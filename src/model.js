// キャラの3Dモデルと動き（ポーズ）・表情
// v1.4：キックフライト／#コンパス／バウンティラッシュの調査をもとに作り直し
//  ・頭身：約4.3頭身（キックフライトのキッカーに近い、手足の長いアニメ体型）。丸い部品の寄せ集めをやめ、
//    先細りの手足・胸と腰のくびれ・あごの細いアニメ顔
//  ・表情：顔は「表情の絵」を貼った板を頭にかぶせ、状況で切りかえる（ふつう・まばたき・攻撃・痛い・ダウン・勝ち・スペシャル・負け）
//  ・髪：毛束を1本ずつ作る（とがった束・前髪・天使の輪のハイライト）
//  ・ふちどり：部品の色を暗くした線（色トレス）。影は色をのせる（gfx.js の cel）
//  ・グローブとスニーカーのジェットはチームの色で光る（ブルームでにじむ）
// v1.5：キャラ18人。見た目は looks.js の値で決める（体・服・髪・顔・小物を名前と数で組み合わせる。LOOK_BASE・OUTFITS・BOTTOMS・
//  HAIR_STYLES・FACE_STYLES・〜_ITEMS）。前からの3人は前とまったく同じ形。部品のまとめ（bakeModel）で、セル塗りとふちどりを
//  それぞれ1回で描くようにした（1人 ~17回 → ~8回）。胸の柄 PRINTS、勝ちポーズ WIN_POSES、カットイン CUTIN_POSES、KO_EMOTE もキャラごと
// v1.6：写真から10人を作り直した。髪は殻（shellGeo）＋毛すじの絵（hairTex）＋毛束（clumpOn）、メガネ（specs）、二重・細い目・ほくろ・ひげ、
//  布の柄（PATTERNS）、ネクタイ・リュック・チェーン・ピアスなど（looks.js の先頭に一覧）
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon, cel, addOutline, outlineMat, roundedBox, canvasTex, lineColor } from './gfx.js';
import { TEAM } from './config.js';
import { damp, clamp } from './util.js';

const NOBAKE = typeof location !== 'undefined' && /[?&]nobake/.test(location.search); // 点検用：部品をまとめない
const HEAD_R = 0.215;
const OW = 0.016; // ふちどりの太さ（世界）

// ===== 形の部品 =====
// 回転体（[半径, 高さ] の点を回す）
function lathe(pts, seg = 16, sz = 1) {
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y)), seg);
  if (sz !== 1) g.scale(1, 1, sz);
  g.computeVertexNormals();
  return g;
}
// UV を何倍かにする（柄の布をくり返す回数をそろえる）
function uvScale(g, su, sv) {
  const uv = g.attributes.uv;
  if (!uv) return g;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return g;
}
// 先細りのカプセル（関節から下に len）
function limbGeo(r0, r1, len, seg = 12) {
  const pts = [];
  const cap = 4;
  for (let i = 0; i <= cap; i++) {
    const a = (i / cap) * (Math.PI / 2);
    pts.push([Math.sin(a) * r1, -len - Math.cos(a) * r1 * 0.9 + r1 * 0.2]);
  }
  for (let i = 0; i <= cap; i++) {
    const a = (i / cap) * (Math.PI / 2);
    pts.push([Math.cos(a) * r0, Math.sin(a) * r0 * 0.9 - r0 * 0.2]);
  }
  pts[0][0] = 0.0001;
  pts[pts.length - 1][0] = 0.0001;
  return lathe(pts, seg);
}
function mesh(geo, mat, line, w = OW) {
  const m = new THREE.Mesh(geo, mat);
  if (line != null) addOutline(m, line, w);
  return m;
}

// 毛束：根元から先へ細くなる、曲がった房（+Y が先）。flat で前後につぶす
function strandGeo(len, rad, bend = 0.6, flat = 0.55, twist = 0) {
  const g = new THREE.ConeGeometry(rad, len, 7, 5, false);
  g.translate(0, len / 2, 0);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const t = clamp(v.y / len, 0, 1);
    v.z *= flat;
    // 先のほうほど曲がる
    const a = bend * t * t;
    const y = v.y, z = v.z;
    v.y = y * Math.cos(a) - z * Math.sin(a);
    v.z = y * Math.sin(a) + z * Math.cos(a) + bend * 0.12 * t * len;
    if (twist) {
      const tw = twist * t;
      const x = v.x;
      v.x = x * Math.cos(tw) - v.z * Math.sin(tw) * 0.3;
    }
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// アニメの頭の形：横を少しせまく、あごを細く前へ、後頭部を少し大きく
// hp.jaw（0〜1）：ほお・あごを丸く（ぽっちゃり・やさしい顔）
// hp.wide（0〜1）：ほおとあごを横に広げて、あご先を丸く（まるい顔）/ hp.long（0〜1）：顔の下半分を長く（面長）
function headShape(v, R, hp) {
  const y = v.y / R;
  const jaw = (hp && hp.jaw) || 0;
  const wide = (hp && hp.wide) || 0, long = (hp && hp.long) || 0;
  v.x *= 0.93;
  v.y *= 1.04;
  if (y < 0) {
    const k = smooth(0, -1, y);
    if (jaw) {
      v.x *= 1 - 0.3 * k * (1 - jaw * 0.55) + jaw * 0.05 * Math.sin(Math.PI * Math.min(1, k * 1.6));
      if (v.z > 0) v.z *= 1 - 0.12 * k;
      else v.z *= 1 - 0.3 * k * (1 - jaw * 0.3);
    } else {
      v.x *= 1 - 0.3 * k;
      if (v.z > 0) v.z *= 1 - 0.12 * k;
      else v.z *= 1 - 0.3 * k;
    }
    if (wide) v.x *= 1 + wide * (0.15 * Math.sin(Math.PI * Math.min(1, k * 1.15)) + 0.07 * k);
    if (v.z > 0) v.z += R * 0.05 * smooth(-0.45, -1, y) * (1 - wide * 0.7);
    v.y -= R * 0.05 * k * (1 - wide * 0.5);
    if (long) v.y *= 1 + long * 0.16 * k;
  } else if (v.z < 0) v.z *= 1.06;
  return v;
}
function smooth(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// ===== 服の形の道具（胴にそった布） =====
// 胴の形の半径（ふたの点をのぞく。上下にはみ出したら、まっすぐのばす）
function bandR(prof, y) {
  const P = prof.slice(1, -1);
  if (y <= P[0][1]) return P[0][0];
  if (y >= P[P.length - 1][1]) return P[P.length - 1][0];
  for (let i = 0; i < P.length - 1; i++) {
    const [r0, y0] = P[i], [r1, y1] = P[i + 1];
    if (y >= y0 && y <= y1) return y1 > y0 ? r0 + ((r1 - r0) * (y - y0)) / (y1 - y0) : r1;
  }
  return P[P.length - 1][0];
}
// 高さの段：胴の形の折れ目（ここを通らないと布が胴にめりこむ）＋ step ごと
function levelsFor(prof, y0, y1, step = 0.03) {
  const L = new Set([y0, y1]);
  for (const [, y] of prof) if (y > y0 && y < y1) L.add(y);
  for (let y = y0 + step; y < y1; y += step) L.add(+y.toFixed(4));
  return [...L].sort((a, b) => a - b);
}
// 胴を回る布：列 u（0〜1）ごとに、高さの範囲 yr(u) と角度 ph(u, y)（0＝前、＋＝キャラの左）、半径 rf(y, ph)
// 段 levels（下から上）を、その列の範囲におさめて並べる。角度は u とともに増やす（面が外を向く）
function wrapGeo(o) {
  const cols = o.cols || 36;
  const lv = o.levels;
  const rows = lv.length - 1;
  const zs = o.zs || 0.7;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= cols; i++) {
    const u = i / cols;
    const [ya, yb] = o.yr(u);
    for (let j = 0; j <= rows; j++) {
      const y = clamp(lv[j], ya, yb);
      const ph = o.ph(u, y);
      const r = o.rf(y, ph);
      pos.push(Math.sin(ph) * r, y, Math.cos(ph) * r * zs);
      uv.push(u * (o.uRep || 1), ((y - lv[0]) / Math.max(1e-4, lv[rows] - lv[0])) * (o.vRep || 1));
    }
  }
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) {
      const a = i * (rows + 1) + j, b = a + rows + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (o.closed) {
    // 1周する布は、つなぎ目（後ろ）の向きをそろえる（影の線が出ないように）
    const n = g.attributes.normal;
    for (let j = 0; j <= rows; j++) {
      const a = j, b = cols * (rows + 1) + j;
      const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b);
      const l = Math.hypot(x, y, z) || 1;
      n.setXYZ(a, x / l, y / l, z / l);
      n.setXYZ(b, x / l, y / l, z / l);
    }
  }
  return g;
}
// 点の列にそった細い管（えりのふち・ひも・ライン）
function tubeGeo(pts, r, closed = false, seg = null, rs = 5) {
  const curve = new THREE.CatmullRomCurve3(pts, closed, 'catmullrom', 0.5);
  return new THREE.TubeGeometry(curve, seg || Math.max(8, pts.length * 3), r, rs, closed);
}
// 腰（ズボン）の半径（胴の高さ y で。胴の z のつぶれ 0.7 にあわせた値）
function hipsR(look, yBody) {
  const bw = look.build * (look.female ? 1.06 : 1);
  const P = [[0.1, -0.125], [0.135, -0.07], [0.14, 0.0], [0.128, 0.06]];
  if (yBody > 0.065) return 0;
  let r = P[0][0];
  for (let i = 0; i < P.length - 1; i++) if (yBody >= P[i][1] && yBody <= P[i + 1][1]) r = P[i][0] + ((P[i + 1][0] - P[i][0]) * (yBody - P[i][1])) / (P[i + 1][1] - P[i][1]);
  if (yBody > 0.06) r = 0.128;
  return r * bw * (0.74 / 0.7);
}
// 毛束・ひものような細長い物を、向き dir（とまがる向き curl）にあわせて置く
function aimMesh(m, dir, curl) {
  const D = dir.clone().normalize();
  let Z = (curl || new THREE.Vector3(0, 0, 1)).clone();
  Z.addScaledVector(D, -Z.dot(D));
  if (Z.lengthSq() < 1e-6) Z = new THREE.Vector3(1, 0, 0).addScaledVector(D, -D.x);
  Z.normalize();
  const X = new THREE.Vector3().crossVectors(D, Z).normalize();
  m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, D, Z));
  return m;
}
// 決まった乱数（毎回同じ形になるように）
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ===== 表情の絵（4×2のマス。1マス256px）=====
// 0 ふつう 1 まばたき 2 攻撃 3 痛い 4 ダウン 5 勝ち 6 スペシャル 7 負け
export const FACES = { neutral: 0, blink: 1, attack: 2, hurt: 3, ko: 4, happy: 5, special: 6, sad: 7 };
const faceCache = new Map();
function faceAtlas(def, look) {
  if (faceCache.has(def.id)) return faceCache.get(def.id);
  look = look || normLook(def.look);
  const tex = canvasTex(1024, 512, (ctx) => {
    ctx.clearRect(0, 0, 1024, 512);
    for (let i = 0; i < 8; i++) {
      ctx.save();
      ctx.translate((i % 4) * 256, Math.floor(i / 4) * 256);
      ctx.beginPath();
      ctx.rect(0, 0, 256, 256);
      ctx.clip();
      drawFace(ctx, look, i);
      ctx.restore();
    }
  });
  tex.userData.shared = true;
  tex.anisotropy = 4;
  faceCache.set(def.id, tex);
  return tex;
}

const INK = '#1d1418';
function eyeOpen(ctx, x, y, s, look, o = {}) {
  // アニメの目：白目・虹彩（上が濃いグラデーション）・瞳・ハイライト2つ・上まつげの太い線
  const w = (o.w || 22) * s, h = (o.h || 26) * s;
  const iris = '#' + new THREE.Color(look.eye).getHexString();
  ctx.save();
  ctx.translate(x, y);
  if (o.tilt) ctx.rotate(o.tilt);
  ctx.fillStyle = '#f7f3f4';
  ctx.beginPath();
  ctx.ellipse(0, 0, w, h, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 0, w, h, 0, 0, Math.PI * 2);
  ctx.clip();
  const ir = (o.iris || 0.78) * w;
  const ix = (o.lookX || 0) * w * 0.25, iy = h * 0.1 + (o.lookY || 0) * h * 0.2;
  const g = ctx.createLinearGradient(0, iy - ir * 1.2, 0, iy + ir * 1.2);
  g.addColorStop(0, '#120c0c');
  g.addColorStop(0.45, iris);
  g.addColorStop(1, o.glow ? '#d4feff' : lighten(iris, 0.45));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(ix, iy, ir, ir * 1.18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0b0708';
  ctx.beginPath();
  if (o.glow) ctx.ellipse(ix, iy + ir * 0.05, ir * 0.26, ir * 0.5, 0, 0, Math.PI * 2);
  else ctx.ellipse(ix, iy + ir * 0.05, ir * 0.45, ir * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();
  if (o.glow) {
    ctx.strokeStyle = 'rgba(225,255,255,0.95)';
    ctx.lineWidth = 2.6 * s;
    ctx.beginPath();
    ctx.ellipse(ix, iy, ir * 0.78, ir * 0.94, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  // 上まぶたの影
  ctx.fillStyle = 'rgba(60,30,50,0.28)';
  ctx.fillRect(-w, -h, w * 2, h * 0.55);
  ctx.restore();
  // ハイライト
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(ix - ir * 0.38, iy - ir * 0.45, ir * 0.32, ir * 0.38, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ix + ir * 0.4, iy + ir * 0.55, ir * 0.16, 0, Math.PI * 2);
  ctx.fill();
  if (o.sparkle) {
    // キラキラ（イケメン・スペシャル）
    ctx.fillStyle = '#fffbe0';
    star(ctx, ix + ir * 0.1, iy - ir * 0.1, ir * 0.42, 4);
  }
  // 上まつげ（太く、目じりを少し上げる）
  ctx.strokeStyle = INK;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 7.5 * s;
  ctx.beginPath();
  ctx.moveTo(-w * 1.12, -h * 0.25);
  ctx.quadraticCurveTo(-w * 0.2, -h * 1.22, w * 1.05, -h * 0.62);
  ctx.lineTo(w * 1.28, -h * 0.82);
  ctx.stroke();
  // 下まつげ（細く）
  ctx.lineWidth = 2.5 * s;
  ctx.strokeStyle = 'rgba(40,20,28,0.7)';
  ctx.beginPath();
  ctx.moveTo(-w * 0.55, h * 0.92);
  ctx.quadraticCurveTo(0, h * 1.08, w * 0.6, h * 0.88);
  ctx.stroke();
  ctx.restore();
}
// 目のまわりの光（スペシャル）
function eyeGlow(ctx, x, y, s, color) {
  const g = ctx.createRadialGradient(x, y, 6 * s, x, y, 44 * s);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, y, 46 * s, 38 * s, 0, 0, Math.PI * 2);
  ctx.fill();
}
function lighten(hex, k) {
  const c = new THREE.Color(hex);
  c.lerp(new THREE.Color(0xffffff), k);
  return '#' + c.getHexString();
}
function star(ctx, x, y, r, n) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * 0.28 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}
function arcEye(ctx, x, y, s, up = true, w = 24) {
  // 笑って閉じた目（∩）／つぶった目（∪）
  ctx.strokeStyle = INK;
  ctx.lineWidth = 8 * s;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (up) {
    ctx.moveTo(x - w * s, y + 6 * s);
    ctx.quadraticCurveTo(x, y - 20 * s, x + w * s, y + 6 * s);
  } else {
    ctx.moveTo(x - w * s, y - 4 * s);
    ctx.quadraticCurveTo(x, y + 12 * s, x + w * s, y - 4 * s);
  }
  ctx.stroke();
}
function brow(ctx, x, y, s, ang, len = 26, side = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang * side);
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.moveTo(-len * s, 3 * s);
  ctx.quadraticCurveTo(0, -7 * s, len * s, -1 * s);
  ctx.quadraticCurveTo(0, -1 * s, -len * s, 3 * s);
  ctx.lineTo(-len * s, 6 * s);
  ctx.quadraticCurveTo(0, -2 * s, len * s, 2 * s);
  ctx.fill();
  ctx.restore();
}
function mouthOpen(ctx, x, y, s, w, h, o = {}) {
  // 開いた口：濃い赤・上の歯・舌
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#6e1a24';
  ctx.beginPath();
  if (o.shape === 'D') {
    ctx.moveTo(-w * s, -h * 0.35 * s);
    ctx.quadraticCurveTo(0, -h * 0.55 * s, w * s, -h * 0.35 * s);
    ctx.quadraticCurveTo(w * 0.8 * s, h * s, 0, h * s);
    ctx.quadraticCurveTo(-w * 0.8 * s, h * s, -w * s, -h * 0.35 * s);
  } else {
    ctx.ellipse(0, 0, w * s, h * s, 0, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-w * s, -h * 1.2 * s, w * 2 * s, h * (o.teeth != null ? o.teeth : 0.55) * s);
  ctx.fillStyle = '#ff8b92';
  ctx.beginPath();
  ctx.ellipse(0, h * 0.75 * s, w * 0.6 * s, h * 0.45 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.restore();
}
function mouthLine(ctx, x, y, s, w, curve, o = {}) {
  ctx.strokeStyle = o.color || '#5a2a2a';
  ctx.lineWidth = (o.lw || 5) * s;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - w * s, y);
  ctx.quadraticCurveTo(x, y + curve * s, x + w * s, y + (o.lift || 0) * s);
  ctx.stroke();
}
function blush(ctx, x, y, s, k = 1) {
  for (const sx of [-1, 1]) {
    const g = ctx.createRadialGradient(x + sx * 62 * s, y, 0, x + sx * 62 * s, y, 26 * s);
    g.addColorStop(0, `rgba(255,105,120,${0.42 * k})`);
    g.addColorStop(1, 'rgba(255,105,120,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x + sx * 62 * s, y, 28 * s, 16 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(230,70,90,${0.5 * k})`;
    ctx.lineWidth = 2.4 * s;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(x + sx * 62 * s + i * 8 * s - 4 * s, y + 6 * s);
      ctx.lineTo(x + sx * 62 * s + i * 8 * s + 4 * s, y - 6 * s);
      ctx.stroke();
    }
  }
}
function swirl(ctx, x, y, s) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4.5 * s;
  ctx.beginPath();
  for (let a = 0; a < Math.PI * 5; a += 0.2) {
    const r = (2 + a * 2.6) * s;
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.stroke();
}
function sweat(ctx, x, y, s) {
  ctx.fillStyle = 'rgba(150,215,255,0.95)';
  ctx.strokeStyle = 'rgba(40,110,190,0.9)';
  ctx.lineWidth = 2.5 * s;
  ctx.beginPath();
  ctx.moveTo(x, y - 16 * s);
  ctx.quadraticCurveTo(x + 11 * s, y + 2 * s, x, y + 9 * s);
  ctx.quadraticCurveTo(x - 11 * s, y + 2 * s, x, y - 16 * s);
  ctx.fill();
  ctx.stroke();
}

// ===== 新しい顔（値で決める表情の絵）=====
// look.face に名前（下の FACE_STYLES）か、{ base: '名前', … } の値を書く。'grin'・'oh'・'cool' は前の3人の顔（drawFace）
//  eye：目の形（EYE_TYPES）/ ew・eh：目の大きさ / iris：黒目の大きさ / brow：まゆの角度（＋で怒り、−で困り）/ browY：まゆの高さ
//  browW：まゆの太さ / browUp：片方のまゆを上げる / mouth：口の形（mouth2）/ lash：まつげ（女の子は自動で）/ blushK：ほおの赤み
//  flush：真っ赤な顔（酔っぱらい）/ mark：'anger' 怒りマーク・'sweat' 汗 / sparkle：キラキラ / nose：'red' 風邪の赤い鼻 / bags：目の下のくま
export const FACE_STYLES = {
  calm: { eye: 'round', mouth: 'smile' },
  cheer: { eye: 'round', ew: 23, eh: 26, brow: -0.1, mouth: 'grin' },
  tipsy: { eye: 'tipsy', brow: -0.22, mouth: 'drunk', flush: 1 },
  fresh: { eye: 'clear', brow: 0.1, mouth: 'smirk', sparkle: 1 },
  hot: { eye: 'sharp', brow: 0.34, browW: 1.5, mouth: 'toothy', mark: 'sweat' },
  angry: { eye: 'glare', brow: 0.56, browY: 9, browW: 1.25, mouth: 'growl', mark: 'anger' },
  idol: { eye: 'lidded', brow: -0.04, mouth: 'small', lowLash: 1, blushK: 0.45 },
  smug: { eye: 'smug', brow: 0.12, browUp: 1, mouth: 'smirk' },
  shine: { eye: 'smiley', mouth: 'bigSmile', sparkle: 2 },
  sleepy: { eye: 'tired', brow: -0.3, mouth: 'oh', nose: 'red', bags: 1, blushK: 0.55 },
  gentle: { eye: 'droopy', brow: -0.24, mouth: 'soft' },
  buddy: { eye: 'round', ew: 20, eh: 22, iris: 0.86, brow: -0.06, mouth: 'grin' },
  cute: { eye: 'big', mouth: 'cat', blushK: 0.75 },
  chatty: { eye: 'big', mouth: 'talk', browUp: 1, blushK: 0.55 },
  soft: { eye: 'droopy', ew: 23, eh: 27, mouth: 'soft', brow: -0.2, blushK: 0.55 },
  cheeky: { eye: 'big', tilt: 0.16, mouth: 'catGrin', brow: 0.14, blushK: 0.5 },
};
// 目の形：w・h 大きさ / iris 黒目 / lid 上まぶた（0〜0.6 かくす）/ low 下まぶた（笑った目）/ tilt 目じり（＋で上がる）
const EYE_TYPES = {
  round: { w: 22, h: 25, iris: 0.8 },
  tipsy: { w: 22, h: 23, iris: 0.8, lid: 0.46, tilt: -0.14, lookY: 0.35 },
  clear: { w: 22, h: 23, iris: 0.8, tilt: 0.09, sparkle: 1 },
  sharp: { w: 23, h: 18, iris: 0.76, tilt: 0.22 },
  glare: { w: 23, h: 16, iris: 0.6, tilt: 0.26, lid: 0.12 },
  lidded: { w: 23, h: 22, iris: 0.82, lid: 0.36, tilt: 0.03 },
  smug: { w: 22, h: 21, iris: 0.8, lid: 0.44, tilt: 0.06, lookX: 0.4 },
  smiley: { w: 22, h: 24, iris: 0.82, low: 0.34, sparkle: 1 },
  tired: { w: 22, h: 22, iris: 0.8, lid: 0.5, tilt: -0.12 },
  droopy: { w: 22, h: 24, iris: 0.84, tilt: -0.24 },
  big: { w: 25, h: 30, iris: 0.85, sparkle: 2 },
  // v1.6（写真から）：crease＝二重の線 / narrow＝攻撃・スペシャルでも細いまま
  bigRound: { w: 24, h: 27, iris: 0.86, crease: 1 },
  calmRound: { w: 22, h: 21, iris: 0.82, crease: 1, lid: 0.06 },
  softBig: { w: 24, h: 27, iris: 0.86, crease: 1, sparkle: 1 },
  narrow: { w: 24, h: 14, iris: 0.66, lid: 0.12, tilt: 0.02, narrow: 1 },
  narrowSmile: { w: 24, h: 15, iris: 0.68, lid: 0.1, low: 0.3, tilt: 0.0, narrow: 1 },
  sleepyN: { w: 23, h: 16, iris: 0.7, lid: 0.3, tilt: -0.03, narrow: 1 },
  sharpN: { w: 24, h: 15, iris: 0.7, lid: 0.06, tilt: 0.13, narrow: 1 },
  crinkle: { w: 23, h: 16, iris: 0.7, lid: 0.16, low: 0.42, tilt: -0.02, narrow: 1 },
  happyN: { w: 23, h: 18, iris: 0.72, low: 0.48, tilt: 0.02, narrow: 1 },
  crescent: { w: 23, h: 18, iris: 0.72, low: 0.48, narrow: 1, arc: 1 }, // ふだんから笑って細くなった目（∩）
};
const faceParamCache = new WeakMap();
function faceParams(look) {
  const f = look.face;
  if (f === 'grin' || f === 'oh' || f === 'cool') return null;
  if (f && typeof f === 'object' && faceParamCache.has(f)) return faceParamCache.get(f);
  const base = typeof f === 'string' ? FACE_STYLES[f] || FACE_STYLES.calm : (f && FACE_STYLES[f.base]) || FACE_STYLES.calm;
  const fp = { ...base, ...(f && typeof f === 'object' ? f : {}) };
  if (fp.lash == null) fp.lash = !!look.female;
  if (f && typeof f === 'object') faceParamCache.set(f, fp);
  return fp;
}
// 目（新しい顔）。side：-1＝画面の左の目（鏡うつし）。外がわの目じりは、どちらも顔の外へ
function eye2(ctx, x, y, side, look, o = {}) {
  const w = o.w || 22, h = o.h || 25;
  const iris = '#' + new THREE.Color(look.eye).getHexString();
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(side, 1);
  ctx.rotate(-(o.tilt || 0));
  const lid = o.lid || 0, low = o.low || 0;
  const lidY = -h + 2 * h * lid;
  const lowY = h - 2 * h * low;
  // 見える白目：だ円から上まぶた・下まぶたをのぞく
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 0, w, h, 0, 0, Math.PI * 2);
  ctx.clip();
  if (lid) {
    ctx.beginPath();
    ctx.moveTo(-w * 1.6, lidY + h * 0.12);
    ctx.quadraticCurveTo(0, lidY - h * 0.16, w * 1.6, lidY + h * 0.12);
    ctx.lineTo(w * 1.6, h * 2);
    ctx.lineTo(-w * 1.6, h * 2);
    ctx.closePath();
    ctx.clip();
  }
  if (low) {
    ctx.beginPath();
    ctx.moveTo(-w * 1.6, -h * 2);
    ctx.lineTo(w * 1.6, -h * 2);
    ctx.lineTo(w * 1.6, lowY + h * 0.2);
    ctx.quadraticCurveTo(0, lowY - h * 0.55, -w * 1.6, lowY + h * 0.2);
    ctx.closePath();
    ctx.clip();
  }
  ctx.fillStyle = '#f7f3f4';
  ctx.fillRect(-w * 1.6, -h * 1.6, w * 3.2, h * 3.2);
  const ir = (o.iris || 0.8) * w;
  const ix = (o.lookX || 0) * w * 0.25, iy = h * 0.1 + (o.lookY || 0) * h * 0.2;
  const g = ctx.createLinearGradient(0, iy - ir * 1.2, 0, iy + ir * 1.2);
  g.addColorStop(0, '#120c0c');
  g.addColorStop(0.45, iris);
  g.addColorStop(1, o.glow ? '#d4feff' : lighten(iris, 0.45));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(ix, iy, ir, ir * 1.18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0b0708';
  ctx.beginPath();
  ctx.ellipse(ix, iy + ir * 0.05, ir * (o.glow ? 0.26 : 0.45), ir * (o.glow ? 0.5 : 0.6), 0, 0, Math.PI * 2);
  ctx.fill();
  if (o.glow) {
    ctx.strokeStyle = 'rgba(225,255,255,0.95)';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.ellipse(ix, iy, ir * 0.78, ir * 0.94, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(60,30,50,0.28)';
  ctx.fillRect(-w * 1.6, Math.min(lidY, -h) - h * 0.2, w * 3.2, h * 0.55 + Math.max(0, lidY + h) + h * 0.2);
  // ハイライト（光は画面の左上から＝鏡うつしをもどす）
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(ix - side * ir * 0.38, iy - ir * 0.45, ir * 0.32, ir * 0.38, -0.4 * side, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ix + side * ir * 0.4, iy + ir * 0.55, ir * 0.16, 0, Math.PI * 2);
  ctx.fill();
  if (o.sparkle >= 2) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(ix + side * ir * 0.1, iy + ir * 0.05, ir * 0.11, 0, Math.PI * 2);
    ctx.fill();
  }
  if (o.sparkle && o.glow) {
    ctx.fillStyle = '#fffbe0';
    star(ctx, ix + ir * 0.1, iy - ir * 0.1, ir * 0.42, 4);
  }
  ctx.restore();
  // 上まつげ（太く、目じりを上げる）。上まぶたがあるときは、まぶたの線にそって
  ctx.strokeStyle = INK;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = o.lash ? 8.5 : 7.5;
  ctx.beginPath();
  if (lid) {
    ctx.moveTo(-w * 1.1, lidY + h * 0.22);
    ctx.quadraticCurveTo(-w * 0.1, lidY - h * 0.18, w * 1.12, lidY + h * 0.02);
    ctx.lineTo(w * 1.3, lidY - h * 0.12);
  } else {
    ctx.moveTo(-w * 1.12, -h * 0.25);
    ctx.quadraticCurveTo(-w * 0.2, -h * 1.22, w * 1.05, -h * 0.62);
    ctx.lineTo(w * 1.28, -h * 0.82);
  }
  ctx.stroke();
  if (o.crease) {
    // 二重の線（上まぶたの少し上に、細く）
    const cy = (lid ? lidY : -h * 0.95) - h * 0.32 - 3;
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = 'rgba(70,35,40,0.75)';
    ctx.beginPath();
    ctx.moveTo(-w * 0.7, cy + h * 0.32);
    ctx.quadraticCurveTo(w * 0.05, cy - h * 0.12, w * 1.02, cy + h * 0.18);
    ctx.stroke();
    ctx.strokeStyle = INK;
  }
  if (o.lash) {
    // まつげの先（目じりに2本）
    const ty = lid ? lidY : -h * 0.7;
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(w * 0.95, ty + h * 0.05);
    ctx.lineTo(w * 1.5, ty - h * 0.32);
    ctx.moveTo(w * 0.62, ty - h * 0.18);
    ctx.lineTo(w * 1.05, ty - h * 0.62);
    ctx.stroke();
  }
  // 下まつげ
  ctx.lineWidth = o.lowLash || o.lash ? 3.2 : 2.5;
  ctx.strokeStyle = 'rgba(40,20,28,0.7)';
  ctx.beginPath();
  if (low) {
    ctx.moveTo(-w * 0.85, lowY + h * 0.05);
    ctx.quadraticCurveTo(0, lowY - h * 0.45, w * 0.9, lowY + h * 0.02);
  } else {
    ctx.moveTo(-w * 0.55, h * 0.92);
    ctx.quadraticCurveTo(0, h * 1.08, w * 0.6, h * 0.88);
  }
  ctx.stroke();
  if (o.lash || o.lowLash) {
    ctx.beginPath();
    ctx.moveTo(w * 0.62, h * 0.86);
    ctx.lineTo(w * 0.95, h * 1.02);
    ctx.stroke();
  }
  ctx.restore();
}
// 閉じた目（まばたき：︶）。lash で目じりに小さなまつげ
function shutEye(ctx, x, y, side, w, lash, up = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(side, 1);
  ctx.strokeStyle = INK;
  ctx.lineCap = 'round';
  ctx.lineWidth = 7.5;
  ctx.beginPath();
  if (up) {
    ctx.moveTo(-w, 6);
    ctx.quadraticCurveTo(0, -20, w, 6);
  } else {
    ctx.moveTo(-w, -4);
    ctx.quadraticCurveTo(0, 12, w, -4);
  }
  ctx.stroke();
  if (lash) {
    ctx.lineWidth = 4;
    ctx.beginPath();
    if (up) {
      ctx.moveTo(w * 0.85, 2);
      ctx.lineTo(w * 1.3, -6);
    } else {
      ctx.moveTo(w * 0.8, -1);
      ctx.lineTo(w * 1.25, -10);
      ctx.moveTo(w * 0.45, 3);
      ctx.lineTo(w * 0.7, -6);
    }
    ctx.stroke();
  }
  ctx.restore();
}
// まゆ（太さ thick を変えられる）
function brow2(ctx, x, y, ang, len, thick = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.scale(1, thick);
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.moveTo(-len, 3);
  ctx.quadraticCurveTo(0, -7, len, -1);
  ctx.quadraticCurveTo(0, -1, -len, 3);
  ctx.lineTo(-len, 6);
  ctx.quadraticCurveTo(0, -2, len, 2);
  ctx.fill();
  ctx.restore();
}
// 歯を見せる口（toothy：ニカッ / growl：食いしばって口角が下がる / roar：さけぶ）
function teethMouth(ctx, x, y, w, h, down) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  const c = down ? 6 : -6;
  ctx.moveTo(-w, -h * 0.5 + (down ? 4 : -2));
  ctx.quadraticCurveTo(0, -h * 0.5 - c * 0.4, w, -h * 0.5 + (down ? 4 : -2));
  ctx.quadraticCurveTo(w * 1.05, h * 0.5, w * 0.8, h * 0.5 + (down ? 3 : 0));
  ctx.quadraticCurveTo(0, h * 0.5 + c, -w * 0.8, h * 0.5 + (down ? 3 : 0));
  ctx.quadraticCurveTo(-w * 1.05, h * 0.5, -w, -h * 0.5 + (down ? 4 : -2));
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(90,40,50,0.5)';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(-w, 0.5 + (down ? 1 : -1));
  ctx.quadraticCurveTo(0, c * 0.35, w, 0.5 + (down ? 1 : -1));
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = '#5a2a2a';
  ctx.lineWidth = 3.5;
  ctx.stroke();
  ctx.restore();
}
// 口（新しい顔）
function mouth2(ctx, type, cx, my) {
  const s = 1;
  switch (type) {
    case 'grin':
      mouthOpen(ctx, cx, my - 6, s, 30, 20, { shape: 'D', teeth: 0.5 });
      break;
    case 'bigSmile':
      mouthOpen(ctx, cx, my - 8, s, 34, 24, { shape: 'D', teeth: 0.5 });
      break;
    case 'drunk':
      // 酔ってゆがんだ、へらへら笑い
      ctx.save();
      ctx.translate(cx, my - 6);
      ctx.rotate(-0.16);
      mouthOpen(ctx, 0, 0, s, 26, 17, { shape: 'D', teeth: 0.4 });
      ctx.restore();
      break;
    case 'smirk':
      mouthLine(ctx, cx + 4, my - 6, s, 17, 6, { lift: -11 });
      break;
    case 'toothy':
      // ニカッと歯を見せる（自信の笑い）
      mouthOpen(ctx, cx, my - 7, s, 31, 21, { shape: 'D', teeth: 0.8 });
      break;
    case 'growl':
      // 歯を食いしばって、口角が下がる（イーッ）
      teethMouth(ctx, cx + 2, my - 4, 26, 15, true);
      break;
    case 'roar':
      mouthOpen(ctx, cx, my - 4, s, 32, 26, { shape: 'D', teeth: 0.62 });
      break;
    case 'small':
      mouthLine(ctx, cx + 2, my - 4, s, 8, 3, { lw: 4.5 });
      break;
    case 'oh':
      mouthOpen(ctx, cx, my - 2, s, 10, 10, { teeth: 0 });
      break;
    case 'soft':
      mouthLine(ctx, cx + 2, my - 6, s, 15, 8, { lw: 4.2 });
      break;
    case 'talk':
      mouthOpen(ctx, cx, my - 4, s, 13, 12, { teeth: 0.35 });
      break;
    case 'cat':
    case 'catGrin': {
      if (type === 'catGrin') {
        mouthOpen(ctx, cx, my - 4, s, 17, 13, { shape: 'D', teeth: 0 });
        // 八重歯
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(cx + 5, my - 9);
        ctx.lineTo(cx + 12, my - 9);
        ctx.lineTo(cx + 8.5, my - 2);
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = '#5a2a2a';
      ctx.lineWidth = 4.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - 17, my - 12);
      ctx.quadraticCurveTo(cx - 8, my - 1, cx, my - 9);
      ctx.quadraticCurveTo(cx + 8, my - 1, cx + 17, my - 12);
      ctx.stroke();
      break;
    }
    case 'flat':
      // まっすぐの口（真顔）
      mouthLine(ctx, cx + 2, my - 6, s, 13, 1.5, { lw: 4.4 });
      break;
    case 'pout':
    case 'lips': {
      // ふっくらしたくちびる（閉じた口）。lips：もっと厚い（ちじわ）
      const k = type === 'lips' ? 1.55 : 1;
      ctx.fillStyle = type === 'lips' ? 'rgba(222,88,96,0.85)' : 'rgba(226,112,118,0.78)';
      ctx.beginPath();
      ctx.ellipse(cx + 2, my - 7 + 6 * k, 15 * k, 6.5 * k, 0, 0, Math.PI * 2);
      ctx.fill();
      if (type === 'lips') {
        ctx.beginPath();
        ctx.ellipse(cx + 2, my - 9, 16, 5, 0, Math.PI, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,215,215,0.55)';
      ctx.beginPath();
      ctx.ellipse(cx - 2, my - 8 + 5 * k, 6 * k, 2.2 * k, 0, 0, Math.PI * 2);
      ctx.fill();
      mouthLine(ctx, cx + 2, my - 7, s, 14 * k, 2, { lw: 3.6, color: '#7a3236' });
      break;
    }
    case 'beam':
      // 大きく笑って上の歯を見せる
      mouthOpen(ctx, cx, my - 10, s, 42, 27, { shape: 'D', teeth: 0.74 });
      break;
    case 'smile':
    default:
      mouthLine(ctx, cx + 2, my - 6, s, 17, 9);
  }
}
// 怒りマーク（💢）
function angerMark(ctx, x, y, r) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = '#e8333d';
  ctx.lineWidth = r * 0.36;
  ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI) / 2);
    ctx.beginPath();
    ctx.moveTo(r * 0.28, r * 1.0);
    ctx.quadraticCurveTo(r * 0.3, r * 0.3, r * 1.0, r * 0.28);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}
