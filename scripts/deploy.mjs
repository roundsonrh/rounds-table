// Publishes ./site to the Worker that serves roundsonrh.com and updates the
// name service's holder list. Finds the account and project on its own.
//   CLOUDFLARE_API_TOKEN=… node scripts/deploy.mjs
import { execFileSync } from "child_process";

const TOKEN = (process.env.CLOUDFLARE_API_TOKEN || "").trim();
const KV_NAMESPACE = "c72b23c212a64457aa6e1d29967a90bf";   // rounds-names
if (!TOKEN) { console.error("Set the CLOUDFLARE_API_TOKEN secret."); process.exit(1); }

async function cf(p) {
  const r = await fetch("https://api.cloudflare.com/client/v4" + p, { headers: { Authorization: "Bearer " + TOKEN } });
  const j = await r.json().catch(() => ({}));
  if (!j.success) throw new Error(`Cloudflare ${p}: ${JSON.stringify(j.errors || r.status)}`);
  return j.result;
}

let account = (process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
if (!account) {
  const accts = await cf("/accounts");
  if (!accts.length) throw new Error("This token can't see any Cloudflare account.");
  account = accts[0].id;
  console.log("Account:", accts[0].name);
}
const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: TOKEN };
const run = (args) => execFileSync("npx", ["--yes", "wrangler@3", ...args], { stdio: "inherit", env });

// roundsonrh.com is served by a Worker with static assets (the dashboard's
// "upload files" flow): little-king-16c2. Found by its custom domain so a
// rename doesn't break this; SITE_WORKER overrides.
let worker = (process.env.SITE_WORKER || "").trim();
if (!worker) {
  const domains = await cf(`/accounts/${account}/workers/domains`);
  const hit = domains.find((d) => /(^|\.)roundsonrh\.com$/.test(d.hostname));
  if (!hit) throw new Error("No Worker is attached to roundsonrh.com — set the SITE_WORKER variable.");
  worker = hit.service;
}
console.log(`Publishing site/ to the ${worker} Worker…`);
run(["deploy", "--name", worker, "--assets", "site", "--compatibility-date", "2026-10-01"]);
console.log("Updating the name service's holder list…");
run(["kv", "key", "put", "config:holders", "--path", "holders.json", "--namespace-id", KV_NAMESPACE]);
console.log("Live.");
