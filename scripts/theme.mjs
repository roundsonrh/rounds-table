// Holiday colors, OpenSea side. The site worker flips /meta on its own at
// each theme's start and end (data/themes.json); this asks OpenSea to
// re-read all 888 so marketplaces show it. Runs from theme.yml at 07:03 and
// 08:03 UTC (midnight Pacific, summer and winter) and on every refresh run;
// does nothing unless the live theme changed since it last ran.
//   node scripts/theme.mjs          sync (refresh only if changed)
//   node scripts/theme.mjs --force  refresh all 888 regardless
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const KV = "c72b23c212a64457aa6e1d29967a90bf";
const ROUNDS = "0x8cd655173351c6f619acb907ba08bf920b736d1c";
const SITE = (process.env.SITE_URL || "https://roundsonrh.com").replace(/\/$/, "");
const TOKEN = (process.env.CLOUDFLARE_API_TOKEN || "").trim();
const KEY = (process.env.OPENSEA_API_KEY || "").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cfBase = async () => {
  const j = await (await fetch("https://api.cloudflare.com/client/v4/accounts", { headers: { Authorization: "Bearer " + TOKEN } })).json();
  const acct = (process.env.CLOUDFLARE_ACCOUNT_ID || "").trim() || j.result[0].id;
  return `https://api.cloudflare.com/client/v4/accounts/${acct}/storage/kv/namespaces/${KV}/values/`;
};
const base = await cfBase();
const kvGet = async (k) => { const r = await fetch(base + encodeURIComponent(k), { headers: { Authorization: "Bearer " + TOKEN } }); return r.ok ? (await r.text()).trim() : null; };
const kvPut = async (k, v) => { const r = await fetch(base + encodeURIComponent(k), { method: "PUT", headers: { Authorization: "Bearer " + TOKEN }, body: v }); if (!r.ok) throw new Error("KV put " + r.status); };

// What's live right now — ask the site itself, so this agrees with OpenSea's view.
const meta = await (await fetch(`${SITE}/meta/1?t=${Date.now()}`)).json();
const m = String(meta.image || "").match(/\/art\/([a-z0-9-]+)\//);
const live = m ? m[1] : "none";
const applied = (await kvGet("theme:applied")) || "none";
console.log(`Theme live: ${live} · last pushed to OpenSea: ${applied}`);
if (live === applied && !process.argv.includes("--force")) { console.log("Nothing to do."); process.exit(0); }

let ok = 0, fail = [];
for (let id = 1; id <= 888; id++) {
  let done = false;
  for (let tries = 0; tries < 4 && !done; tries++) {
    const r = await fetch(`https://api.opensea.io/api/v2/chain/robinhood/contract/${ROUNDS}/nfts/${id}/refresh`, { method: "POST", headers: { "x-api-key": KEY, accept: "application/json", "user-agent": "rounds-bot" } }).catch(() => null);
    if (r && r.ok) done = true;
    else await sleep(r && r.status === 429 ? 5000 * (tries + 1) : 1500);
  }
  done ? ok++ : fail.push(id);
  await sleep(600);
}
console.log(`Asked OpenSea to refresh ${ok}/888` + (fail.length ? ` (failed: ${fail.slice(0, 20).join(",")}${fail.length > 20 ? "…" : ""})` : ""));
if (ok >= 850) await kvPut("theme:applied", live);
else process.exit(1);
