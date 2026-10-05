// Publishes ./site to the Rounds Cloudflare Pages project and updates the
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
const projects = await cf(`/accounts/${account}/pages/projects`);
const want = (process.env.PAGES_PROJECT || "").trim();
const project = want ? projects.find((p) => p.name === want)
  : projects.find((p) => (p.domains || []).some((d) => /roundsonrh\.com$/.test(d))) || (projects.length === 1 ? projects[0] : null);
if (!project) throw new Error(`Couldn't tell which Pages project is the site (found: ${projects.map((p) => p.name).join(", ") || "none"}). Set the PAGES_PROJECT variable.`);
console.log(`Deploying to ${project.name} (${project.production_branch})…`);

const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: TOKEN };
const run = (args) => execFileSync("npx", ["--yes", "wrangler@3", ...args], { stdio: "inherit", env });
run(["pages", "deploy", "site", "--project-name", project.name, "--branch", project.production_branch, "--commit-dirty=true"]);
console.log("Updating the name service's holder list…");
run(["kv", "key", "put", "config:holders", "--path", "holders.json", "--namespace-id", KV_NAMESPACE]);
console.log("Live.");
