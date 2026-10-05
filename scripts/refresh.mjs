// Rounds holder refresh — runs on GitHub Actions, no Mac needed.
//
//   1. Owners + hold times: every Rounds Transfer event, read straight from
//      Robinhood Chain's public RPC.
//   2. What each holder collects: OpenSea's per-wallet NFT list.
//   3. The family tree, built exactly like the old Mac batch (family.mjs).
//   4. Writes site/data/{family_tree,holds,floor-targets,floors}.json,
//      holders.json (for the name worker) and history/<date>.json.
//
// Refuses to write anything if the result looks broken (OpenSea down, RPC
// short), so a bad run never replaces good data on the live site.
//
//   OPENSEA_API_KEY=… node scripts/refresh.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildFamilyTree } from "./family.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "site", "data");
const SITE = (process.env.SITE_URL || "https://www.roundsonrh.com").replace(/\/$/, "");
const RPC = process.env.RH_RPC || "https://rpc.mainnet.chain.robinhood.com";
const KEY = (process.env.OPENSEA_API_KEY || "").trim();
const ROUNDS = "0x8cd655173351c6f619acb907ba08bf920b736d1c";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const START_BLOCK = 68270000;          // just before the mint (first transfer: 68280043)
const LOG_SPAN = 100000;               // the RPC's eth_getLogs limit
const MAX_PAGES = 50;                  // 50 × 200 NFTs per wallet is plenty
const CONCURRENCY = 4;
const FLOOR_MIN_HOLDERS = 10;

