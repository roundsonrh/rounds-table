// Sellers data for the table's Sellers tab (informational only).
//   rounds: every Rounds sale on OpenSea + how long the seller held it first
//   chain:  every sale Rounds holders made across Robinhood Chain collections
// Account histories are kept in .sellers-state/ between runs (actions/cache),
// so after the first run only new events are fetched.
//   OPENSEA_API_KEY=… node scripts/sellers.mjs   → site/data/sellers.json
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEY = (process.env.OPENSEA_API_KEY || "").trim();
const SITE = (process.env.SITE_URL || "https://roundsonrh.com").replace(/\/$/, "");
const OUT = path.join(ROOT, "site", "data", "sellers.json");
const STATE_DIR = path.join(ROOT, ".sellers-state");
const STATE = path.join(STATE_DIR, "accounts.json");
const FIRST_PAGES = 12, BUDGET_MIN = Number(process.env.SELLERS_BUDGET_MIN || 100);
const t0 = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function os(url) {
  for (let tries = 0; tries < 6; tries++) {
    const wait = 520 - (Date.now() - last); if (wait > 0) await sleep(wait);
    last = Date.now();
    const r = await fetch(url, { headers: { "x-api-key": KEY, accept: "application/json", "user-agent": "rounds-bot" } }).catch(() => null);
    if (r && r.ok) return r.json();
    if (r && r.status === 404) return null;
    await sleep(r && r.status === 429 ? 5000 * (tries + 1) : 1500);
  }
  return null;
}
const med = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const ethUsd = await fetch(SITE + "/data/floors.json").then((r) => r.json()).then((j) => j.eth_usd).catch(() => null);
const toEth = (pay) => {
  if (!pay || !pay.quantity) return null;
  const v = Number(pay.quantity) / 10 ** (pay.decimals || 18);
  if (pay.symbol === "ETH" || pay.symbol === "WETH") return v;
  if ((pay.symbol === "USDG" || pay.symbol === "USDC") && ethUsd) return v / ethUsd;
  return null;
};
const r6 = (x) => (x == null ? null : Math.round(x * 1e6) / 1e6);

/* ---------------- Rounds: the collection's own sales ---------------- */
const rev = [];
{
  let next = null, pages = 0;
  do {
    const j = await os("https://api.opensea.io/api/v2/events/collection/roundsonrh?event_type=sale&event_type=transfer&limit=50" + (next ? "&next=" + encodeURIComponent(next) : ""));
    if (!j) break;
    rev.push(...(j.asset_events || [])); next = j.next; pages++;
  } while (next && pages < 1000);
}
function summarize(sales) {
  const by = new Map();
  for (const s of sales) (by.get(s.a) || by.set(s.a, []).get(s.a)).push(s);
  const sellers = [...by].map(([a, xs]) => {
    const hs = xs.map((s) => s.h).filter((h) => h != null);
    return { a, n: xs.length, vol: r6(xs.reduce((v, s) => v + (s.p || 0), 0)), med: med(hs), min: hs.length ? Math.min(...hs) : null, cols: new Set(xs.map((s) => s.c)).size, last: Math.max(...xs.map((s) => s.t)) };
  }).sort((x, y) => (y.n - x.n) || ((x.med ?? 1e12) - (y.med ?? 1e12)));
  const holds = sales.map((s) => s.h).filter((h) => h != null);
  return { sales: sales.length, sellers_count: sellers.length, median_hold: med(holds), within_day: holds.filter((h) => h < 86400).length, held_known: holds.length, sellers: sellers.slice(0, 300),
    fastest: sales.filter((s) => s.h != null).sort((x, y) => (x.h - y.h) || (y.t - x.t)).slice(0, 150) };
}
function holdsFrom(events, keyOf) {
  const into = new Map();
  for (const e of events) if (e.event_type === "transfer" && e.nft) {
    const k = keyOf(e) + ":" + String(e.to_address).toLowerCase();
    (into.get(k) || into.set(k, []).get(k)).push(e.event_timestamp);
  }
  return into;
}
let rounds = null;
{
  const into = holdsFrom(rev, (e) => e.nft.identifier);
  const sales = rev.filter((e) => e.event_type === "sale" && e.nft).map((e) => {
    const a = String(e.seller).toLowerCase(), t = e.event_timestamp;
    const got = (into.get(e.nft.identifier + ":" + a) || []).filter((x) => x <= t);
    return { c: "roundsonrh", id: e.nft.identifier, a, t, h: got.length ? t - Math.max(...got) : null, p: r6(toEth(e.payment)) };
  });
  if (sales.length) rounds = summarize(sales);
}

