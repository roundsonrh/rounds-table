"""Builds site/gif40/<id>.gif — day 40 (Transforming): the breath from
build-gif.py plus every circle slowly hollowing out to an outline and filling
back in, a 16s wave rippling out from the piece's center. Used as the NFT's
`image` once a Round has been held 40+ days. Only builds Rounds held 38+
days (plus #49, the home-page sample) so CI stays fast; skips existing GIFs.
    pip install pillow && python3 scripts/build-gif40.py
"""
import json, math, os, time
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SIZE, FPS, BREATH, MORPH, SS = 360, 8, 8, 16, 2
LIME, BLACK = (204, 255, 0), (0, 0, 0)
SAMPLES = {49}

def frames(circ):
    pts = [(circ[i], circ[i + 1], circ[i + 2]) for i in range(0, len(circ), 3)]
    w = sum(r * r for _, _, r in pts) or 1
    cx = sum(x * r * r for x, _, r in pts) / w; cy = sum(y * r * r for _, y, r in pts) / w
    far = max([math.hypot(x - cx, y - cy) for x, y, _ in pts] + [1])
    pal = Image.new("P", (1, 1))
    pal.putpalette(list(BLACK) + list(LIME) + [int(BLACK[j] + (LIME[j] - BLACK[j]) * t) for t in (.25, .5, .75) for j in range(3)] + [0] * (3 * 251))
    S = SIZE * SS; k = S / 10000; out = []
    for f in range(FPS * MORPH):
        sec = f / FPS; im = Image.new("RGB", (S, S), BLACK); d = ImageDraw.Draw(im)
        for x, y, r in pts:
            dd = math.hypot(x - cx, y - cy) / far
            u = (1 - math.cos(sec / BREATH * 2 * math.pi - dd * 1.2)) / 2
            b = u * u * (3 - 2 * u); sp = 1 + .07 * b
            X, Y, R = (cx + (x - cx) * sp) * k, (cy + (y - cy) * sp) * k, r * (.94 + .2 * b) * k
            v = (1 - math.cos(sec / MORPH * 2 * math.pi - dd * 2.0)) / 2; h = v * v * (3 - 2 * v)
            hole = max(0, (R - max(R * .12, 2.2 * SS)) * h)
            d.ellipse((X - R, Y - R, X + R, Y + R), fill=LIME)
            if hole > 2 * SS: d.ellipse((X - hole, Y - hole, X + hole, Y + hole), fill=BLACK)
        out.append(im.resize((SIZE, SIZE), Image.LANCZOS).quantize(palette=pal, dither=Image.Dither.NONE))
    return out

if __name__ == "__main__":
    pieces = json.load(open(os.path.join(ROOT, "site", "data", "pieces.json")))
    holds = json.load(open(os.path.join(ROOT, "site", "data", "holds.json")))["holds"]
    now = time.time()
    want = {int(i) for i, h in holds.items() if now - float(h["since"]) >= 38 * 86400} | SAMPLES
    out = os.path.join(ROOT, "site", "gif40"); os.makedirs(out, exist_ok=True); made = 0
    for i in sorted(want):
        path = os.path.join(out, f"{i}.gif")
        if os.path.exists(path) or not (1 <= i <= len(pieces)): continue
        fr = frames(pieces[i - 1][3]); fr[0].save(path, save_all=True, append_images=fr[1:], duration=1000 // FPS, loop=0, disposal=1); made += 1
    print(f"Day 40 GIFs: built {made}, {len(os.listdir(out))} in site/gif40/ ({len(want)} wanted)")