// 真っ赤な顔（酔っぱらい）：ほおから鼻まで赤く、ななめ線
function flushFace(ctx, cx, y, k = 1) {
  const g = ctx.createRadialGradient(cx, y, 4, cx, y, 92);
  g.addColorStop(0, `rgba(255,70,85,${0.42 * k})`);
  g.addColorStop(1, 'rgba(255,70,85,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(cx, y, 96, 26, 0, 0, Math.PI * 2);
  ctx.fill();
  blush(ctx, cx, y + 4, 1, 1.5 * k);
}
function drawFace2(ctx, look, fp, ex) {
  const s = 1;
  const cx = 128, ey = 132, sx = fp.sx || 46, my = 205;
  const E = EYE_TYPES[fp.eye] || EYE_TYPES.round;
  const eo = { ...E, w: fp.ew || E.w, h: fp.eh || E.h, iris: fp.iris || E.iris, tilt: fp.tilt != null ? fp.tilt : E.tilt || 0, lid: fp.lid != null ? fp.lid : E.lid || 0, low: fp.low != null ? fp.low : E.low || 0, lash: !!fp.lash, lowLash: !!(fp.lowLash || fp.lash), crease: fp.crease != null ? fp.crease : E.crease || 0 };
  const narrow = !!(fp.narrow != null ? fp.narrow : E.narrow);
  ctx.lineJoin = 'round';
  // ひげのそりあと（口のまわりを うすく青く）
  if (fp.stubble) {
    const k = fp.stubble;
    const r = rng(41);
    for (const [y, w, h] of [[my - 17, 24, 6], [my + 20, 26, 12]]) {
      const g = ctx.createRadialGradient(cx + 2, y, 2, cx + 2, y, w);
      g.addColorStop(0, `rgba(80,90,120,${0.13 * k})`);
      g.addColorStop(1, 'rgba(80,90,120,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx + 2, y, w, h, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = `rgba(60,64,86,${0.26 * k})`;
    for (let i = 0; i < 46; i++) {
      const a = r() * Math.PI * 2, rr = Math.sqrt(r());
      const up = i < 16;
      const x = cx + 2 + Math.cos(a) * rr * (up ? 21 : 23);
      const y = up ? my - 17 + Math.sin(a) * rr * 5 : my + 20 + Math.sin(a) * rr * 11;
      ctx.fillRect(x, y, 1.3, 1.3);
    }
  }
  // ほくろ
  if (fp.mole) {
    ctx.fillStyle = 'rgba(60,35,30,0.9)';
    ctx.beginPath();
    ctx.arc(cx + fp.mole[0], ey + fp.mole[1], 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  const nose = () => {
    if (fp.nose === 'red') {
      ctx.fillStyle = 'rgba(255,105,115,0.8)';
      ctx.beginPath();
      ctx.ellipse(cx + 2, ey + 40, 8, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.arc(cx - 1, ey + 37, 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.fillStyle = 'rgba(170,90,80,0.45)';
    ctx.beginPath();
    ctx.ellipse(cx + 3, ey + 40, 4, 3, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  const bk = fp.blushK != null ? fp.blushK : look.blush ? 1 : 0;
  if (fp.flush) flushFace(ctx, cx, ey + 40, ex === FACES.ko || ex === FACES.hurt ? 1.15 : 1);
  else if (bk || ex === FACES.happy || ex === FACES.hurt) blush(ctx, cx, ey + 44, s, Math.max(bk, ex === FACES.happy || ex === FACES.hurt ? 0.6 : 0));
  const eyes = (o, dy = 0) => {
    eye2(ctx, cx - sx, ey + dy, -1, look, o);
    eye2(ctx, cx + sx, ey + dy, 1, look, o);
  };
  const brows = (b, dy = 0, len = 25, up = fp.browUp ? 1 : 0) => {
    const by = ey - 44 + dy + (fp.browY || 0);
    const th = fp.browW || 1;
    brow2(ctx, cx - sx, by, b, len, th);
    brow2(ctx, cx + sx, by - up * 8, -b - up * 0.2, len, th);
  };
  const shut = (up = false, dy = 6, w = 21) => {
    shutEye(ctx, cx - sx, ey + dy, -1, w, eo.lash, up);
    shutEye(ctx, cx + sx, ey + dy, 1, w, eo.lash, up);
  };
  const marks = (lv = 1) => {
    if (fp.mark === 'anger') angerMark(ctx, cx + 84, ey - 46, 13 * lv);
    if (fp.mark === 'sweat') sweat(ctx, cx + 90, ey - 26, s);
    if (fp.bags) {
      ctx.strokeStyle = 'rgba(120,80,120,0.45)';
      ctx.lineWidth = 2.6;
      for (const x of [cx - sx, cx + sx]) {
        ctx.beginPath();
        ctx.moveTo(x - 15, ey + 32);
        ctx.quadraticCurveTo(x, ey + 38, x + 15, ey + 32);
        ctx.stroke();
      }
    }
    if (fp.sparkle >= 2) {
      ctx.fillStyle = '#fff6c8';
      star(ctx, cx + sx + 40, ey - 34, 11, 4);
      star(ctx, cx - sx - 42, ey - 18, 7, 4);
    }
  };
  // スペシャルの顔：クール系（不敵な笑み・金色のキラキラの目）か、熱い系（さけぶ・水色に光る目）
  const coolSp = fp.mouth === 'smirk' || fp.mouth === 'small' || fp.mouth === 'soft' || fp.mouth === 'flat' || fp.mouth === 'pout' || fp.mouth === 'lips' || !!fp.sparkle;
  const glowC = coolSp ? 'rgba(255,236,150,0.65)' : 'rgba(130,245,255,0.7)';
  switch (ex) {
    case FACES.neutral:
    case FACES.blink: {
      brows(fp.brow || 0);
      if (E.arc) shut(true, 2, 23); // 笑った目（まばたきも同じ）
      else if (ex === FACES.blink) shut(fp.eye === 'smiley', 6, 21);
      else eyes(eo, 2);
      nose();
      mouth2(ctx, fp.mouth, cx, my);
      marks();
      break;
    }
    case FACES.attack: {
      brows(0.42 + Math.max(0, fp.brow || 0) * 0.35, 6, 26, 0);
      eyes({ ...eo, h: narrow ? Math.max(11, eo.h * 0.85) : Math.min(eo.h, 19) * 0.82, lid: 0, low: 0, tilt: 0.14 + Math.max(0, eo.tilt) * 0.5, iris: Math.min(eo.iris, 0.74), sparkle: 0 }, 6);
      nose();
      if (fp.mouth === 'growl') teethMouth(ctx, cx, my - 5, 27, 18, false);
      else mouthOpen(ctx, cx, my - 4, s, 30, 24, { shape: 'D', teeth: 0.6 });
      if (fp.mark === 'anger') angerMark(ctx, cx + 84, ey - 46, 15);
      break;
    }
    case FACES.hurt: {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      for (const side of [-1, 1]) {
        const x = cx + side * sx;
        ctx.beginPath();
        ctx.moveTo(x - side * 22, ey - 16);
        ctx.lineTo(x + side * 16, ey + 2);
        ctx.lineTo(x - side * 22, ey + 18);
        ctx.stroke();
      }
      brows(-0.35, 0, 24, 0);
      mouthOpen(ctx, cx, my, s, 22, 13, { teeth: 0.9 });
      sweat(ctx, cx + 92, ey - 30, s);
      break;
    }
    case FACES.ko: {
      swirl(ctx, cx - sx, ey, s);
      swirl(ctx, cx + sx, ey, s);
      brows(-0.3, -2, 22, 0);
      ctx.strokeStyle = '#5a2a2a';
      ctx.lineWidth = 5;
      ctx.beginPath();
      for (let i = 0; i <= 6; i++) ctx.lineTo(cx - 24 + i * 8, my - 4 + (i % 2 ? 7 : -3));
      ctx.stroke();
      break;
    }
    case FACES.happy: {
      brows(-0.15, -6, 24, 0);
      shut(true, 0, 24);
      nose();
      if (fp.mouth === 'cat' || fp.mouth === 'catGrin') mouth2(ctx, 'catGrin', cx, my);
      else if (fp.mouth === 'drunk') mouth2(ctx, 'drunk', cx, my);
      else mouthOpen(ctx, cx, my - 8, s, 34, 26, { shape: 'D', teeth: 0.48 });
      if (fp.sparkle >= 2) marks();
      break;
    }
    case FACES.special: {
      const cool = coolSp;
      const bt = cool ? 0.2 : 0.46;
      brows(bt, 10, 28, 0);
      brows(bt, 14, 25, 0);
      eyeGlow(ctx, cx - sx, ey + 6, s, glowC);
      eyeGlow(ctx, cx + sx, ey + 6, s, glowC);
      eyes({ ...eo, w: 24, h: narrow ? eo.h + 4 : Math.max(22, Math.min(eo.h, 28)), lid: 0, low: 0, iris: narrow ? 0.74 : 0.84, glow: true, sparkle: cool ? 1 : 0, tilt: cool ? Math.max(0, eo.tilt) : 0.12 }, 6);
      nose();
      if (cool) mouthLine(ctx, cx + 4, my - 8, s, 20, 9, { lift: -7 });
      else mouthOpen(ctx, cx, my - 10, s, 38, 30, { shape: 'D', teeth: 0.55 });
      if (fp.mark === 'anger') angerMark(ctx, cx + 84, ey - 46, 15);
      break;
    }
    case FACES.sad: {
      brows(-0.32, 2, 24, 0);
      eyes({ ...eo, h: narrow ? eo.h : Math.min(eo.h, 20), lid: Math.max(eo.lid || 0, 0.1), low: 0, tilt: Math.min(0, eo.tilt) - 0.08, lookY: 0.6, sparkle: 0 }, 6);
      nose();
      mouthLine(ctx, cx, my, s, 15, -8);
      ctx.fillStyle = 'rgba(120,180,255,0.35)';
      ctx.fillRect(cx - sx - 26, ey - 92, 52, 4);
      break;
    }
  }
}

// 1マスに顔をかく（中心 128。目の高さ 136）
function drawFace(ctx, look, ex) {
  const fp = faceParams(look);
  if (fp) return drawFace2(ctx, look, fp, ex);
  const s = 1;
  const cx = 128, ey = 132, sx = 46, my = 205;
  const style = look.face; // grin（ドラ）/ oh（エブン）/ cool（アオッチ）
  ctx.lineJoin = 'round';
  // 鼻（小さな影）
  const nose = () => {
    ctx.fillStyle = 'rgba(170,90,80,0.45)';
    ctx.beginPath();
    ctx.ellipse(cx + 3, ey + 40, 4, 3, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  if (look.blush || ex === FACES.happy || ex === FACES.hurt) blush(ctx, cx, ey + 44, s, look.blush ? 1 : 0.6);
  switch (ex) {
    case FACES.neutral:
    case FACES.blink: {
      const shut = ex === FACES.blink;
      if (style === 'grin') {
        // ドラ：いつも大笑い（笑うと目がなくなる）
        brow(ctx, cx - sx, ey - 46, s, -0.12, 24, 1);
        brow(ctx, cx + sx, ey - 46, s, 0.12, 24, 1);
        arcEye(ctx, cx - sx, ey, s, true);
        arcEye(ctx, cx + sx, ey, s, true);
        nose();
        mouthOpen(ctx, cx, my - 6, s, 36, 26, { shape: 'D', teeth: 0.5 });
      } else if (style === 'oh') {
        // エブン：まるい目・まるい口
        brow(ctx, cx - sx, ey - 48, s, -0.05, 22, 1);
        brow(ctx, cx + sx, ey - 48, s, 0.05, 22, 1);
        if (shut) {
          arcEye(ctx, cx - sx, ey + 6, s, false, 20);
          arcEye(ctx, cx + sx, ey + 6, s, false, 20);
        } else {
          eyeOpen(ctx, cx - sx, ey, s, look, { w: 23, h: 28, iris: 0.82 });
          eyeOpen(ctx, cx + sx, ey, s, look, { w: 23, h: 28, iris: 0.82 });
        }
        nose();
        mouthOpen(ctx, cx, my, s, 11, 12, { teeth: 0 });
      } else {
        // アオッチ：きりっとした目・少し笑う口
        brow(ctx, cx - sx, ey - 42, s, 0.06, 26, 1);
        brow(ctx, cx + sx, ey - 42, s, -0.06, 26, 1);
        if (shut) {
          arcEye(ctx, cx - sx, ey + 4, s, false, 22);
          arcEye(ctx, cx + sx, ey + 4, s, false, 22);
        } else {
          eyeOpen(ctx, cx - sx, ey + 2, s, look, { w: 22, h: 21, iris: 0.8 });
          eyeOpen(ctx, cx + sx, ey + 2, s, look, { w: 22, h: 21, iris: 0.8 });
        }
        nose();
        mouthLine(ctx, cx + 4, my - 6, s, 18, 7, { lift: -5 });
      }
      break;
    }
    case FACES.attack: {
      // 攻撃：まゆを寄せて、叫ぶ
      brow(ctx, cx - sx, ey - 38, s, 0.42, 26, 1);
      brow(ctx, cx + sx, ey - 38, s, -0.42, 26, 1);
      if (style === 'grin') {
        arcEye(ctx, cx - sx, ey + 2, s, true, 22);
        arcEye(ctx, cx + sx, ey + 2, s, true, 22);
      } else {
        eyeOpen(ctx, cx - sx, ey + 6, s, look, { w: 22, h: 15, iris: 0.72, tilt: 0.12 });
        eyeOpen(ctx, cx + sx, ey + 6, s, look, { w: 22, h: 15, iris: 0.72, tilt: -0.12 });
      }
      nose();
      mouthOpen(ctx, cx, my - 4, s, 30, 24, { shape: 'D', teeth: 0.6 });
      break;
    }
    case FACES.hurt: {
      // 痛い：＞＜の目、ゆがんだ口、汗
      ctx.strokeStyle = INK;
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      for (const side of [-1, 1]) {
        const x = cx + side * sx;
        ctx.beginPath();
        ctx.moveTo(x - side * 22, ey - 16);
        ctx.lineTo(x + side * 16, ey + 2);
        ctx.lineTo(x - side * 22, ey + 18);
        ctx.stroke();
      }
      brow(ctx, cx - sx, ey - 44, s, -0.35, 24, 1);
      brow(ctx, cx + sx, ey - 44, s, 0.35, 24, 1);
      mouthOpen(ctx, cx, my, s, 22, 13, { teeth: 0.9 });
      sweat(ctx, cx + 92, ey - 30, s);
      break;
    }
    case FACES.ko: {
      // ダウン：ぐるぐる目
      swirl(ctx, cx - sx, ey, s);
      swirl(ctx, cx + sx, ey, s);
      brow(ctx, cx - sx, ey - 46, s, -0.3, 22, 1);
      brow(ctx, cx + sx, ey - 46, s, 0.3, 22, 1);
      ctx.strokeStyle = '#5a2a2a';
      ctx.lineWidth = 5;
      ctx.beginPath();
      for (let i = 0; i <= 6; i++) ctx.lineTo(cx - 24 + i * 8, my - 4 + (i % 2 ? 7 : -3));
      ctx.stroke();
      break;
    }
    case FACES.happy: {
      // 勝ち：にっこり
      brow(ctx, cx - sx, ey - 50, s, -0.15, 24, 1);
      brow(ctx, cx + sx, ey - 50, s, 0.15, 24, 1);
      arcEye(ctx, cx - sx, ey, s, true);
      arcEye(ctx, cx + sx, ey, s, true);
      nose();
      mouthOpen(ctx, cx, my - 8, s, 34, 26, { shape: 'D', teeth: 0.48 });
      break;
    }
    case FACES.special: {
      // スペシャル：光る目＋強いまゆ＋大きく開いた口（アオッチはイケメンのキラキラ目と不敵な笑み）
      const cool = style === 'cool';
      const bt = cool ? 0.2 : 0.46;
      // まゆは前髪にかくれないよう少し下に、太く
      brow(ctx, cx - sx, ey - 34, s, bt, 28, 1);
      brow(ctx, cx + sx, ey - 34, s, -bt, 28, 1);
      brow(ctx, cx - sx, ey - 30, s, bt, 25, 1);
      brow(ctx, cx + sx, ey - 30, s, -bt, 25, 1);
      eyeGlow(ctx, cx - sx, ey + 6, s, cool ? 'rgba(255,236,150,0.65)' : 'rgba(130,245,255,0.7)');
      eyeGlow(ctx, cx + sx, ey + 6, s, cool ? 'rgba(255,236,150,0.65)' : 'rgba(130,245,255,0.7)');
      // 目を大きく見ひらく（瞳は小さく＝本気の目）
      eyeOpen(ctx, cx - sx, ey + 6, s, look, { w: 24, h: cool ? 23 : 24, iris: 0.84, glow: true, sparkle: cool, tilt: cool ? 0 : 0.12 });
      eyeOpen(ctx, cx + sx, ey + 6, s, look, { w: 24, h: cool ? 23 : 24, iris: 0.84, glow: true, sparkle: cool, tilt: cool ? 0 : -0.12 });
      nose();
      if (cool) mouthLine(ctx, cx + 4, my - 8, s, 20, 9, { lift: -7 });
      else mouthOpen(ctx, cx, my - 10, s, 38, 30, { shape: 'D', teeth: 0.55 });
      break;
    }
    case FACES.sad: {
      // 負け：まゆが下がって、下を見る
      brow(ctx, cx - sx, ey - 42, s, -0.32, 24, 1);
      brow(ctx, cx + sx, ey - 42, s, 0.32, 24, 1);
      if (style === 'grin') {
        arcEye(ctx, cx - sx, ey + 6, s, false, 22);
        arcEye(ctx, cx + sx, ey + 6, s, false, 22);
      } else {
        eyeOpen(ctx, cx - sx, ey + 6, s, look, { w: 21, h: 18, iris: 0.8, lookY: 0.6 });
        eyeOpen(ctx, cx + sx, ey + 6, s, look, { w: 21, h: 18, iris: 0.8, lookY: 0.6 });
      }
      nose();
      mouthLine(ctx, cx, my, s, 15, -8);
      ctx.fillStyle = 'rgba(120,180,255,0.35)';
      ctx.fillRect(cx - sx - 26, ey - 92, 52, 4);
      break;
    }
  }
}

// ===== 見た目の決まり =====
// looks.js の値を読む。書いていない所はここの値になる（前からの3人＝ドラ・エブン・アオッチは前とまったく同じ形）
//  体：height 身長 / build 胴の太さ / female 女の子の体（肩がせまく、腰がくびれる、まつげ）/ headScale 頭の大きさ
//      shoulder 肩はば / slope なで肩（0〜1）/ arm・leg 腕・脚の太さ / limb 腕・脚の長さ / belly おなか（0〜1）/ jaw ほおの丸み（0〜1）/ neck 首の太さ
//  服：outfit（tee / tank / shirt / zip / open / hoodie / oversize）/ sleeves（long / short / none / wide）
//      bottom（pants / shorts / short / longShorts / skirt / wide / slim）/ shirt・sleeve・inner・trim・pants・socks・belt（色）
//  小物：items [...]（前からの extra：tigerBand / goggles / glasses も使える）
//  髪：hairStyle / 顔：face（'grin'・'oh'・'cool' は前の3人の顔。ほかは FACE_STYLES の名前か {…} の値）
const LOOK_BASE = {
  skin: 0xf2c4a0, hair: 0x2a211d, shirt: 0xe9edf2, sleeve: null, pants: 0x2f3442, shoe: 0xf4f4f4, shoeAccent: 0x3a3f4a, eye: 0x3b2418,
  hairStyle: 'short', face: 'calm', height: 1, build: 1, blush: false, shortSleeve: false, extra: null,
  female: false, headScale: 1, shoulder: 1, slope: 0, arm: 1, leg: 1, limb: 1, belly: 0, jaw: 0, neck: 1, faceW: 0, faceL: 0,
  outfit: 'tee', sleeves: null, bottom: null, items: null, belt: 0x24232a,
};
const NUM_RANGE = { height: [0.6, 1.6], build: [0.6, 1.8], headScale: [0.6, 1.4], shoulder: [0.6, 1.6], slope: [0, 1], arm: [0.6, 1.8], leg: [0.6, 1.8], limb: [0.8, 1.3], belly: [0, 1], jaw: [0, 1], neck: [0.6, 1.8], faceW: [0, 1], faceL: [0, 1] };
const lookCache = new WeakMap();
export function normLook(look) {
  const src = look && typeof look === 'object' ? look : null;
  if (src && lookCache.has(src)) return lookCache.get(src);
  const L = { ...LOOK_BASE };
  if (src) for (const k of Object.keys(src)) if (src[k] != null) L[k] = src[k];
  for (const k in NUM_RANGE) {
    const [a, b] = NUM_RANGE[k];
    if (typeof L[k] !== 'number' || !isFinite(L[k])) L[k] = LOOK_BASE[k];
    L[k] = clamp(L[k], a, b);
  }
  if (L.sleeve == null) L.sleeve = L.shirt;
  if (!L.sleeves) L.sleeves = L.outfit === 'tank' || L.outfit === 'bare' ? 'none' : L.shortSleeve ? 'short' : 'long';
  if (!L.bottom) L.bottom = L.extra === 'goggles' ? 'shorts' : 'pants';
  const items = new Set(Array.isArray(L.items) ? L.items : []);
  if (L.extra) items.add(L.extra);
  L.has = (k) => items.has(k);
  L.items = [...items];
  if (src) lookCache.set(src, L);
  return L;
}

// 胴の形（[半径, 高さ]）。女の子は肩をせまく、腰をくびれさせる。なで肩は肩の上を下げる
function torsoProfile(look) {
  const bw = look.build, f = look.female, sl = look.slope;
  const sh = look.shoulder * (f ? 0.86 : 1);
  const mid = (1 + sh) / 2;
  return [
    [0.0, -0.02],
    [0.125 * bw, -0.015],
    [0.14 * bw * (f ? 0.92 : 1), 0.06],
    [0.135 * bw * (f ? 0.84 : 1), 0.14],
    [0.15 * bw * (f ? 0.9 : mid), 0.24],
    [0.172 * bw * sh, 0.33],
    [0.175 * bw * sh * (1 - sl * 0.08), 0.4 - sl * 0.02],
    [0.15 * bw * sh * (1 - sl * 0.25), 0.47 - sl * 0.04],
    [0.09 * (f ? 0.92 : 1), 0.505],
    [0.0, 0.51],
  ];
}
// 胴の形の、ある高さでの半径（折れ線をなぞる）
function profR(prof, y) {
  for (let i = 0; i < prof.length - 1; i++) {
    const [r0, y0] = prof[i], [r1, y1] = prof[i + 1];
    if (y >= y0 && y <= y1) return y1 > y0 ? r0 + ((r1 - r0) * (y - y0)) / (y1 - y0) : r1;
  }
  return y < prof[0][1] ? prof[0][0] : prof[prof.length - 1][0];
}
// おなかを前にふくらませる（胴の形を作ったあとで）
const BELLY_Z = 0.62, BELLY_X = 0.13;
function bellyBulge(g, k, y0, y1) {
  if (!k) return g;
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y <= y0 || y >= y1) continue;
    const b = Math.sin((Math.PI * (y - y0)) / (y1 - y0));
    const z = p.getZ(i);
    if (z > 0) p.setZ(i, z * (1 + k * BELLY_Z * b));
    p.setX(i, p.getX(i) * (1 + k * BELLY_X * b));
  }
  g.computeVertexNormals();
  return g;
}

// ===== キャラを作る =====
export function buildPuncher(def, teamIdx) {
  def = def || { id: 'unknown' };
  const look = normLook(def.look);
  const has = look.has;
  const team = TEAM[teamIdx] || TEAM[0];
  const fem = !!look.female;
  const root = new THREE.Group();
  const scaleBox = new THREE.Group(); // 身長
  const s = 0.8 * look.height;
  scaleBox.scale.setScalar(s);
  // 背が高い・脚が長いキャラは、足が地面にめりこまないように少し上げる（ドラ・エブン・アオッチは上げない）
  const limb = look.limb;
  const ss = clamp(+look.shoeSole || 1, 1, 2.5); // くつ底の厚さ（厚底スニーカー）
  const footY = -0.1 * s + s * (-0.06 - 0.71 * limb - 0.1125 - (ss - 1) * 0.045);
  const lift = Math.max(0, -0.81 - footY);
  scaleBox.position.y = -0.1 * s + lift; // 当たりの中心を体のまん中に
  root.add(scaleBox);
  const body = new THREE.Group(); // 腰を中心にした全身（飛ぶときに前に倒す）
  scaleBox.add(body);
  const spine = new THREE.Group();
  spine.position.y = 0.02;
  body.add(spine);
  const chest = new THREE.Group(); // 胸（ひねり・反り）
  chest.position.y = 0.22;
  spine.add(chest);

  // 材質：キャラ用の光＋影色。リム（ふちの光）はチームの色（敵味方がひと目でわかる。キックフライト・#コンパスと同じ考え）
  const rimC = new THREE.Color(team.light);
  const C = (color, shade = 'cool', o = {}) => toon(color, { char: true, shade, rim: o.rim != null ? o.rim : 0.55, rimColor: o.rimColor != null ? o.rimColor : rimC.getHex(), ...o });
  const mSkin = C(look.skin, 'skin', { rim: 0.3, rimColor: 0xffe8dc });
  // 柄の服（アロハなど）は、柄の絵を貼ったセル塗り（描く回数が1回ふえる）
  const mShirt = look.pattern ? texCel({ char: true, shade: 'cool', rim: 0.55, rimColor: rimC.getHex(), map: patternTex(look.pattern, look.shirt) }) : C(look.shirt, look.shirtShade || 'cool');
  const mSleeve = look.pattern && look.sleeve === look.shirt ? mShirt : C(look.sleeve, look.shirtShade || 'cool');
  // 柄のズボン（しょうたの短パンなど）
  const mPants = look.pantsPattern ? texCel({ char: true, shade: 'cool', rim: 0.55, rimColor: rimC.getHex(), map: patternTex(look.pantsPattern, look.pants) }) : C(look.pants);
  const mShoe = C(look.shoe);
  const mAcc = C(look.shoeAccent);
  const mSole = C(0xf2f0ee, 'cool', { rim: 0.2 });
  const mGlove = C(team.hex, 'cool', { rim: 0.35, rimColor: 0xffffff });
  const mGlove2 = C(0xf4f4f6, 'cool', { rim: 0.25 });
  const mHair = C(look.hair, 'hair', { rim: 0.6 });
  const L = (c) => lineColor(c);
  // 新しい部品用：色から材質とふちどりを作る
  const part = (geo, color, w = OW, shade = 'cool', o = {}) => mesh(geo, C(color, shade, o), L(color), w);
  const skinPart = (geo, w = OW) => mesh(geo, mSkin, L(look.skin), w);
  const K = { look, has, fem, team, C, part, skinPart, mSkin, mShirt, mSleeve, mPants, mHair, L, chest, body, root, rimHex: rimC.getHex() };

  // ---- 胴（胸のふくらみと腰のくびれ）----
  const bw = look.build;
  const prof = torsoProfile(look);
  K.prof = prof;
  const outfit = OUTFITS[look.outfit] ? look.outfit : 'tee';
  K.outfit = outfit;
  const hipW = fem ? 1.06 : 1;
  K.hipW = hipW;
  // 肩の位置と大きさ（腕を作る前に、服のそでぐりでも使う）
  const sh = look.shoulder * (fem ? 0.86 : 1);
  const at = look.arm * (fem ? 0.84 : 1);
  const sl = look.slope;
  const capR = 0.068 * (at >= 1 ? Math.max(1, at * 0.92) : 0.5 + 0.5 * at) * (1 - sl * 0.18);
  K.capR = capR;
  K.shX = 0.172 * bw * sh;
  K.shY = 0.255 - sl * 0.04;
  const bareTop = outfit === 'tank' || outfit === 'bare' || (outfit === 'open' && !!look.innerTank); // innerTank：前のあいたシャツの中がタンクトップ（首まわりははだ）
  const torsoMat = bareTop ? mSkin : outfit === 'open' ? C(look.inner != null ? look.inner : 0xf4f3ef) : mShirt;
  const torsoCol = bareTop ? look.skin : outfit === 'open' ? (look.inner != null ? look.inner : 0xf4f3ef) : look.shirt;
  const torsoG = bellyBulge(lathe(prof, 18, 0.7), look.belly, -0.02, 0.36);
  const torso = mesh(torsoG, torsoMat, L(torsoCol));
  torso.position.y = -0.2;
  chest.add(torso);
  if (!bareTop) {
    // すそ（Tシャツの下のふち）
    const hem = mesh(new THREE.TorusGeometry(0.128 * bw, 0.018, 6, 20), torsoMat, L(torsoCol), 0.01);
    hem.rotation.x = Math.PI / 2;
    hem.scale.set(1, 0.7, 1);
    hem.position.y = -0.2 + 0.0;
    chest.add(hem);
  }
  OUTFITS[outfit](K);
  // 胸のプリント（キャラの柄）
  const pr = PRINT_AT[def.id] || {};
  const psz = 0.115 * (pr.size || 1);
  const print = new THREE.Mesh(new THREE.PlaneGeometry(psz, psz), new THREE.MeshBasicMaterial({ map: chestPrint(def), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  {
    const py = pr.y != null ? pr.y : 0.12;
    const px = pr.x || 0;
    // 胴の表面の少し前に（前の3人は前と同じ 0.124×build）
    const legacyP = !fem && look.shoulder === 1 && !look.slope;
    const rr = legacyP ? 1 : profR(prof, py + 0.2) / (bw * profR(LEGACY_PROF, py + 0.2));
    const r0 = 0.124 * bw * rr;
    const ang = Math.asin(clamp(px / Math.max(0.05, r0 / 0.7), -0.9, 0.9));
    print.position.set(px, py, px ? Math.cos(ang) * r0 : r0);
    print.rotation.y = px ? ang * 0.8 : 0;
    if (look.belly && py + 0.2 < 0.36) print.position.z *= 1 + look.belly * BELLY_Z * Math.sin((Math.PI * (py + 0.22)) / 0.38);
    if (pr.back) {
      // 背中にも同じ柄（バスケのユニフォームの背番号）
      const bk = new THREE.Mesh(print.geometry.clone(), print.material);
      bk.position.set(0, pr.backY != null ? pr.backY : py + 0.04, -r0 - 0.002);
      bk.rotation.y = Math.PI;
      bk.renderOrder = 2;
      chest.add(bk);
    }
  }
  print.renderOrder = 2;
  if (look.print !== false) chest.add(print); // print: false は柄なし（写真の服に柄がない）
  // 腰（ズボン）
  const hipsG = lathe(
    [
      [0.0, -0.13],
      [0.1 * bw * hipW, -0.125],
      [0.135 * bw * hipW, -0.07],
      [0.14 * bw * hipW, 0.0],
      [0.128 * bw * hipW, 0.06],
      [0.0, 0.065],
    ],
    16,
    0.74
  );
  if (look.pantsPattern) uvScale(hipsG, 3.2, 1);
  const hips = mesh(hipsG, mPants, L(look.pants));
  hips.position.y = 0.0;
  body.add(hips);
  // ベルト
  if (look.belt !== false && look.bottom !== 'skirt') {
    const belt = mesh(new THREE.TorusGeometry(0.127 * bw * hipW, 0.014, 6, 20), C(look.belt), L(look.belt), 0.008);
    belt.rotation.x = Math.PI / 2;
    belt.scale.set(1, 0.74, 1);
    belt.position.y = 0.045;
    body.add(belt);
  }

  // ---- 首と頭 ----
  const nk = look.neck * (fem ? 0.86 : 1);
  const neck = mesh(limbGeo(0.045 * nk, 0.05 * nk, 0.11, 10), mSkin, L(look.skin));
  neck.position.y = 0.39;
  neck.rotation.x = Math.PI;
  chest.add(neck);
  const head = new THREE.Group();
  const hs = look.headScale;
  head.position.y = 0.55 - (1 - hs) * 0.12;
  if (hs !== 1) head.scale.setScalar(hs);
  chest.add(head);
  const HP = { jaw: look.jaw, wide: look.faceW, long: look.faceL };
  K.head = head;
  K.HP = HP;
  const headG = new THREE.SphereGeometry(HEAD_R, 30, 24);
  {
    const p = headG.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      headShape(v, HEAD_R, HP);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    headG.computeVertexNormals();
  }
  const headMesh = mesh(headG, mSkin, L(look.skin), 0.012);
  head.add(headMesh);
  // 顔の板（表情の絵）
  const faceG = new THREE.SphereGeometry(HEAD_R * 1.012, 24, 18, Math.PI / 2 - 0.98, 1.96, 0.98, 1.28);
  {
    const p = faceG.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      headShape(v, HEAD_R, HP);
      p.setXYZ(i, v.x, v.y, v.z);
    }
  }
  const faceTex = faceAtlas(def, look).clone();
  faceTex.needsUpdate = true;
  faceTex.repeat.set(0.25, 0.5);
  faceTex.offset.set(0, 0.5);
  const faceMat = new THREE.MeshBasicMaterial({ map: faceTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const face = new THREE.Mesh(faceG, faceMat);
  face.renderOrder = 2;
  head.add(face);
  // 耳
  for (const sx of [-1, 1]) {
    const ear = mesh(new THREE.SphereGeometry(0.045, 10, 8), mSkin, L(look.skin), 0.008);
    ear.scale.set(0.45, 1, 0.75);
    ear.position.set(sx * HEAD_R * 0.9, -0.025, -0.01);
    head.add(ear);
  }
  // 髪
  const hair = new THREE.Group();
  head.add(hair);
  const hairPivots = [];
  K.hairPivots = hairPivots;
  buildHair(hair, look, mHair, L(look.hair), K);
  // 小物（頭）
  if (has('glasses')) {
    const gm = C(0x231d1f, 'cool', { rim: 0.2 });
    const glasses = new THREE.Group();
    for (const sx of [-1, 1]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.0075, 8, 26), gm);
      ring.scale.set(1.1, 0.86, 1);
      ring.position.set(sx * 0.075, -0.005, HEAD_R * 0.95);
      ring.rotation.y = sx * 0.2;
      glasses.add(ring);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.056, 22), new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.16, depthWrite: false }));
      lens.scale.set(1.1, 0.86, 1);
      lens.position.copy(ring.position);
      lens.rotation.y = sx * 0.2;
      glasses.add(lens);
      // レンズの光
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(0.012, 0.05), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false }));
      sh.position.set(sx * 0.075 - 0.02, 0.005, HEAD_R * 0.97);
      sh.rotation.set(0, sx * 0.2, -0.6);
      glasses.add(sh);
      const temple = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.01, 0.2), gm);
      temple.position.set(sx * 0.135, 0.0, 0.1);
      temple.rotation.y = sx * -0.08;
      glasses.add(temple);
    }
    const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.04, 6), gm);
    bridge.rotation.z = Math.PI / 2;
    bridge.position.set(0, 0.005, HEAD_R * 0.99);
    glasses.add(bridge);
    head.add(glasses);
    root.userData.glasses = glasses;
  }
  if (has('goggles') && look.gogglesAt === 'neck') {
    // エブン（v1.6）：プールのゴーグルを首にかける（写真のふわっとした前髪をかくさない）
    const strap = mesh(new THREE.TorusGeometry(0.098 * look.neck, 0.011, 6, 30), C(0x14161c, 'cool', { rim: 0.3 }), 0x0b0c10, 0.006);
    strap.rotation.x = Math.PI / 2 - 0.5;
    strap.position.set(0, 0.3, -0.004);
    chest.add(strap);
    for (const sx of [-1, 1]) {
      const g = new THREE.Group();
      g.position.copy(torsoPt(K, 0.405, sx * 0.24, 0.024));
      g.rotation.set(-0.35, sx * 0.24, sx * 0.08);
      chest.add(g);
      const frame = mesh(new THREE.SphereGeometry(0.05, 16, 12), C(0x1a1d24), 0x0b0c10, 0.007);
      frame.scale.set(1.2, 0.82, 0.5);
      g.add(frame);
      const lens = new THREE.Mesh(new THREE.SphereGeometry(0.042, 16, 12), C(0x2f7fe0, 'cool', { rim: 0.9, rimColor: 0xbfe8ff }));
      lens.scale.set(1.15, 0.76, 0.42);
      lens.position.z = 0.012;
      g.add(lens);
      const shine = new THREE.Mesh(new THREE.CircleGeometry(0.01, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      shine.position.set(-0.015, 0.012, 0.031);
      g.add(shine);
    }
    const nb = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 6), C(0x14161c), 0x0b0c10, 0.004);
    nb.rotation.z = Math.PI / 2;
    nb.position.copy(torsoPt(K, 0.405, 0, 0.03));
    chest.add(nb);
  } else if (has('goggles')) {
    // エブン：プールのゴーグル（おでこにかけている）
    const strap = new THREE.Mesh(new THREE.TorusGeometry(HEAD_R * 1.06, 0.014, 6, 32), C(0x14161c, 'cool', { rim: 0.3 }));
    strap.rotation.x = Math.PI / 2 - 0.42;
    strap.scale.set(0.96, 1.02, 1);
    strap.position.y = 0.095;
    head.add(strap);
    for (const sx of [-1, 1]) {
      const frame = mesh(new THREE.SphereGeometry(0.06, 16, 12), C(0x1a1d24), 0x0b0c10, 0.008);
      frame.scale.set(1.2, 0.82, 0.55);
      frame.position.set(sx * 0.074, 0.15, 0.17);
      frame.rotation.x = -0.75;
      head.add(frame);
      const lens = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), C(0x2f7fe0, 'cool', { rim: 0.9, rimColor: 0xbfe8ff }));
      lens.scale.set(1.15, 0.76, 0.42);
      lens.position.set(sx * 0.074, 0.155, 0.185);
      lens.rotation.x = -0.75;
      head.add(lens);
      const shine = new THREE.Mesh(new THREE.CircleGeometry(0.012, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      shine.position.set(sx * 0.074 - 0.018, 0.17, 0.205);
      shine.rotation.x = -0.75;
      head.add(shine);
    }
  }
  for (const it of look.items) if (HEAD_ITEMS[it]) HEAD_ITEMS[it](K);

  // ---- 腕 ----
  const arms = [];
  const sleeves = look.sleeves;
  const capMat = sleeves === 'none' ? mSkin : mShirt;
  const capCol = sleeves === 'none' ? look.skin : look.shirt;
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * K.shX, K.shY, 0);
    chest.add(shoulder);
    // 肩（Tシャツのそで）
    const cap = mesh(new THREE.SphereGeometry(capR, 14, 10), capMat, L(capCol), 0.01);
    cap.scale.set(1, 0.95, 0.95);
    cap.position.y = -0.02;
    shoulder.add(cap);
    const bare = sleeves !== 'long';
    const upperMat = bare ? mSkin : mSleeve;
    const upper = mesh(limbGeo(0.052 * at, 0.045 * at, 0.24 * limb), upperMat, L(bare ? look.skin : look.sleeve));
    upper.position.y = -0.03;
    shoulder.add(upper);
    if (sleeves === 'short' || has('tigerBand')) {
      const k = Math.max(1, at * 0.95);
      const sleeve = mesh(lathe([[0.067 * k, 0.0], [0.07 * k, -0.05], [0.064 * k, -0.11], [0.06 * k, -0.115]], 14), mShirt, L(look.shirt), 0.01);
      sleeve.position.y = -0.02;
      shoulder.add(sleeve);
    }
    const A = { side, shoulder, at, limb };
    if (side === 1) {
      // チームのマーク（そで。少し光る）
      const badge = new THREE.Mesh(new THREE.CircleGeometry(0.026, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(team.light).multiplyScalar(1.4) }));
      const bx = sleeves === 'wide' ? 0.09 * Math.max(1, at * 0.95) + 0.004 : sleeves === 'short' || sleeves === 'long' || has('tigerBand') ? 0.066 * Math.max(1, at * 0.95) : 0.052 * at + 0.004;
      badge.position.set(side * Math.max(bx, capR * 0.97), -0.07, 0.0);
      badge.rotation.y = side * Math.PI / 2;
      shoulder.add(badge);
    }
    if (has('tigerBand') && side === -1) {
      // ドラ：トラのうでわ（オレンジに黒のしま）
      const band = mesh(new THREE.CylinderGeometry(0.054, 0.054, 0.06, 14), C(0xff8a1f), L(0xff8a1f), 0.008);
      band.position.y = -0.17;
      shoulder.add(band);
      for (let i = 0; i < 3; i++) {
        const st = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.056, 0.012, 14, 1, true, i * 2.1, 0.9), C(0x1d1a1a));
        st.position.y = -0.17 + (i - 1) * 0.018;
        shoulder.add(st);
      }
    }
    const elbow = new THREE.Group();
    elbow.position.y = -0.26 * limb;
    shoulder.add(elbow);
    const lowBare = sleeves !== 'long';
    const lower = mesh(limbGeo(0.046 * at, 0.04 * at, 0.2 * limb), lowBare ? mSkin : mSleeve, L(lowBare ? look.skin : look.sleeve));
    elbow.add(lower);
    A.elbow = elbow;
    // グローブ（チームの色・白い手首・光るライン）
    const wrist = new THREE.Group();
    wrist.position.y = -0.23 * limb;
    elbow.add(wrist);
    const glove = mesh(roundedBox(0.15, 0.16, 0.17, 0.065, 3), mGlove, L(team.hex), 0.012);
    glove.position.set(0, -0.075, 0.012);
    wrist.add(glove);
    const thumb = mesh(new THREE.SphereGeometry(0.042, 10, 8), mGlove, L(team.hex), 0.01);
    thumb.scale.set(0.8, 1.2, 0.9);
    thumb.position.set(-side * 0.065, -0.05, 0.06);
    wrist.add(thumb);
    const cuff = mesh(new THREE.CylinderGeometry(0.06, 0.066, 0.07, 14), mGlove2, L(0xd8d8de), 0.008);
    cuff.position.y = 0.005;
    wrist.add(cuff);
    const glowM = new THREE.MeshBasicMaterial({ color: new THREE.Color(team.light).multiplyScalar(1.7) });
    const knuckle = new THREE.Mesh(roundedBox(0.155, 0.022, 0.03, 0.01, 1), glowM);
    knuckle.position.set(0, -0.1, 0.095);
    wrist.add(knuckle);
    A.wrist = wrist;
    if (SLEEVES[sleeves]) SLEEVES[sleeves](K, A);
    for (const it of look.items) if (HAND_ITEMS[it]) HAND_ITEMS[it](K, A);
    arms.push({ shoulder, elbow, glove: wrist, side });
  }

  // ---- 脚 ----
  const legs = [];
  const lt = look.leg * (fem ? 0.9 : 1);
  const bottom = BOTTOMS[look.bottom] ? look.bottom : 'pants';
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.085 * bw * hipW, -0.06, 0);
    body.add(hip);
    const knee = new THREE.Group();
    knee.position.y = -0.37 * limb;
    hip.add(knee);
    const G = { side, hip, knee, lt, limb };
    BOTTOMS[bottom](K, G);
    // スニーカー（厚いソール・色の切りかえ・かかとのジェット）
    const foot = new THREE.Group();
    foot.position.y = -0.34 * limb;
    if (fem) foot.scale.setScalar(0.9);
    knee.add(foot);
    const upperShoe = mesh(roundedBox(0.13, 0.1, 0.25, 0.045, 2), mShoe, L(look.shoe), 0.01);
    upperShoe.position.set(0, -0.03, 0.045);
    foot.add(upperShoe);
    const toe = mesh(new THREE.SphereGeometry(0.066, 12, 8), mShoe, L(look.shoe), 0.01);
    toe.scale.set(1, 0.7, 1);
    toe.position.set(0, -0.045, 0.14);
    foot.add(toe);
    const stripe = mesh(roundedBox(0.136, 0.035, 0.14, 0.012, 1), mAcc, L(look.shoeAccent), 0.008);
    stripe.position.set(0, -0.02, 0.02);
    foot.add(stripe);
    const sole = mesh(roundedBox(0.142, 0.045 * ss, 0.285, 0.02, 1), mSole, L(0xc8c8cc), 0.008);
    sole.position.set(0, -0.09 - (ss - 1) * 0.0225, 0.05);
    foot.add(sole);
    // かかとの噴射口（飛ぶと光る）
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.01, 6, 14), C(0x2a2d36));
    ring.position.set(0, -0.05, -0.085);
    foot.add(ring);
    const jet = new THREE.Mesh(new THREE.CircleGeometry(0.032, 14), new THREE.MeshBasicMaterial({ color: new THREE.Color(team.light).multiplyScalar(2.2) }));
    jet.position.set(0, -0.05, -0.09);
    jet.rotation.y = Math.PI;
    foot.add(jet);
    G.foot = foot;
    for (const it of look.items) if (FOOT_ITEMS[it]) FOOT_ITEMS[it](K, G);
    legs.push({ hip, knee, side, jet, foot });
  }
  for (const it of look.items) if (BODY_ITEMS[it]) BODY_ITEMS[it](K);

  root.userData.parts = { scaleBox, body, spine, chest, head, arms, legs, hair, face, faceTex, hairPivots, skirt: K.skirt || null };
  root.userData.def = def;
  root.userData.look = look;
  root.userData.team = teamIdx;
  root.userData.blink = { t: 1 + Math.random() * 2, on: 0 };
  root.userData.faceNow = -1;
  root.traverse((o) => {
    if (o.isMesh) o.frustumCulled = true;
  });
  // 部品をまとめて、描く回数を減らす（顔の板・メガネ・噴射の光は切りかえるので別のまま）
  if (!NOBAKE) {
    bakeModel(root, [face, root.userData.glasses, ...legs.map((g) => g.jet)]);
    if (root.userData.glasses) mergeStatic(root.userData.glasses);
  }
  setFace(root, FACES.neutral);
  return root;
}
const LEGACY_PROF = torsoProfile({ build: 1, shoulder: 1, slope: 0, female: false });