/* ---------------- Chain: what Rounds holders sell everywhere ---------------- */
let state = { accounts: {} };
try { state = JSON.parse(fs.readFileSync(STATE, "utf8")); } catch {}
const holds = await fetch(SITE + "/data/holds.json").then((r) => r.json()).then((j) => j.holds).catch(() => null);
const holders = holds ? [...new Set(Object.values(holds).map((h) => String(h.owner).toLowerCase()))] : Object.keys(state.accounts);
// oldest-refreshed first, so a run that runs out of time picks up where the last one stopped
holders.sort((a, b) => ((state.accounts[a] || {}).at || 0) - ((state.accounts[b] || {}).at || 0));
let done = 0;
for (const a of holders) {
  if ((Date.now() - t0) / 60000 > BUDGET_MIN) break;
  const st = state.accounts[a] || { ins: [], sells: [], newest: 0, at: 0 };
  let next = null, pages = 0, newest = st.newest;
  const cap = st.newest ? 40 : FIRST_PAGES;
  outer: do {
    const j = await os(`https://api.opensea.io/api/v2/events/accounts/${a}?chain=robinhood&event_type=sale&event_type=transfer&limit=50` + (st.newest ? `&after=${st.newest}` : "") + (next ? "&next=" + encodeURIComponent(next) : ""));
    if (!j) break;
    for (const e of j.asset_events || []) {
      if (!e.nft) continue;
      if (e.event_timestamp <= st.newest) break outer;
      newest = Math.max(newest, e.event_timestamp);
      const k = String(e.nft.contract).toLowerCase() + ":" + e.nft.identifier;
      if (e.event_type === "transfer" && String(e.to_address).toLowerCase() === a) st.ins.push([k, e.event_timestamp]);
      if (e.event_type === "sale" && String(e.seller).toLowerCase() === a) st.sells.push([k, e.nft.collection, e.event_timestamp, r6(toEth(e.payment))]);
    }
    next = j.next; pages++;
  } while (next && pages < cap);
  st.newest = newest; st.at = Date.now();
  state.accounts[a] = st; done++;
}
fs.mkdirSync(STATE_DIR, { recursive: true });
fs.writeFileSync(STATE, JSON.stringify(state));

const chainSales = [];
for (const [a, st] of Object.entries(state.accounts)) {
  const into = new Map();
  for (const [k, t] of st.ins) (into.get(k) || into.set(k, []).get(k)).push(t);
  for (const [k, c, t, p] of st.sells) {
    const got = (into.get(k) || []).filter((x) => x <= t);
    chainSales.push({ c, id: k.split(":")[1], a, t, h: got.length ? t - Math.max(...got) : null, p });
  }
}
let chain = null;
if (chainSales.length) {
  chain = summarize(chainSales);
  chain.accounts = Object.keys(state.accounts).length;
  chain.never_sold = Object.values(state.accounts).filter((s) => !s.sells.length).length;
  const byC = new Map();
  for (const s of chainSales) (byC.get(s.c) || byC.set(s.c, []).get(s.c)).push(s);
  chain.collections = [...byC].map(([c, xs]) => ({ c, n: xs.length, sellers: new Set(xs.map((s) => s.a)).size, med: med(xs.map((s) => s.h)), within_day: xs.filter((s) => s.h != null && s.h < 86400).length, known: xs.filter((s) => s.h != null).length }))
    .filter((x) => x.n >= 10).sort((x, y) => y.n - x.n).slice(0, 80);
  // readable names for the collections we show
  let names = {};
  try { names = JSON.parse(fs.readFileSync(path.join(STATE_DIR, "names.json"), "utf8")); } catch {}
  for (const x of chain.collections) {
    if (!(x.c in names) && (Date.now() - t0) / 60000 < BUDGET_MIN + 10) {
      const j = await os("https://api.opensea.io/api/v2/collections/" + encodeURIComponent(x.c));
      names[x.c] = (j && j.name) || null;
    }
  }
  fs.writeFileSync(path.join(STATE_DIR, "names.json"), JSON.stringify(names));
  chain.names = Object.fromEntries(chain.collections.map((x) => [x.c, names[x.c] || null]));
  for (const s of chain.fastest) if (!(s.c in chain.names)) chain.names[s.c] = names[s.c] || null;
}

if (!rounds && !chain) { console.log("No sales data — keeping the last sellers.json"); process.exit(0); }
let prev = {};
try { prev = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch {}
fs.writeFileSync(OUT, JSON.stringify({ generated_at: new Date().toISOString(), eth_usd: ethUsd, rounds: rounds || prev.rounds || null, chain: chain || prev.chain || null }));
console.log(`Sellers: Rounds ${rounds ? rounds.sales : "-"} sales · chain ${chain ? chain.sales : "-"} sales from ${chain ? chain.accounts : 0} holders (${done} refreshed this run, ${Math.round((Date.now() - t0) / 60000)} min)`);
