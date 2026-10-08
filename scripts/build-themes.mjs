// Builds site/art/<theme>/<id>.svg — every Round, recolored for each holiday
// in site/data/themes.json. Same circles as the original still (pieces.json,
// 10000×10000), only the two colors change.
//   node scripts/build-themes.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pieces = JSON.parse(fs.readFileSync(path.join(ROOT, "site", "data", "pieces.json"), "utf8"));
const { themes } = JSON.parse(fs.readFileSync(path.join(ROOT, "site", "data", "themes.json"), "utf8"));

const svg = (c, fill, bg) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10000 10000" width="2000" height="2000">` +
  `<rect width="10000" height="10000" fill="${bg}"/><g fill="${fill}">` +
  Array.from({ length: c.length / 3 }, (_, i) => `<circle cx="${c[i * 3]}" cy="${c[i * 3 + 1]}" r="${c[i * 3 + 2]}"/>`).join("") +
  `</g></svg>`;

const OUT = path.join(ROOT, "site", "art");
fs.rmSync(OUT, { recursive: true, force: true });
for (const t of themes) {
  const dir = path.join(OUT, t.id);
  fs.mkdirSync(dir, { recursive: true });
  pieces.forEach((p, i) => fs.writeFileSync(path.join(dir, `${i + 1}.svg`), svg(p[3], t.fill, t.bg)));
}
console.log(`Wrote ${themes.length} themes × ${pieces.length} Rounds to site/art/`);
