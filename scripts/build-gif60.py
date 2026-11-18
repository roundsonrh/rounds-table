"""Builds site/gif60/<id>.gif — day 60 (Rippling), everything stacked: the
breath, the day 40 hollowing, and three faint rings rippling out from the
bigger circles with every breath. Used as the NFT's `image` once a Round has
been held 60+ days. Builds only Rounds held 58+ days (plus #49, the home-page
sample), oldest holds first, in parallel, and stops after a time budget so a
refresh never stalls; the rest are built on the next run. Skips existing GIFs.
    pip install pillow && python3 scripts/build-gif60.py
"""
import json, math, os, time
from multiprocessing import Pool
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SIZE, FPS, BREATH, MORPH, SS = 360, 8, 8, 16, 2
LIME, BLACK = (204, 255, 0), (0, 0, 0)
SAMPLES = {49}
BUDGET_S = float(os.environ.get("GIF60_BUDGET_MIN", "40")) * 60

def mix(t): return tuple(int(BLACK[j] + (LIME[j] - BLACK[j]) * t) for j in range(3))

def frames(circ):
    pts = [(circ[i], circ[i + 1], circ[i + 2]) for i in range(0, len(circ), 3)]
    w = sum(r * r for _, _, r in pts) or 1
    cx = sum(x * r * r for x, _, r in pts) / w; cy = sum(y * r * r for _, y, r in pts) / w
    far = max([math.hypot(x - cx, y - cy) for x, y, _ in pts] + [1])
    big = sorted(r for *_, r in pts)[int(len(pts) * .6)] if pts else 0
    pal = Image.new("P", (1, 1))
    pal.putpalette(list(BLACK) + list(LIME) + [c for t in (.1, .2, .3, .45, .6, .75, .9) for c in mix(t)] + [0] * (3 * 247))
    S = SIZE * SS; k = S / 10000; out = []
    for f in range(FPS * MORPH):
        sec = f / FPS; im = Image.new("RGB", (S, S), BLACK); d = ImageDraw.Draw(im); geo = []
        for x, y, r in pts:
            dd = math.hypot(x - cx, y - cy) / far
            u = (1 - math.cos(sec / BREATH * 2 * math.pi - dd * 1.2)) / 2
            b = u * u * (3 - 2 * u); sp = 1 + .07 * b
            geo.append(((cx + (x - cx) * sp) * k, (cy + (y - cy) * sp) * k, r * (.94 + .2 * b) * k, dd, r >= big))
        for X, Y, R, dd, isbig in geo:  # day 60: three faint rings per breath from the bigger circles
            if not isbig: continue
            for lag in (0, 1 / 3, 2 / 3):
                p = (sec / BREATH - dd * 1.2 / (2 * math.pi) + lag) % 1.0
                rr = R * (1.04 + .9 * p); a = .7 * (1 - p) ** 1.5
                if a < .06 or rr < 3 * SS: continue
                d.ellipse((X - rr, Y - rr, X + rr, Y + rr), outline=mix(a), width=max(1, int(SS * 1.2)))
        for X, Y, R, dd, _ in geo:  # day 40: hollow to an outline and fill back in
            d.ellipse((X - R, Y - R, X + R, Y + R), fill=LIME)
            v = (1 - math.cos(sec / MORPH * 2 * math.pi - dd * 2.0)) / 2; h = v * v * (3 - 2 * v)
            hole = max(0, (R - max(R * .12, 2.2 * SS)) * h)
            if hole > max(2 * SS, R * .15): d.ellipse((X - hole, Y - hole, X + hole, Y + hole), fill=BLACK)
        out.append(im.resize((SIZE, SIZE), Image.LANCZOS).quantize(palette=pal, dither=Image.Dither.NONE))
    return out

def build(args):
    i, circ, path = args
    fr = frames(circ)
    tmp = path + ".tmp.gif"
    fr[0].save(tmp, save_all=True, append_images=fr[1:], duration=1000 // FPS, loop=0, disposal=1)
    os.replace(tmp, path)
    return i

if __name__ == "__main__":
    t0 = time.time()
    pieces = json.load(open(os.path.join(ROOT, "site", "data", "pieces.json")))
    holds = json.load(open(os.path.join(ROOT, "site", "data", "holds.json")))["holds"]
    now = time.time()
    since = {int(i): float(h["since"]) for i, h in holds.items()}
    want = sorted({i for i, s in since.items() if now - s >= 58 * 86400} | SAMPLES, key=lambda i: since.get(i, 0))
    out = os.path.join(ROOT, "site", "gif60"); os.makedirs(out, exist_ok=True)
    clean = lambda: [os.remove(os.path.join(out, f)) for f in os.listdir(out) if f.endswith(".tmp.gif")]
    clean()
    todo = [(i, pieces[i - 1][3], os.path.join(out, f"{i}.gif")) for i in want
            if 1 <= i <= len(pieces) and not os.path.exists(os.path.join(out, f"{i}.gif"))]
    made = 0
    with Pool(os.cpu_count() or 2) as pool:
        for _ in pool.imap_unordered(build, todo):
            made += 1
            if time.time() - t0 > BUDGET_S:
                pool.terminate(); break
    clean()
    print(f"Day 60 GIFs: built {made}, {len([f for f in os.listdir(out) if f.endswith('.gif') and not f.endswith('.tmp.gif')])} in site/gif60/ ({len(want)} wanted, {len(todo) - made} left for next run)")