// ===== 服（上）=====
// K：作っているキャラの道具箱（look・材質・胸 chest・胴の形 prof・肩の位置 shX/shY など）
// 胴にそう物は chest の中で y を -0.2 にする（胴の形 prof の高さがそのまま使える）
const darker = (c, k = 0.86) => new THREE.Color(c).multiplyScalar(k).getHex();
function onTorso(K, g, color, w = OW, mat = null) {
  const m = mat ? mesh(g, mat, K.L(color), w) : K.part(g, color, w);
  m.position.y = -0.2;
  K.chest.add(m);
  return m;
}
// 1周する帯（しま・切りかえ・すそ）
function ringBand(K, y0, y1, off, color, mat = null) {
  const { prof, look } = K;
  const PH = (u) => Math.PI + u * Math.PI * 2;
  const g = bellyBulge(wrapGeo({ levels: levelsFor(prof, y0, y1, 0.02), cols: 40, closed: true, yr: () => [y0, y1], ph: PH, rf: (y) => bandR(prof, y) + off }), look.belly, -0.02, 0.36);
  return onTorso(K, g, color, 0.008, mat);
}
// 前の細い帯（ファスナー・前立て）
function frontStrip(K, y0, y1, half, off, color, w = 0.006) {
  const { prof, look } = K;
  const g = bellyBulge(wrapGeo({ levels: levelsFor(prof, y0, y1, 0.03), cols: 2, yr: () => [y0, y1], ph: (u) => -half + 2 * half * u, rf: (y) => bandR(prof, y) + off }), look.belly, -0.02, 0.36);
  return onTorso(K, g, color, w);
}
// 胴の表面の点（前 ph=0）
function torsoPt(K, y, ph, off = 0) {
  const r = bandR(K.prof, y) + off;
  let z = Math.cos(ph) * r * 0.7;
  if (K.look.belly && y > -0.02 && y < 0.36 && z > 0) z *= 1 + K.look.belly * BELLY_Z * Math.sin((Math.PI * (y + 0.02)) / 0.38);
  return new THREE.Vector3(Math.sin(ph) * r, y - 0.2, z);
}
// 布の柄（アロハなど）。胴・そでの UV に何回くり返すかは形のほうで決める
const patCache = new Map();
function patternTex(kind, color) {
  const key = kind + '|' + color;
  if (patCache.has(key)) return patCache.get(key);
  const t = canvasTex(256, 256, (ctx) => {
    const base = '#' + new THREE.Color(color).getHexString();
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 256, 256);
    if (kind !== 'aloha' && PATTERNS[kind]) return PATTERNS[kind](ctx, color, base);
    // ハイビスカスと葉（はしでつながるように、まわりにも描く）
    const flower = (x, y, r, rot, c1, c2) => {
      for (const dx of [-256, 0, 256])
        for (const dy of [-256, 0, 256]) {
          ctx.save();
          ctx.translate(x + dx, y + dy);
          ctx.rotate(rot);
          ctx.fillStyle = c1;
          for (let i = 0; i < 5; i++) {
            ctx.rotate((Math.PI * 2) / 5);
            ctx.beginPath();
            ctx.ellipse(0, -r * 0.55, r * 0.42, r * 0.6, 0, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillStyle = c2;
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
    };
    const leaf = (x, y, r, rot) => {
      for (const dx of [-256, 0, 256])
        for (const dy of [-256, 0, 256]) {
          ctx.save();
          ctx.translate(x + dx, y + dy);
          ctx.rotate(rot);
          ctx.fillStyle = 'rgba(10,60,70,0.55)';
          ctx.beginPath();
          ctx.ellipse(0, 0, r * 0.35, r, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
    };
    leaf(70, 150, 40, 0.7);
    leaf(190, 50, 36, -0.5);
    leaf(200, 200, 30, 1.9);
    flower(64, 64, 46, 0.2, '#fdfbf2', '#ffd23a');
    flower(180, 150, 40, 1.0, '#ffe066', '#ff7a1a');
    flower(110, 220, 30, 0.6, '#fdfbf2', '#ffd23a');
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.userData.shared = true;
  patCache.set(key, t);
  return t;
}

// v1.6 布の柄（写真から）。どれも 256×256 で、はしがつながる
const PATTERNS = {
  // てつんど：青のオンブレチェック（ぼかした太いしまが、たてと横に重なる）
  ombre(ctx, color) {
    const dk = 'rgba(28,38,66,';
    const band = (horiz, at, wid, a) => {
      for (const d of [-256, 0, 256]) {
        const c0 = at + d;
        const g = horiz ? ctx.createLinearGradient(0, c0 - wid, 0, c0 + wid) : ctx.createLinearGradient(c0 - wid, 0, c0 + wid, 0);
        g.addColorStop(0, dk + '0)');
        g.addColorStop(0.35, dk + a * 0.7 + ')');
        g.addColorStop(0.5, dk + a + ')');
        g.addColorStop(0.65, dk + a * 0.7 + ')');
        g.addColorStop(1, dk + '0)');
        ctx.fillStyle = g;
        if (horiz) ctx.fillRect(0, c0 - wid, 256, wid * 2);
        else ctx.fillRect(c0 - wid, 0, wid * 2, 256);
      }
    };
    band(false, 64, 58, 0.78);
    band(true, 64, 58, 0.72);
    band(false, 190, 22, 0.42);
    band(true, 190, 22, 0.38);
    // 細い線
    ctx.strokeStyle = 'rgba(20,26,44,0.35)';
    ctx.lineWidth = 2;
    for (const x of [24, 104, 150, 230]) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 256); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, x); ctx.lineTo(256, x); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(235,242,255,0.22)';
    ctx.lineWidth = 1.5;
    for (const x of [128, 250]) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 256); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, x); ctx.lineTo(256, x); ctx.stroke();
    }
  },
  // ちじわ：白いワッフル（細かい格子）
  waffle(ctx) {
    ctx.strokeStyle = 'rgba(120,110,95,0.16)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 256; i += 10.67) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let x = 0; x < 256; x += 10.67) for (let y = 0; y < 256; y += 10.67) ctx.fillRect(x + 3, y + 3, 4, 4);
  },
  // トリキ：色落ちしたデニム（ななめの綾目と、明るいむら）
  denim(ctx) {
    const r = rng(9);
    for (let i = 0; i < 7; i++) {
      const x = r() * 256, y = r() * 256, rr = 40 + r() * 60;
      for (const dx of [-256, 0, 256])
        for (const dy of [-256, 0, 256]) {
          const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rr);
          g.addColorStop(0, 'rgba(225,235,245,0.16)');
          g.addColorStop(1, 'rgba(225,235,245,0)');
          ctx.fillStyle = g;
          ctx.fillRect(x + dx - rr, y + dy - rr, rr * 2, rr * 2);
        }
    }
    ctx.strokeStyle = 'rgba(20,32,52,0.16)';
    ctx.lineWidth = 1.6;
    for (let i = -256; i < 512; i += 6) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 256, 256); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(240,246,252,0.1)';
    for (let i = -253; i < 512; i += 12) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 256, 256); ctx.stroke();
    }
  },
  // しょうた：赤い短パンの白い小さな柄（細かくならべる）
  redPrint(ctx) {
    ctx.fillStyle = '#fbf6f2';
    const n = 8, st = 256 / n;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const x = i * st + (j % 2 ? st / 2 : 0) + st / 2, y = j * st + st / 2;
        // 小さな白いしずくと点
        ctx.beginPath();
        ctx.ellipse(x, y - 3, 4.2, 6.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(x - 1.4, y + 3, 2.8, 6);
      }
    ctx.fillStyle = 'rgba(30,20,24,0.85)';
    for (const [i, j] of [[2, 1], [6, 4], [3, 6]]) {
      const x = i * st + (j % 2 ? st / 2 : 0) + st / 2, y = j * st + st / 2;
      ctx.beginPath();
      ctx.ellipse(x, y - 3, 4.2, 6.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};
const OUTFITS = {
  // v1.6 上半身はだか（しょうた）。胴ははだの色（体の線は胸のプリントでかく）
  bare() {},
  // Tシャツ（前からの形）
  tee(K) {
    const { look, chest, has } = K;
    const collar = mesh(new THREE.TorusGeometry(0.068, 0.018, 6, 16), has('tigerBand') ? K.mSleeve : K.mShirt, K.L(look.shirt), 0.01);
    collar.rotation.x = Math.PI / 2 - 0.25;
    collar.position.set(0, 0.29, 0.01);
    chest.add(collar);
    if (look.stitch != null) {
      // ちじわ：黒いロックミシンのぬい目（えりのまわりと、肩のぬい目）
      const sc = look.stitch;
      const ring = [];
      const N = 64;
      const e = new THREE.Euler(Math.PI / 2 - 0.25, 0, 0);
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        const rr = 0.087 + (i % 2 ? 0.005 : -0.003);
        ring.push(new THREE.Vector3(Math.cos(a) * rr, Math.sin(a) * rr, 0.004).applyEuler(e).add(new THREE.Vector3(0, 0.29, 0.01)));
      }
      chest.add(K.part(tubeGeo(ring, 0.0028, true, 192, 4), sc, 0.002));
      for (const sd of [-1, 1]) {
        const pts = [];
        for (let i = 0; i <= 18; i++) {
          const u = i / 18;
          pts.push(torsoPt(K, 0.488 - 0.085 * u + (i % 2 ? 0.006 : -0.004), sd * (0.78 + 0.8 * u), 0.006));
        }
        chest.add(K.part(tubeGeo(pts, 0.0026, false, 72, 4), sc, 0.002));
      }
    }
  },
  // タンクトップ・バスケのユニフォーム：前はU字、横は肩の上まで、後ろは首の下
  tank(K) {
    const { look, prof } = K;
    const yTop = (ph) => {
      const c = Math.cos(ph), sd = Math.abs(Math.sin(ph));
      const base = 0.36 - 0.045 * c;
      return base + smooth(0.5, 0.93, sd) * (0.5 - base);
    };
    const PH = (u) => Math.PI + u * Math.PI * 2;
    const g = bellyBulge(wrapGeo({ levels: levelsFor(prof, -0.015, 0.5, 0.025), cols: 44, closed: true, yr: (u) => [-0.015, yTop(PH(u))], ph: PH, rf: (y) => bandR(prof, y) + 0.005 }), look.belly, -0.02, 0.36);
    onTorso(K, g, look.shirt, OW, K.mShirt);
    const hem = mesh(new THREE.TorusGeometry(0.128 * look.build, 0.018, 6, 20), K.mShirt, K.L(look.shirt), 0.01);
    hem.rotation.x = Math.PI / 2;
    hem.scale.set(1, 0.7, 1);
    hem.position.y = -0.2;
    K.chest.add(hem);
    if (look.trim != null) {
      // ふちの線（えりぐり・そでぐり）
      const pts = [];
      for (let i = 0; i < 48; i++) {
        const ph = (i / 48) * Math.PI * 2;
        pts.push(torsoPt(K, yTop(ph), ph, 0.009));
      }
      K.chest.add(K.part(tubeGeo(pts, 0.009, true, 120), look.trim, 0.006));
      for (const sd of [-1, 1]) {
        const ring = K.part(new THREE.TorusGeometry(K.capR * 1.0, 0.0085, 5, 22), look.trim, 0.006);
        ring.position.set(sd * (K.shX - 0.016), K.shY - 0.02, 0);
        ring.rotation.y = Math.PI / 2;
        K.chest.add(ring);
      }
    }
  },
  // えりつきシャツ（前立てとボタン）。trim でえりの色、stripes でしま、vest でベスト
  shirt(K) {
    const { look, prof } = K;
    const col = look.trim != null ? look.trim : look.shirt;
    const short = look.placket === 'short';
    if (look.stripes) for (const [y0, y1, c] of look.stripes) ringBand(K, y0, y1, 0.0035, c);
    // 前立てとボタン
    const pl = short ? 0.33 : -0.015;
    frontStrip(K, pl, 0.48, 0.05, 0.005, short ? col : darker(look.shirt, 0.95));
    for (const y of short ? [0.36, 0.43] : [0.06, 0.15, 0.24, 0.33, 0.42]) {
      const b = K.part(new THREE.SphereGeometry(0.0085, 8, 6), look.button != null ? look.button : 0xf2efe6, 0.004);
      b.position.copy(torsoPt(K, y, 0, 0.011));
      K.chest.add(b);
    }
    if (look.vest != null) {
      // V首のベスト（シャツの上）
      const yTop = (ph) => {
        const a = Math.abs(Math.atan2(Math.sin(ph), Math.cos(ph)));
        if (a < 0.95) return 0.2 + 0.3 * (a / 0.95);
        return 0.5 - 0.06 * smooth(2.3, Math.PI, a);
      };
      const PH = (u) => Math.PI + u * Math.PI * 2;
      const g = bellyBulge(wrapGeo({ levels: levelsFor(prof, -0.035, 0.5, 0.025), cols: 48, closed: true, yr: (u) => [-0.035, yTop(PH(u))], ph: PH, rf: (y) => bandR(prof, y) + 0.016 }), look.belly, -0.02, 0.36);
      onTorso(K, g, look.vest);
      const pts = [];
      for (let i = 0; i < 64; i++) {
        const ph = (i / 64) * Math.PI * 2;
        pts.push(torsoPt(K, yTop(ph), ph, 0.02));
      }
      K.chest.add(K.part(tubeGeo(pts, 0.008, true, 160), look.vestLine != null ? look.vestLine : darker(look.vest, 1.6), 0.005));
      const vh = K.part(new THREE.TorusGeometry(0.13 * look.build, 0.017, 6, 22), look.vest, 0.008);
      vh.rotation.x = Math.PI / 2;
      vh.scale.set(1, 0.7, 1);
      vh.position.y = -0.235;
      K.chest.add(vh);
    }
    // えり（首まわりの帯と、えり先）
    const stand = K.part(new THREE.CylinderGeometry(0.072, 0.082, 0.05, 18, 1, true), col, 0.008);
    stand.position.set(0, 0.295, -0.004);
    stand.rotation.x = -0.24;
    K.chest.add(stand);
    for (const sd of [-1, 1]) {
      const shp = new THREE.Shape();
      shp.moveTo(0, 0);
      shp.lineTo(sd * 0.066, 0.004);
      shp.lineTo(sd * 0.036, -0.066);
      shp.closePath();
      const m = K.part(new THREE.ExtrudeGeometry(shp, { depth: 0.008, bevelEnabled: false }), col, 0.007);
      const p = torsoPt(K, 0.478, 0, 0.004);
      m.position.set(sd * 0.008, p.y + 0.004, p.z + (look.vest != null ? 0.006 : 0));
      m.rotation.set(-0.62, sd * 0.12, 0);
      K.chest.add(m);
    }
  },
  // ジッパーのジャケット（ウインドブレーカー・ジャージ）：立てえり・ファスナー・肩の切りかえ（trim）
  zip(K) {
    const { look, prof } = K;
    const yoke = look.trim != null && look.yoke !== false;
    if (yoke) ringBand(K, 0.335, 0.505, 0.0045, look.trim);
    if (look.chestLine != null) ringBand(K, 0.27, 0.3, 0.0045, look.chestLine);
    frontStrip(K, -0.015, 0.5, 0.019, 0.008, 0x2b2d34, 0.004);
    const pull = K.part(roundedBox(0.017, 0.036, 0.008, 0.004, 1), 0xd6dae2, 0.004);
    pull.position.copy(torsoPt(K, 0.42, 0, 0.014));
    pull.rotation.x = -0.25;
    K.chest.add(pull);
    const cc = look.collar != null ? look.collar : yoke ? look.trim : look.shirt;
    const collar = K.part(lathe([[0.073, 0.0], [0.09, 0.0], [0.087, 0.066], [0.077, 0.07], [0.073, 0.0]], 18), cc, 0.01);
    collar.position.set(0, 0.272, -0.002);
    collar.scale.set(1, 1, 0.88);
    collar.rotation.x = -0.18;
    K.chest.add(collar);
    const hemC = look.trim != null && !yoke ? look.trim : darker(look.shirt, 0.8);
    const hem = K.part(new THREE.TorusGeometry(0.131 * look.build, 0.022, 8, 22), hemC, 0.008);
    hem.rotation.x = Math.PI / 2;
    hem.scale.set(1, 0.7, 1);
    hem.position.y = -0.205;
    K.chest.add(hem);
  },
  // 前のあいた上着（アロハ・カーディガン・ロングコート）。中の服は inner。coat：長い上着 / lapel：'wide'・'band'
  open(K) {
    const { look, prof } = K;
    const coat = !!look.coat;
    const pat = !!look.pattern;
    const lapel = look.lapel || (coat ? 'wide' : pat ? 'wide' : 'band');
    const yLow = coat ? -0.21 : look.crop ? (look.cropY != null ? look.cropY : 0.035) : -0.04, yHigh = 0.505;
    const gk = look.gapK || 1;
    const gTop = (coat ? 0.4 : pat ? 0.42 : 0.5) * gk, gBot = (coat ? 0.3 : pat ? 0.22 : 0.07) * gk;
    const gap = (y) => gBot + (gTop - gBot) * smooth(0.05, 0.45, y);
    const rf = (y) => {
      let r = bandR(prof, y);
      const hr = hipsR(look, y + 0.04);
      if (hr) r = Math.max(r, hr + 0.012);
      if (y < 0) r += -y * (coat ? 0.32 : 0.2);
      return r + 0.012;
    };
    // 中の服のえり（タンクトップのときは、U字の胸元）
    const inner = look.inner != null ? look.inner : 0xf4f3ef;
    if (look.innerTank) {
      const yTop = (ph) => {
        const c = Math.cos(ph), sd = Math.abs(Math.sin(ph));
        const base = 0.33 - 0.05 * c;
        return base + smooth(0.45, 0.95, sd) * (0.5 - base);
      };
      const PH = (u) => Math.PI + u * Math.PI * 2;
      const tg = bellyBulge(wrapGeo({ levels: levelsFor(prof, -0.015, 0.5, 0.025), cols: 44, closed: true, yr: (u) => [-0.015, yTop(PH(u))], ph: PH, rf: (y) => bandR(prof, y) + 0.004 }), look.belly, -0.02, 0.36);
      onTorso(K, tg, inner);
      const hm = K.part(new THREE.TorusGeometry(0.128 * look.build, 0.018, 6, 20), inner, 0.01);
      hm.rotation.x = Math.PI / 2;
      hm.scale.set(1, 0.7, 1);
      hm.position.y = -0.2;
      K.chest.add(hm);
    } else {
      const ic = K.part(new THREE.TorusGeometry(0.068, 0.016, 6, 16), inner, 0.01);
      ic.rotation.x = Math.PI / 2 - 0.25;
      ic.position.set(0, 0.29, 0.01);
      K.chest.add(ic);
    }
    const pr = look.patRep || 4;
    const g = bellyBulge(wrapGeo({ levels: levelsFor(prof, yLow, yHigh, 0.025), cols: 44, yr: () => [yLow, yHigh], ph: (u, y) => gap(y) + (Math.PI * 2 - 2 * gap(y)) * u, rf, uRep: pr, vRep: pr / 2 }), look.belly, -0.02, 0.36);
    onTorso(K, g, look.shirt, OW, K.mShirt);
    // えり（あきのふちを外に折りかえす）
    const y0 = lapel === 'wide' ? 0.2 : yLow, wMax = lapel === 'wide' ? (coat ? 0.36 : 0.34) : 0.075;
    const lw = lapel === 'wide' ? (y) => wMax * smooth(y0, 0.47, y) + 0.02 : () => wMax;
    const lc = look.lapelColor != null ? look.lapelColor : lapel === 'wide' ? look.shirt : darker(look.shirt, 0.9);
    const lm = pat ? K.mShirt : null;
    for (const sd of [-1, 1]) {
      const ph = sd > 0 ? (u, y) => gap(y) + lw(y) * u : (u, y) => Math.PI * 2 - gap(y) - lw(y) * (1 - u);
      const lg = bellyBulge(wrapGeo({ levels: levelsFor(prof, y0, yHigh, 0.025), cols: 4, yr: () => [y0, yHigh], ph, rf: (y) => rf(y) + 0.006, uRep: 0.4, vRep: 1 }), look.belly, -0.02, 0.36);
      onTorso(K, lg, lc, 0.008, lm);
    }
    // 後ろえり
    const back = mesh(new THREE.TorusGeometry(0.1, 0.02, 6, 18, Math.PI * 1.25), lm || K.C(lc), K.L(lc), 0.008);
    back.rotation.set(Math.PI / 2 - 0.3, 0, Math.PI * 0.5 + Math.PI * 0.625);
    back.position.set(0, 0.292, -0.01);
    K.chest.add(back);
    if (look.crop) {
      // 短い上着のすその帯（デニムジャケット）
      const wb = bellyBulge(wrapGeo({ levels: levelsFor(prof, yLow, yLow + 0.04, 0.02), cols: 40, yr: () => [yLow, yLow + 0.04], ph: (u, y) => gap(y) + (Math.PI * 2 - 2 * gap(y)) * u, rf: (y) => rf(y) + 0.006, uRep: 4, vRep: 0.3 }), look.belly, -0.02, 0.36);
      onTorso(K, wb, darker(look.shirt, 0.92), 0.008, pat ? K.mShirt : null);
    }
    if (look.zipEdge) {
      // ファスナーのふち（黒い上着）
      for (const sd of [-1, 1]) {
        const ph = sd > 0 ? (u, y) => gap(y) + 0.012 + 0.028 * u : (u, y) => Math.PI * 2 - gap(y) - 0.04 + 0.028 * u;
        const zg = bellyBulge(wrapGeo({ levels: levelsFor(prof, yLow, yHigh - 0.02, 0.025), cols: 2, yr: () => [yLow, yHigh - 0.02], ph, rf: (y) => rf(y) + 0.008 }), look.belly, -0.02, 0.36);
        onTorso(K, zg, look.zipEdge === true ? 0x3e4049 : look.zipEdge, 0.004);
      }
    }
    if (look.collarPts) {
      // デニムジャケットのえり（とがった、折りかえしたえり）
      for (const sd of [-1, 1]) {
        const shp = new THREE.Shape();
        shp.moveTo(0, 0);
        shp.lineTo(sd * 0.085, 0.01);
        shp.lineTo(sd * 0.04, -0.1);
        shp.closePath();
        const m = pat ? mesh(new THREE.ExtrudeGeometry(shp, { depth: 0.009, bevelEnabled: false }), K.mShirt, K.L(look.shirt), 0.007) : K.part(new THREE.ExtrudeGeometry(shp, { depth: 0.009, bevelEnabled: false }), look.shirt, 0.007);
        const p = torsoPt(K, 0.48, sd * 0.5, 0.02);
        m.position.set(p.x - sd * 0.02, p.y + 0.012, p.z);
        m.rotation.set(-0.62, sd * 0.42, sd * 0.05);
        K.chest.add(m);
      }
    }
    if (look.pockets) {
      // 胸のフラップポケット（ボタンつき）
      for (const sd of [-1, 1]) {
        const ph = sd * (gap(0.34) + 0.36);
        const q = torsoPt(K, 0.34, ph, rf(0.34) - bandR(prof, 0.34) + 0.006);
        const f = pat ? mesh(roundedBox(0.075, 0.032, 0.01, 0.004, 1), K.mShirt, K.L(look.shirt), 0.005) : K.part(roundedBox(0.075, 0.032, 0.01, 0.004, 1), look.shirt, 0.005);
        f.position.copy(q);
        f.rotation.y = ph;
        K.chest.add(f);
        const b = K.part(new THREE.SphereGeometry(0.0075, 8, 6), look.button != null ? look.button : 0xb9864a, 0.003);
        b.position.copy(torsoPt(K, 0.333, ph, rf(0.34) - bandR(prof, 0.34) + 0.013));
        K.chest.add(b);
        // ポケットのたてのぬい目（2本）
        for (const dx of [-0.03, 0.03]) {
          const sm = K.part(roundedBox(0.004, 0.14, 0.003, 0.001, 1), darker(look.shirt, 0.8), 0.002);
          const qq = torsoPt(K, 0.24, ph + dx * 2.2, rf(0.24) - bandR(prof, 0.24) + 0.005);
          sm.position.copy(qq);
          sm.rotation.y = ph + dx * 2.2;
          K.chest.add(sm);
        }
      }
    }
    if (lapel === 'band' && look.button !== false && !look.zipEdge) {
      // カーディガンのボタン
      for (const y of [0.03, 0.11, 0.19, 0.27]) {
        if (y < yLow + 0.02) continue;
        const b = K.part(new THREE.SphereGeometry(0.009, 8, 6), look.button != null ? look.button : 0xf6f1e6, 0.004);
        const ph = gap(y) + 0.04;
        b.position.copy(torsoPt(K, y, ph, rf(y) - bandR(prof, y) + 0.012));
        K.chest.add(b);
      }
    }
  },
  // パーカー：首のうしろのフード・おなかのポケット・ひも・太いすそ。rumpled：しわしわ（少しゆがめる）
  hoodie(K) {
    const { look, prof } = K;
    const bw = look.build;
    const dk = darker(look.shirt, 0.88);
    const rum = look.rumpled ? 1 : 0;
    const ring = K.part(new THREE.TorusGeometry(0.094, 0.032, 8, 22), look.shirt, 0.01);
    ring.rotation.set(Math.PI / 2 - 0.42, 0, 0.12 * rum);
    ring.position.set(0, 0.293, -0.014);
    K.chest.add(ring);
    const hood = K.part(new THREE.SphereGeometry(0.13, 16, 12), look.shirt, 0.012);
    hood.scale.set(1.18, 0.82, 0.44);
    hood.position.set(0.012 * rum, 0.23, -0.7 * bandR(prof, 0.43) - 0.022);
    hood.rotation.set(-0.38, 0, 0.12 * rum);
    K.chest.add(hood);
    const pp = torsoPt(K, 0.085, 0, 0.0);
    const pocket = K.part(roundedBox(0.2 * bw, 0.1, 0.034, 0.014, 2), dk, 0.008);
    pocket.position.set(0, pp.y, pp.z + 0.004);
    pocket.rotation.set(0.12, 0, -0.04 * rum);
    K.chest.add(pocket);
    K.pocket = pocket.position.clone();
    for (const sd of [-1, 1]) {
      const p = torsoPt(K, 0.43, sd * 0.2, 0.012);
      const len = 0.1 + (rum ? sd * 0.025 : 0);
      const st = K.part(new THREE.CylinderGeometry(0.0055, 0.0055, len, 6), 0xf2f2f2, 0.004);
      st.position.set(p.x, p.y - len / 2 + 0.01, p.z);
      st.rotation.set(-0.14, 0, sd * 0.06);
      K.chest.add(st);
      const tip = K.part(new THREE.CylinderGeometry(0.0085, 0.0085, 0.022, 6), look.trim != null ? look.trim : 0x333333, 0.004);
      tip.position.set(p.x + sd * 0.003, p.y - len + 0.0, p.z + 0.012);
      tip.rotation.x = -0.14;
      K.chest.add(tip);
    }
    const hem = K.part(new THREE.TorusGeometry(0.133 * bw, 0.026, 8, 22), dk, 0.01);
    hem.rotation.set(Math.PI / 2, 0.05 * rum, 0);
    hem.scale.set(1, 0.7, 1);
    hem.position.y = -0.205;
    K.chest.add(hem);
  },
  // オーバーサイズのT：長いすそ（腰までかくす）・広いえり
  oversize(K) {
    const { look, prof } = K;
    const collar = K.part(new THREE.TorusGeometry(0.074, 0.017, 6, 18), look.shirt, 0.01);
    collar.rotation.x = Math.PI / 2 - 0.28;
    collar.position.set(0, 0.288, 0.006);
    K.chest.add(collar);
    const yL = -0.125;
    const rf = (y) => Math.max(bandR(prof, y), hipsR(look, y + 0.04) + 0.014) + 0.01 + Math.max(0, -y) * 0.18;
    const PH = (u) => Math.PI + u * Math.PI * 2;
    const g = wrapGeo({ levels: levelsFor(prof, yL, 0.03, 0.02), cols: 40, closed: true, yr: () => [yL, 0.03], ph: PH, rf });
    onTorso(K, g, look.shirt, OW, K.mShirt);
    const r = rf(yL);
    const hem = K.part(new THREE.TorusGeometry(r, 0.016, 6, 24), look.shirt, 0.008);
    hem.rotation.x = Math.PI / 2;
    hem.scale.set(1, 0.7, 1);
    hem.position.y = -0.2 + yL;
    K.chest.add(hem);
  },
};
// そで（腕ごと）。A：{ side, shoulder, elbow, wrist, at, limb }
const SLEEVES = {
  long(K, A) {
    const { look } = K;
    if (K.outfit === 'zip' || K.outfit === 'hoodie' || K.outfit === 'open' || look.cuffs) {
      const c = look.cuff != null ? look.cuff : K.outfit === 'zip' && look.trim != null && look.yoke === false ? look.trim : darker(look.sleeve, 0.86);
      const cuff = K.part(new THREE.CylinderGeometry(0.05 * A.at + 0.003, 0.052 * A.at + 0.003, 0.042, 12), c, 0.006);
      cuff.position.y = -0.172 * A.limb;
      A.elbow.add(cuff);
    }
    if (look.sleeveStripe != null) {
      // ジャージのそでの2本線（腕の外がわ）
      const parts = [[A.shoulder, 0.052 * A.at, 0.045 * A.at, 0.235 * A.limb, -0.035], [A.elbow, 0.046 * A.at, 0.04 * A.at, 0.15 * A.limb, -0.0]];
      for (const [grp, r0, r1, len, y0] of parts)
        for (const off of [-0.2, 0.2]) {
          const th = (A.side > 0 ? Math.PI / 2 : -Math.PI / 2) + off - 0.07;
          const m = K.part(new THREE.CylinderGeometry(r0 + 0.0035, r1 + 0.0035, len, 10, 1, true, th, 0.14), look.sleeveStripe, 0.003);
          m.position.y = y0 - len / 2;
          grp.add(m);
        }
    }
  },
  short(K, A) {
    const { look } = K;
    if (look.stripes && look.stripes.length) {
      // しまのシャツは、そでにもしまを1本
      const k = Math.max(1, A.at * 0.95);
      const m = K.part(new THREE.CylinderGeometry(0.0702 * k, 0.0672 * k, 0.026, 14, 1, true), look.stripes[0][2], 0.004);
      m.position.y = -0.02 - 0.06;
      A.shoulder.add(m);
    }
  },
  // オーバーサイズの太いそで（ひじまで）
  wide(K, A) {
    const k = Math.max(1, A.at * 0.95);
    const sl = mesh(lathe([[0.083 * k, -0.215 * A.limb], [0.088 * k, -0.2 * A.limb], [0.09 * k, -0.07], [0.08 * k, 0.025]], 16), K.mShirt, K.L(K.look.shirt), 0.01);
    sl.position.y = -0.02;
    A.shoulder.add(sl);
  },
};
// くつ下（socks の色。sockLen：'knee' ひざ下まで / ふつうは足首）
function socks(K, G) {
  const { look } = K;
  if (look.socks == null) return;
  if (look.sockLen === 'knee' || look.sockLen === 'mid') {
    const top = look.sockLen === 'knee' ? -0.035 : -0.17;
    const r = (y) => (0.06 + (0.045 - 0.06) * clamp(-y / 0.31, 0, 1)) * G.lt + 0.0045;
    const ys = [-0.3, -0.2, top - 0.05, top];
    const pts = ys.map((y) => [r(y), y * G.limb]);
    const sk = K.part(lathe(pts, 14), look.socks, 0.008);
    G.knee.add(sk);
    const band = K.part(new THREE.TorusGeometry(r(top) + 0.001, 0.006, 5, 16), look.socks, 0.005);
    band.rotation.x = Math.PI / 2;
    band.position.y = top * G.limb;
    G.knee.add(band);
  } else {
    const sock = K.part(new THREE.CylinderGeometry(0.05 * G.lt, 0.048 * G.lt, 0.09, 12), look.socks, 0.008);
    sock.position.y = -0.3 * G.limb;
    G.knee.add(sock);
  }
}
// 脚（ズボンでない所）：legwear（タイツ）の色か、はだ
function bareLegs(K, G) {
  const { look } = K;
  const lc = look.legwear != null ? look.legwear : look.skin;
  const lm = look.legwear != null ? K.C(look.legwear) : K.mSkin;
  const thigh = mesh(limbGeo(0.078 * G.lt, 0.062 * G.lt, 0.34 * G.limb), lm, K.L(lc));
  thigh.position.y = -0.01;
  G.hip.add(thigh);
  const shin = mesh(limbGeo(0.06 * G.lt, 0.045 * G.lt, 0.31 * G.limb), lm, K.L(lc));
  G.knee.add(shin);
}
// ズボン・スカート（脚ごと）。G：{ side, hip, knee, lt, limb }
const BOTTOMS = {
  // ジョガーパンツ（前からの形）
  pants(K, G) {
    const { look } = K;
    const thigh = mesh(limbGeo(0.078 * G.lt, 0.062 * G.lt, 0.34 * G.limb), K.mPants, K.L(look.pants));
    thigh.position.y = -0.01;
    G.hip.add(thigh);
    const shin = mesh(limbGeo(0.06 * G.lt, 0.045 * G.lt, 0.31 * G.limb), K.mPants, K.L(look.pants));
    G.knee.add(shin);
    // ジョガーパンツのすそ（しぼり）
    const cuffP = mesh(new THREE.CylinderGeometry(0.052 * G.lt, 0.055 * G.lt, 0.05, 12), K.C(new THREE.Color(look.pants).multiplyScalar(0.8).getHex()), K.L(look.pants), 0.008);
    cuffP.position.y = -0.31 * G.limb;
    G.knee.add(cuffP);
  },
  // ひざまでの半ズボン＋白いくつ下（エブン）
  shorts(K, G) {
    const { look } = K;
    const thigh = mesh(limbGeo(0.078 * G.lt, 0.062 * G.lt, 0.34 * G.limb), K.mPants, K.L(look.pants));
    thigh.position.y = -0.01;
    G.hip.add(thigh);
    const shin = mesh(limbGeo(0.06 * G.lt, 0.045 * G.lt, 0.31 * G.limb), K.mSkin, K.L(look.skin));
    G.knee.add(shin);
    const cuffS = mesh(lathe([[0.083 * G.lt, 0.04], [0.08 * G.lt, -0.03], [0.074 * G.lt, -0.06]], 14), K.mPants, K.L(look.pants), 0.01);
    G.knee.add(cuffS);
    const sc = look.socks != null ? look.socks : 0xf4f4f2;
    const sock = mesh(new THREE.CylinderGeometry(0.05 * G.lt, 0.048 * G.lt, 0.09, 12), K.C(sc), K.L(look.socks != null ? sc : 0xd0d0d0), 0.008);
    sock.position.y = -0.3 * G.limb;
    G.knee.add(sock);
  },
  // 短パン（太ももの上まで）。shortLen：長さ（しょうたはひざの上まで）/ shortR：太さ
  short(K, G) {
    bareLegs(K, G);
    const lt = G.lt;
    const sl = K.look.shortLen || 0.126, sr = K.look.shortR || 1;
    const sg = lathe([[0.086 * lt * sr, -sl], [0.091 * lt * sr, -sl + 0.006], [0.093 * lt * sr, -0.05], [0.088 * lt * sr, 0.045]], 16);
    if (K.look.pantsPattern) uvScale(sg, 1.6, (sl + 0.045) / 0.2);
    const sh = mesh(sg, K.mPants, K.L(K.look.pants), 0.01);
    G.hip.add(sh);
    if (K.look.trim != null && K.outfit !== 'zip') {
      const t = K.part(new THREE.TorusGeometry(0.09 * lt, 0.006, 5, 16), K.look.trim, 0.004);
      t.rotation.x = Math.PI / 2;
      t.position.y = -0.118;
      G.hip.add(t);
    }
    socks(K, G);
  },
  // バスケの長い短パン（ひざの下まで、ゆったり）
  longShorts(K, G) {
    const { look } = K;
    const lt = G.lt;
    const thigh = mesh(limbGeo(0.078 * lt, 0.062 * lt, 0.34 * G.limb), K.mPants, K.L(look.pants));
    thigh.position.y = -0.01;
    G.hip.add(thigh);
    const leg = mesh(lathe([[0.095 * lt, -0.4 * G.limb], [0.099 * lt, -0.34 * G.limb], [0.1 * lt, -0.1], [0.094 * lt, 0.04]], 16), K.mPants, K.L(look.pants), 0.01);
    G.hip.add(leg);
    if (look.trim != null) {
      const t = K.part(new THREE.TorusGeometry(0.096 * lt, 0.008, 5, 18), look.trim, 0.005);
      t.rotation.x = Math.PI / 2;
      t.position.y = -0.385 * G.limb;
      G.hip.add(t);
      const s = K.part(new THREE.CylinderGeometry(0.1015 * lt, 0.1005 * lt, 0.3 * G.limb, 12, 1, true, G.side > 0 ? Math.PI / 2 - 0.12 : -Math.PI / 2 - 0.12, 0.24), look.trim, 0.004);
      s.position.y = -0.2 * G.limb;
      G.hip.add(s);
    }
    const shin = mesh(limbGeo(0.06 * lt, 0.045 * lt, 0.31 * G.limb), K.mSkin, K.L(look.skin));
    G.knee.add(shin);
    socks(K, G);
  },
  // スカート（腰に1つ。脚にあわせて少し動く）。long：ひざまで
  skirt(K, G) {
    const { look } = K;
    bareLegs(K, G);
    socks(K, G);
    if (G.side !== 1) return;
    const sk = new THREE.Group();
    K.body.add(sk);
    K.skirt = sk;
    const hw = look.build * K.hipW;
    const long = !!look.long;
    const yH = long ? -0.44 : -0.205, rH = (long ? 0.235 : 0.212) * Math.max(1, hw);
    const g = lathe([[rH - 0.006, yH - 0.008], [rH, yH], [0.15 * hw + (rH - 0.15 * hw) * 0.4, -0.07], [0.147 * hw, 0.02], [0.134 * hw, 0.08]], 36, 0.8);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const t = clamp((0.02 - y) / (0.02 - yH), 0, 1);
      const k = 1 + 0.04 * t * Math.cos(Math.atan2(p.getX(i), p.getZ(i)) * 14);
      p.setX(i, p.getX(i) * k);
      p.setZ(i, p.getZ(i) * k);
    }
    g.computeVertexNormals();
    sk.add(mesh(g, K.mPants, K.L(look.pants), 0.012));
    const wb = K.part(new THREE.TorusGeometry(0.135 * hw, 0.013, 6, 24), darker(look.pants, 0.92), 0.008);
    wb.rotation.x = Math.PI / 2;
    wb.scale.set(1, 0.8, 1);
    wb.position.y = 0.078;
    sk.add(wb);
  },
  // ワイドパンツ（すそが広がって、くつの上にかかる）
  wide(K, G) {
    const { look } = K;
    const lt = G.lt;
    const thigh = mesh(limbGeo(0.09 * lt, 0.086 * lt, 0.34 * G.limb), K.mPants, K.L(look.pants));
    thigh.position.y = -0.01;
    G.hip.add(thigh);
    const shin = mesh(lathe([[0.094 * lt, -0.336 * G.limb], [0.1 * lt, -0.33 * G.limb], [0.097 * lt, -0.3 * G.limb], [0.088 * lt, -0.1], [0.084 * lt, 0.04]], 16), K.mPants, K.L(look.pants), 0.01);
    G.knee.add(shin);
  },
  // 細いズボン（すそは折りかえし）
  slim(K, G) {
    const { look } = K;
    const lt = G.lt;
    const thigh = mesh(limbGeo(0.073 * lt, 0.058 * lt, 0.34 * G.limb), K.mPants, K.L(look.pants));
    thigh.position.y = -0.01;
    G.hip.add(thigh);
    const shin = mesh(limbGeo(0.056 * lt, 0.046 * lt, 0.31 * G.limb), K.mPants, K.L(look.pants));
    G.knee.add(shin);
    const hem = K.part(new THREE.CylinderGeometry(0.05 * lt, 0.052 * lt, 0.03, 12), darker(look.pants, 0.82), 0.006);
    hem.position.y = -0.3 * G.limb;
    G.knee.add(hem);
  },
};
// 耳たぶの小さなスタッド（銀）。sd：-1＝右耳 / 1＝左耳
function earStud(K, sd) {
  const st = K.part(new THREE.SphereGeometry(0.0072, 10, 8), 0xe6e9ef, 0.002, 'cool', { rim: 0.95, rimColor: 0xffffff });
  st.position.set(sd * HEAD_R * 0.93, -0.06, 0.006);
  K.head.add(st);
}
// 小物（頭・手・足・体）。items の名前で呼ばれる
const HEAD_ITEMS = {
  // はやた：頭の上に押し上げたスポーツサングラス（ミラーのレンズ。つるは頭のてっぺんへ）
  sunglasses(K) {
    const el = 0.98;
    const g = new THREE.Group();
    g.position.copy(headShape(new THREE.Vector3(0, Math.sin(el), Math.cos(el)).multiplyScalar(HEAD_R * 1.19), HEAD_R, K.HP));
    g.rotation.x = -el;
    K.head.add(g);
    const lc = K.look.lensColor != null ? K.look.lensColor : 0x22c98f;
    for (const sd of [-1, 1]) {
      const lens = K.part(new THREE.SphereGeometry(0.056, 18, 12), lc, 0.008, 'cool', { rim: 1.0, rimColor: 0xeafff8 });
      lens.scale.set(1.3, 0.78, 0.32);
      lens.position.set(sd * 0.068, 0, 0.004);
      lens.rotation.y = sd * 0.28;
      g.add(lens);
      const hl = K.part(new THREE.SphereGeometry(0.012, 6, 4), 0xffffff, 0.002, 'cool', { rim: 0 });
      hl.scale.set(2.4, 0.5, 0.4);
      hl.position.set(sd * 0.068 - 0.022, 0.014, 0.022);
      hl.rotation.set(0, sd * 0.28, 0.5);
      g.add(hl);
      const tm = K.part(roundedBox(0.012, 0.16, 0.012, 0.005, 1), 0x1d2026, 0.004);
      tm.position.set(sd * 0.14, 0.075, -0.018);
      tm.rotation.set(-0.36, 0, -sd * 0.1);
      g.add(tm);
    }
    const bar = K.part(roundedBox(0.27, 0.014, 0.014, 0.006, 1), 0x1d2026, 0.004);
    bar.position.set(0, 0.034, 0.008);
    g.add(bar);
  },
  // こうせい：バスケのヘアバンド（白に赤い線）
  headband(K) {
    const R = HEAD_R;
    const g = new THREE.Group();
    g.position.set(0, 0.075, -0.004);
    g.rotation.x = -0.2;
    g.scale.set(0.95, 1, 1.02);
    K.head.add(g);
    const ri = R * 1.075, ro = R * 1.13;
    g.add(K.part(lathe([[ri, -0.026], [ro, -0.026], [ro + 0.004, 0], [ro, 0.026], [ri, 0.026], [ri, -0.026]], 30), K.look.bandColor != null ? K.look.bandColor : 0xf6f6f6, 0.008));
    const st = K.part(new THREE.CylinderGeometry(ro + 0.0045, ro + 0.0045, 0.012, 30, 1, true), K.look.trim != null ? K.look.trim : 0xe8331f, 0.003);
    g.add(st);
  },
  // ねじりはちまき（紅白のねじれた手ぬぐい・前に結び目）。v1.5 のなお（いまは使っていない）
  twistBand(K) {
    const R = HEAD_R;
    const g = new THREE.Group();
    g.position.set(0, 0.07, -0.006);
    g.rotation.x = -0.16;
    K.head.add(g);
    const rx = R * 1.04 * 0.95, rz = R * 1.07;
    const N = 15;
    for (const [ph, col] of [[0, 0xf8f6f0], [Math.PI, 0xe8331f]]) {
      const pts = [];
      for (let i = 0; i < 120; i++) {
        const u = (i / 120) * Math.PI * 2;
        const a = u * N + ph;
        const r = 0.011;
        const out = Math.cos(a) * r, up = Math.sin(a) * r;
        pts.push(new THREE.Vector3(Math.sin(u) * (rx + 0.012 + out), up, Math.cos(u) * (rz + 0.012 + out)));
      }
      g.add(K.part(tubeGeo(pts, 0.0125, true, 200, 5), col, 0.006));
    }
    // 結び目（右前）
    const kn = new THREE.Group();
    kn.position.set(0.13, 0.0, 0.17);
    kn.rotation.y = 0.65;
    g.add(kn);
    kn.add(K.part(new THREE.SphereGeometry(0.026, 10, 8), 0xf8f6f0, 0.006));
    for (const [a, b] of [[0.5, 0.0], [-0.3, 0.5]]) {
      const e = K.part(strandGeo(0.07, 0.02, 0.5, 0.5), b ? 0xe8331f : 0xf8f6f0, 0.005);
      e.position.set(0, 0.012, 0.01);
      e.rotation.set(-0.5 + b, 0, a);
      kn.add(e);
    }
  },
  // あやな：ベレー帽
  beret(K) {
    const g = new THREE.Group();
    g.position.set(0.02, 0.172, -0.035);
    g.rotation.set(-0.22, 0, -0.32);
    K.head.add(g);
    const c = K.look.beretColor != null ? K.look.beretColor : 0x6d7a4a;
    const b = K.part(new THREE.SphereGeometry(0.2, 24, 12), c, 0.01);
    b.scale.set(1.12, 0.36, 1.08);
    g.add(b);
    const band = K.part(new THREE.TorusGeometry(0.19, 0.014, 6, 28), darker(c, 0.85), 0.006);
    band.rotation.x = Math.PI / 2;
    band.position.y = -0.03;
    band.scale.set(1.12, 1.08, 1);
    g.add(band);
    const stem = K.part(new THREE.CylinderGeometry(0.008, 0.01, 0.03, 6), darker(c, 0.8), 0.004);
    stem.position.y = 0.075;
    g.add(stem);
  },
  // まさし：耳の小さなフープピアス
  earrings(K) {
    for (const sd of [-1, 1]) {
      const r = K.part(new THREE.TorusGeometry(0.017, 0.0045, 6, 18), 0xe3e7ee, 0.003, 'cool', { rim: 0.9, rimColor: 0xffffff });
      r.position.set(sd * HEAD_R * 0.93, -0.083, -0.005);
      r.rotation.y = Math.PI / 2;
      K.head.add(r);
      if (sd > 0) {
        const st = K.part(new THREE.SphereGeometry(0.0075, 8, 6), 0xe3e7ee, 0.002, 'cool', { rim: 0.9, rimColor: 0xffffff });
        st.position.set(sd * HEAD_R * 0.935, -0.045, 0.012);
        K.head.add(st);
      }
    }
  },
  // v1.6 メガネ（写真から）。look.specs = { shape: 'round'・'boston'・'octa', w・h：レンズの半分の幅・高さ, t：ふちの太さ, color,
  //  top・topT：上ぶち（ブロー）の色と太さ, rivet：鋲の色, metal：細い金属（鼻パッドつき）, y：高さ, sep：左右のレンズの中心, tilt：顔にそわせる角度 }
  specs(K) {
    const sp = K.look.specs || {};
    const R = HEAD_R;
    const w = sp.w || 0.062, h = sp.h || 0.054, t = sp.t || 0.0075;
    const sep = sp.sep || 0.078, y0 = sp.y != null ? sp.y : -0.012;
    const fc = sp.color != null ? sp.color : 0x1b1719;
    const tilt = sp.tilt != null ? sp.tilt : 0.2;
    const g = new THREE.Group();
    K.head.add(g);
    // レンズの形（2D）。octa：角の丸い四角 / boston：上が少し平ら
    const shape2 = (a) => {
      let x = Math.cos(a), y = Math.sin(a);
      if (sp.shape === 'octa') {
        const p = 3.2;
        x = Math.sign(x) * Math.abs(x) ** (2 / p);
        y = Math.sign(y) * Math.abs(y) ** (2 / p);
      } else if (sp.shape === 'boston') {
        if (y > 0) {
          x = Math.sign(x) * Math.abs(x) ** 0.82;
          y *= 0.86;
        }
      }
      return [x * w, y * h];
    };
    // 顔の前の、少し曲がった面に置く（外がわほど後ろへ）
    const place = (sd, x, y, dz = 0) => {
      const lx = sd * sep + x;
      const z = R * 0.965 + dz - Math.max(0, sd * x) * Math.sin(tilt) - Math.max(0, -sd * x) * 0.05 - (y * y) * 0.6;
      return new THREE.Vector3(lx, y0 + y, z);
    };
    const N = 44;
    for (const sd of [-1, 1]) {
      const pts = [];
      for (let i = 0; i < N; i++) {
        const [x, y] = shape2((i / N) * Math.PI * 2);
        pts.push(place(sd, x * sd, y));
      }
      g.add(K.part(tubeGeo(pts, t, true, 64, 6), fc, 0.0035, 'cool', { rim: 0.35, rimColor: 0xffffff }));
      if (sp.top != null) {
        // 上ぶち（ブロー）：上の半分を太く
        const tp = [];
        for (let i = 0; i <= 20; i++) {
          const a = 0.12 + (i / 20) * (Math.PI - 0.24);
          const [x, y] = shape2(a);
          tp.push(place(sd, x * sd, y + t * 0.4, 0.001));
        }
        g.add(K.part(tubeGeo(tp, sp.topT || t * 1.9, false, 40, 6), sp.top, 0.0035, 'cool', { rim: 0.3, rimColor: 0xffffff }));
      }
      // レンズ（うすい水色）
      const lp = [];
      for (let i = 0; i < N; i++) {
        const [x, y] = shape2((i / N) * Math.PI * 2);
        lp.push(new THREE.Vector2(x * 0.98, y * 0.98));
      }
      const lg = new THREE.ShapeGeometry(new THREE.Shape(lp), 2);
      const lv = lg.attributes.position;
      for (let i = 0; i < lv.count; i++) {
        const q = place(sd, lv.getX(i) * sd, lv.getY(i), -0.002);
        lv.setXYZ(i, q.x, q.y, q.z);
      }
      if (sd < 0) lg.index.array.reverse();
      lg.computeVertexNormals();
      const lens = new THREE.Mesh(lg, new THREE.MeshBasicMaterial({ color: sp.lens != null ? sp.lens : 0xcfeaff, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide }));
      g.add(lens);
      // レンズの光（ななめの線）
      const hl = new THREE.Mesh(new THREE.PlaneGeometry(0.006, h * 0.75), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      hl.position.copy(place(sd, -0.35 * w * sd + (sd > 0 ? 0 : 0), 0.1 * h, 0.003));
      hl.rotation.set(0, sd * tilt * 0.6, -0.55);
      g.add(hl);
      // つる（耳まで）
      const [ex] = shape2(0);
      const a0 = place(sd, ex * sd + sd * t, 0.2 * h);
      const pts2 = [a0, new THREE.Vector3(sd * R * 0.9, y0 + 0.012, R * 0.45), new THREE.Vector3(sd * R * 0.93, y0 + 0.008, R * 0.05), new THREE.Vector3(sd * R * 0.9, y0 - 0.018, -R * 0.2)];
      g.add(K.part(tubeGeo(pts2, t * (sp.metal ? 0.7 : 0.85), false, 24, 5), sp.temple != null ? sp.temple : fc, 0.003));
      if (sp.rivet != null) {
        // 鋲（前の上の外がわ）
        for (const k of [0.0, 0.035]) {
          const rv = K.part(new THREE.SphereGeometry(t * 0.55, 8, 6), sp.rivet, 0.002, 'cool', { rim: 0.9, rimColor: 0xffffff });
          rv.position.copy(place(sd, (w * 0.62 + k * 0.4) * sd, h * 0.62 - k * 0.3, t * 0.9));
          g.add(rv);
        }
      }
      if (sp.metal || sp.pads) {
        // 鼻パッド
        const pd = K.part(new THREE.SphereGeometry(0.0075, 8, 6), sp.pads != null ? sp.pads : 0xd9c08a, 0.002, 'cool', { rim: 0.8, rimColor: 0xffffff });
        pd.scale.set(0.6, 1.2, 0.6);
        pd.position.copy(place(sd, -w * 0.82 * sd, -h * 0.25, -0.006));
        g.add(pd);
      }
    }
    // ブリッジ
    const bp = [];
    for (let i = 0; i <= 8; i++) {
      const u = i / 8;
      const x = -sep + w * 0.96 + (2 * (sep - w * 0.96)) * u;
      bp.push(new THREE.Vector3(x, y0 + h * (sp.bridgeY != null ? sp.bridgeY : 0.32) + 0.008 * Math.sin(u * Math.PI), R * 0.985 + 0.004));
    }
    g.add(K.part(tubeGeo(bp, t * (sp.metal ? 0.8 : 0.95), false, 16, 5), sp.top != null ? sp.top : fc, 0.003));
  },
  // v1.6 ピアス：studR（右耳たぶのスタッド）・cuffR（右耳の上のリング）・studL（左耳たぶ）
  studR(K) {
    earStud(K, -1);
  },
  studL(K) {
    earStud(K, 1);
  },
  cuffR(K) {
    const r = K.part(new THREE.TorusGeometry(0.014, 0.0035, 6, 16), 0xe3e7ee, 0.002, 'cool', { rim: 0.9, rimColor: 0xffffff });
    r.position.set(-HEAD_R * 0.935, 0.008, -0.022);
    r.rotation.set(0.2, Math.PI / 2, 0.4);
    K.head.add(r);
  },
  // ちじわ：風邪のマスク（あごにずらしている）
  mask(K) {
    const R = HEAD_R;
    const up = !!K.look.maskUp; // maskUp：鼻と口をおおう（ドラ）。ふつうはあごにずらしている（前のちじわ）
    const th0 = up ? 1.86 : 2.12, thL = up ? 0.92 : 0.62;
    const g = new THREE.SphereGeometry(R * 1.04, 26, up ? 12 : 8, Math.PI / 2 - (up ? 1.2 : 1.12), up ? 2.4 : 2.24, th0, thL);
    const p = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      headShape(v, R, K.HP);
      p.setXYZ(i, v.x, v.y, v.z * 1.03);
    }
    g.computeVertexNormals();
    const c = 0xf3f6f8;
    const m = K.part(g, c, 0.008);
    K.head.add(m);
    // 上のふち・ひだ・耳のひも
    const edge = (th, off) => {
      const pts = [];
      for (let i = 0; i <= 16; i++) {
        const ph = Math.PI / 2 - 1.1 + (2.2 * i) / 16;
        const vv = new THREE.Vector3(-Math.cos(ph) * Math.sin(th), Math.cos(th), Math.sin(ph) * Math.sin(th)).multiplyScalar(R * (1.045 + off));
        headShape(vv, R, K.HP);
        vv.z *= 1.03;
        pts.push(vv);
      }
      return pts;
    };
    if (up) {
      // 上のふち（鼻の上）と、横のひだ・耳のひも
      K.head.add(K.part(tubeGeo(edge(1.87, 0.0), 0.0045, false, 40), 0xd2d9df, 0.003));
      K.head.add(K.part(tubeGeo(edge(2.12, 0.004), 0.003, false, 40), 0xdde3e8, 0.002));
      K.head.add(K.part(tubeGeo(edge(2.36, 0.004), 0.003, false, 40), 0xdde3e8, 0.002));
      for (const sd of [-1, 1]) {
        const pts = [new THREE.Vector3(sd * R * 0.9, -R * 0.2, R * 0.45), new THREE.Vector3(sd * R * 0.98, -R * 0.12, R * 0.15), new THREE.Vector3(sd * R * 0.98, -R * 0.02, -R * 0.02), new THREE.Vector3(sd * R * 0.9, R * 0.02, -R * 0.12)];
        K.head.add(K.part(tubeGeo(pts, 0.0035, false, 16), 0xe8edf0, 0.002));
        const pts2 = [new THREE.Vector3(sd * R * 0.8, -R * 0.72, R * 0.45), new THREE.Vector3(sd * R * 0.95, -R * 0.5, R * 0.12), new THREE.Vector3(sd * R * 0.96, -R * 0.28, -R * 0.04), new THREE.Vector3(sd * R * 0.9, -R * 0.18, -R * 0.12)];
        K.head.add(K.part(tubeGeo(pts2, 0.0035, false, 16), 0xe8edf0, 0.002));
      }
    } else {
      K.head.add(K.part(tubeGeo(edge(2.13, 0.0), 0.0045, false, 40), 0xd2d9df, 0.003));
      K.head.add(K.part(tubeGeo(edge(2.32, 0.004), 0.003, false, 40), 0xdde3e8, 0.002));
      K.head.add(K.part(tubeGeo(edge(2.5, 0.004), 0.003, false, 40), 0xdde3e8, 0.002));
      for (const sd of [-1, 1]) {
        const a = new THREE.Vector3(sd * R * 0.86, -R * 0.62, R * 0.36);
        const pts = [a, new THREE.Vector3(sd * R * 0.97, -R * 0.38, R * 0.12), new THREE.Vector3(sd * R * 0.97, -R * 0.08, -R * 0.02), new THREE.Vector3(sd * R * 0.9, R * 0.02, -R * 0.12)];
        K.head.add(K.part(tubeGeo(pts, 0.0035, false, 16), 0xe8edf0, 0.002));
      }
    }
  },
};
const HAND_ITEMS = {
  // てつんど：両手にドラムスティック（にぎりこぶしから前へ）
  drumsticks(K, A) {
    const st = K.part(lathe([[0.0001, -0.12], [0.013, -0.118], [0.0135, 0.1], [0.0095, 0.2], [0.0065, 0.235], [0.0098, 0.25], [0.0001, 0.263]], 8), 0xe2bd7c, 0.005);
    st.position.set(0, -0.08, 0.03);
    st.rotation.set(2.75, 0, -A.side * 0.22);
    A.wrist.add(st);
  },
  // まな：左手にスマホ（水色のケース）
  phone(K, A) {
    if (A.side !== -1) return;
    const g = new THREE.Group();
    g.position.set(0.03, -0.215, 0.045);
    g.rotation.set(0.35, -0.5, 0.12);
    A.wrist.add(g);
    g.add(K.part(roundedBox(0.09, 0.17, 0.018, 0.014, 2), K.look.phoneColor != null ? K.look.phoneColor : 0x6fc4ff, 0.006));
    const scr = new THREE.Mesh(roundedBox(0.078, 0.155, 0.004, 0.01, 1), new THREE.MeshBasicMaterial({ color: 0x1b2433 }));
    scr.position.z = -0.009;
    g.add(scr);
    const cam = K.part(roundedBox(0.03, 0.03, 0.01, 0.007, 1), 0x2a3140, 0.003);
    cam.position.set(-0.018, -0.052, 0.012);
    g.add(cam);
    for (const [x, y] of [[-0.012, -0.044], [-0.024, -0.06]]) {
      const l = new THREE.Mesh(new THREE.CircleGeometry(0.006, 10), new THREE.MeshBasicMaterial({ color: 0x8fb6ff }));
      l.position.set(x, y, 0.0172);
      g.add(l);
    }
    if (K.look.phoneHeart === false) return;
    const heart = K.part(new THREE.SphereGeometry(0.012, 8, 6), 0xff8fb8, 0.003);
    heart.scale.set(1, 1, 0.5);
    heart.position.set(0.018, 0.02, 0.0105);
    g.add(heart);
  },
};
const FOOT_ITEMS = {
  // はやた：自転車のすそバンド（右の足首・光る黄緑）
  ankleBand(K, G) {
    if (G.side !== -1) return;
    const b = K.part(new THREE.CylinderGeometry(0.054 * G.lt + 0.006, 0.055 * G.lt + 0.006, 0.034, 12), 0xd6ff3a, 0.004, 'cool', { rim: 0.9, rimColor: 0xffffff });
    b.position.y = -0.255 * G.limb;
    G.knee.add(b);
  },
};
const BODY_ITEMS = {
  // てつんど：首にかけたタオル（赤）
  towel(K) {
    const { look, prof } = K;
    const c = look.towel != null ? look.towel : 0xe8331f;
    const ring = K.part(new THREE.TorusGeometry(0.1 * look.neck, 0.028, 8, 24), c, 0.008);
    ring.rotation.x = Math.PI / 2 - 0.32;
    ring.position.set(0, 0.292, -0.006);
    K.chest.add(ring);
    for (const sd of [-1, 1]) {
      const p = torsoPt(K, 0.405, sd * 0.42, 0.02);
      const e = K.part(roundedBox(0.062, 0.14, 0.02, 0.008, 1), c, 0.007);
      e.position.set(p.x, p.y + 0.01, p.z);
      e.rotation.set(-0.12, sd * 0.38, sd * 0.05);
      K.chest.add(e);
      const w = K.part(roundedBox(0.064, 0.014, 0.022, 0.005, 1), 0xf6f6f6, 0.004);
      w.position.set(p.x, p.y - 0.045, p.z + 0.006);
      w.rotation.copy(e.rotation);
      K.chest.add(w);
    }
  },
  // コーダイ：ベルトにレモンサワーの缶
  can(K) {
    const { look } = K;
    const g = new THREE.Group();
    g.position.set(0.172 * look.build * K.hipW, 0.035, 0.05);
    g.rotation.set(0.05, 0.55, -0.1);
    K.body.add(g);
    g.add(K.part(new THREE.CylinderGeometry(0.034, 0.034, 0.1, 16), 0xf4d43a, 0.006));
    const band = K.part(new THREE.CylinderGeometry(0.0347, 0.0347, 0.034, 16, 1, true), 0xf8f8f4, 0.003);
    band.position.y = -0.008;
    g.add(band);
    const lem = K.part(new THREE.SphereGeometry(0.011, 8, 6), 0xffe14a, 0.002);
    lem.scale.set(1, 1, 0.4);
    lem.position.set(0, -0.008, 0.035);
    g.add(lem);
    const top = K.part(new THREE.CylinderGeometry(0.03, 0.034, 0.012, 16), 0xd9dde4, 0.004, 'cool', { rim: 0.8, rimColor: 0xffffff });
    top.position.y = 0.056;
    g.add(top);
    const clip = K.part(new THREE.TorusGeometry(0.036, 0.006, 5, 16), 0x24232a, 0.003);
    clip.rotation.x = Math.PI / 2;
    clip.position.y = 0.02;
    g.add(clip);
  },
  // まさし・しょうた：銀のネックレス
  necklace(K) {
    const { look } = K;
    const r = (look.chainR || 0.088) * look.neck * (K.fem ? 0.88 : 1);
    const n = K.part(new THREE.TorusGeometry(r, look.pendant === false ? 0.0032 : 0.0042, 5, 36), 0xdfe3ea, 0.003, 'cool', { rim: 0.9, rimColor: 0xffffff });
    n.rotation.x = Math.PI / 2 - (look.chainTilt || 0.52);
    n.position.set(0, 0.276, 0.004);
    K.chest.add(n);
    if (look.pendant === false) return; // 細いチェーンだけ（てつんど・ナオT）
    const pd = K.part(new THREE.TorusGeometry(0.011, 0.004, 5, 12), 0xdfe3ea, 0.003, 'cool', { rim: 0.9, rimColor: 0xffffff });
    pd.position.set(0, 0.232, 0.7 * bandR(K.prof, 0.43) + 0.022);
    pd.rotation.x = -0.4;
    K.chest.add(pd);
  },
  // ちじわ：パーカーのポケットからカップめん
  cupNoodle(K) {
    const p = K.pocket || torsoPt(K, 0.085, 0, 0.02);
    const g = new THREE.Group();
    g.position.set(p.x - 0.062 * K.look.build, p.y + 0.045, p.z + 0.006);
    g.rotation.set(0.32, 0.0, 0.42);
    K.chest.add(g);
    g.add(K.part(lathe([[0.0001, -0.045], [0.031, -0.045], [0.043, 0.04], [0.045, 0.046], [0.0001, 0.046]], 16), 0xf7f5ef, 0.006));
    const band = K.part(new THREE.CylinderGeometry(0.0425, 0.0385, 0.024, 16, 1, true), 0xe23a2c, 0.003);
    band.position.y = 0.012;
    g.add(band);
    const hinge = new THREE.Group();
    hinge.position.set(0, 0.048, -0.042);
    hinge.rotation.x = -0.85;
    g.add(hinge);
    const lid = K.part(new THREE.CylinderGeometry(0.047, 0.047, 0.004, 16), 0xf0dea8, 0.003);
    lid.position.set(0, 0, 0.042);
    hinge.add(lid);
    for (const sd of [-1, 1]) {
      const ch = K.part(new THREE.CylinderGeometry(0.0035, 0.003, 0.15, 5), 0xd9b27a, 0.002);
      ch.position.set(sd * 0.01, 0.07, 0.012);
      ch.rotation.set(0.25, 0, sd * 0.08 - 0.15);
      g.add(ch);
    }
  },
  // みのり：2リットルの水のボトル（肩からななめにかけたひもで、右の腰に）
  bottle(K) {
    const { look, prof } = K;
    const bw = look.build;
    // ななめのひも（左の肩 → 右の腰）
    const pts = [];
    const y0 = 0.22, kx = 1.45 / bw;
    for (let i = 0; i < 40; i++) {
      const ph = (i / 40) * Math.PI * 2;
      let y = y0;
      for (let it = 0; it < 6; it++) y = clamp(y0 + kx * Math.sin(ph) * bandR(prof, y), -0.05, 0.5);
      const hr = hipsR(look, y + 0.04);
      const r = Math.max(bandR(prof, y), hr ? hr + 0.01 : 0) + 0.012;
      pts.push(new THREE.Vector3(Math.sin(ph) * r, y - 0.2, Math.cos(ph) * r * 0.7));
    }
    K.chest.add(K.part(tubeGeo(pts, 0.009, true, 120, 5), look.strap != null ? look.strap : 0x3a6fb5, 0.005));
    const g = new THREE.Group();
    g.position.set(-0.205 * bw, -0.33, -0.045);
    g.rotation.set(0.06, 0.3, 0.12);
    K.chest.add(g);
    const body = K.part(lathe([[0.0001, -0.13], [0.04, -0.13], [0.05, -0.115], [0.05, 0.05], [0.042, 0.088], [0.02, 0.112], [0.016, 0.118], [0.0001, 0.118]], 18), 0xcdefff, 0.008, 'cool', { rim: 0.95, rimColor: 0xffffff });
    g.add(body);
    const label = K.part(new THREE.CylinderGeometry(0.0507, 0.0507, 0.07, 18, 1, true), 0xf8fbff, 0.003);
    label.position.y = -0.03;
    g.add(label);
    const stripe = K.part(new THREE.CylinderGeometry(0.0512, 0.0512, 0.018, 18, 1, true), 0x3aa0ff, 0.003);
    stripe.position.y = -0.03;
    g.add(stripe);
    const cap = K.part(new THREE.CylinderGeometry(0.019, 0.019, 0.026, 12), 0x2f7fe0, 0.004);
    cap.position.y = 0.128;
    g.add(cap);
    const holder = K.part(new THREE.TorusGeometry(0.02, 0.006, 5, 12), look.strap != null ? look.strap : 0x3a6fb5, 0.003);
    holder.rotation.x = Math.PI / 2;
    holder.position.y = 0.11;
    g.add(holder);
  },
  // v1.6 ドラ：ネクタイ（紺に白い水玉）と、白いシャツのえり
  tie(K) {
    const { look, prof } = K;
    const c = look.tieColor != null ? look.tieColor : 0x1f2b55;
    const hw = (y) => 0.075 + 0.11 * smooth(0.44, 0.08, y); // 角度の半分（下ほど広い）
    const y0 = 0.06, y1 = 0.44;
    const off = 0.011;
    const g = bellyBulge(wrapGeo({ levels: levelsFor(prof, y0 - 0.05, y1, 0.02), cols: 8, yr: (u) => [y0 - 0.05 + 0.05 * Math.abs(2 * u - 1), y1], ph: (u, y) => -hw(y) + 2 * hw(y) * u, rf: (y) => bandR(prof, y) + off }), look.belly, -0.02, 0.36);
    onTorso(K, g, c, 0.005);
    // 結び目
    const kn = K.part(new THREE.CylinderGeometry(0.022, 0.014, 0.036, 8), c, 0.004);
    const kp = torsoPt(K, 0.455, 0, off + 0.006);
    kn.position.copy(kp);
    kn.rotation.x = -0.28;
    K.chest.add(kn);
    // 白い水玉
    const dotM = new THREE.MeshBasicMaterial({ color: 0xeef1f6 });
    const r = rng(3);
    for (let i = 0; i < 14; i++) {
      const y = 0.1 + (i / 13) * 0.3;
      const ph = (r() * 2 - 1) * hw(y) * 0.7;
      const d = new THREE.Mesh(new THREE.CircleGeometry(0.0052, 8), dotM);
      const q = torsoPt(K, y, ph, off + 0.0025);
      d.position.copy(q);
      d.lookAt(q.clone().add(new THREE.Vector3(Math.sin(ph), 0, Math.cos(ph))));
      K.chest.add(d);
    }
    // シャツのえり（白い三角）
    const col = look.collarColor != null ? look.collarColor : 0xf6f7f9;
    for (const sd of [-1, 1]) {
      const shp = new THREE.Shape();
      shp.moveTo(0, 0);
      shp.lineTo(sd * 0.07, 0.006);
      shp.lineTo(sd * 0.03, -0.07);
      shp.closePath();
      const m = K.part(new THREE.ExtrudeGeometry(shp, { depth: 0.007, bevelEnabled: false }), col, 0.006);
      const q = torsoPt(K, 0.482, 0, 0.012);
      m.position.set(sd * 0.012, q.y + 0.006, q.z + 0.004);
      m.rotation.set(-0.55, sd * 0.16, 0);
      K.chest.add(m);
    }
  },
  // v1.6 はやた：黒いリュック（背中。前に肩ひもと、胸のバックル）
  backpack(K) {
    const { look, prof } = K;
    const bw = look.build;
    const c = look.packColor != null ? look.packColor : 0x1c1c21;
    const back = K.part(roundedBox(0.27 * bw, 0.33, 0.13, 0.05, 3), c, 0.01);
    const bp = torsoPt(K, 0.25, Math.PI, 0.075);
    back.position.copy(bp);
    K.chest.add(back);
    const pk = K.part(roundedBox(0.2 * bw, 0.14, 0.05, 0.03, 2), darker(c, 1.25), 0.008);
    pk.position.copy(torsoPt(K, 0.16, Math.PI, 0.145));
    K.chest.add(pk);
    const top = K.part(new THREE.TorusGeometry(0.03, 0.007, 5, 12, Math.PI), c, 0.004);
    top.position.copy(torsoPt(K, 0.43, Math.PI, 0.08));
    K.chest.add(top);
    for (const sd of [-1, 1]) {
      // 肩ひも：背中の上 → 肩の上 → 胸の前を下へ → わきへ
      const pts = [];
      for (let i = 0; i <= 10; i++) {
        const u = i / 10;
        const y = 0.46 - 0.4 * u;
        const ph = sd * (0.5 + 0.35 * u * u);
        pts.push(torsoPt(K, y, ph, 0.016));
      }
      const top2 = torsoPt(K, 0.5, sd * 0.42, 0.02);
      const bk = torsoPt(K, 0.4, Math.PI - sd * 0.5, 0.03);
      K.chest.add(K.part(tubeGeo([bk, top2, ...pts], 0.012, false, 48, 5), c, 0.005));
    }
    // 胸のベルトとバックル
    const yC = 0.34;
    const bl = [];
    for (let i = 0; i <= 8; i++) bl.push(torsoPt(K, yC, -0.52 + (1.04 * i) / 8, 0.024));
    K.chest.add(K.part(tubeGeo(bl, 0.006, false, 24, 4), c, 0.004));
    const bu = K.part(roundedBox(0.045, 0.024, 0.012, 0.006, 1), 0x2a2a30, 0.004);
    bu.position.copy(torsoPt(K, yC, 0.05, 0.03));
    K.chest.add(bu);
  },
  // v1.6 しょうた：短パンの白いひも
  drawstring(K) {
    const { look } = K;
    const z = 0.128 * look.build * K.hipW * 0.74 + 0.006;
    for (const sd of [-1, 1]) {
      const pts = [new THREE.Vector3(sd * 0.012, 0.05, z), new THREE.Vector3(sd * 0.02, 0.0, z + 0.008), new THREE.Vector3(sd * 0.03 + 0.004, -0.06, z + 0.012)];
      K.body.add(K.part(tubeGeo(pts, 0.0045, false, 12, 4), 0xf6f6f2, 0.003));
      const tip = K.part(new THREE.SphereGeometry(0.008, 6, 5), 0xf6f6f2, 0.002);
      tip.position.copy(pts[2]);
      K.body.add(tip);
    }
  },
  // v1.6 細いチェーン（首から胸へ、体にそってたれる）。てつんど・ナオT
  chain(K) {
    const { look, prof } = K;
    const yf = look.chainY != null ? look.chainY : 0.385, yb = 0.49;
    const pts = [];
    for (let i = 0; i < 48; i++) {
      const ph = (i / 48) * Math.PI * 2;
      const f = Math.cos(ph / 2) ** 2; // 前＝1・後ろ＝0
      const y = yb + (yf - yb) * f ** 1.6;
      pts.push(torsoPt(K, y, ph, look.chainOff != null ? look.chainOff : 0.009));
    }
    K.chest.add(K.part(tubeGeo(pts, 0.003, true, 160, 4), look.chainColor != null ? look.chainColor : 0x9aa1ad, 0.0018, 'cool', { rim: 0.95, rimColor: 0xffffff }));
  },
  // みのり：えりのリボン
  ribbon(K) {
    const c = K.look.ribbon != null ? K.look.ribbon : 0x3aa0ff;
    const p = torsoPt(K, 0.465, 0, 0.012);
    const g = new THREE.Group();
    g.position.set(0, p.y + 0.004, p.z + 0.004);
    g.rotation.x = -0.35;
    K.chest.add(g);
    for (const sd of [-1, 1]) {
      const l = K.part(new THREE.SphereGeometry(0.03, 10, 8), c, 0.005);
      l.scale.set(1.25, 0.72, 0.45);
      l.position.set(sd * 0.034, 0, 0);
      l.rotation.z = sd * 0.3;
      g.add(l);
      const t = K.part(strandGeo(0.05, 0.016, 0.2, 0.4), c, 0.004);
      t.position.set(sd * 0.01, -0.004, 0.004);
      t.rotation.set(0, 0, Math.PI + sd * 0.35);
      g.add(t);
    }
    g.add(K.part(new THREE.SphereGeometry(0.014, 8, 6), darker(c, 0.85), 0.004));
  },
};
// 胸のプリントの場所と大きさ（キャラごと。書いていないキャラはまん中）
const PRINT_AT = {};

