// Family-tree builder, unchanged from the Mac batch (batch.js).
const ROUNDS_CONTRACT = "0x8cd655173351c6f619acb907ba08bf920b736d1c";
const MAX_CONNECTIONS_PER_HOLDER = 60;

// Connection strength is normalised by how much each wallet holds overall.
// Without it, mega-collectors dominate: one wallet holding 1,349 collections
// appeared in the top-5 "family" of 187 of 708 holders, purely because
// holding everything means overlapping with everyone. Dividing by the
// geometric mean of both footprints makes the score "how similar is your
// taste" rather than "how much do you own". DAMPING stops the opposite
// failure, where a wallet holding 3 collections looks like a perfect match
// to everything it touches.
const FOOTPRINT_DAMPING = 25;

// "Overlaps with at least one collection" is useless as a headline: the
// median holder overlaps with 693 of 703 others, because a few collections
// are near-universal. Counting only holders sharing 10+ gives a number that
// actually varies per person.
const CLOSE_CONNECTION_MIN_SHARED = 10;

// Optional curated allowlist of collections to include. Leave EMPTY to
// include every collection shared by 2+ holders. Keyed by contract address,
// not name, on purpose: this chain has dozens of copycat contracts reusing
// the same name (20+ "Clay StonKz"), so names can't identify a collection.
const COLLECTION_ALLOWLIST = [
  // "0xde0acefc89d4cf5f4ce45a4fb8a51aa355091b44", // Clay StonKz
];
const allowSet = new Set(COLLECTION_ALLOWLIST.map((a) => a.toLowerCase()));

// Wallets not worth fetching. Each of these has an NFT history so large that
// Blockscout pages it slowly and the run can hit the 200-page cap without ever
// reaching its Rounds — hours of work for a wallet that gets dropped anyway.
// Skipped wallets are left out of the family tree, same as before.
export const SKIP_WALLETS = new Set([
  "0xb4d1204685b9b471557ac233f2bcee88d21675bf", // stalled the 9/28 run; capped out on 9/27
].map((a) => a.toLowerCase()));

// Collections dropped from the family tree entirely — not shown, not scored.
// Near-universal airdrops and scams otherwise make everyone "related" to
// everyone. Keyed by contract address for the same reason as the allowlist.
const COLLECTION_BLOCKLIST = [
  "0x019695a94464e8c6252f03e58980dea550c2a19a", // unnamed scam airdrop (~90% of holders)
  "0x14c49e6118f46525de9ab41a51cbaa3c6ebf181d", // Rare Friends Generations
];
const blockSet = new Set(COLLECTION_BLOCKLIST.map((a) => a.toLowerCase()));

export function buildFamilyTree(allHoldings, totalHolderCount) {
  // Only wallets that STILL hold a Rounds NFT belong in the family tree. The
  // checkpoint persists across runs, so wallets that sold since an earlier
  // run would otherwise linger as phantom family.
  const holderHoldings = {};
  for (const [addr, holdings] of Object.entries(allHoldings)) {
    if ((holdings || []).some((h) => h.collection_address === ROUNDS_CONTRACT.toLowerCase())) {
      holderHoldings[addr] = holdings;
    }
  }
  const dropped = Object.keys(allHoldings).length - Object.keys(holderHoldings).length;
  if (dropped > 0) console.log(`  [note] excluded ${dropped} wallet(s) that no longer hold Rounds`);

  const collectionToHolders = new Map();
  const collectionNames = new Map();
  for (const [addr, holdings] of Object.entries(holderHoldings)) {
    for (const h of holdings) {
      const ca = h.collection_address;
      if (!ca || ca === ROUNDS_CONTRACT.toLowerCase()) continue;
      if (blockSet.has(ca)) continue;
      if (!collectionToHolders.has(ca)) collectionToHolders.set(ca, new Set());
      collectionToHolders.get(ca).add(addr);
      if (h.collection_name) collectionNames.set(ca, h.collection_name);
    }
  }

  // Nothing is hard-excluded — a collection half the holders own is still
  // real. Each carries a rarity weight (1 / holder count) so a collection 3
  // people share counts far more than one 500 people share, and popular ones
  // sink in the ranking rather than being deleted.
  const order = [];
  for (const [ca, holders] of collectionToHolders.entries()) {
    if (holders.size < 2) continue;
    if (allowSet.size && !allowSet.has(ca)) continue;
    order.push(ca);
  }
  // Most-held first, so index 0 is the most common collection. Stable and
  // makes the array itself readable.
  order.sort((a, b) => collectionToHolders.get(b).size - collectionToHolders.get(a).size);

  const indexOf = new Map();
  const collections = order.map((ca, i) => {
    indexOf.set(ca, i);
    const n = collectionToHolders.get(ca).size;
    return {
      a: ca,
      name: collectionNames.get(ca) || ca,
      holder_count: n,
      holder_share: +(n / totalHolderCount).toFixed(4),
    };
  });

  // Every holder's COMPLETE list of qualifying collections, as indices.
  // Complete rather than capped, so the page can compute exact overlaps
  // between any two holders.
  //
  // `counts` is a PARALLEL array: counts[k] is how many tokens this wallet
  // holds of collections[k]. Kept as a second flat array rather than pairs
  // because it costs far fewer bytes across ~78k memberships.
  const holderCols = new Map();
  const holderCounts = new Map();
  for (const addr of Object.keys(holderHoldings)) {
    const tally = new Map();
    for (const h of holderHoldings[addr]) {
      const idx = indexOf.get(h.collection_address);
      if (idx === undefined) continue;
      tally.set(idx, (tally.get(idx) || 0) + 1);
    }
    const idxs = [...tally.keys()].sort((x, y) => x - y);
    holderCols.set(addr, idxs);
    holderCounts.set(addr, idxs.map((i) => tally.get(i)));
  }

  // Weighted connection strength, without materialising a global edge list.
  const perHolder = new Map();
  const bump = (a, b, w) => {
    let m = perHolder.get(a);
    if (!m) { m = new Map(); perHolder.set(a, m); }
    const cur = m.get(b) || { weight: 0, shared: 0 };
    cur.weight += w;
    cur.shared += 1;
    m.set(b, cur);
  };
  for (let i = 0; i < order.length; i++) {
    const hs = [...collectionToHolders.get(order[i])];
    const w = 1 / hs.length;
    for (let x = 0; x < hs.length; x++) {
      for (let y = x + 1; y < hs.length; y++) { bump(hs[x], hs[y], w); bump(hs[y], hs[x], w); }
    }
  }

  const holdersOut = {};
  for (const addr of Object.keys(holderHoldings)) {
    const connMap = perHolder.get(addr) || new Map();
    const myFoot = (holderCols.get(addr).length || 0) + FOOTPRINT_DAMPING;
    const connections = [...connMap.entries()]
      .map(([other, v]) => {
        const theirFoot = (holderCols.get(other).length || 0) + FOOTPRINT_DAMPING;
        return {
          addr: other,
          score: +(v.weight / Math.sqrt(myFoot * theirFoot)).toFixed(8),
          shared: v.shared,
        };
      })
      .sort((x, y) => y.score - x.score)
      .slice(0, MAX_CONNECTIONS_PER_HOLDER);

    const mine = holderCols.get(addr);
    holdersOut[addr] = {
      connections,
      collections: mine,
      counts: holderCounts.get(addr),
      close_connections: [...connMap.values()].filter((v) => v.shared >= CLOSE_CONNECTION_MIN_SHARED).length,
      total_connections: connMap.size,
    };
  }

  return { collections, holders: holdersOut };
}

