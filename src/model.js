// キャラの3Dモデルと動き（ポーズ）・表情
// v1.4：キックフライト／#コンパス／バウンティラッシュの調査をもとに作り直し
//  ・頭身：約4.3頭身（キックフライトのキッカーに近い、手足の長いアニメ体型）。丸い部品の寄せ集めをやめ、
//    先細りの手足・胸と腰のくびれ・あごの細いアニメ顔
//  ・表情：顔は「表情の絵」を貼った板を頭にかぶせ、状況で切りかえる（ふつう・まばたき・攻撃・痛い・ダウン・勝ち・スペシャル・負け）
//  ・髪：毛束を1本ずつ作る（とがった束・前髪・天使の輪のハイライト）
//  ・ふちどり：部品の色を暗くした線（色トレス）。影は色をのせる（gfx.js の cel）
//  ・グローブとスニーカーのジェットはチームの色で光る（ブルームでにじむ）
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon, addOutline, outlineMat, roundedBox, canvasTex, lineColor } from './gfx.js';
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
function headShape(v, R) {
  const y = v.y / R;
  v.x *= 0.93;
  v.y *= 1.04;
  if (y < 0) {
    const k = smooth(0, -1, y);
    v.x *= 1 - 0.3 * k;
    if (v.z > 0) v.z *= 1 - 0.12 * k;
    else v.z *= 1 - 0.3 * k;
    if (v.z > 0) v.z += R * 0.05 * smooth(-0.45, -1, y);
    v.y -= R * 0.05 * k;
  } else if (v.z < 0) v.z *= 1.06;
  return v;
}
function smooth(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// ===== 表情の絵（4×2のマス。1マス256px）=====
// 0 ふつう 1 まばたき 2 攻撃 3 痛い 4 ダウン 5 勝ち 6 スペシャル 7 負け
export const FACES = { neutral: 0, blink: 1, attack: 2, hurt: 3, ko: 4, happy: 5, special: 6, sad: 7 };
const faceCache = new Map();
function faceAtlas(def) {
  if (faceCache.has(def.id)) return faceCache.get(def.id);
  const look = def.look;
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

// 1マスに顔をかく（中心 128。目の高さ 136）
function drawFace(ctx, look, ex) {
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

// ===== キャラを作る =====
export function buildPuncher(def, teamIdx) {
  const look = def.look;
  const team = TEAM[teamIdx];
  const root = new THREE.Group();
  const scaleBox = new THREE.Group(); // 身長
  const s = 0.8 * look.height;
  scaleBox.scale.setScalar(s);
  scaleBox.position.y = -0.1 * s; // 当たりの中心を体のまん中に
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
  const mShirt = C(look.shirt);
  const mSleeve = C(look.sleeve);
  const mPants = C(look.pants);
  const mShoe = C(look.shoe);
  const mAcc = C(look.shoeAccent);
  const mSole = C(0xf2f0ee, 'cool', { rim: 0.2 });
  const mGlove = C(team.hex, 'cool', { rim: 0.35, rimColor: 0xffffff });
  const mGlove2 = C(0xf4f4f6, 'cool', { rim: 0.25 });
  const mHair = C(look.hair, 'hair', { rim: 0.6 });
  const L = (c) => lineColor(c);

  // ---- 胴（胸のふくらみと腰のくびれ）----
  const bw = look.build;
  const torsoG = lathe(
    [
      [0.0, -0.02],
      [0.125 * bw, -0.015],
      [0.14 * bw, 0.06],
      [0.135 * bw, 0.14],
      [0.15 * bw, 0.24],
      [0.172 * bw, 0.33],
      [0.175 * bw, 0.4],
      [0.15 * bw, 0.47],
      [0.09, 0.505],
      [0.0, 0.51],
    ],
    18,
    0.7
  );
  const torso = mesh(torsoG, mShirt, L(look.shirt));
  torso.position.y = -0.2;
  chest.add(torso);
  // すそ（Tシャツの下のふち）
  const hem = mesh(new THREE.TorusGeometry(0.128 * bw, 0.018, 6, 20), mShirt, L(look.shirt), 0.01);
  hem.rotation.x = Math.PI / 2;
  hem.scale.set(1, 0.7, 1);
  hem.position.y = -0.2 + 0.0;
  chest.add(hem);
  // えり
  const collar = mesh(new THREE.TorusGeometry(0.068, 0.018, 6, 16), look.extra === 'tigerBand' ? mSleeve : mShirt, L(look.shirt), 0.01);
  collar.rotation.x = Math.PI / 2 - 0.25;
  collar.position.set(0, 0.29, 0.01);
  chest.add(collar);
  // 胸のプリント（キャラの柄）
  const print = new THREE.Mesh(new THREE.PlaneGeometry(0.115, 0.115), new THREE.MeshBasicMaterial({ map: chestPrint(def), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  print.position.set(0, 0.12, 0.124 * bw);
  print.renderOrder = 2;
  chest.add(print);
  // 腰（ズボン）
  const hipsG = lathe(
    [
      [0.0, -0.13],
      [0.1 * bw, -0.125],
      [0.135 * bw, -0.07],
      [0.14 * bw, 0.0],
      [0.128 * bw, 0.06],
      [0.0, 0.065],
    ],
    16,
    0.74
  );
  const hips = mesh(hipsG, mPants, L(look.pants));
  hips.position.y = 0.0;
  body.add(hips);
  // ベルト
  const belt = mesh(new THREE.TorusGeometry(0.127 * bw, 0.014, 6, 20), C(0x24232a), L(0x24232a), 0.008);
  belt.rotation.x = Math.PI / 2;
  belt.scale.set(1, 0.74, 1);
  belt.position.y = 0.045;
  body.add(belt);

  // ---- 首と頭 ----
  const neck = mesh(limbGeo(0.045, 0.05, 0.11, 10), mSkin, L(look.skin));
  neck.position.y = 0.39;
  neck.rotation.x = Math.PI;
  chest.add(neck);
  const head = new THREE.Group();
  head.position.y = 0.55;
  chest.add(head);
  const headG = new THREE.SphereGeometry(HEAD_R, 30, 24);
  {
    const p = headG.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      headShape(v, HEAD_R);
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
      headShape(v, HEAD_R);
      p.setXYZ(i, v.x, v.y, v.z);
    }
  }
  const faceTex = faceAtlas(def).clone();
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
  buildHair(hair, look, mHair, L(look.hair));
  // 小物
  if (look.extra === 'glasses') {
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
  if (look.extra === 'goggles') {
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

  // ---- 腕 ----
  const arms = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.172 * bw, 0.255, 0);
    chest.add(shoulder);
    // 肩（Tシャツのそで）
    const cap = mesh(new THREE.SphereGeometry(0.068, 14, 10), mShirt, L(look.shirt), 0.01);
    cap.scale.set(1, 0.95, 0.95);
    cap.position.y = -0.02;
    shoulder.add(cap);
    const upperMat = look.shortSleeve ? mSkin : mSleeve;
    const upper = mesh(limbGeo(0.052, 0.045, 0.24), upperMat, L(look.shortSleeve ? look.skin : look.sleeve));
    upper.position.y = -0.03;
    shoulder.add(upper);
    if (look.shortSleeve || look.extra === 'tigerBand') {
      const sleeve = mesh(lathe([[0.067, 0.0], [0.07, -0.05], [0.064, -0.11], [0.06, -0.115]], 14), mShirt, L(look.shirt), 0.01);
      sleeve.position.y = -0.02;
      shoulder.add(sleeve);
    }
    if (side === 1) {
      // チームのマーク（そで。少し光る）
      const badge = new THREE.Mesh(new THREE.CircleGeometry(0.026, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(team.light).multiplyScalar(1.4) }));
      badge.position.set(side * 0.066, -0.07, 0.0);
      badge.rotation.y = side * Math.PI / 2;
      shoulder.add(badge);
    }
    if (look.extra === 'tigerBand' && side === -1) {
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
    elbow.position.y = -0.26;
    shoulder.add(elbow);
    const lower = mesh(limbGeo(0.046, 0.04, 0.2), look.shortSleeve ? mSkin : mSleeve, L(look.shortSleeve ? look.skin : look.sleeve));
    elbow.add(lower);
    // グローブ（チームの色・白い手首・光るライン）
    const wrist = new THREE.Group();
    wrist.position.y = -0.23;
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
    arms.push({ shoulder, elbow, glove: wrist, side });
  }

  // ---- 脚 ----
  const legs = [];
  const shorts = look.extra === 'goggles'; // エブンは半ズボン
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.085 * bw, -0.06, 0);
    body.add(hip);
    const thigh = mesh(limbGeo(0.078, 0.062, 0.34), mPants, L(look.pants));
    thigh.position.y = -0.01;
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.y = -0.37;
    hip.add(knee);
    const shin = mesh(limbGeo(0.06, 0.045, 0.31), shorts ? mSkin : mPants, L(shorts ? look.skin : look.pants));
    knee.add(shin);
    if (shorts) {
      // 半ズボンのすそ・白いくつ下
      const cuffS = mesh(lathe([[0.083, 0.04], [0.08, -0.03], [0.074, -0.06]], 14), mPants, L(look.pants), 0.01);
      knee.add(cuffS);
      const sock = mesh(new THREE.CylinderGeometry(0.05, 0.048, 0.09, 12), C(0xf4f4f2), L(0xd0d0d0), 0.008);
      sock.position.y = -0.3;
      knee.add(sock);
    } else {
      // ジョガーパンツのすそ（しぼり）
      const cuffP = mesh(new THREE.CylinderGeometry(0.052, 0.055, 0.05, 12), C(new THREE.Color(look.pants).multiplyScalar(0.8).getHex()), L(look.pants), 0.008);
      cuffP.position.y = -0.31;
      knee.add(cuffP);
    }
    // スニーカー（厚いソール・色の切りかえ・かかとのジェット）
    const foot = new THREE.Group();
    foot.position.y = -0.34;
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
    const sole = mesh(roundedBox(0.142, 0.045, 0.285, 0.02, 1), mSole, L(0xc8c8cc), 0.008);
    sole.position.set(0, -0.09, 0.05);
    foot.add(sole);
    // かかとの噴射口（飛ぶと光る）
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.01, 6, 14), C(0x2a2d36));
    ring.position.set(0, -0.05, -0.085);
    foot.add(ring);
    const jet = new THREE.Mesh(new THREE.CircleGeometry(0.032, 14), new THREE.MeshBasicMaterial({ color: new THREE.Color(team.light).multiplyScalar(2.2) }));
    jet.position.set(0, -0.05, -0.09);
    jet.rotation.y = Math.PI;
    foot.add(jet);
    legs.push({ hip, knee, side, jet, foot });
  }

  root.userData.parts = { scaleBox, body, spine, chest, head, arms, legs, hair, face, faceTex };
  root.userData.def = def;
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
    groups.get(gi.key).items.push({ geo: o.geometry, m: _m.clone(), bone: boneIdx.get(b), color: gi.color });
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
    for (const it of grp.items) geos.push(skinGeo(it.geo, it.m, it.bone, keepUv, keepCol, it.color));
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
    groups.get(gi.key).items.push({ geo: o.geometry, m: _m.clone(), color: gi.color });
    old.push(o);
  });
  const made = [];
  for (const grp of groups.values()) {
    const mat = grp.gi.make();
    const keepUv = !!(mat.map || (mat.uniforms && mat.uniforms.cmap));
    const geos = grp.items.map((it) => {
      const g = skinGeo(it.geo, it.m, 0, keepUv, !!mat.vertexColors, it.color);
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

// まとめ方：色だけがちがう材質は「頂点の色」にして1つにする（キャラの描く回数がさらに減る）
const vcBasic = new Map();
function groupOf(o) {
  const mat = o.material;
  const ro = o.renderOrder;
  const U = mat.userData || {};
  if (o.name === 'outline' && U.outline && !mat.vertexColors) {
    const [w, a, b] = U.outline;
    return { key: `ol|${w}|${a}|${b}|${ro}`, color: mat.color, make: () => outlineMat(0xffffff, w, a, b, true) };
  }
  if (U.celOpts && !mat.vertexColors && mat.uniforms && mat.uniforms.diffuse) {
    const opts = U.celOpts;
    const k = JSON.stringify(opts, (kk, v) => (v && v.isTexture ? v.uuid : v));
    return { key: 'cel|' + k + '|' + ro, color: mat.uniforms.diffuse.value, make: () => toon(0xffffff, { ...opts, vertexColors: true }) };
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
// 1つの部品の形を、まとめ先の座標にして骨の番号をつける（color：頂点の色にする材質の色）
function skinGeo(src, m, bone, keepUv, keepCol, color) {
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
    } else {
      // アオッチ：ペン先（まんがを描く）
      ctx.fillStyle = '#1d1418';
      ctx.beginPath(); ctx.moveTo(128, 24); ctx.lineTo(196, 128); ctx.lineTo(128, 232); ctx.lineTo(60, 128); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.moveTo(128, 52); ctx.lineTo(176, 128); ctx.lineTo(128, 204); ctx.lineTo(80, 128); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#1d1418';
      ctx.beginPath(); ctx.arc(128, 120, 16, 0, 6.3); ctx.fill();
      ctx.fillRect(124, 120, 8, 84);
    }
  });
  t.userData.shared = true;
  printCache.set(def.id, t);
  return t;
}

// 髪：スタイルごとに毛束を組み立てる
function buildHair(hair, look, mat, line) {
  const R = HEAD_R;
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

// 勝ちポーズ（キャラごと）
function winPose(P, def, t) {
  const b = Math.sin(t * 5);
  const id = def && def.id;
  if (id === 'tora') {
    // ドラ：両手を上げて大笑い
    P.sx = [-2.9 - 0.1 * b, -2.9 + 0.1 * b];
    P.sz = [0.45, 0.45];
    P.ex = [-0.35, -0.35];
    P.chestX = -0.2;
    P.headX = -0.3;
    P.bodyRise = Math.abs(b) * 0.06;
    P.kx = [0.15, 0.15];
  } else if (id === 'even') {
    // エブン：泳ぐように片手を突き上げてジャンプ
    P.sx = [-0.5, -3.0 - 0.12 * b];
    P.sz = [0.4, 0.2];
    P.ex = [-1.6, -0.1];
    P.hx = [0.4, -0.2];
    P.kx = [1.0, 0.2];
    P.bodyRise = 0.05 + Math.abs(b) * 0.07;
    P.headX = -0.2;
  } else {
    // アオッチ：メガネに手をそえて、決めポーズ
    P.sx = [-0.3, -2.25];
    P.sz = [0.25, 0.65];
    P.sy = [0, 0.3];
    P.ex = [-0.4, -2.2];
    P.spineY = -0.3;
    P.headY = 0.25;
    P.headX = 0.05;
    P.hx = [-0.1, 0.18];
    P.kx = [0.1, 0.2];
  }
}

// スペシャルのカットイン用の決めポーズ（キャラごと。絵として見せるので、少し大げさに）
function cutinPose(P, def) {
  const id = def && def.id;
  if (id === 'tora') {
    // ドラ：胸をそらして大笑い。両腕を大きく広げる
    P.bodyX = -0.08;
    P.chestX = -0.2;
    P.headX = -0.14;
    P.spineY = 0.12;
    P.sx = [-1.35, -1.15];
    P.sz = [0.95, 1.1];
    P.ex = [-0.7, -0.9];
  } else if (id === 'even') {
    // エブン：こちらへ向かって大きなパンチ（こぶしが手前に大きく見える）。もう片手は引く
    P.bodyX = 0.12;
    P.spineY = 0.42;
    P.chestX = 0.05;
    P.headY = -0.2;
    P.sx = [-1.55, 0.35];
    P.sz = [0.05, 0.45];
    P.ex = [-0.08, -1.7];
  } else {
    // アオッチ：前髪をかき上げる（メガネを外したイケメン）。もう片手は外へ
    P.spineY = -0.2;
    P.chestX = -0.1;
    P.headY = 0.18;
    P.headX = -0.1;
    P.sx = [-1.2, -2.85];
    P.sz = [1.0, 0.55];
    P.sy = [0, 0.35];
    P.ex = [-0.35, -2.25];
  }
}

const BUSY_MODES = new Set(['punch', 'shoot', 'hurt', 'stun', 'ko', 'special', 'dash']);
// 倒したあとの決めの身ぶり（キャラごと）
export const KO_EMOTE = { tora: 'laugh', even: 'flex', aomachi: 'point' };
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
  }
}

export function setJetGlow(root, on) {
  const parts = root.userData.parts;
  for (const g of parts.legs) g.jet.visible = on;
}
