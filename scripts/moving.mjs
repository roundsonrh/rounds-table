// Moving Rounds bookkeeping, run by the workflow around each deploy.
//   node scripts/moving.mjs compute   (before deploy) which Rounds move now → site/data/moving.json
//   node scripts/moving.mjs refresh   (after deploy)  ask OpenSea to re-read the ones that changed
// A Round moves once it's been held 20+ days by the same wallet.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const KV = "c72b23c212a64457aa6e1d29967a90bf";
const ROUNDS = "0x8cd655173351c6f619acb907ba08bf920b736d1c";
const SITE = (process.env.SITE_URL || "https://www.roundsonrh.com").replace(/\/$/, "");
const DAYS = 20;
const DIFF = path.join(ROOT, "moving-diff.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (process.argv[2] === "compute") {
  const holds = JSON.parse(fs.readFileSync(path.join(ROOT, "site", "data", "holds.json"), "utf8")).holds;
  const now = Date.now() / 1000;
  const ids = Object.entries(holds).filter(([, h]) => now - Number(h.since) >= DAYS * 86400).map(([id]) => id).sort((a, b) => a - b);
  let prev = [];
  try { prev = (await (await fetch(`${SITE}/data/moving.json?t=${Date.now()}`)).json()).ids || []; } catch {}
  const a = new Set(ids), b = new Set(prev);
  const changed = [...ids.filter((x) => !b.has(x)), ...prev.filter((x) => !a.has(x))];
  fs.writeFileSync(path.join(ROOT, "site", "data", "moving.json"), JSON.stringify({ generated_at: new Date().toISOString(), days: DAYS, ids }));
  fs.writeFileSync(DIFF, JSON.stringify(changed));
  console.log(`Moving Rounds: ${ids.length} · ${changed.length} changed since last run`);
} else if (process.argv[2] === "refresh") {
  const KEY = (process.env.OPENSEA_API_KEY || "").trim();
  let ids = [];
  try { ids = JSON.parse(fs.readFileSync(DIFF, "utf8")); } catch {}
  let ok = 0;
  for (const id of ids.slice(0, 888)) {
    for (let tries = 0; tries < 4; tries++) {
      const r = await fetch(`https://api.opensea.io/api/v2/chain/robinhood/contract/${ROUNDS}/nfts/${id}/refresh`, { method: "POST", headers: { "x-api-key": KEY, accept: "application/json", "user-agent": "rounds-bot" } }).catch(() => null);
      if (r && r.ok) { ok++; break; }
      await sleep(r && r.status === 429 ? 5000 * (tries + 1) : 1500);
    }
    await sleep(600);
  }
  console.log(`Asked OpenSea to refresh ${ok}/${Math.min(ids.length, 888)} Rounds`);
}