// ===== 部品のまとめ（スマホで軽く） =====
// キャラは ~120個の部品（ふちどり込み）でできている。そのままだと8人で ~1000回の描画になり、スマホでは重い。
// 同じ材質の部品を1つの形にまとめ、各頂点に「どの骨（関節の入れ物）についていくか」を書く（スキン）。
// 骨ごとに 100% ついていくだけなので、見た目と動きは今までとまったく同じ。1人 ~15回の描画になる
function bakeModel(root, keepList) {
  const host = root.userData.parts.scaleBox;
  root.updateMatrixWorld(true);
  const keep = new Set();
  for (const k of keepList) if (k) k.traverse((o) => keep.add(o));
  // 骨：メッシュでない入れ物ぜんぶ（root もふくむ）
  const bones = [];
  const boneIdx = new Map();
  root.traverse((o) => {
    if (o.isMesh || keep.has(o)) return;
    boneIdx.set(o, bones.length);
    bones.push(o);
  });
  const hostInv = host.matrixWorld.clone().invert();
  const groups = new Map();
  const old = [];
  const _m = new THREE.Matrix4();
  root.traverse((o) => {
    if (!o.isMesh || keep.has(o) || Array.isArray(o.material)) return;
    let b = o.parent;
    while (b && b.isMesh) b = b.parent;
    if (!boneIdx.has(b)) return;
    const gi = groupOf(o);
    if (!groups.has(gi.key)) groups.set(gi.key, { gi, ro: o.renderOrder, outline: o.name === 'outline', items: [] });
    _m.multiplyMatrices(hostInv, o.matrixWorld);
    groups.get(gi.key).items.push({ geo: o.geometry, m: _m.clone(), bone: boneIdx.get(b), color: gi.color, cel: gi.cel, olw: gi.olw });
    old.push(o);
  });
  if (!groups.size) return;
  // まとめた形を作る（骨の番号を頂点に書く）
  const made = [];
  for (const grp of groups.values()) {
    const mat = grp.gi.make();
    const keepUv = !!(mat.map || (mat.uniforms && mat.uniforms.cmap));
    const keepCol = !!mat.vertexColors;
    const geos = [];
    for (const it of grp.items) geos.push(skinGeo(it.geo, it.m, it.bone, keepUv, keepCol, it.color, it));
    let merged = null;
    try {
      merged = mergeGeometries(geos, false);
    } catch (e) {
      merged = null;
    }
    for (const g of geos) if (g !== merged) g.dispose();
    if (!merged) return; // まとめられなかったら、元のまま（安全のため）
    const sm = new THREE.SkinnedMesh(merged, mat);
    sm.renderOrder = grp.ro;
    if (grp.outline) sm.name = 'outline';
    sm.raycast = () => {};
    made.push(sm);
  }
  // 元の部品をはずす（形は1人ずつ作ったものなので片づける。材質は使い回しなので残す）
  const geoSeen = new Set();
  for (const o of old) {
    if (o.parent) o.parent.remove(o);
    if (!geoSeen.has(o.geometry) && !(o.geometry.userData && o.geometry.userData.shared)) {
      geoSeen.add(o.geometry);
      o.geometry.dispose();
    }
  }
  for (const sm of made) host.add(sm);
  root.updateMatrixWorld(true);
  const skel = new THREE.Skeleton(bones);
  for (const sm of made) {
    sm.bind(skel);
    // ポーズで手足が動いても画面外と判定されないように、外接球を大きめに
    sm.geometry.computeBoundingSphere();
    sm.boundingSphere = sm.geometry.boundingSphere.clone();
    sm.boundingSphere.radius *= 1.7;
  }
}
// 動かない小物（メガネなど）：中の部品を材質ごとに1つにまとめる（スキンなし）
function mergeStatic(group) {
  group.updateMatrixWorld(true);
  const inv = group.matrixWorld.clone().invert();
  const groups = new Map();
  const old = [];
  const _m = new THREE.Matrix4();
  group.traverse((o) => {
    if (!o.isMesh || Array.isArray(o.material)) return;
    const gi = groupOf(o);
    if (!groups.has(gi.key)) groups.set(gi.key, { gi, ro: o.renderOrder, outline: o.name === 'outline', items: [] });
    _m.multiplyMatrices(inv, o.matrixWorld);
    groups.get(gi.key).items.push({ geo: o.geometry, m: _m.clone(), color: gi.color, cel: gi.cel, olw: gi.olw });
    old.push(o);
  });
  const made = [];
  for (const grp of groups.values()) {
    const mat = grp.gi.make();
    const keepUv = !!(mat.map || (mat.uniforms && mat.uniforms.cmap));
    const geos = grp.items.map((it) => {
      const g = skinGeo(it.geo, it.m, 0, keepUv, !!mat.vertexColors, it.color, it);
      g.deleteAttribute('skinIndex');
      g.deleteAttribute('skinWeight');
      return g;
    });
    let merged = null;
    try {
      merged = mergeGeometries(geos, false);
    } catch (e) {}
    for (const g of geos) if (g !== merged) g.dispose();
    if (!merged) return;
    const mm = new THREE.Mesh(merged, mat);
    mm.renderOrder = grp.ro;
    if (grp.outline) mm.name = 'outline';
    mm.raycast = () => {};
    made.push(mm);
  }
  for (const o of old) {
    if (o.parent) o.parent.remove(o);
    o.geometry.dispose();
  }
  for (const mm of made) group.add(mm);
}

