// roundsonrh.com — static site (./site) plus one dynamic route:
//
//   GET /meta/<id>   token metadata for Rounds #<id> (the contract's baseURI)
//
// It's the original IPFS metadata, byte for byte, until the Round has been
// held 20+ days by a wallet that has connected to roundsonrh.com/table.
// Then it also carries animation_url → /anim/<id>, the moving version.
// Sell it and the clock (and the motion) starts over with the new owner.
const ROUNDS = 888;
const HOLD_DAYS = 20;
const SITE = "https://roundsonrh.com";

async function asset(env, origin, p) {
  const r = await env.ASSETS.fetch(new Request(origin + p));
  return r.ok ? r.json() : null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/meta\/(\d{1,4})(?:\.json)?\/?$/);
    if (!m) return env.ASSETS.fetch(request);
    const id = Number(m[1]);
    const headers = { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=300" };
    if (!(id >= 1 && id <= ROUNDS)) return new Response(JSON.stringify({ error: "No such Round." }), { status: 404, headers });
    const meta = await asset(env, url.origin, `/meta-src/${id}.json`);
    if (!meta) return new Response(JSON.stringify({ error: "Missing metadata." }), { status: 500, headers });
    let moving = false;
    try {
      const holds = await asset(env, url.origin, "/data/holds.json");
      const h = holds && holds.holds && holds.holds[id];
      if (h && Date.now() / 1000 - Number(h.since) >= HOLD_DAYS * 86400 && env.NAMES) {
        moving = !!(await env.NAMES.get("connected:" + String(h.owner).toLowerCase()));
      }
    } catch { /* any trouble: serve the still, never break metadata */ }
    const out = moving ? { image: meta.image, animation_url: `${SITE}/anim/${id}`, ...meta } : meta;
    return new Response(JSON.stringify(out), { headers });
  },
};
