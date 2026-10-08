// Builds site/anim/<id>.html — the animated version of each Round, used as
// the NFT's animation_url once it has been held 20+ days by a wallet that
// connected to the site. Self-contained (circle data inline, no requests),
// so it plays inside OpenSea's sandboxed frame.
//   node scripts/build-anim.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pieces = JSON.parse(fs.readFileSync(path.join(ROOT, "site", "data", "pieces.json"), "utf8"));
const OUT = path.join(ROOT, "site", "anim");
fs.mkdirSync(OUT, { recursive: true });

const page = (id, circles) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rounds #${id}</title><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}canvas{display:block;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)}</style></head>
<body><canvas id="c"></canvas><script>
// Rounds #${id}, moving. Same circles as the still, each drifting on its own
// small orbit; the loop repeats every 16 seconds.
const D=[${circles.join(",")}],ID=${id},P=16;
let s=ID*9301+49297;const rnd=()=>((s=(s*233280+12345)%2147483647)/2147483647);
const C=[];for(let i=0;i<D.length;i+=3){const r=D[i+2],a=Math.min(520,90+38000/(r+40));
C.push({x:D[i],y:D[i+1],r,ax:a*(.5+rnd()*.5),ay:a*(.5+rnd()*.5),fx:1+(rnd()*2|0),fy:1+(rnd()*2|0),px:rnd()*6.283,py:rnd()*6.283,pb:rnd()*6.283});}
const cv=document.getElementById("c"),g=cv.getContext("2d");let S=0;
function fit(){const dpr=Math.min(devicePixelRatio||1,2);S=Math.min(innerWidth,innerHeight);cv.style.width=cv.style.height=S+"px";cv.width=cv.height=Math.round(S*dpr);g.setTransform(dpr,0,0,dpr,0,0);}
addEventListener("resize",fit);fit();
function frame(t){const T=(t/1000%P)/P*6.283,k=S/10000;g.fillStyle="#000";g.fillRect(0,0,S,S);g.fillStyle="#ccff00";g.beginPath();
for(const c of C){const x=(c.x+c.ax*Math.sin(T*c.fx+c.px))*k,y=(c.y+c.ay*Math.cos(T*c.fy+c.py))*k,r=c.r*(1+.035*Math.sin(T*2+c.pb))*k;g.moveTo(x+r,y);g.arc(x,y,r,0,6.283);}
g.fill();requestAnimationFrame(frame);}
requestAnimationFrame(frame);
<\/script></body></html>`;

let n = 0;
pieces.forEach((p, i) => { fs.writeFileSync(path.join(OUT, `${i + 1}.html`), page(i + 1, p[3])); n++; });
console.log(`Wrote ${n} animations to site/anim/`);