// 材質の設定を文字にする（絵（テクスチャ）は uuid にする。JSON.stringify は toJSON を先に呼ぶので、
// そのままだと絵を PNG にしてしまい、とても重い。だから入れ物の段階で置きかえる）
function optsKey(opts) {
  return JSON.stringify(opts, (k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && !v.isTexture && Object.values(v).some((x) => x && x.isTexture)) {
      const o = {};
      for (const kk of Object.keys(v)) o[kk] = v[kk] && v[kk].isTexture ? 'tex:' + v[kk].uuid : v[kk];
      return o;
    }
    return v && v.isTexture ? 'tex:' + v.uuid : v;
  });
}
// 絵を貼ったセル塗り（柄の服）。gfx.js の toon は絵のある設定だと重いので、ここで作って使い回す
const texCelCache = new Map();
function texCel(opts) {
  const key = optsKey(opts);
  if (texCelCache.has(key)) return texCelCache.get(key);
  const m = cel(0xffffff, opts);
  m.userData.shared = true;
  texCelCache.set(key, m);
  return m;
}
// セル塗り（gfx.js の cel）の影の色・ふちの光を、uniform ではなく頂点の値で読む版を作る。
// gfx.js のシェーダーの文字を置きかえて作るので、光の計算は gfx.js とずっと同じ。置きかえられないときは使わない（前のまとめ方にもどる）
let _celV;
function celV() {
  if (_celV !== undefined) return _celV;
  _celV = null;
  try {
    const m = cel(0xffffff, { char: true, vertexColors: true });
    let fs = m.fragmentShader;
    const decl = ['uniform vec3 shade;', 'uniform vec3 rimColor;', 'uniform float rim;'];
    if (!decl.every((d) => fs.includes(d)) || !m.vertexShader.includes('void main() {')) return _celV;
    for (const d of decl) fs = fs.replace(d, '');
    m.fragmentShader = 'varying vec3 vShade;\nvarying vec4 vRim;\n#define shade vShade\n#define rimColor vRim.rgb\n#define rim vRim.a\n' + fs;
    m.vertexShader = 'attribute vec3 celShade;\nattribute vec4 celRim;\nvarying vec3 vShade;\nvarying vec4 vRim;\n' + m.vertexShader.replace('void main() {', 'void main() {\n  vShade = celShade;\n  vRim = celRim;');
    m.customProgramCacheKey = () => 'celv';
    m.userData = { shared: true };
    _celV = m;
  } catch (e) {
    _celV = null;
  }
  return _celV;
}
// ふちどり（gfx.js の outlineMat）の太さを、頂点の値で読む版
const olvCache = new Map();
function outlineV(minPx, maxPx) {
  const key = minPx + '|' + maxPx;
  if (olvCache.has(key)) return olvCache.get(key);
  let m = null;
  try {
    const base = outlineMat(0xffffff, 0.02, minPx, maxPx, true);
    const patch = (vs) => vs.replace('uniform float uOutline;', 'attribute float olw;').replace('float px = uOutline * sc', 'float px = olw * sc');
    // 置きかえができるか、先にためす
    const test = { uniforms: {}, vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader };
    base.onBeforeCompile(test);
    const done = patch(test.vertexShader);
    if (done.includes('attribute float olw;') && done.includes('float px = olw * sc') && !done.includes('uOutline')) {
      m = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide, vertexColors: true });
      m.userData = { shared: true, outline: [0, minPx, maxPx] };
      m.onBeforeCompile = (shader, r) => {
        base.onBeforeCompile(shader, r);
        shader.vertexShader = patch(shader.vertexShader);
      };
      m.customProgramCacheKey = () => 'outline2v';
    }
  } catch (e) {
    m = null;
  }
  olvCache.set(key, m);
  return m;
}

// まとめ方：色だけがちがう材質は「頂点の色」にして1つにする（キャラの描く回数がさらに減る）
// さらに、キャラのセル塗り（服・肌・髪・グローブ…）は「影の色・ふちの光の強さと色」も頂点に書いて、ぜんぶ1回で描く。
// ふちどりも「線の太さ」を頂点に書いて1回にする（見た目は前と同じ。1人 ~17回 → ~8回）
const vcBasic = new Map();
const CELV_KEYS = new Set(['char', 'shade', 'rim', 'rimColor']);
function groupOf(o) {
  const mat = o.material;
  const ro = o.renderOrder;
  const U = mat.userData || {};
  if (o.name === 'outline' && U.outline && !mat.vertexColors) {
    const [w, a, b] = U.outline;
    if (outlineV(a, b)) return { key: `olv|${a}|${b}|${ro}`, color: mat.color, olw: w, make: () => outlineV(a, b) };
    return { key: `ol|${w}|${a}|${b}|${ro}`, color: mat.color, make: () => outlineMat(0xffffff, w, a, b, true) };
  }
  if (U.celOpts && !mat.vertexColors && mat.uniforms && mat.uniforms.diffuse) {
    const opts = U.celOpts;
    if (opts.char && Object.keys(opts).every((k) => CELV_KEYS.has(k)) && celV()) {
      const u = mat.uniforms;
      return { key: 'celv|' + ro, color: u.diffuse.value, cel: [u.shade.value, u.rim.value, u.rimColor.value], make: () => celV() };
    }
    const k = optsKey(opts);
    return { key: 'cel|' + k + '|' + ro, color: mat.uniforms.diffuse.value, make: () => (opts.map ? texCel({ ...opts, vertexColors: true }) : toon(0xffffff, { ...opts, vertexColors: true })) };
  }
  if (mat.isMeshBasicMaterial && !mat.vertexColors) {
    const k = ['mb', mat.map ? mat.map.uuid : '', mat.transparent, mat.opacity, mat.depthWrite, mat.side, mat.polygonOffset, mat.polygonOffsetFactor, mat.polygonOffsetUnits, mat.blending, ro].join('|');
    return {
      key: k,
      color: mat.color,
      make: () => {
        if (vcBasic.has(k)) return vcBasic.get(k);
        const m = mat.clone();
        m.color.set(0xffffff);
        m.vertexColors = true;
        m.userData = { shared: true };
        vcBasic.set(k, m);
        return m;
      },
    };
  }
  return { key: mat.uuid + '|' + ro, color: null, make: () => mat };
}
// 1つの部品の形を、まとめ先の座標にして骨の番号をつける（color：頂点の色にする材質の色。
// it.cel：セル塗りの影の色・ふちの光 / it.olw：ふちどりの太さ。どちらも頂点に書く）
function skinGeo(src, m, bone, keepUv, keepCol, color, it = {}) {
  const g = new THREE.BufferGeometry();
  const pos = src.attributes.position.clone();
  const n = pos.count;
  let nor = src.attributes.normal ? src.attributes.normal.clone() : null;
  if (!nor) {
    const t = src.clone();
    t.computeVertexNormals();
    nor = t.attributes.normal.clone();
    t.dispose();
  }
  pos.applyMatrix4(m);
  nor.applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(m)); // 長さ1にもどす処理こみ
  g.setAttribute('position', pos);
  g.setAttribute('normal', nor);
  if (keepUv) g.setAttribute('uv', src.attributes.uv ? src.attributes.uv.clone() : new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  if (keepCol) {
    if (color) {
      const ca = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        ca[i * 3] = color.r;
        ca[i * 3 + 1] = color.g;
        ca[i * 3 + 2] = color.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(ca, 3));
    } else g.setAttribute('color', src.attributes.color ? src.attributes.color.clone() : new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  }
  if (it.cel) {
    const [sh, rim, rc] = it.cel;
    const a = new Float32Array(n * 3), b = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      a[i * 3] = sh.r;
      a[i * 3 + 1] = sh.g;
      a[i * 3 + 2] = sh.b;
      b[i * 4] = rc.r;
      b[i * 4 + 1] = rc.g;
      b[i * 4 + 2] = rc.b;
      b[i * 4 + 3] = rim;
    }
    g.setAttribute('celShade', new THREE.BufferAttribute(a, 3));
    g.setAttribute('celRim', new THREE.BufferAttribute(b, 4));
  }
  if (it.olw != null) g.setAttribute('olw', new THREE.BufferAttribute(new Float32Array(n).fill(it.olw), 1));
  // 三角形の番号（鏡うつしの部品は向きを反転）
  const flip = m.determinant() < 0;
  let idx;
  if (src.index) idx = Uint32Array.from(src.index.array);
  else {
    idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
  }
  if (flip) for (let i = 0; i + 2 < idx.length; i += 3) {
    const t = idx[i + 1];
    idx[i + 1] = idx[i + 2];
    idx[i + 2] = t;
  }
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    si[i * 4] = bone;
    sw[i * 4] = 1;
  }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  return g;
}

