// roundsonrh.com — static site (./site) plus two dynamic routes:
//
//   GET /meta/<id>          token metadata for Rounds #<id> (the contract's baseURI)
//   GET /anim/<theme>/<id>  the moving version, in a holiday's colors
//
// /meta is the original IPFS metadata, byte for byte, except:
//  · held 20+ days by a wallet that connected to roundsonrh.com/table →
//    adds animation_url (/anim/<id>), the moving version. Sell it and the
//    clock (and the motion) starts over with the new owner.
//  · on a holiday in data/themes.json (midnight to midnight Pacific) →
//    image is that day's recolor (/art/<theme>/<id>.svg), and a moving
//    Round moves in the same colors. Next day it's back to the original.
// KV theme:override = a theme id forces that theme now; "none" switches
// themes off. ?theme=<id|none> on /meta previews without changing anything.
const ROUNDS = 888;
const HOLD_DAYS = 20;
const SITE = "https://roundsonrh.com";

async function asset(env, origin, p) {
  const r = await env.ASSETS.fetch(new Request(origin + p));
  return r.ok ? r.json() : null;
}

async function activeTheme(env, origin, ask) {
  const doc = await asset(env, origin, "/data/themes.json").catch(() => null);
  const list = (doc && doc.themes) || [];
  const pick = ask || (env.NAMES ? await env.NAMES.get("theme:override").catch(() => null) : null);
  if (pick === "none") return null;
  if (pick) return list.find((t) => t.id === pick) || null;
  const now = Date.now();
  return list.find((t) => now >= Date.parse(t.start) && now < Date.parse(t.end)) || null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const a = url.pathname.match(/^\/anim\/([a-z0-9-]+)\/(\d{1,4})\/?$/);
    if (a) {
      const id = Number(a[2]);
      const doc = await asset(env, url.origin, "/data/themes.json").catch(() => null);
      const t = doc && doc.themes.find((x) => x.id === a[1]);
      if (!t || !(id >= 1 && id <= ROUNDS)) return new Response("Not found", { status: 404 });
      const r = await env.ASSETS.fetch(new Request(`${url.origin}/anim/${id}`));
      if (!r.ok) return r;
      const html = (await r.text())
        .replace("background:#000", `background:${t.bg}`)
        .replace('g.fillStyle="#000"', `g.fillStyle="${t.bg}"`)
        .replace('g.fillStyle="#ccff00"', `g.fillStyle="${t.fill}"`);
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=3600" } });
    }

    const m = url.pathname.match(/^\/meta\/(\d{1,4})(?:\.json)?\/?$/);
    if (!m) return env.ASSETS.fetch(request);
    const id = Number(m[1]);
    const headers = { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=300" };
    if (!(id >= 1 && id <= ROUNDS)) return new Response(JSON.stringify({ error: "No such Round." }), { status: 404, headers });
    const meta = await asset(env, url.origin, `/meta-src/${id}.json`);
    if (!meta) return new Response(JSON.stringify({ error: "Missing metadata." }), { status: 500, headers });
    let moving = false, theme = null;
    try {
      const holds = await asset(env, url.origin, "/data/holds.json");
      const h = holds && holds.holds && holds.holds[id];
      if (h && Date.now() / 1000 - Number(h.since) >= HOLD_DAYS * 86400 && env.NAMES) {
        moving = !!(await env.NAMES.get("connected:" + String(h.owner).toLowerCase()));
      }
    } catch { /* any trouble: serve the still, never break metadata */ }
    try { theme = await activeTheme(env, url.origin, url.searchParams.get("theme")); } catch { theme = null; }
    let out = meta;
    if (moving) out = { image: meta.image, animation_url: `${SITE}/anim/${id}`, ...meta };
    if (theme) {
      out = { ...out, image: `${SITE}/art/${theme.id}/${id}.svg` };
      if (moving) out.animation_url = `${SITE}/anim/${theme.id}/${id}`;
    }
    return new Response(JSON.stringify(out), { headers });
  },
};
