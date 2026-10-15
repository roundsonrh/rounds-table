// Holder Tier: each Round carries a trait for how its current owner trades
// across every NFT on Robinhood Chain (past 30 days, from the sellers crawl).
//   node scripts/tiers.mjs compute   (after the sellers cache is restored, before deploy)
//                                    → site/data/tiers.json  { ids: { "<id>": [tier, score] } }
//   node scripts/tiers.mjs refresh   (after deploy) ask OpenSea to re-read Rounds whose tier changed
// Tiers, by the owner's median hold time on sales in the past 30 days:
//   Diamond Hands  no sales in 30 days, or median hold 30+ days
//   Steady Hands   7+ days
//   Swing Trader   1+ day
//   Flipper        1+ hour
//   Paper Hands    under an hour
// Holder Score 0–100 rises with median hold time on a log scale (30 days = 100).
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

export function tierOf(sales, now = Date.now() / 1000) {
  const recent = sales.filter((s) => s.t >= now - WINDOW);
  if (!recent.length) return ["Diamond Hands", 100];
  const hs = recent.map((s) => s.h).filter((h) => h != null).sort((a, b) => a - b);
  const med = hs.length ? hs[Math.floor((hs.length - 1) / 2)] : 7 * DAY; // no known buy times: treat as held a while
  const score = Math.max(1, Math.min(100, Math.round(100 * Math.log1p(med / 3600) / Math.log1p(720))));
  const tier = med >= 30 * DAY ? "Diamond Hands" : med >= 7 * DAY ? "Steady Hands" : med >= DAY ? "Swing Trader" : med >= 3600 ? "Flipper" : "Paper Hands";
  return [tier, score];
}

if (process.argv[2] === "compute") {
  const holds = JSON.parse(fs.readFileSync(path.join(ROOT, "site", "data", "holds.json"), "utf8")).holds;
  let state = null;
  try { state = JSON.parse(fs.readFileSync(path.join(ROOT, ".sellers-state", "accounts.json"), "utf8")); } catch {}
  const now = Date.now() / 1000;
  const byOwner = new Map();
  for (const [a, st] of Object.entries((state && state.accounts) || {})) {
    if (!st.at) continue; // never crawled
    const into = new Map();
    for (const [k, t] of st.ins || []) (into.get(k) || into.set(k, []).get(k)).push(t);
    const sales = (st.sells || []).map(([k, , t]) => {
      const got = (into.get(k) || []).filter((x) => x <= t);
      return { t, h: got.length ? t - Math.max(...got) : null };
    });
    byOwner.set(a.toLowerCase(), tierOf(sales, now));
  }
  const ids = {};
  for (const [id, h] of Object.entries(holds)) {
    const t = byOwner.get(String(h.owner).toLowerCase());
    if (t) ids[id] = t;
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
