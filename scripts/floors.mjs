// Floor price + volume from OpenSea for every collection in
// site/data/floor-targets.json (written by refresh.mjs). Writes
// site/data/floors.json. A collection that can't be read keeps its last
// numbers, so a hiccup never blanks the chart.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "site", "data");
const KEY = (process.env.OPENSEA_API_KEY || "").trim();
const LIMIT = Number(process.env.FLOORS_LIMIT || 0);
if (!KEY) { console.error("Set OPENSEA_API_KEY."); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const GAP_MS = 540;   // ~110 requests a minute, under OpenSea's 120
let nextSlot = 0;
async function slot() { const now = Date.now(), at = Math.max(now, nextSlot); nextSlot = at + GAP_MS; if (at > now) await sleep(at - now); }
async function stats(slug) {
  for (let i = 0; i < 6; i++) {
    await slot();
    try {
      const r = await fetch(`https://api.opensea.io/api/v2/collections/${encodeURIComponent(slug)}/stats`, {
        headers: { "x-api-key": KEY, accept: "application/json", "user-agent": "rounds-refresh/1.0" }, signal: AbortSignal.timeout(30000) });
      if (r.status === 404) return null;
      if (r.status === 429) { nextSlot = Date.now() + 15000; continue; }
      if (!r.ok) { await sleep(2000); continue; }
      return await r.json();
    } catch { await sleep(2000); }
  }
  return undefined;
}

const targets = JSON.parse(fs.readFileSync(path.join(DATA, "floor-targets.json"), "utf8")).slugs;
let prev = null;
try { prev = JSON.parse(fs.readFileSync(path.join(DATA, "floors.json"), "utf8")); } catch {}
const out = { ...((prev && prev.collections) || {}) };

let ethUsd = null;
try { ethUsd = +(await (await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot")).json()).data.amount || null; } catch {}
ethUsd = ethUsd || (prev && prev.eth_usd) || null;
const usd = (v, sym) => (/^(USDG|USDC|USDT|DAI)$/i.test(sym || "") ? +(+v).toFixed(4)
  : ethUsd && /^W?ETH$/i.test(sym || "ETH") ? +(v * ethUsd).toFixed(4) : null);

let slugs = Object.keys(targets);
if (LIMIT) slugs = slugs.slice(0, LIMIT);
let ok = 0, failed = 0;
for (const slug of slugs) {
  const j = await stats(slug);
  if (!j || !j.total) { if (j === undefined) failed++; continue; }
  const iv = Object.fromEntries((j.intervals || []).map((x) => [x.interval, x]));
  const sym = j.total.floor_price_symbol || "ETH", vsym = j.total.volume_symbol || "ETH";
  const floor = j.total.floor_price || 0;
  const row = {
    slug, floor, sym, floor_usd: usd(floor, sym),
    vol_1d: (iv.one_day || {}).volume || 0, vol_7d: (iv.seven_day || {}).volume || 0, vol: j.total.volume || 0,
    vol_1d_usd: usd((iv.one_day || {}).volume || 0, vsym), vol_7d_usd: usd((iv.seven_day || {}).volume || 0, vsym),
    sales_1d: (iv.one_day || {}).sales || 0, sales_7d: (iv.seven_day || {}).sales || 0, owners: j.total.num_owners || 0,
  };
  for (const a of targets[slug]) out[a] = row;
  ok++;
}
fs.writeFileSync(path.join(DATA, "floors.json"), JSON.stringify({
  generated_at: new Date().toISOString(), source: "OpenSea", eth_usd: ethUsd, collections: out }));
console.log(`Floors: ${ok} collections priced` + (failed ? `, ${failed} kept their last numbers` : ""));