// 髪のつやの帯（球の緯度 th0 あたりを、顔のある前側だけ。ぎざぎざにする）
function hairShine(R, rad, th0, sx = 1) {
  const seg = 26;
  const pos = [];
  const idx = [];
  for (let i = 0; i <= seg; i++) {
    const u = i / seg;
    const ph = -1.45 + u * 2.9;
    const fade = Math.sin(u * Math.PI);
    const w = 0.07 * (0.5 + 0.5 * fade);
    const zig = i % 2 ? 0.035 : -0.01;
    for (const th of [th0 - w * 0.5 + zig * 0.4, th0 + w * 0.5 + zig]) {
      const v = new THREE.Vector3(Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph)).multiplyScalar(R * rad);
      headShape(v, R);
      v.x *= sx;
      pos.push(v.x, v.y, v.z);
    }
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

// 新しいキャラの胸の柄（256×256 にかく。太い線で、小さくても見えるように）
const BOLD = '900 {s}px "Arial Black", "Hiragino Sans", "Noto Sans CJK JP", "Yu Gothic", Arial, sans-serif';
const font = (n) => BOLD.replace('{s}', n);
function outlined(ctx, text, x, y, size, fill, line, lw = 12) {
  ctx.font = font(size);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = lw;
  ctx.strokeStyle = line;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}
const PRINTS = {
  // てつんど：ROCKETs のロケット（白い機体・火の噴射・星）
  tetsundo(ctx) {
    ctx.save();
    ctx.translate(128, 128);
    ctx.rotate(0.62);
    ctx.fillStyle = '#ff5a1f';
    ctx.beginPath(); ctx.moveTo(-26, 56); ctx.quadraticCurveTo(0, 140, 26, 56); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffd23a';
    ctx.beginPath(); ctx.moveTo(-14, 56); ctx.quadraticCurveTo(0, 112, 14, 56); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#f4f4f4';
    ctx.strokeStyle = '#e8331f';
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(0, -100); ctx.quadraticCurveTo(44, -50, 34, 58); ctx.lineTo(-34, 58); ctx.quadraticCurveTo(-44, -50, 0, -100); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e8331f';
    for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sd * 30, 10); ctx.lineTo(sd * 62, 64); ctx.lineTo(sd * 30, 56); ctx.closePath(); ctx.fill(); }
    ctx.fillStyle = '#3aa0ff';
    ctx.beginPath(); ctx.arc(0, -28, 17, 0, 6.3); ctx.fill();
    ctx.strokeStyle = '#1d1418'; ctx.lineWidth = 6; ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#ffd23a';
    star(ctx, 52, 60, 22, 4);
    star(ctx, 206, 196, 16, 4);
  },
  // コーダイ：レモンの輪切り（レモンサワー）と泡
  koudai(ctx) {
    ctx.fillStyle = '#ffd23a';
    ctx.strokeStyle = '#1d1418';
    ctx.lineWidth = 12;
    ctx.beginPath(); ctx.arc(120, 136, 86, 0, 6.3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff6b0';
    ctx.beginPath(); ctx.arc(120, 136, 64, 0, 6.3); ctx.fill();
    ctx.strokeStyle = '#ffd23a';
    ctx.lineWidth = 9;
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(120, 136); ctx.lineTo(120 + Math.cos(a) * 64, 136 + Math.sin(a) * 64); ctx.stroke(); }
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#3aa0ff';
    ctx.lineWidth = 6;
    for (const [x, y, r] of [[212, 52, 18], [184, 26, 11], [226, 96, 10]]) { ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill(); ctx.stroke(); }
  },
  // はやた：黒いTシャツの大きなプリント（赤いにじんだ文字と、水色と白の波）。写真の雰囲気だけ（絵はオリジナル）
  hayata(ctx) {
    ctx.save();
    // 水色と白の波（左下から右上へ）
    ctx.lineCap = 'round';
    for (const [c, w, o] of [['#7fd3cf', 30, 0], ['#f4f1ea', 16, 10], ['#3f9c9a', 9, 22]]) {
      ctx.strokeStyle = c;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(26, 238 - o);
      ctx.bezierCurveTo(70, 160 - o, 30, 120 - o, 96, 84 - o);
      ctx.bezierCurveTo(150, 54 - o, 120, 150 - o, 178, 150 - o);
      ctx.stroke();
    }
    // 赤い文字（にじんで、下にたれる）
    ctx.translate(140, 70);
    ctx.rotate(-0.08);
    ctx.font = font(52);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#d8262c';
    ctx.fillText('HAYATA', 0, 0);
    const r = rng(29);
    for (let i = 0; i < 11; i++) {
      const x = -100 + i * 19 + r() * 6;
      ctx.fillRect(x, 16, 4.5, 10 + r() * 30);
      ctx.beginPath();
      ctx.arc(x + 2.2, 26 + r() * 36, 3.6, 0, 6.3);
      ctx.fill();
    }
    ctx.restore();
  },
  // なお：写真のスポーツTシャツの、青いななめの太字（名前の「NAO」にした）と、明るい青の切りこみ
  takanobu(ctx) {
    ctx.save();
    ctx.translate(128, 132);
    ctx.transform(1, 0, -0.26, 1, 0, 0);
    ctx.font = font(104);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#2350c8';
    ctx.fillText('NAO', 0, 0);
    ctx.restore();
    // ななめの切りこみ（明るい青）
    ctx.save();
    ctx.translate(128, 132);
    ctx.rotate(-0.32);
    ctx.fillStyle = '#e1e5e4';
    ctx.fillRect(-150, -6, 300, 9);
    ctx.fillStyle = '#5aa9ff';
    ctx.fillRect(-150, 6, 300, 7);
    ctx.restore();
  },
  // こうた：盾の校章に、かみなり（短気）
  kouta(ctx) {
    ctx.fillStyle = '#23345e';
    ctx.strokeStyle = '#8fd0ff';
    ctx.lineWidth = 14;
    ctx.beginPath(); ctx.moveTo(128, 16); ctx.lineTo(226, 46); ctx.lineTo(212, 158); ctx.lineTo(128, 240); ctx.lineTo(44, 158); ctx.lineTo(30, 46); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffd23a';
    ctx.beginPath(); ctx.moveTo(146, 44); ctx.lineTo(84, 140); ctx.lineTo(124, 140); ctx.lineTo(104, 214); ctx.lineTo(174, 108); ctx.lineTo(132, 108); ctx.closePath(); ctx.fill();
  },
  // まさし：ミントのハートとキラキラ（K-POP）
  masashi(ctx) {
    ctx.fillStyle = '#48d6a0';
    ctx.strokeStyle = '#1d1418';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(128, 222);
    ctx.bezierCurveTo(20, 150, 20, 60, 80, 52);
    ctx.bezierCurveTo(108, 48, 124, 66, 128, 86);
    ctx.bezierCurveTo(132, 66, 148, 48, 176, 52);
    ctx.bezierCurveTo(236, 60, 236, 150, 128, 222);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffffff';
    star(ctx, 92, 104, 24, 4);
    star(ctx, 214, 40, 20, 4);
  },
  // こうせい：バスケのユニフォームの背番号
  kousei(ctx) {
    outlined(ctx, '5', 128, 136, 236, '#e8331f', '#ffffff', 22);
  },
  // しょうた：上半身はだか（写真のまま）。胸と腹筋のうすい線・おへそ
  shouta(ctx) {
    ctx.strokeStyle = 'rgba(150,80,60,0.32)';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    for (const sd of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(128 + sd * 12, 64);
      ctx.quadraticCurveTo(128 + sd * 52, 82, 128 + sd * 86, 52);
      ctx.stroke();
    }
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(128, 76);
    ctx.lineTo(128, 196);
    ctx.stroke();
    for (const y of [118, 152]) {
      for (const sd of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(128 + sd * 8, y);
        ctx.quadraticCurveTo(128 + sd * 22, y + 4, 128 + sd * 34, y - 2);
        ctx.stroke();
      }
    }
    ctx.fillStyle = 'rgba(140,70,55,0.5)';
    ctx.beginPath();
    ctx.ellipse(128, 214, 4, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  },
  // ちじわ：体温計（風邪）
  chijiwa(ctx) {
    ctx.save();
    ctx.translate(128, 128);
    ctx.rotate(-0.6);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#1d1418';
    ctx.lineWidth = 12;
    ctx.beginPath(); ctx.moveTo(-24, 42); ctx.lineTo(-24, -80); ctx.arc(0, -80, 24, Math.PI, 0); ctx.lineTo(24, 42); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 78, 38, 0, 6.3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e8331f';
    ctx.beginPath(); ctx.arc(0, 78, 24, 0, 6.3); ctx.fill();
    ctx.fillRect(-9, -40, 18, 120);
    ctx.fillStyle = '#1d1418';
    for (let i = 0; i < 4; i++) ctx.fillRect(10, -84 + i * 24, 14, 6);
    ctx.restore();
    ctx.fillStyle = 'rgba(150,215,255,0.95)';
    ctx.beginPath(); ctx.moveTo(200, 150); ctx.quadraticCurveTo(222, 186, 200, 200); ctx.quadraticCurveTo(178, 186, 200, 150); ctx.fill();
  },
  // ナオT：胸の小さな白い文字（写真のTシャツのワンポイント）。T は Tシャツの T
  naot(ctx) {
    ctx.save();
    ctx.translate(128, 128);
    ctx.rotate(-0.12);
    ctx.font = 'italic 700 150px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f2f1ee';
    ctx.fillText('T', 6, -4);
    ctx.strokeStyle = '#f2f1ee';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-74, 58);
    ctx.bezierCurveTo(-20, 86, 40, 40, 88, 66);
    ctx.stroke();
    ctx.restore();
  },
  // トリキ：白い小鳥のワッペン
  toriki(ctx) {
    ctx.fillStyle = '#1f3f8f';
    ctx.strokeStyle = '#f6f6f2';
    ctx.lineWidth = 14;
    ctx.beginPath(); ctx.arc(128, 128, 108, 0, 6.3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.ellipse(124, 144, 66, 52, 0, 0, 6.3); ctx.fill();
    ctx.beginPath(); ctx.arc(160, 98, 34, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#ff9f1a';
    ctx.beginPath(); ctx.moveTo(190, 92); ctx.lineTo(222, 104); ctx.lineTo(190, 114); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#1d1418';
    ctx.beginPath(); ctx.arc(166, 92, 8, 0, 6.3); ctx.fill();
    ctx.strokeStyle = '#3aa0ff';
    ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(84, 140); ctx.quadraticCurveTo(116, 176, 150, 146); ctx.stroke();
  },
  // みのり：にこにこの水のしずく
  minori(ctx) {
    ctx.fillStyle = '#5bb8ff';
    ctx.strokeStyle = '#1d1418';
    ctx.lineWidth = 12;
    ctx.beginPath(); ctx.moveTo(128, 18); ctx.bezierCurveTo(150, 70, 214, 118, 214, 166); ctx.bezierCurveTo(214, 214, 174, 240, 128, 240); ctx.bezierCurveTo(82, 240, 42, 214, 42, 166); ctx.bezierCurveTo(42, 118, 106, 70, 128, 18); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#1d1418';
    ctx.beginPath(); ctx.arc(100, 168, 10, 0, 6.3); ctx.arc(156, 168, 10, 0, 6.3); ctx.fill();
    ctx.strokeStyle = '#1d1418';
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.arc(128, 186, 22, 0.3, Math.PI - 0.3); ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.ellipse(92, 126, 12, 20, 0.5, 0, 6.3); ctx.fill();
  },
  // まな：ハートの吹き出し（よく電話する）
  mana(ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#1d1418';
    ctx.lineWidth = 12;
    ctx.beginPath(); ctx.ellipse(128, 110, 104, 80, 0, 0, 6.3); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(70, 172); ctx.lineTo(52, 232); ctx.lineTo(112, 186); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.ellipse(128, 110, 96, 72, 0, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#ff5f8f';
    ctx.beginPath(); ctx.moveTo(128, 160); ctx.bezierCurveTo(68, 120, 80, 62, 114, 68); ctx.bezierCurveTo(122, 70, 126, 78, 128, 86); ctx.bezierCurveTo(130, 78, 134, 70, 142, 68); ctx.bezierCurveTo(176, 62, 188, 120, 128, 160); ctx.fill();
  },
  // あやな：小さな花（デイジー）
  ayana(ctx) {
    ctx.fillStyle = '#5e8f3a';
    ctx.beginPath(); ctx.ellipse(80, 196, 44, 18, -0.6, 0, 6.3); ctx.fill();
    ctx.beginPath(); ctx.ellipse(178, 200, 40, 16, 0.6, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#1d1418';
    ctx.lineWidth = 7;
    for (let i = 0; i < 8; i++) {
      ctx.save(); ctx.translate(128, 120); ctx.rotate((i / 8) * Math.PI * 2);
      ctx.beginPath(); ctx.ellipse(0, -54, 22, 44, 0, 0, 6.3); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = '#ffc21a';
    ctx.beginPath(); ctx.arc(128, 120, 34, 0, 6.3); ctx.fill(); ctx.stroke();
  },
  // ゆか：赤い星のワッペン（スポーティー）
  yuka(ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#1d1418';
    ctx.lineWidth = 12;
    ctx.beginPath(); ctx.arc(128, 128, 104, 0, 6.3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e8334a';
    star(ctx, 128, 136, 86, 5);
  },
};
// 胸のプリントの場所と大きさ（x：キャラの左が＋ / y：胸の高さ / size：大きさ）。書いていないキャラはまん中
Object.assign(PRINT_AT, {
  tetsundo: { y: 0.11, size: 1.2 },
  koudai: { y: 0.1, size: 0.82 },
  hayata: { x: -0.01, y: 0.12, size: 1.6 },
  takanobu: { y: 0.17, size: 1.45 },
  kouta: { x: 0.085, y: 0.13, size: 0.5 },
  masashi: { y: 0.1, size: 1.05 },
  kousei: { y: 0.03, size: 1.05, back: true, backY: 0.12 },
  shouta: { y: 0.13, size: 1.95 },
  chijiwa: { y: 0.11, size: 0.82 },
  naot: { x: 0.08, y: 0.22, size: 0.55 },
  toriki: { x: 0.085, y: 0.2, size: 0.55 },
  minori: { y: 0.1, size: 0.62 },
  mana: { y: 0.1, size: 0.95 },
  ayana: { y: 0.1, size: 0.7 },
  yuka: { x: 0.08, y: 0.15, size: 0.55 },
});
// 胸のプリント（キャラごとの柄）
const printCache = new Map();
function chestPrint(def) {
  if (printCache.has(def.id)) return printCache.get(def.id);
  const t = canvasTex(256, 256, (ctx) => {
    ctx.clearRect(0, 0, 256, 256);
    ctx.lineJoin = 'round';
    if (def.id === 'tora') {
      // ドラ：トラのしまの盾マーク
      ctx.fillStyle = '#ff8a1f';
      ctx.strokeStyle = '#1d1418';
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.moveTo(128, 18); ctx.lineTo(222, 54); ctx.lineTo(206, 168); ctx.lineTo(128, 236); ctx.lineTo(50, 168); ctx.lineTo(34, 54); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#1d1418';
      for (const [x, y, r] of [[70, 80, 0.5], [186, 80, -0.5], [60, 140, 0.3], [196, 140, -0.3]]) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(r);
        ctx.beginPath(); ctx.moveTo(-24, -6); ctx.quadraticCurveTo(0, -18, 26, 0); ctx.quadraticCurveTo(0, -4, -24, 8); ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = '#fff';
      ctx.font = '900 104px "Arial Black", Arial, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 10; ctx.strokeText('D', 128, 132); ctx.fillText('D', 128, 132);
    } else if (def.id === 'even') {
      // エブン：波と水しぶき
      ctx.strokeStyle = '#3fb7ff';
      ctx.lineWidth = 22; ctx.lineCap = 'round';
      for (let k = 0; k < 2; k++) {
        ctx.beginPath();
        for (let x = 20; x <= 236; x += 6) ctx.lineTo(x, 110 + k * 56 + Math.sin(x / 28) * 18);
        ctx.stroke();
      }
      ctx.fillStyle = '#dff4ff';
      for (const [x, y, r] of [[70, 52, 13], [104, 34, 9], [150, 44, 11]]) { ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill(); }
    } else if (def.id === 'aomachi') {
      // アオッチ：ペン先（まんがを描く）
      ctx.fillStyle = '#1d1418';
      ctx.beginPath(); ctx.moveTo(128, 24); ctx.lineTo(196, 128); ctx.lineTo(128, 232); ctx.lineTo(60, 128); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.moveTo(128, 52); ctx.lineTo(176, 128); ctx.lineTo(128, 204); ctx.lineTo(80, 128); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#1d1418';
      ctx.beginPath(); ctx.arc(128, 120, 16, 0, 6.3); ctx.fill();
      ctx.fillRect(124, 120, 8, 84);
    } else if (PRINTS[def.id]) {
      PRINTS[def.id](ctx);
    } else {
      // 知らないキャラ：白い丸に星
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#1d1418';
      ctx.lineWidth = 12;
      ctx.beginPath(); ctx.arc(128, 128, 100, 0, 6.3); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffc93c';
      star(ctx, 128, 132, 78, 5);
      ctx.stroke();
    }
  });
  t.userData.shared = true;
  printCache.set(def.id, t);
  return t;
}

// ===== 髪の新しいスタイル =====
// 頭の帽子（髪のはえぎわ）。front：おでこの線の高さ / side：もみあげ / nape：えりあし（どれも頭の半径の何倍か）
function capGeo(HP, o = {}) {
  const R = HEAD_R;
  const rad = o.rad || 1.07;
  const capG = new THREE.SphereGeometry(R * rad, 34, 26, 0, Math.PI * 2, 0, Math.PI * (o.theta || 0.84));
  const p = capG.attributes.position;
  const v = new THREE.Vector3();
  const fl = R * (o.front != null ? o.front : 0.36);
  const sideY = R * (o.side != null ? o.side : -0.32);
  const napeY = R * (o.nape != null ? o.nape : -0.74);
  const part = o.part || 0; // 分け目のくぼみ（az の位置）
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    headShape(v, R, HP);
    const az = Math.abs(Math.atan2(v.x, v.z));
    const f0 = fl - Math.min(az, 0.9) * R * 0.1;
    let lim;
    if (az < 0.9) lim = f0;
    else if (az < 1.75) lim = f0 + (sideY - f0) * smooth(0.9, 1.75, az);
    else lim = sideY + (napeY - sideY) * smooth(1.75, 2.6, az);
    if (v.y < lim) {
      v.y = lim;
      const rr = Math.sqrt(Math.max(0, (R * rad) ** 2 - lim * lim)) / Math.max(1e-4, Math.hypot(v.x, v.z));
      v.x *= Math.min(1, rr);
      v.z *= Math.min(1, rr);
    }
    // てっぺんのふくらみ（ボリューム）
    if (o.vol && v.y > 0) {
      const k = 1 + o.vol * (v.y / (R * rad)) ** 2;
      v.x *= k;
      v.z *= k;
      v.y *= 1 + o.vol * 0.5 * (v.y / (R * rad));
    }
    if (part) {
      const a = Math.atan2(v.x, v.z);
      const d = Math.abs(a - part);
      if (v.y > R * 0.3 && v.z > -R * 0.2 && d < 0.12) {
        const k = 1 - 0.035 * (1 - d / 0.12);
        v.x *= k;
        v.y *= k;
        v.z *= k;
      }
    }
    p.setXYZ(i, v.x, v.y, v.z);
  }
  capG.computeVertexNormals();
  return capG;
}
// 毛すじの絵（髪の殻に貼る）。たての線＝球の経線なので、てっぺんから すそへ流れる
const hairTexCache = new Map();
function hairTex(color, kind = 'down') {
  const key = color + '|' + kind;
  if (hairTexCache.has(key)) return hairTexCache.get(key);
  const t = canvasTex(512, 256, (ctx) => {
    const c = new THREE.Color(color);
    const hex = (k, l = 0) => '#' + c.clone().multiplyScalar(k).lerp(new THREE.Color(0xffffff), l).getHexString();
    ctx.fillStyle = hex(1);
    ctx.fillRect(0, 0, 512, 256);
    const r = rng(kind === 'down' ? 61 : 67);
    const dark = c.getHSL({}).l < 0.2;
    if (kind === 'slant') {
      // 分け目から横へなでつけた髪（ななめのくしの目）
      const n = 22;
      for (let i = 0; i < n; i++) {
        const x = (i / n) * 512 + (r() - 0.5) * 4;
        for (const [col, a, wdt, dx] of [[hex(0.55), 0.6, 3, 0], [hex(1, 0.28), 0.42, 2, 6]]) {
          ctx.strokeStyle = col;
          ctx.globalAlpha = a;
          ctx.lineWidth = wdt;
          for (const o of [-512, 0, 512]) {
            ctx.beginPath();
            ctx.moveTo(x + dx + o, 0);
            ctx.bezierCurveTo(x + dx + o + 40, 90, x + dx + o + 90, 170, x + dx + o + 150, 256);
            ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;
      return;
    }
    if (kind === 'comb') {
      // オールバック：くしの目（等間かくの暗いみぞと、つやの線）
      const n = 24;
      for (let i = 0; i < n; i++) {
        const x = (i / n) * 512 + (r() - 0.5) * 4;
        ctx.strokeStyle = hex(0.55);
        ctx.globalAlpha = 0.62;
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.bezierCurveTo(x + 4, 90, x - 4, 170, x + 2, 256);
        ctx.stroke();
        ctx.strokeStyle = hex(1, 0.28);
        ctx.globalAlpha = 0.42;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + 5, 0);
        ctx.bezierCurveTo(x + 9, 90, x + 1, 170, x + 7, 256);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      return;
    }
    // 毛束のかたまり（太い明暗）
    for (let i = 0; i < 40; i++) {
      const x = r() * 512, w = 6 + r() * 16;
      ctx.fillStyle = r() < 0.5 ? hex(0.72) : dark ? hex(1, 0.1) : hex(1.12);
      ctx.globalAlpha = 0.38;
      ctx.beginPath();
      ctx.moveTo(x - w * 0.15, 0);
      ctx.quadraticCurveTo(x + (r() - 0.5) * 20, 128, x - w * 0.5, 256);
      ctx.lineTo(x + w * 0.5, 256);
      ctx.quadraticCurveTo(x + (r() - 0.5) * 20 + w * 0.3, 128, x + w * 0.15, 0);
      ctx.fill();
    }
    // 細い毛すじ
    ctx.globalAlpha = 1;
    for (let i = 0; i < 110; i++) {
      const x = r() * 512;
      const light = r() < 0.45;
      ctx.strokeStyle = light ? (dark ? hex(1, 0.2) : hex(1.25, 0.08)) : hex(0.6);
      ctx.globalAlpha = light ? 0.32 : 0.55;
      ctx.lineWidth = 0.8 + r() * 1.8;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + (r() - 0.5) * 14, 80, x + (r() - 0.5) * 18, 170, x + (r() - 0.5) * 10, 256);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  });
  t.wrapS = THREE.RepeatWrapping;
  t.userData.shared = true;
  hairTexCache.set(key, t);
  return t;
}
// 髪を作る道具：頭の表面の場所（az：0＝前・＋＝キャラの左 / el：0＝目の高さ・＋＝上）から毛束を生やす
function hairKit(hair, look, mat, line, K) {
  const R = HEAD_R, HP = K ? K.HP : null;
  const add = (geo, w = 0.009, parent = hair) => {
    const m = mesh(geo, mat, line, w);
    parent.add(m);
    return m;
  };
  const surf = (az, el, rr = 1.05) => headShape(new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(R * rr), R, HP);
  // 毛束：o = { pitch：表面から外へ, yaw：横へ（＋で az の増える向き）, bend, flat, twist, rr：根元の深さ, dir：向きを直接, curl：まがる向き, parent }
  const strand = (az, el, len, rad, o = {}) => {
    const er = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    const eu = new THREE.Vector3(-Math.sin(az) * Math.sin(el), Math.cos(el), -Math.cos(az) * Math.sin(el));
    const ea = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
    const pi = o.pitch || 0, ya = o.yaw || 0;
    const D = o.dir ? new THREE.Vector3(...o.dir) : eu.clone().multiplyScalar(-Math.cos(pi) * Math.cos(ya)).addScaledVector(ea, Math.cos(pi) * Math.sin(ya)).addScaledVector(er, Math.sin(pi));
    const curl = o.curl ? new THREE.Vector3(...o.curl) : er.clone().negate();
    const m = add(strandGeo(len, rad, o.bend != null ? o.bend : 0.5, o.flat != null ? o.flat : 0.5, o.twist || 0), o.w || 0.009, o.parent || hair);
    aimMesh(m, D, curl);
    const p = surf(az, el, o.rr || 1.06);
    if (o.parent && o.parent !== hair) p.sub(o.parent.position);
    m.position.copy(p);
    return m;
  };
  // ゆれる髪（後ろ髪・ポニーテール）の入れ物。頭のかたむきを打ち消して、体にそって下がる（poseModel）
  // fly：飛ぶときのなびき方（＋：背中からうかす／−：足の方へ流す）
  const pivot = (x, y, z, k = 0.85, sway = 0.06, fly = 0.25) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    hair.add(g);
    if (K) K.hairPivots.push({ g, k, sway, fly });
    return g;
  };
  const shine = (rad = 1.075, th = 0.6, sx = 1) => {
    const shineM = new THREE.MeshBasicMaterial({ color: lighten('#' + new THREE.Color(look.hair).getHexString(), 0.5), transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const m = new THREE.Mesh(hairShine(R, rad, th, sx), shineM);
    m.renderOrder = 2;
    hair.add(m);
    return m;
  };
  // 毛すじの絵を貼った髪（殻に使う）。kind：'down'（上から下へ）/ 'back'（前から後ろへ）
  const addTex = (geo, w = 0.012, kind = 'down') => {
    const m = mesh(geo, K ? texCel({ char: true, shade: 'hair', rim: 0.6, rimColor: K.rimHex, map: hairTex(look.hair, kind) }) : mat, line, w);
    hair.add(m);
    return m;
  };
  return { R, HP, add, addTex, surf, strand, pivot, shine };
}
// 前髪の列（az を a0〜a1 に n 本）
function fringe(H, n, a0, a1, el, len, rad, o = {}) {
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const az = a0 + (a1 - a0) * t;
    const L = typeof len === 'function' ? len(t, i) : len;
    H.strand(az, typeof el === 'function' ? el(t, i) : el, L, rad, { ...o, yaw: typeof o.yaw === 'function' ? o.yaw(t, i) : o.yaw || 0 });
  }
}
const HAIR_STYLES = {
  // てつんど：ふつうの短い黒髪（前髪・上・横・後ろに毛束をかさねる）
  short(hair, look, mat, line, K) {
    const H = hairKit(hair, look, mat, line, K);
    H.add(capGeo(H.HP, { front: 0.38, vol: 0.06 }), 0.012);
    fringe(H, 6, -0.62, 0.62, 0.64, (t, i) => 0.105 + (i % 2) * 0.02, 0.056, { pitch: 0.2, bend: 0.65, flat: 0.42, yaw: (t, i) => (i % 2 ? 0.25 : -0.2) });
    fringe(H, 5, -0.8, 0.8, 0.98, 0.13, 0.065, { pitch: 0.28, bend: 0.55, flat: 0.45, yaw: (t) => (t - 0.5) * 0.6 });
    for (const [az, yaw] of [[0.5, Math.PI - 0.5], [-0.5, Math.PI + 0.5], [2.4, 0.3], [-2.4, -0.3]]) H.strand(az, 1.3, 0.12, 0.065, { pitch: 0.42, yaw, bend: 0.5 });
    for (const sd of [-1, 1]) for (const [az, el] of [[1.3, 0.42], [1.75, 0.4], [2.25, 0.5]]) H.strand(sd * az, el, 0.095, 0.058, { pitch: 0.14, bend: 0.45, flat: 0.45 });
    for (const az of [2.75, -2.75, Math.PI]) H.strand(az, 0.55, 0.12, 0.062, { pitch: 0.16, bend: 0.45, flat: 0.45 });
    H.shine(1.085, 0.6);
  },
  // ごく短い坊主（はちまきの上に、短い毛）。v1.5 のなお（いまは使っていない）
  buzz(hair, look, mat, line, K) {
    const H = hairKit(hair, look, mat, line, K);
    H.add(capGeo(H.HP, { front: 0.32, rad: 1.045, side: -0.36, nape: -0.7 }), 0.012);
    for (let i = 0; i < 7; i++) H.strand(-0.9 + i * 0.3, 1.15 - Math.abs(i - 3) * 0.04, 0.05, 0.052, { pitch: 0.9, bend: 0.2, rr: 1.03 });
    for (const az of [2.2, -2.2, Math.PI, 1.4, -1.4]) H.strand(az, 1.05, 0.05, 0.052, { pitch: 0.8, bend: 0.2, rr: 1.03 });
    H.shine(1.05, 0.62);
  },
  // こうた：きちんとした七三分け（左で分けて、大きく右へ流す）
  side(hair, look, mat, line, K) {
    const H = hairKit(hair, look, mat, line, K);
    H.add(capGeo(H.HP, { front: 0.4, vol: 0.06, part: 0.55 }), 0.012);
    for (let i = 0; i < 5; i++) H.strand(0.45 - i * 0.05, 1.12 - i * 0.12, 0.2, 0.072, { pitch: 0.22, yaw: -1.25 + i * 0.1, bend: 0.45, flat: 0.36 });
    H.strand(0.32, 0.8, 0.19, 0.066, { pitch: 0.2, yaw: -1.35, bend: 0.5, flat: 0.36 });
    H.strand(0.05, 0.72, 0.12, 0.056, { pitch: 0.2, yaw: -1.2, bend: 0.55, flat: 0.38 });
    for (const [az, el] of [[0.75, 1.0], [0.95, 0.78], [1.15, 0.58]]) H.strand(az, el, 0.11, 0.056, { pitch: 0.18, yaw: 0.7, bend: 0.45, flat: 0.38 });
    for (const sd of [-1, 1]) for (const [az, el] of [[1.5, 0.4], [1.9, 0.42]]) H.strand(sd * az, el, 0.085, 0.056, { pitch: 0.1, bend: 0.4, flat: 0.4 });
    for (const az of [2.4, -2.4, 2.8, -2.8, Math.PI]) H.strand(az, 0.6, 0.12, 0.062, { pitch: 0.12, bend: 0.4, flat: 0.42 });
    H.shine(1.085, 0.62);
  },
  // コーダイ：茶色の、ゆるいパーマの中くらいの髪（耳にかかる）
  wavy(hair, look, mat, line, K) {
    const H = hairKit(hair, look, mat, line, K);
    H.add(capGeo(H.HP, { front: 0.34, side: -0.45, nape: -0.86, vol: 0.1 }), 0.012);
    fringe(H, 6, -0.6, 0.6, 0.7, (t, i) => 0.135 + (i % 2) * 0.02, 0.06, { pitch: 0.22, bend: 0.7, flat: 0.42, twist: 1.4, yaw: (t, i) => (i % 2 ? 0.3 : -0.3) });
    fringe(H, 5, -0.85, 0.85, 1.05, 0.15, 0.068, { pitch: 0.3, bend: 0.6, flat: 0.45, twist: 1.2, yaw: (t) => (t - 0.5) * 0.7 });
    for (const sd of [-1, 1]) for (const [az, el, len] of [[1.2, 0.5, 0.16], [1.6, 0.48, 0.17], [2.05, 0.5, 0.17]]) H.strand(sd * az, el, len, 0.064, { pitch: 0.13, yaw: -sd * 0.1, bend: 0.35, flat: 0.45, twist: 1.6 * sd });
    for (const az of [2.55, -2.55, Math.PI]) H.strand(az, 0.5, 0.18, 0.07, { pitch: 0.13, bend: 0.35, flat: 0.45, twist: 1.2 });
    for (const [az, yaw] of [[0.4, 2.6], [-0.4, -2.6], [Math.PI, 0]]) H.strand(az, 1.32, 0.13, 0.07, { pitch: 0.45, yaw, bend: 0.6, twist: 1.5 });
    H.shine(1.1, 0.6);
  },
  // はやた：長めのセンター分け（前髪が左右に流れて、ほおまで）
  centerLong(hair, look, mat, line, K) {
    const H = hairKit(hair, look, mat, line, K);
    H.add(capGeo(H.HP, { front: 0.42, side: -0.42, nape: -0.82, vol: 0.12, part: 0.001 }), 0.012);
    for (const sd of [-1, 1]) {
      H.strand(sd * 0.07, 1.02, 0.25, 0.072, { pitch: 0.24, yaw: sd * 0.95, bend: 0.48, flat: 0.38 });
      H.strand(sd * 0.28, 0.86, 0.23, 0.066, { pitch: 0.2, yaw: sd * 0.6, bend: 0.48, flat: 0.38 });
      H.strand(sd * 0.6, 0.66, 0.21, 0.06, { pitch: 0.15, yaw: sd * 0.25, bend: 0.45, flat: 0.4 });
      H.strand(sd * 1.2, 0.48, 0.18, 0.062, { pitch: 0.12, yaw: -sd * 0.08, bend: 0.4, flat: 0.42 });
      H.strand(sd * 1.75, 0.45, 0.17, 0.064, { pitch: 0.12, bend: 0.4, flat: 0.42 });
      H.strand(sd * 0.45, 1.28, 0.15, 0.072, { pitch: 0.36, yaw: sd * 0.7, bend: 0.5 });
      H.strand(sd * 2.3, 0.55, 0.15, 0.066, { pitch: 0.13, bend: 0.4, flat: 0.42 });
    }
    H.strand(Math.PI, 0.55, 0.16, 0.07, { pitch: 0.13, bend: 0.4, flat: 0.42 });
    H.strand(Math.PI, 1.25, 0.13, 0.07, { pitch: 0.4, bend: 0.5 });
    H.shine(1.12, 0.62);
  },
  // まさし：K-POPの重めの前髪（目の上まで）と、長めのえりあし（ウルフ）
  kpop(hair, look, mat, line, K) {
    const H = hairKit(hair, look, mat, line, K);
    H.add(capGeo(H.HP, { front: 0.44, side: -0.5, nape: -0.95, vol: 0.12 }), 0.012);
    fringe(H, 7, -0.66, 0.66, 0.84, (t, i) => 0.178 + (i % 2) * 0.012, 0.056, { pitch: 0.2, bend: 0.62, flat: 0.34, yaw: (t) => (t - 0.5) * 0.3 });
    fringe(H, 5, -0.7, 0.7, 1.15, 0.17, 0.07, { pitch: 0.26, bend: 0.55, flat: 0.4, yaw: (t) => (t - 0.5) * 0.5 });
    for (const sd of [-1, 1]) {
      H.strand(sd * 1.08, 0.55, 0.19, 0.058, { pitch: 0.14, yaw: -sd * 0.15, bend: 0.5, flat: 0.4 });
      H.strand(sd * 1.95, 0.5, 0.2, 0.064, { pitch: 0.13, bend: 0.42, flat: 0.42 });
      H.strand(sd * 2.45, 0.35, 0.22, 0.064, { pitch: 0.1, bend: 0.3, flat: 0.42 });
    }
    H.strand(Math.PI, 0.3, 0.25, 0.07, { pitch: 0.1, bend: 0.3, flat: 0.42 });
    for (const az of [2.6, -2.6, Math.PI]) H.strand(az, 1.1, 0.15, 0.07, { pitch: 0.3, bend: 0.5 });
    H.shine(1.12, 0.6);
  },
  // しょうた：おしゃれなパーマ（くるくるの毛束が上と前に）
  perm(hair, look, mat, line, K) {
    const H = hairKit(hair, look, mat, line, K);
    H.add(capGeo(H.HP, { front: 0.38, side: -0.38, nape: -0.78, vol: 0.12 }), 0.012);
    const r = rng(7);
    const rows = [[0.68, 6, 0.75], [0.98, 7, 1.0], [1.28, 5, 0.95], [1.5, 2, 0.6]];
    for (const [el, n, spread] of rows)
      for (let i = 0; i < n; i++) {
        const az = n === 1 ? 0 : -Math.PI * spread + ((Math.PI * 2 * spread) / (spread >= 1 ? n : n - 1)) * i + (r() - 0.5) * 0.15;
        H.strand(az, el, 0.105 + r() * 0.025, 0.062, { pitch: 0.32 + r() * 0.2, yaw: (r() - 0.5) * 1.0, bend: 1.25, flat: 0.55, twist: 3.5 + r() * 1.5, rr: 1.075 });
      }
    for (const sd of [-1, 1]) for (const az of [1.45, 1.9]) H.strand(sd * az, 0.42, 0.085, 0.055, { pitch: 0.14, bend: 0.8, twist: 2.4, rr: 1.065 });
    H.shine(1.12, 0.62);
  },
  // ちじわ：ぼさぼさの寝ぐせ（いろんな向きにはねる・アホ毛）
  bedhead(hair, look, mat, line, K) {
    const H = hairKit(hair, look, mat, line, K);
    H.add(capGeo(H.HP, { front: 0.36, side: -0.4, nape: -0.8, vol: 0.1 }), 0.012);
    const r = rng(23);
    for (let i = 0; i < 18; i++) {
      const az = (i / 18) * Math.PI * 2 - Math.PI + (r() - 0.5) * 0.3;
      const el = 0.4 + r() * 0.95;
      H.strand(az, el, 0.1 + r() * 0.08, 0.052 + r() * 0.015, { pitch: 0.3 + r() * 0.9, yaw: (r() - 0.5) * 2.2, bend: (r() - 0.35) * 1.4, flat: 0.5, twist: (r() - 0.5) * 2 });
    }
    fringe(H, 5, -0.55, 0.5, 0.66, (t, i) => 0.1 + (i % 2) * 0.04, 0.052, { pitch: 0.28, bend: 0.6, flat: 0.42, yaw: (t, i) => (i % 2 ? 0.4 : -0.35) });
    for (const sd of [-1, 1]) H.strand(sd * 1.5, 0.4, 0.1, 0.055, { pitch: 0.35, yaw: sd * 0.6, bend: -0.4, flat: 0.45 });
    H.strand(0.25, 1.35, 0.17, 0.02, { pitch: 1.2, yaw: 0.6, bend: 1.9, flat: 0.6 });
    H.strand(-0.6, 1.2, 0.13, 0.018, { pitch: 1.1, yaw: -0.9, bend: -1.6, flat: 0.6 });
    H.shine(1.1, 0.62);
  },
  // ナオT：マンバン（髪を後ろでまとめたおだんご）
  manbun(hair, look, mat, line, K) {
    const H = hairKit(hair, look, mat, line, K);
    H.add(capGeo(H.HP, { front: 0.46, side: -0.3, nape: -0.62, rad: 1.06 }), 0.012);
    // 後ろへなでつけた毛束
    for (let i = 0; i < 7; i++) {
      const az = -0.75 + i * 0.25;
      H.strand(az, 0.58, 0.22, 0.064, { pitch: 0.06, yaw: Math.PI - az * 0.3, bend: 0.32, flat: 0.3, rr: 1.065 });
    }
    for (const sd of [-1, 1]) {
      H.strand(sd * 1.3, 0.42, 0.2, 0.064, { pitch: 0.06, yaw: Math.PI - sd * 0.55, bend: 0.3, flat: 0.3, rr: 1.065 });
      H.strand(sd * 1.85, 0.3, 0.17, 0.064, { pitch: 0.06, yaw: Math.PI - sd * 0.9, bend: 0.3, flat: 0.3, rr: 1.065 });
      H.strand(sd * 0.95, 0.42, 0.11, 0.018, { pitch: 0.15, yaw: sd * 0.2, bend: 0.5, flat: 0.6 });
    }
    // おだんご＋ゴム
    const bp = H.surf(Math.PI, 0.82, 1.16);
    const bun = H.add(new THREE.SphereGeometry(0.07, 16, 12), 0.01);
    bun.position.copy(bp);
    bun.scale.set(1.08, 0.92, 1.0);
    for (let i = 0; i < 3; i++) {
      const w = H.add(new THREE.TorusGeometry(0.052 - i * 0.013, 0.017, 6, 16), 0.006);
      w.position.copy(bp);
      w.rotation.set(0.6 + i * 0.5, i * 0.9, 0);
    }
    const tie = K.part(new THREE.TorusGeometry(0.046, 0.011, 6, 16), 0x2b2320, 0.004);
    tie.position.copy(H.surf(Math.PI, 0.72, 1.07));
    tie.rotation.x = -0.72 + Math.PI / 2;
    hair.add(tie);
    H.shine(1.075, 0.66);
  },
  // トリキ・こうせい：短いツンツン（前と上を立てる）
  spiky(hair, look, mat, line, K) {
    const H = hairKit(hair, look, mat, line, K);
    H.add(capGeo(H.HP, { front: 0.36, rad: 1.06, side: -0.34, nape: -0.72 }), 0.012);
    fringe(H, 5, -0.5, 0.5, 0.62, (t) => 0.095 + 0.015 * Math.sin(t * 8), 0.058, { pitch: 1.0, bend: -0.25, flat: 0.55, yaw: (t) => (t - 0.5) * 0.6 });
    for (const [az, el, len] of [[0.0, 1.0, 0.12], [0.5, 1.05, 0.11], [-0.5, 1.05, 0.11], [0.0, 1.35, 0.11], [1.2, 0.85, 0.09], [-1.2, 0.85, 0.09], [2.3, 0.9, 0.1], [-2.3, 0.9, 0.1], [Math.PI, 0.8, 0.1]]) H.strand(az, el, len, 0.062, { pitch: 1.05, bend: -0.2, flat: 0.55 });
    for (const sd of [-1, 1]) H.strand(sd * 1.55, 0.38, 0.065, 0.05, { pitch: 0.3, bend: 0.2 });
    H.shine(1.075, 0.6);
  },
  // みのり：まっすぐのロングヘア（前髪・顔のよこの髪・背中まで）
  long(hair, look, mat, line, K) {
    const H = hairKit(hair, look, mat, line, K);
    H.add(capGeo(H.HP, { front: look.sheer ? 0.42 : 0.34, side: -0.55, nape: -0.95, vol: 0.06 }), 0.012);
    if (look.sheer) {
      // シースルーの前髪（細い束を、すきまをあけて。まん中は少し分ける）
      fringe(H, 9, -0.6, 0.6, 0.86, (t, i) => 0.16 + (i % 2) * 0.014 - Math.abs(t - 0.5) * 0.02, 0.026, { pitch: 0.16, bend: 0.55, flat: 0.4, yaw: (t) => (t - 0.5) * 0.55 });
      for (const sd of [-1, 1]) H.strand(sd * 0.72, 0.72, 0.21, 0.034, { pitch: 0.1, yaw: -sd * 0.15, bend: 0.35, flat: 0.4 });
    } else fringe(H, 7, -0.62, 0.62, 0.76, (t, i) => 0.158 + (i % 2) * 0.012, 0.05, { pitch: 0.18, bend: 0.6, flat: 0.34, yaw: (t) => (t - 0.5) * 0.3 });
    fringe(H, 5, -0.75, 0.75, 1.1, 0.17, 0.068, { pitch: 0.22, bend: 0.5, flat: 0.38, yaw: (t) => (t - 0.5) * 0.4 });
    for (const sd of [-1, 1]) {
      H.strand(sd * 1.0, 0.44, 0.34, 0.054, { pitch: 0.1, yaw: -sd * 0.12, bend: 0.12, flat: 0.4 });
      H.strand(sd * 1.3, 0.42, 0.33, 0.06, { pitch: 0.1, bend: 0.1, flat: 0.4 });
      H.strand(sd * 1.75, 0.6, 0.24, 0.066, { pitch: 0.1, bend: 0.2, flat: 0.4 });
      H.strand(sd * 2.3, 0.75, 0.24, 0.07, { pitch: 0.1, bend: 0.2, flat: 0.4 });
    }
    H.strand(Math.PI, 0.85, 0.24, 0.072, { pitch: 0.1, bend: 0.2, flat: 0.4 });
    // 背中の髪（ゆれる）
    const pv = H.pivot(0, -0.1, -0.16);
    for (let i = 0; i < 9; i++) {
      const az = Math.PI - 1.25 + (2.5 * i) / 8;
      const d = new THREE.Vector3(Math.sin(az) * 0.15, -1, Math.cos(az) * 0.15 - 0.22);
      H.strand(az, -0.08, 0.46 - Math.abs(i - 4) * 0.025, 0.072, { dir: [d.x, d.y, d.z], curl: [-Math.sin(az), 0.25, -Math.cos(az)], bend: 0.12, flat: 0.32, parent: pv, rr: 1.03 });
    }
    H.shine(1.085, 0.62);
  },
  // まな：あごまでのボブ（内まき）
  bob(hair, look, mat, line, K) {
    const H = hairKit(hair, look, mat, line, K);
    H.add(capGeo(H.HP, { front: 0.36 }), 0.012);
    const R = HEAD_R;
    const bob = new THREE.SphereGeometry(R * 1.15, 36, 24, 0, Math.PI * 2, 0, Math.PI * 0.86);
    {
      const p = bob.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        headShape(v, R, H.HP);
        const az = Math.abs(Math.atan2(v.x, v.z));
        const lim = az < 0.9 ? R * 0.45 : az < 1.45 ? R * 0.45 + (-0.86 * R - 0.45 * R) * smooth(0.9, 1.45, az) : -0.86 * R + 0.1 * R * smooth(1.45, Math.PI, az);
        if (v.y < lim) v.y = lim;
        // 横はまっすぐ下へ、すそは内側へまく
        if (v.y < 0) {
          const t = smooth(0, -0.86 * R, v.y);
          const k = (1.0 + 0.16 * Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5)) * (1 - 0.1 * smooth(0.7, 1, t));
          v.x *= k;
          v.z *= v.z < 0 ? k : 1 + (k - 1) * 0.4;
        }
        p.setXYZ(i, v.x, v.y, v.z);
      }
      bob.computeVertexNormals();
    }
    H.add(bob, 0.012);
    fringe(H, 7, -0.64, 0.64, 0.8, (t, i) => 0.152 + (i % 2) * 0.01, 0.05, { pitch: 0.2, bend: 0.55, flat: 0.32, yaw: (t) => (t - 0.5) * 0.25, rr: 1.1 });
    // ボブの表面の毛すじ（てっぺんから下へ）とすその毛先
    for (let i = 0; i < 14; i++) {
      const az = (i / 14) * Math.PI * 2 + 0.1;
      const front = Math.abs(Math.atan2(Math.sin(az), Math.cos(az))) < 0.95;
      if (!front) H.strand(az, 0.45, 0.24, 0.078, { pitch: 0.04, bend: 0.3, flat: 0.28, rr: 1.15 });
      H.strand(az + 0.22, 1.05, 0.2, 0.08, { pitch: 0.06, bend: 0.45, flat: 0.28, rr: 1.15 });
    }
    for (const sd of [-1, 1]) H.strand(sd * 0.95, 0.5, 0.22, 0.056, { pitch: 0.12, yaw: -sd * 0.1, bend: 0.45, flat: 0.36, rr: 1.1 });
    H.shine(1.16, 0.66);
  },
  // あやな：ゆるい巻き髪のロング（流した前髪）
  wave(hair, look, mat, line, K) {
    const H = hairKit(hair, look, mat, line, K);
    H.add(capGeo(H.HP, { front: 0.36, side: -0.55, nape: -0.95, vol: 0.08, part: 0.45 }), 0.012);
    for (let i = 0; i < 5; i++) H.strand(0.42 - i * 0.05, 1.05 - i * 0.1, 0.2 - i * 0.01, 0.062, { pitch: 0.2, yaw: -1.0 + i * 0.12, bend: 0.55, flat: 0.38, twist: 0.6 });
    H.strand(0.2, 0.72, 0.2, 0.058, { pitch: 0.16, yaw: -0.9, bend: 0.6, flat: 0.38, twist: 0.6 });
    for (const [az, el] of [[0.7, 0.95], [0.95, 0.72]]) H.strand(az, el, 0.15, 0.056, { pitch: 0.16, yaw: 0.45, bend: 0.5, flat: 0.4 });
    for (const sd of [-1, 1]) {
      H.strand(sd * 1.05, 0.42, 0.33, 0.058, { pitch: 0.1, yaw: -sd * 0.1, bend: 0.12, flat: 0.42, twist: 2.4 * sd });
      H.strand(sd * 1.38, 0.4, 0.32, 0.064, { pitch: 0.1, bend: 0.1, flat: 0.42, twist: -2.2 * sd });
      H.strand(sd * 1.8, 0.6, 0.24, 0.066, { pitch: 0.1, bend: 0.2, flat: 0.4, twist: 1.2 });
      H.strand(sd * 2.35, 0.75, 0.24, 0.07, { pitch: 0.1, bend: 0.2, flat: 0.4 });
    }
    H.strand(Math.PI, 0.85, 0.24, 0.072, { pitch: 0.1, bend: 0.2, flat: 0.4 });
    const pv = H.pivot(0, -0.1, -0.16);
    for (let i = 0; i < 9; i++) {
      const az = Math.PI - 1.25 + (2.5 * i) / 8;
      const d = new THREE.Vector3(Math.sin(az) * 0.2, -1, Math.cos(az) * 0.2 - 0.22);
      H.strand(az, -0.08, 0.42 - Math.abs(i - 4) * 0.02, 0.076, { dir: [d.x, d.y, d.z], curl: [-Math.sin(az), 0.25, -Math.cos(az)], bend: 0.15, flat: 0.4, twist: i % 2 ? 2.6 : -2.6, parent: pv, rr: 1.03 });
    }
    H.shine(1.09, 0.6);
  },
  // ゆか：高いポニーテール（シュシュ）と、顔のよこの細い髪
  pony(hair, look, mat, line, K) {
    const H = hairKit(hair, look, mat, line, K);
    H.add(capGeo(H.HP, { front: 0.34, side: -0.4, nape: -0.62, rad: 1.06 }), 0.012);
    fringe(H, 5, -0.52, 0.52, 0.74, (t, i) => 0.13 + (i % 2) * 0.015, 0.052, { pitch: 0.2, bend: 0.6, flat: 0.36, yaw: (t) => -0.25 + (t - 0.5) * 0.4 });
    for (const sd of [-1, 1]) H.strand(sd * 1.02, 0.4, 0.22, 0.024, { pitch: 0.12, yaw: -sd * 0.18, bend: 0.25, flat: 0.55, twist: 0.8 * sd });
    // 後ろへまとめた髪のすじ
    for (const [az, el, yaw] of [[1.5, 0.45, Math.PI - 0.7], [-1.5, 0.45, Math.PI + 0.7], [0.6, 1.0, Math.PI - 0.3], [-0.6, 1.0, Math.PI + 0.3], [0, 1.15, Math.PI]]) H.strand(az, el, 0.18, 0.06, { pitch: 0.03, yaw, bend: 0.3, flat: 0.28, rr: 1.06 });
    const base = H.surf(Math.PI, 0.66, 1.1);
    const tie = K.part(K.has('scrunchie') ? scrunchieGeo() : new THREE.TorusGeometry(0.04, 0.011, 6, 16), K.look.scrunchie != null ? K.look.scrunchie : 0xe8334a, 0.005);
    tie.position.copy(base);
    tie.rotation.x = -0.66 + Math.PI / 2;
    hair.add(tie);
    const pv = H.pivot(base.x, base.y, base.z, 0.85, 0.14, -0.95);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const m = H.add(strandGeo(0.36 - (i % 3) * 0.03, 0.074 - (i % 2) * 0.008, 1.45 + (i % 2) * 0.2, 0.62, 0.25), 0.009, pv);
      aimMesh(m, new THREE.Vector3(Math.cos(a) * 0.14, 0.22 + Math.sin(a) * 0.1, -1), new THREE.Vector3(Math.cos(a) * 0.12, -1, 0.05));
      m.position.set(Math.cos(a) * 0.014, Math.sin(a) * 0.014, -0.012);
    }
    H.shine(1.075, 0.62);
  },
};
// ===== 写真から作り直した髪（v1.6）=====
// 値か関数（az をわたす）を読む
const azv = (x, az) => (typeof x === 'function' ? x(az) : x || 0);
// すその線：前（|az|<a1）→ 横（a2）→ 後ろ（a3〜）を、なめらかにつなぐ（R の何倍）
function hemLine(front, side, back, a1 = 0.7, a2 = 1.6, a3 = 2.5) {
  return (az) => {
    const a = Math.abs(az);
    if (a < a1) return front;
    if (a < a2) return front + (side - front) * smooth(a1, a2, a);
    if (a < a3) return side + (back - side) * smooth(a2, a3, a);
    return back;
  };
}
// 髪のかたまり（頭をおおう殻）。マッシュ・ボブのように、すそを切りそろえた形
//  hem(az)：すその高さ / rad：大きさ / puff(az, yy)：ふくらみ（yy＝y/R）/ flare：すそを外へ / tuck：すそのふちを内へ（前髪を顔にそわせる）
//  band：flare がきく幅（R の何倍）/ clumps：{ n 毛束の数（1周）, tip 毛先のとがり, amp ふくらみ, top どこから（yy）, a 毛束を入れる範囲（|az|＜a） }
function shellK(o, az, y, hem) {
  const R = HEAD_R;
  let k = 1 + (o.puff ? o.puff(az, y / R) : 0);
  k += azv(o.flare, az) * smooth(hem + R * (o.band || 0.4), hem, y);
  k -= azv(o.tuck, az) * smooth(hem + R * (o.tuckBand || 0.12), hem, y);
  const c = o.clumps;
  if (c && Math.abs(az) < (c.a || 9)) {
    const s = Math.abs(Math.sin((az * c.n) / 2 + (c.ph || 0)));
    k += (c.amp || 0) * (1 - s * 2) * smooth(R * (c.top != null ? c.top : 0.6), hem, y);
  }
  if (o.part != null && y > R * 0.25) {
    // 分け目のくぼみ
    const d = Math.abs(az - o.part);
    if (d < 0.12) k -= 0.03 * (1 - d / 0.12) * smooth(R * 0.25, R * 0.6, y);
  }
  return k;
}
function shellHem(o, az) {
  let hem = o.hem(az);
  const c = o.clumps;
  if (c && Math.abs(az) < (c.a || 9)) hem -= (c.tip || 0) * (1 - Math.abs(Math.sin((az * c.n) / 2 + (c.ph || 0))));
  return hem * HEAD_R;
}
function shellGeo(HP, o) {
  const R = HEAD_R;
  const rad = o.rad || 1.12;
  const g = new THREE.SphereGeometry(R * rad, o.ws || 60, o.hs || 30, -Math.PI / 2, Math.PI * 2, 0, Math.PI * (o.theta || 0.96)); // つなぎ目は後ろ
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    headShape(v, R, HP);
    const az = Math.atan2(v.x, v.z);
    const hem = shellHem(o, az);
    if (v.y < hem) v.y = hem;
    const k = shellK(o, az, v.y, hem);
    v.x *= k;
    v.z *= k;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}
// 殻の表面の点（az・高さ yy で。殻と同じ計算）。毛先や毛束をすそにそって置くときに使う
function shellPt(HP, o, az, yy, out = 0) {
  const R = HEAD_R;
  const rad = o.rad || 1.12;
  // 球の上で、高さ yy になる点をさがす（headShape で少し動くので、何回かなおす）
  let th = Math.acos(clamp(yy / (rad * 1.04), -1, 1));
  const v = new THREE.Vector3();
  for (let it = 0; it < 5; it++) {
    v.set(Math.sin(th) * Math.sin(az), Math.cos(th), Math.sin(th) * Math.cos(az)).multiplyScalar(R * rad);
    headShape(v, R, HP);
    th = clamp(th + (v.y / R - yy) * 0.6, 0.02, Math.PI - 0.02);
  }
  const hem = shellHem(o, az);
  if (v.y < hem) v.y = hem;
  const k = shellK(o, az, v.y, hem) + out;
  v.x *= k;
  v.z *= k;
  return v;
}
// 殻のすそにそって、毛先（下向きの短い束）を並べる。a0〜a1 に n 本
function hemTips(H, o, n, a0, a1, len, rad, opt = {}) {
  const r = rng(opt.seed || 5);
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const az = a0 + (a1 - a0) * t + (opt.jit || 0) * (r() - 0.5);
    const hem = shellHem(o, az) / HEAD_R;
    const p = shellPt(H.HP, o, az, hem + (opt.up != null ? opt.up : 0.06), opt.out != null ? opt.out : -0.01);
    const L = (typeof len === 'function' ? len(t, i, az) : len) * (1 + (opt.lenJit || 0) * (r() - 0.5));
    const m = H.add(strandGeo(L, typeof rad === 'function' ? rad(t, i, az) : rad, opt.bend != null ? opt.bend : 0.25, opt.flat != null ? opt.flat : 0.5, opt.twist || 0), opt.w || 0.008);
    // 下向き（少し外へ・横へ）
    const out = new THREE.Vector3(Math.sin(az), 0, Math.cos(az));
    const side = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
    const yaw = typeof opt.yaw === 'function' ? opt.yaw(t, i, az) : opt.yaw || 0;
    const D = new THREE.Vector3(0, -1, 0).addScaledVector(out, opt.pitch != null ? opt.pitch : 0.12).addScaledVector(side, yaw);
    aimMesh(m, D, out.clone().negate());
    m.position.copy(p);
  }
}
// 殻の上に毛束を重ねる（表面にそって下へ。yaw で横へ、lift で表面から起こす）。毛束はふちどりがつくので、髪の流れが見える
function clumpOn(H, o, az, yy, len, rad, opt = {}) {
  const p0 = shellPt(H.HP, o, az, yy, opt.out != null ? opt.out : 0.01);
  const p1 = shellPt(H.HP, o, az, yy - 0.06, opt.out != null ? opt.out : 0.01);
  const q1 = shellPt(H.HP, o, az + 0.06, yy, opt.out != null ? opt.out : 0.01);
  const down = p1.clone().sub(p0);
  if (down.lengthSq() < 1e-9) down.set(0, -1, 0); // すそより下にさしたとき（平らな所）は、まっすぐ下へ
  down.normalize();
  const side = q1.clone().sub(p0).normalize();
  const nrm = new THREE.Vector3().crossVectors(side, down).normalize();
  if (nrm.dot(p0) < 0) nrm.negate();
  const yaw = opt.yaw || 0, lift = opt.lift || 0;
  const D = down.clone().multiplyScalar(Math.cos(yaw)).addScaledVector(side, Math.sin(yaw)).multiplyScalar(Math.cos(lift)).addScaledVector(nrm, Math.sin(lift));
  const m = H.add(strandGeo(len, rad, opt.bend != null ? opt.bend : 0.35, opt.flat != null ? opt.flat : 0.34, opt.twist || 0), opt.w || 0.008);
  aimMesh(m, D, nrm.clone().negate());
  m.position.copy(p0);
  return m;
}
Object.assign(HAIR_STYLES, {
  // みのり：まっすぐのロングヘア（金色）。シースルーの前髪はまつげまで、顔のよこに落ちる髪、背中まで（毛束をすきまなく重ねる）
  straightLong(hair, look, mat, line, K) {
    const H = hairKit(hair, look, mat, line, K);
    const o = {
      rad: 1.08,
      hem: hemLine(0.44, -0.1, -0.5, 0.66, 1.5, 2.4),
      puff: (az, yy) => 0.03 * Math.exp(-(((yy - 0.55) / 0.45) ** 2)),
      tuck: (az) => 0.02 + 0.07 * Math.max(0, Math.cos(az)) ** 2,
      tuckBand: 0.3,
      clumps: { n: 50, tip: 0.36, amp: 0.004, top: 0.6, a: 0.72 },
      part: 0,
    };
    H.addTex(shellGeo(H.HP, o), 0.012);
    const r = rng(83);
    // シースルーの前髪（細い束を、すきまをあけて）
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const az = -0.55 + 1.1 * t;
      clumpOn(H, o, az, 0.78, 0.15 + 0.01 * Math.sin(i * 1.7), 0.022, { yaw: (t - 0.5) * 0.4, lift: 0.05, bend: 0.3, flat: 0.45, out: 0.004 });
    }
    // 顔のよこの髪（あごの下まで、まっすぐ下へ）
    for (const sd of [-1, 1]) {
      clumpOn(H, o, sd * 0.74, 0.52, 0.32, 0.044, { yaw: -sd * 0.04, lift: 0.0, bend: 0.06, flat: 0.3 });
      clumpOn(H, o, sd * 0.95, 0.6, 0.36, 0.052, { yaw: -sd * 0.02, lift: 0.0, bend: 0.05, flat: 0.28 });
      for (const az of [1.25, 1.6, 1.95, 2.3, 2.65]) clumpOn(H, o, sd * az, 0.55, 0.26, 0.068, { lift: 0.0, bend: 0.06, flat: 0.28, twist: (r() - 0.5) * 0.2 });
    }
    clumpOn(H, o, Math.PI, 0.55, 0.26, 0.072, { lift: 0.0, bend: 0.06, flat: 0.28 });
    // 背中の髪（ゆれる）：すきまなく重ねて、まっすぐ下へ（鎖骨の下まで）
    const pv = H.pivot(0, -0.1, -0.15);
    for (let i = 0; i < 13; i++) {
      const az = Math.PI - 1.5 + (3.0 * i) / 12;
      const d = new THREE.Vector3(Math.sin(az) * 0.04, -1, Math.cos(az) * 0.04 - 0.16);
      H.strand(az, -0.12, 0.52 - Math.abs(i - 6) * 0.01, 0.076, { dir: [d.x, d.y, d.z], curl: [-Math.sin(az), 0.2, -Math.cos(az)], bend: 0.04, flat: 0.26, parent: pv, rr: 1.02 });
    }
    H.shine(1.09, 0.6, 1.0);
  },
  // ドラ：大きく丸いマッシュ（前髪は上まつげの上でまっすぐ。横は耳をかくして外へふくらみ、後ろはえりあしまで）
  mushroom(hair, look, mat, line, K) {
    const H = hairKit(hair, look, mat, line, K);
    const o = {
      rad: 1.17,
      hem: hemLine(0.07, -0.46, -0.78, 0.74, 1.62, 2.5),
      puff: (az, yy) => 0.13 * Math.sin(az) ** 2 * Math.exp(-(((yy + 0.05) / 0.6) ** 2)) + 0.03 * Math.cos(az) ** 2 * Math.exp(-(((yy - 0.3) / 0.4) ** 2)) - 0.05 * Math.max(0, yy - 0.6),
      flare: (az) => 0.03 + 0.05 * Math.sin(az) ** 2,
      tuck: (az) => 0.1 * Math.max(0, Math.cos(az)) ** 2 + 0.04 * Math.max(0, -Math.cos(az)),
      band: 0.4,
      tuckBand: 0.14,
      clumps: { n: 44, tip: 0.04, amp: 0.014, top: 0.75 },
    };
    H.addTex(shellGeo(H.HP, o), 0.012);
    hemTips(H, o, 13, -0.8, 0.8, (t) => 0.016 + 0.006 * Math.sin(t * 17), 0.014, { pitch: -0.02, bend: 0.1, up: 0.03, out: -0.012, jit: 0.04, seed: 11, w: 0.005 });
    H.shine(1.18, 0.66, 1.08);
  },
  // ちじわ：まっすぐ目のボブ（あたたかい黒茶色）。前髪はメガネの上まで。耳の前の髪は口の高さまで、後ろはえりあし
  mash(hair, look, mat, line, K) {
    const H = hairKit(hair, look, mat, line, K);
    const o = {
      rad: 1.12,
      hem: (az) => {
        const a = Math.abs(az);
        if (a < 0.72) return 0.24;
        if (a < 1.3) return 0.24 + (-0.58 - 0.24) * smooth(0.72, 1.3, a); // 耳の前で、口の高さまで
        if (a < 1.75) return -0.58 + (-0.36 + 0.58) * smooth(1.3, 1.75, a); // 耳の上は少し短く
        return -0.36 + (-0.72 + 0.36) * smooth(1.75, 2.5, a);
      },
      puff: (az, yy) => 0.04 * Math.sin(az) ** 2 * Math.exp(-(((yy + 0.1) / 0.6) ** 2)) - 0.05 * Math.max(0, yy - 0.5),
      flare: 0.0,
      tuck: (az) => 0.05 + 0.04 * Math.max(0, Math.cos(az)),
      band: 0.3,
      tuckBand: 0.18,
      clumps: { n: 36, tip: 0.06, amp: 0.016, top: 0.7 },
    };
    H.addTex(shellGeo(H.HP, o), 0.012);
    hemTips(H, o, 11, -0.72, 0.72, (t) => 0.026 + 0.01 * Math.sin(t * 13), 0.02, { pitch: -0.03, bend: 0.2, up: 0.04, out: -0.02, jit: 0.05, seed: 7, w: 0.006 });
    // 顔のよこにまっすぐ落ちる髪
    for (const sd of [-1, 1]) for (const az of [0.95, 1.15]) clumpOn(H, o, sd * az, 0.2, 0.12, 0.05, { yaw: -sd * 0.05, lift: 0.0, bend: 0.12, flat: 0.34 });
    H.shine(1.13, 0.64, 1.03);
  },
  // はやた：やわらかく丸い、ゆるくうねるマッシュ（前髪はメガネの上の1/3にかかる。横はあごまで）
  shaggy(hair, look, mat, line, K) {
    const H = hairKit(hair, look, mat, line, K);
    const o = {
      rad: 1.15,
      hem: (az) => {
        const a = Math.abs(az);
        if (a < 0.72) return 0.48;
        if (a < 1.35) return 0.48 + (-0.62 - 0.48) * smooth(0.72, 1.35, a); // 横はあごまで
        return -0.62 + (-0.8 + 0.62) * smooth(1.35, 2.5, a);
      },
      puff: (az, yy) => 0.09 * Math.exp(-(((yy - 0.55) / 0.5) ** 2)) + 0.05 * Math.sin(az) ** 2 * Math.exp(-(((yy + 0.1) / 0.5) ** 2)),
      flare: (az) => 0.02 * Math.sin(az) ** 2,
      tuck: (az) => 0.02 + 0.03 * Math.sin(az) ** 2,
      band: 0.32,
      clumps: { n: 28, tip: 0.06, amp: 0.026, top: 0.8, ph: 0.4 },
    };
    H.addTex(shellGeo(H.HP, o), 0.012);
    const r = rng(19);
    // 前髪：やわらかい重い束がメガネの上のほうまで（ゆるくうねる）
    for (let i = 0; i < 9; i++) {
      const az = -0.82 + (1.64 * i) / 8 + (r() - 0.5) * 0.05;
      clumpOn(H, o, az, 0.92, 0.19 + (i % 2) * 0.015 + r() * 0.012, 0.064, { yaw: (r() - 0.5) * 0.5, lift: 0.06, bend: 0.5, flat: 0.36, twist: (r() - 0.5) * 1.1 });
    }
    // 上：丸くふくらんだ束
    for (let i = 0; i < 11; i++) {
      const az = -2.4 + (4.8 * i) / 10 + (r() - 0.5) * 0.2;
      clumpOn(H, o, az, 1.0 + r() * 0.15, 0.12 + r() * 0.03, 0.07, { yaw: (r() - 0.5) * 0.8, lift: 0.04 + r() * 0.06, bend: 0.65, flat: 0.4, twist: (r() - 0.5) * 0.8 });
    }
    // 横と後ろ：あごまでのやわらかい束（内へまるく）
    for (const sd of [-1, 1])
      for (const [az, yy, len] of [[1.0, 0.35, 0.2], [1.3, 0.25, 0.19], [1.7, 0.15, 0.17], [2.2, 0.0, 0.16], [2.7, -0.15, 0.15]])
        clumpOn(H, o, sd * az, yy, len, 0.07, { yaw: -sd * 0.05, lift: 0.02, bend: 0.4, flat: 0.44, twist: sd * 0.4 });
    H.shine(1.17, 0.6, 1.02);
  },
  // しょうた：無造作で毛量の多いマッシュウルフ（顔の1.5倍くらいのはば。ぬれたような太い束。前髪はまゆまで）
  textured(hair, look, mat, line, K) {
    const H = hairKit(hair, look, mat, line, K);
    const o = {
      rad: 1.18,
      hem: hemLine(0.46, -0.12, -0.6, 0.7, 1.55, 2.5),
      puff: (az, yy) => 0.11 * Math.exp(-(((yy - 0.6) / 0.45) ** 2)) + 0.07 * Math.sin(az) ** 2 * Math.exp(-(((yy - 0.15) / 0.45) ** 2)),
      flare: (az) => 0.03 * Math.sin(az) ** 2,
      tuck: 0.02,
      clumps: { n: 22, tip: 0.12, amp: 0.045, top: 0.85, ph: 0.2 },
    };
    H.addTex(shellGeo(H.HP, o), 0.012);
    const r = rng(31);
    // 前髪：太いとがった束がまゆまで（長さと向きをばらばらに）
    for (let i = 0; i < 8; i++) {
      const az = -0.8 + (1.6 * i) / 7 + (r() - 0.5) * 0.06;
      clumpOn(H, o, az, 0.86, 0.15 + (i % 3) * 0.018 + r() * 0.02, 0.064, { yaw: (r() - 0.5) * 0.6, lift: 0.1, bend: 0.3, flat: 0.36, twist: (r() - 0.5) * 0.8 });
    }
    // 上：ふわっと立った太い束
    for (let i = 0; i < 11; i++) {
      const az = -2.3 + (4.6 * i) / 10 + (r() - 0.5) * 0.2;
      clumpOn(H, o, az, 0.98 + r() * 0.2, 0.11 + r() * 0.04, 0.068, { yaw: (r() - 0.5) * 2.4, lift: 0.3 + r() * 0.35, bend: 0.55, flat: 0.4, twist: (r() - 0.5) * 1.2 });
    }
    // 横と後ろ：太い束が耳の上にかぶさって、毛先は少し外へ
    for (const sd of [-1, 1])
      for (const [az, yy, len] of [[1.1, 0.4, 0.14], [1.45, 0.3, 0.14], [1.85, 0.2, 0.14], [2.3, 0.05, 0.14], [2.75, -0.1, 0.14]])
        clumpOn(H, o, sd * az, yy, len, 0.066, { yaw: -sd * 0.08, lift: 0.03, bend: 0.22, flat: 0.42, twist: sd * 0.3 });
    H.shine(1.2, 0.62, 1.03);
  },
  // てつんど：横は短く耳を出す。おでこを出して、前髪を上へかき上げ、キャラの右（写真の左）・後ろへ流す
  sweep(hair, look, mat, line, K) {
    const H = hairKit(hair, look, mat, line, K);
    H.addTex(capGeo(H.HP, { front: 0.52, side: 0.14, nape: -0.62, rad: 1.06, vol: 0.16 }), 0.012);
    // 前の毛束：はえぎわから立ち上げて、上と後ろへ（少し右へ）
    for (let i = 0; i < 7; i++) {
      const az = 0.6 - i * 0.18;
      H.strand(az, 0.66 + 0.05 * Math.cos(az * 2), 0.17 - Math.abs(az) * 0.03, 0.068, { pitch: 0.8, yaw: -(Math.PI - 0.55), bend: 0.75, flat: 0.36, rr: 1.05 });
    }
    // 右のこめかみに少し落ちる毛
    H.strand(-0.95, 0.55, 0.09, 0.04, { pitch: 0.2, yaw: -0.4, bend: 0.5, flat: 0.4, rr: 1.07 });
    // 上と後ろ（後ろへ流す）
    for (const [az, el] of [[0.35, 1.12], [-0.25, 1.2], [0.95, 1.0], [-0.95, 1.0], [1.8, 0.86], [-1.8, 0.86], [2.5, 0.72], [-2.5, 0.72], [Math.PI, 0.82]]) H.strand(az, el, 0.13, 0.065, { pitch: 0.22, yaw: Math.PI - az * 0.3, bend: 0.5, flat: 0.38, rr: 1.07 });
    // 横の短い毛（耳の上）
    for (const sd of [-1, 1]) for (const az of [1.3, 1.75, 2.2]) H.strand(sd * az, 0.4, 0.055, 0.045, { pitch: 0.15, bend: 0.3, flat: 0.45, rr: 1.05 });
    H.shine(1.1, 0.6);
  },
  // エブン：ふわっとした中くらいの髪。キャラの左で分けて、前髪を右（写真の左）のこめかみへ流す。耳はかくれる
  sideBang(hair, look, mat, line, K) {
    const H = hairKit(hair, look, mat, line, K);
    const o = {
      rad: 1.1,
      hem: (az) => {
        const base = hemLine(0.1, -0.4, -0.62, 0.8, 1.6, 2.5)(az);
        const f = 0.36 - 0.24 * smooth(0.7, -0.6, az); // 分け目（キャラの左）は高く、右へいくほど低い
        return f + (base - f) * smooth(0.62, 0.95, Math.abs(az));
      },
      puff: (az, yy) => 0.05 * Math.exp(-(((yy - 0.6) / 0.45) ** 2)) + 0.045 * Math.sin(az) ** 2 * Math.exp(-(((yy + 0.05) / 0.45) ** 2)),
      flare: (az) => 0.02 + 0.03 * Math.sin(az) ** 2,
      tuck: 0.02,
      band: 0.3,
      clumps: { n: 32, tip: 0.05, amp: 0.02, top: 0.75 },
      part: 0.5,
    };
    H.addTex(shellGeo(H.HP, o), 0.012);
    const r = rng(71);
    // 前髪：分け目から、写真の左（キャラの右）へななめに流れる、やわらかい束
    for (let i = 0; i < 7; i++) {
      const az = 0.42 - i * 0.17;
      clumpOn(H, o, az, 0.92 - i * 0.03, 0.17 + i * 0.012, 0.06, { yaw: -(0.95 - i * 0.05), lift: 0.06, bend: 0.32, flat: 0.34, twist: -0.3 });
    }
    clumpOn(H, o, 0.72, 0.85, 0.12, 0.052, { yaw: 0.5, lift: 0.07, bend: 0.3 });
    // 横と後ろの、やわらかい束（耳にかぶさる）
    for (let i = 0; i < 11; i++) {
      const az = 0.95 + (i / 10) * (Math.PI * 2 - 1.9) + (r() - 0.5) * 0.12;
      clumpOn(H, o, az, 0.5 + r() * 0.2, 0.15 + r() * 0.04, 0.062, { yaw: (r() - 0.5) * 0.3, lift: 0.04, bend: 0.3, flat: 0.38, twist: (r() - 0.5) * 0.5 });
    }
    // 頭の上：寝かせた束（v1.7：立った束がゴーグルのように見えたので、平らに）
    for (let i = 0; i < 5; i++) {
      const y = r() - 0.5;
      clumpOn(H, o, -1.2 + i * 0.6, 1.08, 0.1, 0.05, { yaw: y * 0.6, lift: 0.025, bend: 0.22, flat: 0.42 });
    }
    H.shine(1.11, 0.62, 1.02);
  },
  // なお：短いスポーツ刈り（上は平らで短く、前髪はまゆの少し上。横はすっきりで耳が出る）
  crop(hair, look, mat, line, K) {
    const H = hairKit(hair, look, mat, line, K);
    const o = {
      rad: 1.045,
      hem: (az) => {
        const a = Math.abs(az);
        // 前髪はまゆの少し上（まん中）、こめかみは少し上がる → 横は耳の上 → 後ろはえりあし
        if (a < 0.8) return 0.3 + 0.14 * smooth(0.2, 0.75, a);
        return hemLine(0.44, 0.06, -0.58, 0.8, 1.5, 2.4)(az);
      },
      // 上は毛量があって平ら、横は短く頭にそう
      puff: (az, yy) => 0.075 * Math.exp(-(((yy - 0.62) / 0.32) ** 2)) * (0.55 + 0.45 * Math.cos(az) ** 2) - 0.06 * Math.max(0, yy - 0.86),
      tuck: 0.02,
      tuckBand: 0.12,
      clumps: { n: 44, tip: 0.06, amp: 0.012, top: 0.6, a: 1.3 },
    };
    H.addTex(shellGeo(H.HP, o), 0.012);
    const r = rng(53);
    // 前の短い前髪（前へ、少しぎざぎざに）
    fringe(H, 9, -0.62, 0.62, 0.42, (t, i) => 0.034 + (i % 2) * 0.01 + r() * 0.006, 0.03, { pitch: 0.5, bend: 0.4, flat: 0.5, rr: 1.07, yaw: (t) => (t - 0.5) * 0.4 });
    // 上：短く立った毛（平らにそろえる）
    for (const [el, n, sp] of [[0.78, 8, 0.8], [1.0, 7, 0.85]])
      for (let i = 0; i < n; i++) {
        const az = -sp + (2 * sp * i) / (n - 1) + (r() - 0.5) * 0.08;
        H.strand(az, el, 0.026 + r() * 0.008, 0.032, { pitch: 1.0, yaw: (r() - 0.5) * 0.5, bend: -0.05, flat: 0.5, rr: 1.06 });
      }
    H.shine(1.08, 0.62);
  },
  // ナオT：分け目（写真の左）から横・後ろへなでつけたオールバック（前は少し立ち上がる）と、短く刈り上げた横（フェード）
  slick(hair, look, mat, line, K) {
    const H = hairKit(hair, look, mat, line, K);
    // 刈り上げ：はだが少し見える、明るい色
    const fade = look.fade != null ? look.fade : new THREE.Color(look.hair).lerp(new THREE.Color(0x8a8590), 0.35).lerp(new THREE.Color(look.skin), 0.18).getHex();
    K.head.add(K.part(capGeo(H.HP, { front: 0.52, side: -0.22, nape: -0.62, rad: 1.016 }), fade, 0.008, 'hair', { rim: 0.4 }));
    const PART = -0.78; // 分け目（キャラの右＝写真の左）
    const o = {
      rad: 1.055,
      hem: (az) => {
        const a = Math.abs(az);
        if (a < 0.75) return 0.5 + 0.09 * smooth(0.1, 0.65, a);
        return hemLine(0.59, az < 0 ? 0.5 : 0.42, 0.05, 0.75, 1.5, 2.6)(az);
      },
      // 前は分け目の反対がわが少し立ち上がる。分け目のがわは低く
      puff: (az, yy) => 0.07 * Math.max(0, Math.cos(az - 0.25)) ** 2 * Math.exp(-(((yy - 0.66) / 0.28) ** 2)) - 0.02 * Math.max(0, yy - 0.95) - 0.025 * Math.exp(-(((az - PART) / 0.35) ** 2)),
      tuck: (az) => 0.035 + 0.03 * Math.max(0, Math.cos(az)) ** 2,
      tuckBand: 0.18,
      part: PART,
    };
    H.addTex(shellGeo(H.HP, o), 0.012, 'slant');
    H.shine(1.075, 0.66, 1.0);
  },
  // トリキ：センターパート（前髪を左右に分けて、目じりのあたりまで外へカーブ。横は耳の上にそう）
  curtain(hair, look, mat, line, K) {
    const H = hairKit(hair, look, mat, line, K);
    const o = {
      rad: 1.09,
      hem: (az) => {
        const a = Math.abs(az);
        if (a < 0.7) return 0.62 - 0.3 * smooth(0.0, 0.7, a);
        return hemLine(0.32, -0.16, -0.56, 0.7, 1.55, 2.5)(az);
      },
      puff: (az, yy) => 0.02 * Math.sin(az) ** 2 * Math.exp(-(((yy - 0.1) / 0.5) ** 2)) + 0.045 * Math.exp(-(((yy - 0.62) / 0.35) ** 2)),
      tuck: (az) => 0.02 + 0.03 * Math.sin(az) ** 2,
      band: 0.3,
      clumps: { n: 30, tip: 0.04, amp: 0.018, top: 0.7, a: 2.9 },
      part: 0,
    };
    H.addTex(shellGeo(H.HP, o), 0.012);
    // カーテンの前髪：分け目から左右へ、外へカーブして目じりまで
    for (const sd of [-1, 1]) {
      clumpOn(H, o, sd * 0.07, 1.02, 0.23, 0.062, { yaw: sd * 0.95, lift: 0.07, bend: 0.4, flat: 0.32 });
      clumpOn(H, o, sd * 0.22, 0.96, 0.24, 0.062, { yaw: sd * 0.72, lift: 0.07, bend: 0.4, flat: 0.32 });
      clumpOn(H, o, sd * 0.42, 0.86, 0.22, 0.06, { yaw: sd * 0.5, lift: 0.06, bend: 0.38, flat: 0.34 });
      clumpOn(H, o, sd * 0.66, 0.7, 0.18, 0.058, { yaw: sd * 0.3, lift: 0.05, bend: 0.34, flat: 0.34 });
      // 横（耳の上にそう）と後ろ
      for (const [az, yy, len] of [[1.0, 0.5, 0.14], [1.35, 0.4, 0.12], [1.75, 0.35, 0.11], [2.2, 0.2, 0.11], [2.7, 0.05, 0.11]]) clumpOn(H, o, sd * az, yy, len, 0.058, { yaw: -sd * 0.05, lift: 0.02, bend: 0.4, flat: 0.38 });
    }
    H.shine(1.11, 0.6, 1.02);
  },
});

// シュシュ（ふくらんだ輪）
function scrunchieGeo() {
  const g = new THREE.TorusGeometry(0.042, 0.018, 8, 22);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(y, x);
    const k = 1 + 0.12 * Math.sin(a * 9);
    p.setXYZ(i, x * k, y * k, z * (1 + 0.25 * Math.sin(a * 9)));
  }
  g.computeVertexNormals();
  return g;
}
// 髪：スタイルごとに毛束を組み立てる
function buildHair(hair, look, mat, line, K) {
  const R = HEAD_R;
  const HP = K ? K.HP : null;
  if (HAIR_STYLES[look.hairStyle]) return HAIR_STYLES[look.hairStyle](hair, look, mat, line, K);
  if (look.hairStyle !== 'messy' && look.hairStyle !== 'bowl' && look.hairStyle !== 'center') return HAIR_STYLES.short(hair, look, mat, line, K);
  const add = (geo, x, y, z, rx, ry, rz, w = 0.009) => {
    const m = mesh(geo, mat, line, w);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz, 'YXZ');
    hair.add(m);
    return m;
  };
  // 頭をおおう帽子（えりあし・もみあげの線より下を頭にそわせる）
  const capG = new THREE.SphereGeometry(R * 1.07, 34, 26, 0, Math.PI * 2, 0, Math.PI * 0.84);
  {
    const p = capG.attributes.position;
    const v = new THREE.Vector3();
    const fl = R * (look.hairStyle === 'bowl' ? 0.22 : 0.36);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      headShape(v, R);
      // 髪のはえぎわ：前はおでこを出す → こめかみ・もみあげ → 後ろはえりあしまで
      const az = Math.abs(Math.atan2(v.x, v.z));
      const f0 = fl - Math.min(az, 0.9) * R * 0.1;
      let lim;
      if (az < 0.9) lim = f0;
      else if (az < 1.75) lim = f0 + (-0.32 * R - f0) * smooth(0.9, 1.75, az);
      else lim = -0.32 * R + (-0.74 * R + 0.32 * R) * smooth(1.75, 2.6, az);
      if (v.y < lim) {
        v.y = lim;
        const rr = Math.sqrt(Math.max(0, (R * 1.07) ** 2 - lim * lim)) / Math.max(1e-4, Math.hypot(v.x, v.z));
        v.x *= Math.min(1, rr);
        v.z *= Math.min(1, rr);
      }
      p.setXYZ(i, v.x, v.y, v.z);
    }
    capG.computeVertexNormals();
  }
  add(capG, 0, 0.0, 0, 0, 0, 0, 0.012);
  if (look.hairStyle === 'messy') {
    // ドラ：ツンツンの毛束（上・後ろ・横へ）
    const spikes = [
      [0.0, 0.17, 0.04, -0.25, 0, 0.0, 0.2, 0.075],
      [0.08, 0.16, 0.02, -0.15, 0, -0.55, 0.19, 0.07],
      [-0.08, 0.16, 0.02, -0.15, 0, 0.55, 0.19, 0.07],
      [0.0, 0.14, -0.09, 0.9, 0, 0.0, 0.2, 0.08],
      [0.11, 0.1, -0.07, 0.7, 0, -0.9, 0.18, 0.07],
      [-0.11, 0.1, -0.07, 0.7, 0, 0.9, 0.18, 0.07],
      [0.15, 0.05, 0.02, 0.1, 0, -1.3, 0.15, 0.06],
      [-0.15, 0.05, 0.02, 0.1, 0, 1.3, 0.15, 0.06],
      [0.05, 0.12, -0.15, 1.5, 0, -0.3, 0.16, 0.065],
      [-0.05, 0.12, -0.15, 1.5, 0, 0.3, 0.16, 0.065],
    ];
    for (const [x, y, z, rx, ry, rz, len, rad] of spikes) add(strandGeo(len, rad, 0.5, 0.6), x, y, z, rx, ry, rz);
    // 前髪（おでこにかかる束）
    for (const [x, rz, len] of [[-0.09, 0.35, 0.13], [-0.03, 0.12, 0.15], [0.04, -0.1, 0.14], [0.1, -0.32, 0.12]])
      add(strandGeo(len, 0.05, -0.7, 0.45), x, 0.12, R * 0.82, 2.55, 0, rz);
  } else if (look.hairStyle === 'bowl') {
    // エブン：マッシュ（丸いシルエット・まっすぐな前髪）
    const bowl = new THREE.SphereGeometry(R * 1.12, 30, 18, 0, Math.PI * 2, 0, Math.PI * 0.55);
    {
      const p = bowl.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        headShape(v, R);
        const az = Math.atan2(v.x, v.z);
        const lim = Math.abs(az) < 1.1 ? R * 0.2 : Math.abs(az) < 2.0 ? R * -0.12 : -R * 0.25;
        if (v.y < lim) v.y = lim;
        p.setXYZ(i, v.x * 1.02, v.y, v.z);
      }
      bowl.computeVertexNormals();
    }
    add(bowl, 0, 0.015, -0.005, 0, 0, 0, 0.012);
    // 前髪のぎざぎざ・横と後ろの毛束（ヘルメットに見えないように）
    for (let i = -3; i <= 3; i++) add(strandGeo(0.08, 0.045, -0.35, 0.4), i * 0.046, 0.065, R * 0.96 - Math.abs(i) * 0.014, 2.95, i * 0.13, 0);
    for (const sd of [-1, 1]) {
      add(strandGeo(0.11, 0.05, 0.3, 0.45), sd * 0.2, 0.02, 0.07, Math.PI - 0.15, 0, sd * 0.12);
      add(strandGeo(0.1, 0.05, 0.35, 0.45), sd * 0.21, 0.02, -0.04, Math.PI - 0.05, 0, sd * 0.18);
      add(strandGeo(0.1, 0.05, 0.35, 0.45), sd * 0.15, 0.0, -0.15, Math.PI + 0.3, 0, sd * 0.25);
    }
    add(strandGeo(0.1, 0.05, 0.35, 0.45), 0, 0.0, -0.21, Math.PI + 0.45, 0, 0);
    // てっぺんのはね毛（アホ毛）
    add(strandGeo(0.11, 0.022, 1.3, 0.5), 0.02, 0.25, -0.02, -0.4, 0, -0.3);
  } else {
    // アオッチ：センター分け（左右に流れる前髪・横の髪）
    for (const sd of [-1, 1]) {
      add(strandGeo(0.2, 0.075, -0.9, 0.42), sd * 0.03, 0.18, R * 0.62, 2.4, sd * -0.15, sd * 0.85);
      add(strandGeo(0.17, 0.06, -0.7, 0.42), sd * 0.1, 0.14, R * 0.72, 2.5, sd * -0.35, sd * 0.55);
      add(strandGeo(0.16, 0.06, 0.4, 0.5), sd * 0.19, 0.03, 0.02, Math.PI - 0.2, 0, sd * 0.25);
    }
    for (const [x, rx, rz] of [[0, 0.95, 0], [0.09, 0.85, -0.5], [-0.09, 0.85, 0.5]]) add(strandGeo(0.15, 0.07, 0.4, 0.55), x, 0.1, -0.13, rx, 0, rz);
  }
  // 天使の輪（髪のつやのハイライト）：髪の表面にそった、ぎざぎざの帯
  const bowlStyle = look.hairStyle === 'bowl';
  const shine = hairShine(R, bowlStyle ? 1.13 : 1.075, bowlStyle ? 0.78 : 0.6, bowlStyle ? 1.02 : 1);
  const shineM = new THREE.MeshBasicMaterial({ color: lighten('#' + new THREE.Color(look.hair).getHexString(), 0.5), transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const sh = new THREE.Mesh(shine, shineM);
  sh.renderOrder = 2;
  if (bowlStyle) sh.position.set(0, 0.015, -0.005);
  hair.add(sh);
}

// 表情を切りかえる（絵のマスをずらすだけ）
export function setFace(root, f) {
  const P = root.userData.parts;
  if (!P || !P.faceTex || root.userData.faceNow === f) return;
  root.userData.faceNow = f;
  P.faceTex.offset.set((f % 4) * 0.25, f < 4 ? 0.5 : 0);
}

// ===== ポーズ =====
// 各関節の目標の角度を決め、なめらかに近づける
const tmpPose = {};
function basePose(P) {
  P.bodyX = 0;
  P.bodyZ = 0;
  P.bodyY = 0;
  P.bodyRise = 0;
  P.spineY = 0;
  P.spineX = 0;
  P.chestX = 0;
  P.chestZ = 0;
  P.headX = 0;
  P.headY = 0;
  P.headZ = 0;
  P.sx = [0, 0];
  P.sz = [0.12, 0.12];
  P.sy = [0, 0];
  P.ex = [0, 0];
  P.hx = [0, 0];
  P.hz = [0, 0];
  P.kx = [0, 0];
  P.fx = [0, 0];
  P.stretch = 1;
  P.face = -1;
  return P;
}
const ease = (x) => 1 - (1 - x) * (1 - x);

// state: { mode, t, speed01, turn, punchSide, punchPhase, heavy, ground, runPhase, face, emote, emoteT }
export function poseModel(root, st, dt) {
  const parts = root.userData.parts;
  const P = basePose(tmpPose);
  const t = st.t;
  const L = 0, R = 1;
  const bank = clamp(-(st.turn || 0) * 0.5, -0.6, 0.6);
  switch (st.mode) {
    case 'fly':
    case 'dash': {
      const k = st.mode === 'dash' ? 1 : clamp(st.speed01, 0, 1);
      P.bodyX = 0.2 + 1.15 * k;
      P.bodyZ = bank * (0.6 + 0.4 * k);
      if (st.mode === 'dash') {
        // ジェットで突っこむ：両腕を後ろへ、足をそろえて伸ばす
        P.sx = [0.9, 0.9];
        P.sz = [0.25, 0.25];
        P.ex = [-0.15, -0.15];
        P.hx = [-0.05, 0.05];
        P.kx = [0.15, 0.3];
        P.stretch = 1.06;
      } else {
        // スーパーマン：片手を前に、もう片手は体にそわせる
        P.sx = [0.32 - 0.08 * Math.sin(t * 7), -2.85 * k - 0.6 * (1 - k)];
        P.sz = [0.3, -0.02];
        P.ex = [-0.45, -0.08];
        P.hx = [0.1 + 0.06 * Math.sin(t * 8), -0.02 - 0.06 * Math.sin(t * 8)];
        P.kx = [0.3, 0.55];
      }
      P.chestX = -0.15 * k;
      P.headX = -0.95 * k; // 進む方を見る
      P.fx = [0.4, 0.5];
      break;
    }
    case 'ground': {
      const ph = st.runPhase || 0;
      const k = clamp(st.speed01, 0, 1);
      P.bodyX = 0.22 * k;
      P.sx = [Math.sin(ph) * 1.0 * k - 0.25, -Math.sin(ph) * 1.0 * k - 0.25];
      P.ex = [-1.25, -1.25];
      P.hx = [-Math.sin(ph) * 0.9 * k, Math.sin(ph) * 0.9 * k];
      P.kx = [Math.max(0, Math.cos(ph)) * 1.3 * k + 0.05, Math.max(0, -Math.cos(ph)) * 1.3 * k + 0.05];
      P.spineY = Math.sin(ph) * 0.18 * k;
      P.bodyRise = Math.abs(Math.sin(ph)) * 0.05 * k;
      if (k < 0.1) {
        // ファイティングポーズ（ステップを少し踏む）
        const b = Math.sin(t * 5);
        P.sx = [-1.05, -0.95];
        P.sz = [0.32, 0.3];
        P.ex = [-1.75, -1.6];
        P.hx = [-0.15, 0.22];
        P.kx = [0.25 + 0.05 * b, 0.32 - 0.05 * b];
        P.spineY = -0.25;
        P.headY = 0.2;
        P.bodyRise = -0.02 + 0.015 * b;
      }
      break;
    }
    case 'punch': {
      // 予備動作（引く）→ 一気に伸ばす → もどす。体のひねりで重さを出す
      const p = st.punchPhase; // 0→1
      const side = st.punchSide;
      const sgn = side === R ? -1 : 1;
      let ext;
      if (p < 0.12) ext = -0.35 * (p / 0.12);
      else if (p < 0.3) ext = -0.35 + 1.35 * ease((p - 0.12) / 0.18);
      else ext = 1 - ease((p - 0.3) / 0.7);
      P.bodyX = 0.15;
      P.sx = [-1.05, -1.05];
      P.sz = [0.3, 0.3];
      P.ex = [-1.7, -1.7];
      P.hx = [0.12, -0.18];
      P.kx = [0.55, 0.35];
      if (st.heavy) {
        // アッパー
        const e = Math.max(0, ext);
        P.sx[side] = -0.4 - 2.5 * e + 0.6 * Math.min(0, ext);
        P.ex[side] = -1.5 + 1.3 * e;
        P.bodyX = 0.25 - 0.55 * e;
        P.spineY = sgn * (0.45 * e - 0.4 * Math.min(0, ext));
        P.chestX = -0.25 * e;
        P.kx = [0.25, 0.15];
        P.stretch = 1 + 0.06 * e;
      } else {
        P.sx[side] = -1.05 - 0.6 * ext;
        P.sz[side] = 0.3 - 0.45 * Math.max(0, ext);
        P.ex[side] = -1.7 + 1.65 * Math.max(0, ext);
        P.spineY = sgn * 0.6 * ext;
        P.chestZ = -sgn * 0.08 * ext;
      }
      P.headY = -P.spineY * 0.5;
      P.face = FACES.attack;
      break;
    }
    case 'shoot': {
      const p = st.punchPhase;
      const side = st.punchSide;
      const ext = p < 0.25 ? p / 0.25 : 1 - (p - 0.25) / 0.75;
      P.bodyX = 0.1;
      P.sx = [-0.75, -0.75];
      P.ex = [-1.4, -1.4];
      P.sx[side] = -1.5 - 0.2 * ext;
      P.ex[side] = -0.2 + 0.2 * ext;
      P.spineY = (side === R ? -1 : 1) * 0.35;
      P.headY = -P.spineY * 0.6;
      P.hx = [0.1, -0.15];
      P.kx = [0.5, 0.3];
      P.face = FACES.attack;
      break;
    }
    case 'hurt': {
      P.bodyX = -0.5;
      P.chestX = 0.25;
      P.sx = [0.7, 0.6];
      P.sz = [1.0, 0.9];
      P.ex = [-0.4, -0.3];
      P.hx = [-0.45, -0.2];
      P.kx = [0.7, 0.5];
      P.headX = 0.45;
      P.face = FACES.hurt;
      P.stretch = 0.95;
      break;
    }
    case 'stun': {
      P.bodyX = 0.1;
      P.bodyZ = Math.sin(t * 9) * 0.18;
      P.sx = [0.25, 0.2];
      P.sz = [0.55, 0.5];
      P.ex = [-0.25, -0.2];
      P.headY = Math.sin(t * 7) * 0.4;
      P.headZ = Math.sin(t * 9 + 1) * 0.2;
      P.kx = [0.45, 0.4];
      P.face = FACES.ko;
      break;
    }
    case 'ko': {
      P.bodyX = -1.2;
      P.sx = [-2.7, -2.5];
      P.sz = [1.1, 1.0];
      P.hx = [-0.6, -0.4];
      P.kx = [0.4, 0.7];
      P.headX = 0.5;
      P.face = FACES.ko;
      break;
    }
    case 'special': {
      // 力をためるポーズ（腕を広げ、胸をそらす）
      P.bodyX = -0.15;
      P.chestX = -0.25;
      P.sx = [-1.3, -1.3];
      P.sz = [1.2, 1.2];
      P.ex = [-0.35, -0.35];
      P.hx = [-0.3, 0.3];
      P.hz = [0.25, -0.25];
      P.kx = [0.35, 0.35];
      P.headX = -0.3;
      P.face = FACES.special;
      break;
    }
    case 'win': {
      winPose(P, root.userData.def, t);
      P.face = FACES.happy;
      break;
    }
    case 'cutin': {
      cutinPose(P, root.userData.def);
      P.face = FACES.special;
      break;
    }
    case 'lose': {
      // 肩を落としてうなだれる（顔は見えるくらいに）
      P.bodyX = 0.2;
      P.chestX = 0.18;
      P.headX = 0.3;
      P.headZ = 0.12;
      P.sx = [0.2, 0.16];
      P.sz = [0.06, 0.05];
      P.ex = [-0.25, -0.2];
      P.kx = [0.25, 0.3];
      P.bodyRise = -0.03 + 0.01 * Math.sin(t * 1.6);
      P.face = FACES.sad;
      break;
    }
    default: {
      // ホバー（空中でかまえる。ボクサーのガード）
      const b = Math.sin(t * 2.2);
      P.bodyX = 0.12;
      P.bodyZ = bank;
      P.sx = [-1.05 + 0.06 * b, -1.0 + 0.06 * Math.sin(t * 2.2 + 1)];
      P.sz = [0.32, 0.3];
      P.ex = [-1.8, -1.72];
      P.hx = [-0.08 + 0.08 * Math.sin(t * 2), 0.28 + 0.08 * Math.sin(t * 2 + 1.2)];
      P.kx = [0.4, 0.7];
      P.fx = [0.25, 0.35];
      P.spineY = -0.12;
      P.headY = 0.08;
      P.bodyRise = b * 0.035;
    }
  }
  // エモート（スタンプ・ロビー・KOのあと）：上半身だけ重ねる。攻撃・やられ・スペシャル中はそちらを優先
  if (st.emote && st.emoteT > 0 && !BUSY_MODES.has(st.mode)) emotePose(P, st.emote, st.emoteDur ? 1 - st.emoteT / st.emoteDur : 0.5, t);
  const k = st.snap ? 1000 : 16;
  parts.body.rotation.x = damp(parts.body.rotation.x, P.bodyX, k, dt);
  parts.body.rotation.z = damp(parts.body.rotation.z, P.bodyZ, 9, dt);
  parts.body.rotation.y = damp(parts.body.rotation.y, P.bodyY, 10, dt);
  parts.body.position.y = damp(parts.body.position.y, P.bodyRise, 12, dt);
  parts.spine.rotation.y = damp(parts.spine.rotation.y, P.spineY, 22, dt);
  parts.spine.rotation.x = damp(parts.spine.rotation.x, P.spineX, 14, dt);
  parts.chest.rotation.x = damp(parts.chest.rotation.x, P.chestX, 14, dt);
  parts.chest.rotation.z = damp(parts.chest.rotation.z, P.chestZ, 14, dt);
  parts.head.rotation.x = damp(parts.head.rotation.x, P.headX, 10, dt);
  parts.head.rotation.y = damp(parts.head.rotation.y, P.headY, 10, dt);
  parts.head.rotation.z = damp(parts.head.rotation.z, P.headZ, 10, dt);
  // ゆれる髪（後ろ髪・ポニーテール）：頭のかたむきを打ち消して、体にそって下がる。飛ぶと後ろへなびく
  if (parts.hairPivots && parts.hairPivots.length) {
    const fly = st.mode === 'fly' || st.mode === 'dash' ? (st.mode === 'dash' ? 1 : clamp(st.speed01 || 0, 0, 1)) : 0;
    for (const hp of parts.hairPivots) {
      const tx = -parts.head.rotation.x * hp.k + fly * hp.fly + hp.sway * Math.sin(t * 2.3 + hp.k * 3);
      const tz = -parts.head.rotation.z * hp.k * 0.8 + hp.sway * 0.8 * Math.sin(t * 1.7) - (st.turn || 0) * 0.15;
      hp.g.rotation.x = st.snap ? tx : damp(hp.g.rotation.x, tx, 12, dt);
      hp.g.rotation.z = st.snap ? tz : damp(hp.g.rotation.z, tz, 12, dt);
    }
  }
  // 伸び縮み（ダッシュで少し伸び、痛いと少し縮む）
  const sy = damp(parts.body.scale.y, P.stretch, 14, dt);
  parts.body.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
  for (let i = 0; i < 2; i++) {
    const a = parts.arms[i];
    a.shoulder.rotation.x = damp(a.shoulder.rotation.x, P.sx[i], k + 8, dt);
    a.shoulder.rotation.z = damp(a.shoulder.rotation.z, P.sz[i] * a.side, k, dt);
    a.shoulder.rotation.y = damp(a.shoulder.rotation.y, P.sy[i] * a.side, k, dt);
    a.elbow.rotation.x = damp(a.elbow.rotation.x, P.ex[i], k + 8, dt);
    const g = parts.legs[i];
    g.hip.rotation.x = damp(g.hip.rotation.x, -P.hx[i], k, dt);
    g.hip.rotation.z = damp(g.hip.rotation.z, P.hz[i], k, dt);
    g.knee.rotation.x = damp(g.knee.rotation.x, P.kx[i], k, dt);
    if (g.foot) g.foot.rotation.x = damp(g.foot.rotation.x, P.fx[i], k, dt);
  }
  // スカート：脚の動きに少しついていく（脚がつきぬけないように）
  if (parts.skirt) {
    const h0 = parts.legs[0].hip.rotation, h1 = parts.legs[1].hip.rotation;
    parts.skirt.rotation.x = (h0.x + h1.x) * 0.5 * 0.6;
    parts.skirt.rotation.z = (h0.z + h1.z) * 0.5 * 0.5;
    const spread = Math.abs(h0.z - h1.z) + Math.abs(h0.x - h1.x) * 0.5;
    parts.skirt.scale.set(1 + spread * 0.18, 1, 1 + Math.abs(h0.x - h1.x) * 0.12);
  }
  // 表情（まばたきつき）
  const B = root.userData.blink;
  let f = st.face != null && st.face >= 0 ? st.face : P.face;
  if (f < 0) {
    f = FACES.neutral;
    if (B) {
      B.t -= dt;
      if (B.t <= 0) {
        B.on = 0.12;
        B.t = 2.2 + Math.random() * 2.8;
      }
      if (B.on > 0) {
        B.on -= dt;
        f = FACES.blink;
      }
    }
  }
  setFace(root, f);
}

// 勝ちポーズ（キャラごと）。t：時間、b：はずみ（-1〜1）。知らないキャラは両手を上げる
const WIN_POSES = {
  // ドラ：両手を上げて大笑い
  tora(P, t, b) {
    P.sx = [-2.9 - 0.1 * b, -2.9 + 0.1 * b];
    P.sz = [0.45, 0.45];
    P.ex = [-0.35, -0.35];
    P.chestX = -0.2;
    P.headX = -0.3;
    P.bodyRise = Math.abs(b) * 0.06;
    P.kx = [0.15, 0.15];
  },
  // エブン：泳ぐように片手を突き上げてジャンプ
  even(P, t, b) {
    P.sx = [-0.5, -3.0 - 0.12 * b];
    P.sz = [0.4, 0.2];
    P.ex = [-1.6, -0.1];
    P.hx = [0.4, -0.2];
    P.kx = [1.0, 0.2];
    P.bodyRise = 0.05 + Math.abs(b) * 0.07;
    P.headX = -0.2;
  },
  // アオッチ：メガネに手をそえて、決めポーズ
  aomachi(P) {
    P.sx = [-0.3, -2.25];
    P.sz = [0.25, 0.65];
    P.sy = [0, 0.3];
    P.ex = [-0.4, -2.2];
    P.spineY = -0.3;
    P.headY = 0.25;
    P.headX = 0.05;
    P.hx = [-0.1, 0.18];
    P.kx = [0.1, 0.2];
  },
  // てつんど：エアドラム（スティックを交互にふり下ろす。片足でペダル）
  tetsundo(P, t) {
    const d = Math.sin(t * 13);
    P.sx = [-1.15 - 0.55 * Math.max(0, d), -1.15 - 0.55 * Math.max(0, -d)];
    P.sz = [0.38, 0.38];
    P.ex = [-1.15, -1.15];
    P.chestX = 0.12;
    P.headX = 0.06 + 0.06 * Math.abs(d);
    P.kx = [0.45 + 0.25 * Math.max(0, d), 0.2];
    P.bodyRise = 0.02 * Math.abs(d);
  },
  // コーダイ：かんぱい！（片手を高く。酔ってゆれる）
  koudai(P, t) {
    const w = Math.sin(t * 2.6);
    P.sx = [-2.85, 0.15];
    P.sz = [0.32, 0.7];
    P.ex = [-0.35, -1.7];
    P.bodyZ = 0.12 * w;
    P.headZ = 0.16 * Math.sin(t * 2.6 + 0.7);
    P.headX = -0.15;
    P.chestX = -0.1;
    P.hx = [0.1, -0.12];
    P.kx = [0.25, 0.4];
  },
  // はやた：ゴールの両手ガッツポーズ（自転車レースのゴール）
  hayata(P, t, b) {
    P.sx = [-2.7, -2.7];
    P.sz = [0.78, 0.78];
    P.ex = [-0.25, -0.25];
    P.chestX = -0.25;
    P.headX = -0.35;
    P.bodyRise = 0.03 + Math.abs(b) * 0.04;
    P.kx = [0.1, 0.1];
  },
  // なお：写真のまま、こぶしを鼻にあてて大笑い（肩がゆれる）。もう片手はひざへ
  takanobu(P, t) {
    P.sx = [-2.25, -0.35];
    P.sz = [-0.3, 0.35];
    P.sy = [0.2, 0];
    P.ex = [-2.55, -0.9];
    P.chestX = 0.2 + 0.06 * Math.sin(t * 15);
    P.headX = 0.12 + 0.04 * Math.sin(t * 15 + 0.6);
    P.headY = -0.18;
    P.spineY = -0.15;
    P.kx = [0.35, 0.3];
  },
  // こうた：腕を組んで「ふん」とそっぽを向く
  kouta(P) {
    P.sx = [-1.2, -1.32];
    P.sz = [-0.32, -0.42];
    P.sy = [0.55, 0.55];
    P.ex = [-2.15, -2.0];
    P.headY = 0.42;
    P.headX = -0.1;
    P.spineY = -0.12;
    P.kx = [0.12, 0.18];
  },
  // まさし：頭の上で大きなハート（K-POP）
  masashi(P, t) {
    P.sx = [-2.85, -2.85];
    P.sz = [0.62, 0.62];
    P.ex = [-1.95, -1.95];
    P.headZ = 0.15;
    P.bodyZ = 0.05 * Math.sin(t * 3);
    P.hx = [0.0, 0.14];
    P.kx = [0.15, 0.35];
  },
  // こうせい：ジャンプシュート（話を盛るドヤ顔）
  kousei(P, t, b) {
    P.sx = [-3.0, -2.45];
    P.sz = [0.12, 0.45];
    P.ex = [-0.45, -1.45];
    P.headX = -0.28;
    P.bodyRise = 0.05 + Math.abs(b) * 0.06;
    P.kx = [0.55, 0.55];
    P.hx = [0.25, 0.25];
    P.fx = [0.6, 0.6];
  },
  // しょうた：写真の決めポーズ（胸の前で両腕をクロスして手を上げ、片ひざを内に曲げる）
  shouta(P, t) {
    P.sx = [-1.25, -1.4];
    P.sz = [-0.55, -0.42];
    P.sy = [0.35, 0.3];
    P.ex = [-2.45, -2.3];
    P.spineY = 0.18;
    P.chestZ = 0.06;
    P.headZ = -0.14;
    P.headY = 0.12;
    P.hx = [0.05, 0.3];
    P.hz = [0.02, 0.22];
    P.kx = [0.12, 0.95];
    P.fx = [0.1, 0.5];
    P.bodyRise = 0.01 * Math.sin(t * 2);
  },
  // ちじわ：だるそうに手をふる（かぜ気味）
  chijiwa(P, t) {
    P.sx = [0.12, -2.3];
    P.sz = [0.08, 0.35 + 0.18 * Math.sin(t * 3.2)];
    P.ex = [-0.2, -0.9];
    P.chestX = 0.18;
    P.headX = 0.12;
    P.headZ = 0.22;
    P.kx = [0.3, 0.2];
  },
  // ナオT：大きく両手を広げる（やさしい、ハグの形）
  naot(P, t) {
    P.sx = [-1.15, -1.15];
    P.sz = [1.1, 1.1];
    P.ex = [-0.55, -0.55];
    P.chestX = -0.08;
    P.headZ = 0.1;
    P.bodyRise = 0.015 * Math.sin(t * 2.5);
    P.kx = [0.12, 0.12];
  },
  // トリキ：両手のガッツポーズを前に（いいやつ）
  toriki(P, t, b) {
    P.sx = [-1.45, -1.45];
    P.sz = [0.3, 0.3];
    P.ex = [-1.35 - 0.15 * b, -1.35 + 0.15 * b];
    P.headX = -0.1;
    P.bodyRise = Math.abs(b) * 0.04;
    P.kx = [0.2, 0.2];
  },
  // みのり：ほおに両手をそえて、片足を後ろに上げる（かわいい）
  minori(P, t) {
    P.sx = [-2.05, -2.05];
    P.sz = [0.12, 0.12];
    P.ex = [-2.55, -2.55];
    P.headZ = 0.2;
    P.hx = [0.04, -0.08];
    P.kx = [0.1, 1.35];
    P.bodyRise = 0.02 + 0.015 * Math.sin(t * 3);
  },
  // まな：スマホで自撮り（もう片手はピース）
  mana(P, t) {
    P.sx = [-2.35, -2.25];
    P.sz = [0.32, 0.42];
    P.sy = [-0.3, 0];
    P.ex = [-0.3, -2.4];
    P.headZ = -0.16;
    P.headY = -0.18;
    P.hx = [0.1, -0.04];
    P.kx = [0.3, 0.1];
  },
  // あやな：胸の前で手を合わせて、にっこり（聞き上手）
  ayana(P, t) {
    P.sx = [-1.3, -1.3];
    P.sz = [-0.12, -0.12];
    P.ex = [-1.95, -1.95];
    P.headZ = 0.2;
    P.bodyZ = 0.04 * Math.sin(t * 2);
    P.kx = [0.15, 0.2];
  },
  // ゆか：ハイキック！
  yuka(P, t) {
    P.bodyX = -0.32;
    P.hx = [-0.18, 1.85];
    P.kx = [0.3, 0.12];
    P.fx = [0.2, 0.7];
    P.sx = [-0.55, -1.85];
    P.sz = [1.05, 0.75];
    P.ex = [-0.45, -0.7];
    P.headX = 0.15;
    P.bodyRise = 0.02 * Math.sin(t * 4);
  },
};
function winPose(P, def, t) {
  const b = Math.sin(t * 5);
  const f = WIN_POSES[def && def.id];
  if (f) return f(P, t, b);
  // 知らないキャラ：両手を上げてジャンプ
  P.sx = [-2.8 - 0.1 * b, -2.8 + 0.1 * b];
  P.sz = [0.45, 0.45];
  P.ex = [-0.3, -0.3];
  P.chestX = -0.15;
  P.headX = -0.25;
  P.bodyRise = Math.abs(b) * 0.05;
  P.kx = [0.2, 0.2];
}

// スペシャルのカットイン用の決めポーズ（キャラごと。絵として見せるので、少し大げさに）
const CUTIN_POSES = {
  // ドラ：胸をそらして大笑い。両腕を大きく広げる
  tora(P) {
    P.bodyX = -0.08;
    P.chestX = -0.2;
    P.headX = -0.14;
    P.spineY = 0.12;
    P.sx = [-1.35, -1.15];
    P.sz = [0.95, 1.1];
    P.ex = [-0.7, -0.9];
  },
  // エブン：こちらへ向かって大きなパンチ（こぶしが手前に大きく見える）。もう片手は引く
  even(P) {
    P.bodyX = 0.12;
    P.spineY = 0.42;
    P.chestX = 0.05;
    P.headY = -0.2;
    P.sx = [-1.55, 0.35];
    P.sz = [0.05, 0.45];
    P.ex = [-0.08, -1.7];
  },
  // アオッチ：前髪をかき上げる（メガネを外したイケメン）。もう片手は外へ
  aomachi(P) {
    P.spineY = -0.2;
    P.chestX = -0.1;
    P.headY = 0.18;
    P.headX = -0.1;
    P.sx = [-1.2, -2.85];
    P.sz = [1.0, 0.55];
    P.sy = [0, 0.35];
    P.ex = [-0.35, -2.25];
  },
  // てつんど：スティックを両方ふり上げて、シンバルをたたく直前
  tetsundo(P) {
    P.chestX = -0.18;
    P.headX = -0.08;
    P.spineY = 0.15;
    P.sx = [-2.75, -2.45];
    P.sz = [0.42, 0.58];
    P.ex = [-1.25, -1.0];
  },
  // コーダイ：酔ったいきおいの大ぶりパンチ
  koudai(P) {
    P.spineY = 0.5;
    P.bodyZ = 0.14;
    P.headZ = -0.18;
    P.sx = [-1.6, 0.35];
    P.sz = [0.25, 0.55];
    P.ex = [-0.5, -1.3];
  },
  // はやた：自転車の前かがみ（ハンドルをにぎる形）で突っこむ
  hayata(P) {
    P.chestX = 0.4;
    P.headX = -0.45;
    P.sx = [-1.35, -1.35];
    P.sz = [0.12, 0.12];
    P.ex = [-1.5, -1.5];
  },
  // なお：ほえながら、こちらへ大きなパンチ
  takanobu(P) {
    P.bodyX = 0.1;
    P.spineY = 0.45;
    P.chestX = -0.05;
    P.headY = -0.2;
    P.sx = [-1.6, 0.4];
    P.sz = [0.08, 0.6];
    P.ex = [-0.08, -1.9];
  },
  // こうた：怒ってこちらを指さす
  kouta(P) {
    P.spineY = -0.25;
    P.headX = 0.08;
    P.sx = [0.2, -1.55];
    P.sz = [0.25, -0.05];
    P.ex = [-0.3, 0.0];
  },
  // まさし：顔の横で指ハート
  masashi(P) {
    P.spineY = -0.2;
    P.headZ = 0.16;
    P.sx = [-0.35, -2.2];
    P.sz = [0.25, 0.25];
    P.ex = [-0.4, -2.1];
  },
  // こうせい：「おれがナンバーワン」と上を指す
  kousei(P) {
    P.spineY = 0.2;
    P.headX = -0.15;
    P.chestX = -0.1;
    P.sx = [-3.0, 0.3];
    P.sz = [0.18, 0.55];
    P.ex = [-0.1, -1.4];
  },
  // しょうた：目の横でピース
  shouta(P) {
    P.headZ = 0.15;
    P.headY = 0.1;
    P.spineY = -0.1;
    P.sx = [-2.55, 0.2];
    P.sz = [0.38, 0.5];
    P.ex = [-2.35, -1.2];
  },
  // ちじわ：くしゃみのいきおいでパンチ
  chijiwa(P) {
    P.chestX = 0.28;
    P.headX = 0.22;
    P.spineY = 0.3;
    P.sx = [-1.6, -1.0];
    P.sz = [0.1, 0.4];
    P.ex = [-0.2, -1.9];
  },
  // ナオT：すもうの突っぱり（大きな手のひらを前へ）
  naot(P) {
    P.spineY = 0.4;
    P.chestX = 0.1;
    P.sx = [-1.55, -1.15];
    P.sz = [0.15, 0.4];
    P.ex = [-0.06, -1.5];
  },
  // トリキ：ラグビーのタックル（肩から当たる）
  toriki(P) {
    P.spineY = -0.75;
    P.chestX = 0.25;
    P.headX = -0.2;
    P.headY = 0.4;
    P.sx = [-0.6, -0.6];
    P.sz = [0.55, 0.55];
    P.ex = [-1.8, -1.8];
  },
  // みのり：両手でかわいくパンチ
  minori(P) {
    P.headZ = 0.2;
    P.chestX = 0.05;
    P.sx = [-1.5, -1.5];
    P.sz = [-0.1, -0.1];
    P.ex = [-0.7, -0.7];
  },
  // まな：スマホで応援をよぶ（片手は前を指す）
  mana(P) {
    P.headZ = -0.2;
    P.sx = [-2.6, -1.5];
    P.sz = [0.6, 0.05];
    P.ex = [-2.55, -0.05];
    P.spineY = -0.15;
  },
  // あやな：胸に手をあてて、もう片手を前へ
  ayana(P) {
    P.headZ = 0.15;
    P.sx = [-1.2, -1.5];
    P.sz = [-0.3, 0.1];
    P.ex = [-2.0, -0.2];
  },
  // ゆか：こちらへとびげり
  yuka(P) {
    P.bodyX = -0.3;
    P.hx = [-0.3, 1.6];
    P.kx = [1.2, 0.2];
    P.fx = [0.3, 0.7];
    P.sx = [-0.4, -1.2];
    P.sz = [0.9, 0.7];
    P.ex = [-0.6, -1.4];
  },
};
function cutinPose(P, def) {
  const f = CUTIN_POSES[def && def.id];
  if (f) return f(P);
  // 知らないキャラ：こちらへパンチ
  P.bodyX = 0.1;
  P.spineY = 0.4;
  P.headY = -0.2;
  P.sx = [-1.55, 0.35];
  P.sz = [0.05, 0.45];
  P.ex = [-0.08, -1.7];
}

const BUSY_MODES = new Set(['punch', 'shoot', 'hurt', 'stun', 'ko', 'special', 'dash']);
// 倒したあとの決めの身ぶり（キャラごと）
export const KO_EMOTE = {
  tora: 'laugh', even: 'flex', aomachi: 'point', tetsundo: 'drum', koudai: 'cheers', hayata: 'salute', takanobu: 'nose', kouta: 'cross', masashi: 'heart',
  kousei: 'shrug', shouta: 'xpose', chijiwa: 'cough', naot: 'bow', toriki: 'thumbs', minori: 'cute', mana: 'phone', ayana: 'clap', yuka: 'kick',
};
// ロビーでときどきする身ぶり（キャラごと。main.js の lobbyEmote で使える）
export const EMOTE_PICKS = {
  tora: ['laugh', 'flex', 'wave', 'thumbs'], even: ['wave', 'thumbs', 'flex', 'point'], aomachi: ['point', 'thumbs', 'wave', 'bow'],
  tetsundo: ['drum', 'thumbs', 'laugh'], koudai: ['cheers', 'laugh', 'wave'], hayata: ['salute', 'wave', 'thumbs'], takanobu: ['nose', 'flex', 'thumbs'],
  kouta: ['cross', 'point', 'thumbs'], masashi: ['heart', 'peace', 'wave'], kousei: ['shrug', 'point', 'thumbs'], shouta: ['xpose', 'peace', 'wave'],
  chijiwa: ['cough', 'wave', 'bow'], naot: ['bow', 'wave', 'thumbs'], toriki: ['thumbs', 'flex', 'wave'], minori: ['cute', 'wave', 'peace'],
  mana: ['phone', 'peace', 'wave'], ayana: ['clap', 'bow', 'wave'], yuka: ['kick', 'peace', 'wave'],
};
// エモート（上半身だけ）。k = 0→1 の進み
function emotePose(P, e, k, t) {
  const w = Math.sin(Math.min(1, k * 1.3) * Math.PI); // 出し入れ
  if (e === 'wave') {
    P.sx[1] = -2.6;
    P.sz[1] = 0.5 + 0.35 * Math.sin(t * 14);
    P.ex[1] = -0.6;
    P.face = FACES.happy;
  } else if (e === 'thumbs' || e === 'nice') {
    P.sx[1] = -1.5 * w - 0.2;
    P.sz[1] = 0.25;
    P.ex[1] = -1.5 * w;
    P.face = FACES.happy;
  } else if (e === 'bow') {
    P.chestX = 0.55 * w;
    P.headX = 0.3 * w;
    P.sx = [0.1, 0.1];
    P.face = FACES.blink;
  } else if (e === 'flex') {
    P.sx = [-1.5, -1.5];
    P.sz = [1.3, 1.3];
    P.ex = [-2.1, -2.1];
    P.chestX = -0.15;
    P.face = FACES.special;
  } else if (e === 'laugh') {
    P.chestX = -0.25 + 0.12 * Math.sin(t * 18);
    P.headX = -0.35;
    P.sx = [-0.4, -0.4];
    P.sz = [0.5, 0.5];
    P.ex = [-1.9, -1.9];
    P.face = FACES.happy;
  } else if (e === 'point') {
    P.sx[1] = -1.6;
    P.sz[1] = -0.1;
    P.ex[1] = 0;
    P.spineY = -0.3;
    P.face = FACES.attack;
  } else if (e === 'sorry') {
    P.sx = [-1.2, -1.2];
    P.sz = [-0.2, -0.2];
    P.ex = [-1.9, -1.9];
    P.headX = 0.35;
    P.face = FACES.sad;
  } else if (e === 'drum') {
    // エアドラム
    const d = Math.sin(t * 14);
    P.sx = [-1.1 - 0.5 * Math.max(0, d), -1.1 - 0.5 * Math.max(0, -d)];
    P.sz = [0.38, 0.38];
    P.ex = [-1.2, -1.2];
    P.headX = 0.08;
    P.face = FACES.happy;
  } else if (e === 'cheers') {
    // かんぱい
    P.sx[0] = -2.8 * w - 0.1;
    P.sz[0] = 0.3;
    P.ex[0] = -0.4;
    P.headZ = 0.12 * Math.sin(t * 3);
    P.face = FACES.happy;
  } else if (e === 'salute') {
    // 二本指の敬礼
    P.sx[1] = -2.6 * w - 0.2;
    P.sz[1] = 0.2;
    P.ex[1] = -2.4 * w;
    P.headY = -0.1;
    P.face = FACES.happy;
  } else if (e === 'cross') {
    // 腕組みでそっぽ
    P.sx = [-1.2, -1.32];
    P.sz = [-0.32, -0.42];
    P.sy = [0.55, 0.55];
    P.ex = [-2.15, -2.0];
    P.headY = 0.4 * w;
    P.face = FACES.attack;
  } else if (e === 'heart') {
    // 頭の上でハート
    P.sx = [-2.85, -2.85];
    P.sz = [0.62, 0.62];
    P.ex = [-1.95, -1.95];
    P.headZ = 0.15;
    P.face = FACES.happy;
  } else if (e === 'shrug') {
    // 「よゆう」と肩をすくめる
    P.sx = [-0.35, -0.35];
    P.sz = [0.95, 0.95];
    P.ex = [-1.7, -1.7];
    P.headZ = 0.16 * w;
    P.chestX = -0.06;
  } else if (e === 'peace') {
    // ピース
    P.sx[1] = -2.45;
    P.sz[1] = 0.35;
    P.ex[1] = -2.4 * w;
    P.headZ = 0.15;
    P.face = FACES.happy;
  } else if (e === 'cough') {
    // せきこむ（風邪）
    P.chestX = 0.3 + 0.12 * Math.sin(t * 13);
    P.headX = 0.28;
    P.sx = [-1.7, -0.3];
    P.sz = [0.0, 0.2];
    P.ex = [-2.4, -0.4];
    P.face = FACES.hurt;
  } else if (e === 'cute') {
    // ほおに両手
    P.sx = [-2.05, -2.05];
    P.sz = [0.12, 0.12];
    P.ex = [-2.55, -2.55];
    P.headZ = 0.2 * w;
    P.face = FACES.happy;
  } else if (e === 'phone') {
    // スマホを耳に
    P.sx[0] = -2.6 * w - 0.1;
    P.sz[0] = 0.6;
    P.ex[0] = -2.6 * w;
    P.headZ = -0.2 * w;
  } else if (e === 'clap') {
    // 拍手
    const c = 0.5 + 0.5 * Math.sin(t * 16);
    P.sx = [-1.3, -1.3];
    P.sz = [-0.05 - 0.22 * c, -0.05 - 0.22 * c];
    P.ex = [-1.55, -1.55];
    P.face = FACES.happy;
  } else if (e === 'nose') {
    // なお：こぶしを鼻にあてて大笑い
    P.sx[0] = -2.25 * w - 0.05;
    P.sz[0] = -0.3;
    P.sy[0] = 0.2;
    P.ex[0] = -2.55 * w;
    P.chestX = (0.18 + 0.06 * Math.sin(t * 15)) * w;
    P.headX = 0.1 * w;
    P.headY = -0.15 * w;
    P.face = FACES.happy;
  } else if (e === 'xpose') {
    // しょうた：写真の決めポーズ（胸の前で両腕をクロス）
    P.sx = [-1.25 * w, -1.4 * w];
    P.sz = [-0.55 * w + 0.12 * (1 - w), -0.42 * w + 0.12 * (1 - w)];
    P.sy = [0.35 * w, 0.3 * w];
    P.ex = [-2.45 * w, -2.3 * w];
    P.headZ = -0.14 * w;
    P.headY = 0.12 * w;
    P.face = FACES.special;
  } else if (e === 'kick') {
    // けり
    P.hx[1] = 1.7 * w;
    P.kx[1] = 0.2;
    P.bodyX = -0.3 * w;
    P.sx = [-0.55, -1.7];
    P.sz = [0.95, 0.6];
    P.ex = [-0.4, -0.7];
    P.face = FACES.attack;
  }
}

export function setJetGlow(root, on) {
  const parts = root.userData.parts;
  for (const g of parts.legs) g.jet.visible = on;
}
