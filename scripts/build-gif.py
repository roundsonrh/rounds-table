"""Builds site/gif/<id>.gif — a breathing GIF of each Round, used as the NFT's
`image` once it has been held 20+ days, so it breathes in OpenSea's grid too
(the full animation_url only plays when the NFT is opened). Same breath as
site/anim (8s inhale/exhale rippling from the piece's center), without the
drift, so it loops seamlessly. Skips GIFs that already exist.
    pip install pillow && python3 scripts/build-gif.py
"""
import json, math, os
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SIZE, FPS, BREATH, SS = 360, 10, 8, 2
LIME, BLACK = (204, 255, 0), (0, 0, 0)

def frames(circ):
    pts = [(circ[i], circ[i + 1], circ[i + 2]) for i in range(0, len(circ), 3)]
    w = sum(r * r for _, _, r in pts) or 1
    cx = sum(x * r * r for x, _, r in pts) / w; cy = sum(y * r * r for _, y, r in pts) / w
    far = max([math.hypot(x - cx, y - cy) for x, y, _ in pts] + [1])
    pal = Image.new("P", (1, 1))
    pal.putpalette(list(BLACK) + list(LIME) + [int(BLACK[j] + (LIME[j] - BLACK[j]) * t) for t in (.25, .5, .75) for j in range(3)] + [0] * (3 * 251))
    S = SIZE * SS; k = S / 10000; out = []
    for f in range(FPS * BREATH):
        sec = f / FPS; im = Image.new("RGB", (S, S), BLACK); d = ImageDraw.Draw(im)
        for x, y, r in pts:
            u = (1 - math.cos(sec / BREATH * 2 * math.pi - math.hypot(x - cx, y - cy) / far * 1.2)) / 2
            b = u * u * (3 - 2 * u); sp = 1 + .07 * b
            X, Y, R = (cx + (x - cx) * sp) * k, (cy + (y - cy) * sp) * k, r * (.94 + .2 * b) * k
            d.ellipse((X - R, Y - R, X + R, Y + R), fill=LIME)
        out.append(im.resize((SIZE, SIZE), Image.LANCZOS).quantize(palette=pal, dither=Image.Dither.NONE))
    return out

if __name__ == "__main__":
    pieces = json.load(open(os.path.join(ROOT, "site", "data", "pieces.json")))
    out = os.path.join(ROOT, "site", "gif"); os.makedirs(out, exist_ok=True); made = 0
    for i, p in enumerate(pieces, 1):
        path = os.path.join(out, f"{i}.gif")
        if os.path.exists(path): continue
        fr = frames(p[3]); fr[0].save(path, save_all=True, append_images=fr[1:], duration=1000 // FPS, loop=0, disposal=1); made += 1
    print(f"Breathing GIFs: built {made}, {len(pieces)} total in site/gif/")