if (!KEY) { console.error("Set OPENSEA_API_KEY."); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const startedAt = new Date().toISOString();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* ------------------------------------------------------------ helpers */
async function rpc(method, params) {
  let err;
  for (let i = 0; i < 8; i++) {
    try {
      const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(30000) });
      const j = await r.json();
      if (j.result !== undefined) return j.result;
      err = new Error(JSON.stringify(j.error));
    } catch (e) { err = e; }
    await sleep(1000 * (i + 1));
  }
  throw err;
}
// OpenSea allows ~120 requests a minute per key. Space them out rather than
// bouncing off 429s.
const GAP_MS = 540;
let nextSlot = 0;
async function slot() {
  const now = Date.now(), at = Math.max(now, nextSlot);
  nextSlot = at + GAP_MS;
  if (at > now) await sleep(at - now);
}
async function opensea(p) {
  let err;
  for (let i = 0; i < 10; i++) {
    await slot();
    try {
      const r = await fetch("https://api.opensea.io/api/v2" + p, {
        headers: { "x-api-key": KEY, accept: "application/json", "user-agent": "rounds-refresh/1.0" },
        signal: AbortSignal.timeout(30000) });
      if (r.status === 404) return null;
      if (r.status === 429) { err = new Error("OpenSea 429"); nextSlot = Date.now() + 15000; continue; }
      if (r.status >= 500) { err = new Error("OpenSea " + r.status); await sleep(3000 * (i + 1)); continue; }
      if (!r.ok) throw new Error("OpenSea " + r.status);
      return await r.json();
    } catch (e) { err = e; await sleep(2000); }
  }
  throw err;
}
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}
async function prevJson(file) {
  try {
    const r = await fetch(`${SITE}/data/${file}?t=${Date.now()}`, { signal: AbortSignal.timeout(60000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/* ------------------------------------------- 1. owners from the chain */
async function scanOwners() {
  const head = parseInt(await rpc("eth_blockNumber", []), 16);
  const logs = [];
  const stamps = [];   // [block, unix] samples for dating each transfer
  let calls = 0;
  for (let from = START_BLOCK; from <= head; from += LOG_SPAN) {
    const to = Math.min(head, from + LOG_SPAN - 1);
    const got = await rpc("eth_getLogs", [{ address: ROUNDS, topics: [TRANSFER],
      fromBlock: "0x" + from.toString(16), toBlock: "0x" + to.toString(16) }]);
    calls++;
    if (got.length) {
      logs.push(...got);
      // a timestamp at each end of the window; transfers between are interpolated
      for (const b of [from, to]) stamps.push([b, parseInt((await rpc("eth_getBlockByNumber", ["0x" + b.toString(16), false])).timestamp, 16)]);
    }
  }
  stamps.sort((a, b) => a[0] - b[0]);
  const when = (b) => {
    let k = stamps.findIndex((s) => s[0] >= b);
    if (k === -1) return stamps[stamps.length - 1][1];
    if (k <= 0) return stamps[Math.max(k, 0)][1];
    const [b0, t0] = stamps[k - 1], [b1, t1] = stamps[k];
    return Math.round(t0 + (t1 - t0) * (b - b0) / Math.max(1, b1 - b0));
  };
  logs.sort((a, b) => (parseInt(a.blockNumber, 16) - parseInt(b.blockNumber, 16)) || (parseInt(a.logIndex, 16) - parseInt(b.logIndex, 16)));
  const holds = new Map();
  for (const l of logs) {
    if (l.topics.length < 4) continue;
    const id = String(BigInt(l.topics[3]));
    const to = "0x" + l.topics[2].slice(26).toLowerCase();
    holds.set(id, { since: when(parseInt(l.blockNumber, 16)), owner: to });
  }
  for (const [id, h] of holds) if (/^0x0{40}$/.test(h.owner)) holds.delete(id);   // burned
  return { head, calls, transfers: logs.length,
    holds: Object.fromEntries([...holds.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) };
}

/* -------------------------------------- 2. holdings from OpenSea */
async function walletNfts(addr) {
  const out = [];
  let next = null, pages = 0;
  do {
    const j = await opensea(`/chain/robinhood/account/${addr}/nfts?limit=200` + (next ? `&next=${encodeURIComponent(next)}` : ""));
    if (!j) break;
    for (const n of j.nfts || []) out.push({ collection_address: String(n.contract || "").toLowerCase(), slug: n.collection || null, token_id: n.identifier });
    next = j.next; pages++;
  } while (next && pages < MAX_PAGES);
  return out;
}

/* ---------------------------------------------------------------- run */
log("Loading the live site's current data…");
const [prevTree, prevTargets, prevFloors] = await Promise.all([prevJson("family_tree.json"), prevJson("floor-targets.json"), prevJson("floors.json")]);
if (!prevTree) log("  (no previous family tree — starting clean)");

log("Reading Rounds transfers from Robinhood Chain…");
const chain = await scanOwners();
const owners = new Map();
for (const [id, h] of Object.entries(chain.holds)) { if (!owners.has(h.owner)) owners.set(h.owner, []); owners.get(h.owner).push(id); }
for (const ids of owners.values()) ids.sort((x, y) => Number(y) - Number(x));
log(`  ${chain.transfers} transfers · ${Object.keys(chain.holds).length} Rounds · ${owners.size} holders`);
if (Object.keys(chain.holds).length < 800) throw new Error("Fewer than 800 Rounds found on-chain — refusing to continue.");

// QUICK mode (between full runs): owners and hold times only. Collections
// stay as the last full run left them; sold-out wallets drop, new buyers join.
if (process.env.MODE === "quick" && prevTree && prevTree.holders) {
  const tree = prevTree;
  const gone = new Set(Object.keys(tree.meta || {}).filter((a) => !owners.has(a)));
  for (const a of gone) { delete tree.meta[a]; delete tree.holders[a]; }
  for (const h of Object.values(tree.holders)) h.connections = (h.connections || []).filter((c) => !gone.has(c.addr));
  for (const [a, ids] of owners) tree.meta[a] = { ens: (tree.meta[a] && tree.meta[a].ens) || null, rounds_token_ids: ids };
  const now = new Date().toISOString();
  tree.holder_count = owners.size;
  tree.owners_synced_at = now;
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, "family_tree.json"), JSON.stringify(tree));
  fs.writeFileSync(path.join(DATA, "holds.json"), JSON.stringify({ generated_at: now, contract: ROUNDS, transfers_scanned: chain.transfers, pages_scanned: chain.calls, truncated: false, holds: chain.holds }));
  if (prevTargets) fs.writeFileSync(path.join(DATA, "floor-targets.json"), JSON.stringify(prevTargets));
  if (prevFloors) fs.writeFileSync(path.join(DATA, "floors.json"), JSON.stringify(prevFloors));
  fs.writeFileSync(path.join(ROOT, "holders.json"), JSON.stringify([...owners.keys()]));
  log(`Quick refresh done: ${owners.size} holders (${gone.size} sold out since last run)`);
  process.exit(0);
}

// previous data, for fallbacks
const prevCols = (prevTree && prevTree.collections) || [];
const nameOf = new Map(prevCols.map((c) => [c.a.toLowerCase(), c.name]));
const slugOf = new Map();
for (const [slug, addrs] of Object.entries((prevTargets && prevTargets.slugs) || {})) for (const a of addrs) slugOf.set(a.toLowerCase(), slug);

log(`Fetching collections for ${owners.size} holders from OpenSea…`);
const holdings = {};
const failed = [];
let done = 0;
await pool([...owners.keys()], CONCURRENCY, async (addr) => {
  try {
    const nfts = await walletNfts(addr);
    for (const n of nfts) if (n.slug) slugOf.set(n.collection_address, n.slug);
    holdings[addr] = nfts.filter((n) => n.collection_address !== ROUNDS);
  } catch (e) {
    failed.push(addr);
    // keep what we knew about this wallet last time rather than dropping it
    const ph = prevTree && prevTree.holders && prevTree.holders[addr];
    holdings[addr] = ph ? ph.collections.flatMap((i, k) => Array.from({ length: (ph.counts && ph.counts[k]) || 1 },
      () => ({ collection_address: prevCols[i].a.toLowerCase(), token_id: null }))) : [];
  }
  // the family tree only counts wallets holding a Round; the chain is the source of truth for that
  holdings[addr].push(...owners.get(addr).map((id) => ({ collection_address: ROUNDS, token_id: id })));
  if (++done % 100 === 0) log(`  ${done}/${owners.size}`);
});
log(`  done · ${failed.length} wallet(s) fell back to last run's data`);
if (failed.length > owners.size * 0.1) throw new Error(`OpenSea failed for ${failed.length} wallets — not publishing a half-empty table.`);

// names for collections we haven't seen before (shared by 2+ holders only)
const counts = new Map();
for (const list of Object.values(holdings)) for (const a of new Set(list.map((n) => n.collection_address))) counts.set(a, (counts.get(a) || 0) + 1);
const unnamed = [...counts].filter(([a, n]) => n >= 2 && a !== ROUNDS && !nameOf.has(a) && slugOf.has(a)).map(([a]) => a).slice(0, 400);
log(`Looking up ${unnamed.length} new collection name(s)…`);
await pool(unnamed, CONCURRENCY, async (a) => {
  try { const j = await opensea(`/collections/${encodeURIComponent(slugOf.get(a))}`); if (j && j.name) nameOf.set(a, j.name); } catch {}
});
for (const list of Object.values(holdings)) for (const n of list) n.collection_name = nameOf.get(n.collection_address) || null;

log("Building the family tree…");
const familyTree = buildFamilyTree(holdings, owners.size);
const prevMeta = (prevTree && prevTree.meta) || {};
const meta = {};
for (const [a, ids] of owners) meta[a] = { ens: (prevMeta[a] && prevMeta[a].ens) || null, rounds_token_ids: ids };
const finishedAt = new Date().toISOString();
const tree = { generated_at: finishedAt, started_at: startedAt, rounds_contract: ROUNDS, holder_count: owners.size,
  meta, ...familyTree, owners_synced_at: finishedAt, source: "opensea" };
if (familyTree.collections.length < prevCols.length * 0.5) throw new Error(`Only ${familyTree.collections.length} collections (was ${prevCols.length}) — something's off, not publishing.`);

const holdsDoc = { generated_at: finishedAt, contract: ROUNDS, transfers_scanned: chain.transfers, pages_scanned: chain.calls, truncated: false, holds: chain.holds };

// collections the floors worker should price
const bySlug = {};
for (const c of familyTree.collections) if (c.holder_count >= FLOOR_MIN_HOLDERS && slugOf.has(c.a)) (bySlug[slugOf.get(c.a)] ||= []).push(c.a);
bySlug[slugOf.get(ROUNDS) || "roundsonrh"] = [ROUNDS];

/* ------------------------------------------------------------- write */
fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(path.join(DATA, "family_tree.json"), JSON.stringify(tree));
fs.writeFileSync(path.join(DATA, "holds.json"), JSON.stringify(holdsDoc));
fs.writeFileSync(path.join(DATA, "floor-targets.json"), JSON.stringify({ generated_at: finishedAt, slugs: bySlug }));
if (prevFloors) fs.writeFileSync(path.join(DATA, "floors.json"), JSON.stringify(prevFloors));
fs.writeFileSync(path.join(ROOT, "holders.json"), JSON.stringify([...owners.keys()]));

// a daily snapshot for the holder-update tweet (one per UTC day, latest wins)
const snapCounts = {};
for (const [a, h] of Object.entries(familyTree.holders)) for (const i of h.collections) {
  const c = familyTree.collections[i]; (snapCounts[c.a] ||= { name: c.name, n: 0 }).n++;
}
fs.mkdirSync(path.join(ROOT, "history"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "history", finishedAt.slice(0, 10) + ".json"), JSON.stringify({
  at: finishedAt, data_at: finishedAt, holder_count: owners.size, with_collection_data: Object.keys(familyTree.holders).length,
  holders: Object.fromEntries(owners), collections: snapCounts,
  since: Object.fromEntries(Object.entries(chain.holds).map(([id, v]) => [id, v.since])) }));

log(`Done: ${owners.size} holders · ${familyTree.collections.length} collections · ${Object.keys(bySlug).length} priced · ${((Date.now() - Date.parse(startedAt)) / 60000).toFixed(1)} min`);
