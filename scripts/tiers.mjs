// Holder Tier: each Round carries a trait for how its current owner trades
// across every NFT on Robinhood Chain (past 30 days, from the sellers crawl).
//   node scripts/tiers.mjs compute   (after the sellers cache is restored, before deploy)
//                                    → site/data/tiers.json  { ids: { "<id>": [tier, score] } }
//   node scripts/tiers.mjs refresh   (after deploy) ask OpenSea to re-read Rounds whose tier changed
// Holder Score (0–100) blends three things, each scored 0–1 on a log scale
// where 30 days = full marks:
//   45%  sell patience   median hold on the owner's sales across RH Chain, past 30 days
//                        (no sales = 1, sales with no known buy time = 0.5)
//   35%  this Round      how long the current owner has held this Round
//   20%  turnover        1 − (sales ÷ NFTs received) in the past 30 days, floored at 0
// Tier from the score:
//   85+ Diamond Hands · 65+ Steady Hands · 45+ Swing Trader · 25+ Flipper · under 25 Paper Hands
// Owners the crawl hasn't reached yet get no tier until it does.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROUNDS = "0x8cd655173351c6f619acb907ba08bf920b736d1c";
const SITE = (process.env.SITE_URL || "https://roundsonrh.com").replace(/\/$/, "");
const OUT = path.join(ROOT, "site", "data", "tiers.json");
const DIFF = path.join(ROOT, "tiers-diff.json");
const DAY = 86400, WINDOW = 30 * DAY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const logScore = (sec) => Math.max(0, Math.min(1, Math.log1p(sec / 3600) / Math.log1p(720)));
export function ownerStats(st, now = Date.now() / 1000) {
  const into = new Map();
  for (const [k, t] of st.ins || []) (into.get(k) || into.set(k, []).get(k)).push(t);
  const sales = (st.sells || []).filter(([, , t]) => t >= now - WINDOW).map(([k, , t]) => {
    const got = (into.get(k) || []).filter((x) => x <= t);
    return got.length ? t - Math.max(...got) : null;
  });
  const hs = sales.filter((h) => h != null).sort((a, b) => a - b);
  const patience = !sales.length ? 1 : hs.length ? logScore(hs[Math.floor((hs.length - 1) / 2)]) : 0.5;
  const received = (st.ins || []).filter(([, t]) => t >= now - WINDOW).length;
  const turnover = 1 - Math.min(1, sales.length / Math.max(1, received));
  return { patience, turnover };
}
export function tierOf(o, heldSec) {
  const score = Math.round(100 * (0.45 * o.patience + 0.35 * logScore(heldSec) + 0.2 * o.turnover));
  const tier = score >= 85 ? "Diamond Hands" : score >= 65 ? "Steady Hands" : score >= 45 ? "Swing Trader" : score >= 25 ? "Flipper" : "Paper Hands";
  return [tier, Math.max(1, score)];
}

if (process.argv[2] === "compute") {
  const holds = JSON.parse(fs.readFileSync(path.join(ROOT, "site", "data", "holds.json"), "utf8")).holds;
  let state = null;
  try { state = JSON.parse(fs.readFileSync(path.join(ROOT, ".sellers-state", "accounts.json"), "utf8")); } catch {}
  const now = Date.now() / 1000;
  const byOwner = new Map();
  for (const [a, st] of Object.entries((state && state.accounts) || {})) {
    if (st.at) byOwner.set(a.toLowerCase(), ownerStats(st, now)); // skip never-crawled
  }
  const ids = {};
  for (const [id, h] of Object.entries(holds)) {
    const o = byOwner.get(String(h.owner).toLowerCase());
    if (o) ids[id] = tierOf(o, now - Number(h.since));
  }
  let prev = {};
  try { prev = (await (await fetch(`${SITE}/data/tiers.json?t=${Date.now()}`)).json()).ids || {}; } catch {}
  const all = new Set([...Object.keys(ids), ...Object.keys(prev)]);
  const changed = [...all].filter((id) => JSON.stringify(ids[id] || null) !== JSON.stringify(prev[id] || null)).sort((a, b) => a - b);
  fs.writeFileSync(OUT, JSON.stringify({ generated_at: new Date().toISOString(), window_days: 30, ids }));
  fs.writeFileSync(DIFF, JSON.stringify(changed));
  const count = {};
  for (const [t] of Object.values(ids)) count[t] = (count[t] || 0) + 1;
  console.log(`Holder tiers: ${Object.keys(ids).length} Rounds · ${JSON.stringify(count)} · ${changed.length} changed`);
} else if (process.argv[2] === "refresh") {
  const KEY = (process.env.OPENSEA_API_KEY || "").trim();
  let ids = [];
  try { ids = JSON.parse(fs.readFileSync(DIFF, "utf8")); } catch {}
  let moved = [];
  try { moved = JSON.parse(fs.readFileSync(path.join(ROOT, "moving-diff.json"), "utf8")); } catch {}
  ids = ids.filter((id) => !moved.includes(id)); // already refreshed by moving.mjs
  let ok = 0;
  for (const id of ids.slice(0, 888)) {
    for (let tries = 0; tries < 4; tries++) {
      const r = await fetch(`https://api.opensea.io/api/v2/chain/robinhood/contract/${ROUNDS}/nfts/${id}/refresh`, { method: "POST", headers: { "x-api-key": KEY, accept: "application/json", "user-agent": "rounds-bot" } }).catch(() => null);
      if (r && r.ok) { ok++; break; }
      await sleep(r && r.status === 429 ? 5000 * (tries + 1) : 1500);
    }
    await sleep(600);
  }
  console.log(`Asked OpenSea to refresh ${ok}/${Math.min(ids.length, 888)} Rounds for tier changes`);
}
