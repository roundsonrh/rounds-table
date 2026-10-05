# Rounds — holder table automation

Every 6 hours GitHub runs `.github/workflows/refresh.yml`:

1. `scripts/refresh.mjs` reads every Rounds transfer from Robinhood Chain (owners + hold times),
   asks OpenSea what each holder collects, and rebuilds `site/data/` (the same family-tree math as the old Mac batch).
2. `scripts/deploy.mjs` publishes `site/` to Cloudflare Pages (roundsonrh.com) and updates the name service's holder list.
3. A daily snapshot lands in `history/` for the holder update tweet.

A run that looks broken (OpenSea down, chain short) stops before publishing, so the live site keeps its last good data.

Run it by hand: Actions tab → Refresh holders → Run workflow.

Secrets (Settings → Secrets and variables → Actions):
- `OPENSEA_API_KEY`
- `CLOUDFLARE_API_TOKEN` — Cloudflare Pages: Edit + Workers KV Storage: Edit

Site changes (table.html etc.) go in `site/`.
