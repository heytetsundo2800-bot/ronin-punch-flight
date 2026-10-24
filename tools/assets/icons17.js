// アプリのアイコンの案を作る（v1.7・写真から作り直したキャラで）
// 作るだけ（えらばれたものを tools/assets/assets.js で本番のアイコンにする）
import * as THREE from 'three';
import { Portraits } from '../../src/portraits.js';
import { buildPuncher, poseModel, FACES } from '../../src/model.js';
import { disposeDeep } from '../../src/gfx.js';
import { PUNCHERS } from '../../src/characters.js';

const R = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
R.outputColorSpace = THREE.SRGBColorSpace;
const P = new Portraits(R);
const load = (src) => new Promise((res) => {
  const i = new Image();
  i.onload = () => res(i);
  i.src = src;
});
const JP = '"Noto Sans CJK JP","Noto Sans JP",sans-serif';
const EN = '"CP","Noto Sans CJK JP",sans-serif';

// 3Dのキャラを好きな向き・ポーズで撮る（頭の位置からカメラを置く）
function shot(id, team, o) {
  const model = buildPuncher(PUNCHERS[id], team);
  P.scene.add(model);
  const st = { mode: o.mode || 'hover', t: o.t == null ? 0.6 : o.t, speed01: o.speed == null ? 0 : o.speed, turn: o.turn || 0, punchSide: o.side == null ? 1 : o.side, punchPhase: o.phase == null ? 0.35 : o.phase, heavy: !!o.heavy, runPhase: 0, snap: true, face: o.face == null ? -1 : o.face, emote: o.emote || null, emoteT: o.emoteT || 0, emoteDur: o.emoteDur || 1 };
  poseModel(model, st, 1);
  if (o.armsDown) {
    for (const a of model.userData.parts.arms) {
      a.shoulder.rotation.set(-0.42, 0, 0.3 * a.side);
      a.elbow.rotation.set(-1.75, 0, 0);
    }
  }
  if (o.pose) o.pose(model.userData.parts);
  model.rotation.y = o.rotY || 0;
  if (o.rotX) model.rotation.x = o.rotX;
  model.updateMatrixWorld(true);
  const hp = new THREE.Vector3();
  // ねらう所：頭（ふつう）・グローブ・体のまん中
  if (o.aim === 'glove') model.userData.parts.arms[o.side == null ? 1 : o.side].glove.getWorldPosition(hp);
  else if (o.aim === 'root') hp.set(0, 0, 0);
  else model.userData.parts.head.getWorldPosition(hp);
  const cam = P.cam;
  cam.aspect = o.w / o.h;
  cam.fov = o.fov || 30;
  cam.position.set(hp.x + o.cam[0], hp.y + o.cam[1], hp.z + o.cam[2]);
  cam.lookAt(hp.x + o.look[0], hp.y + o.look[1], hp.z + o.look[2]);
  cam.updateProjectionMatrix();
  const url = P.snap(model, o.w * 2, o.h * 2, o.w, o.h);
  disposeDeep(model);
  return load(url);
}
const face = (id, team, w = 420, h = 420, extra = {}) => shot(id, team, { mode: 'hover', face: FACES.neutral, armsDown: true, fov: 26, cam: [0.3, 0.05, 1.55], look: [0, -0.02, 0], w, h, ...extra });
const happy = (id, team, w = 420, h = 420, extra = {}) => face(id, team, w, h, { face: FACES.happy, ...extra });

// ===== 背景・文字 =====
function canvas(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}
function rays(ctx, s, cx, cy, c1, c2, n = 24) {
  ctx.fillStyle = c1;
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = c2;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = a0 + Math.PI / n;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a0) * 3000, cy + Math.sin(a0) * 3000);
    ctx.lineTo(cx + Math.cos(a1) * 3000, cy + Math.sin(a1) * 3000);
    ctx.fill();
  }
}
function grad(ctx, s, stops, x0 = 0, y0 = 0, x1 = 0, y1 = 512) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  stops.forEach(([k, c]) => g.addColorStop(k, c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
}
function radial(ctx, s, cx, cy, r, stops) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  stops.forEach(([k, c]) => g.addColorStop(k, c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
}
// 集中線（マンガの）
function speedLines(ctx, s, cx, cy, color, n = 70, r0 = 150) {
  ctx.save();
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.sin(i * 7.3) * 0.04;
    const w = 0.012 + (Math.sin(i * 3.1) * 0.5 + 0.5) * 0.02;
    const rr = r0 + (Math.sin(i * 5.7) * 0.5 + 0.5) * 70;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a - w) * 900, cy + Math.sin(a - w) * 900);
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    ctx.lineTo(cx + Math.cos(a + w) * 900, cy + Math.sin(a + w) * 900);
    ctx.fill();
  }
  ctx.restore();
}
function text(ctx, str, x, y, o = {}) {
  ctx.save();
  ctx.translate(x, y);
  if (o.rot) ctx.rotate(o.rot);
  if (o.skew) ctx.transform(1, 0, o.skew, 1, 0, 0);
  ctx.textAlign = o.align || 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${o.italic ? 'italic ' : ''}${o.weight || 900} ${o.size || 60}px ${o.font || JP}`;
  if (o.spacing) ctx.letterSpacing = o.spacing + 'px';
  ctx.lineJoin = 'round';
  if (o.shadow) {
    ctx.fillStyle = o.shadow;
    ctx.fillText(str, o.sx == null ? 5 : o.sx, o.sy == null ? 6 : o.sy);
  }
  if (o.stroke) {
    ctx.lineWidth = o.lw || (o.size || 60) * 0.18;
    ctx.strokeStyle = o.stroke;
    ctx.strokeText(str, 0, 0);
  }
  if (o.glow) {
    ctx.shadowColor = o.glow;
    ctx.shadowBlur = o.glowR || 18;
  }
  ctx.fillStyle = o.color || '#fff';
  ctx.fillText(str, 0, 0);
  ctx.restore();
}
// 黒い帯に黄色の文字（今のアイコンと同じ形）
function band(ctx, str, cx, cy, w, h, rot = -0.12, fg = '#ffd400', bg = '#111', size) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.fillStyle = bg;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.fillStyle = fg;
  ctx.font = `italic 900 ${size || h * 0.72}px ${JP}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(str, 0, h * 0.04);
  ctx.restore();
}
function hexPath(ctx, cx, cy, r, rot = 0) {
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = rot + (k / 6) * Math.PI * 2;
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
}
function petals(ctx, n, seed, colors = ['#ffc6dc', '#ffadcb', '#ffe1ec']) {
  let s = seed;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < n; i++) {
    const x = rnd() * 512, y = rnd() * 512, r = 9 + rnd() * 12, a = rnd() * 6.3;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = colors[i % colors.length];
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.bezierCurveTo(r * 0.8, -r * 0.5, r * 0.8, r * 0.6, r * 0.3, r);
    ctx.lineTo(0, r * 0.75);
    ctx.lineTo(-r * 0.3, r);
    ctx.bezierCurveTo(-r * 0.8, r * 0.6, -r * 0.8, -r * 0.5, 0, -r);
    ctx.fill();
    ctx.restore();
  }
}
function draw(ctx, img, x, y, w, h) {
  ctx.drawImage(img, x, y, w || img.width, h || img.height);
}

async function main() {
  await document.fonts.load('700 40px CP');
  await document.fonts.load('900 40px "Noto Sans CJK JP"');
  const out = [];
  const S = 512;
  const add = (title, c) => out.push({ title, url: c.toDataURL('image/png') });

  // 1. ドラの顔（今と同じ形を、新しい顔で）
  {
    const [c, x] = canvas();
    rays(x, S, S / 2, S * 0.62, '#ffd400', '#ffe55a');
    draw(x, await happy('tora', 0, 470, 470), 21, 70, 470, 470);
    band(x, '浪人パンチ', S / 2, 84, 460, 112);
    add('ドラ・大笑い（今の形）', c);
  }
  // 2. てつんど（ドラムスティック）
  {
    const [c, x] = canvas();
    rays(x, S, S / 2, S * 0.62, '#ff8a1f', '#ffa44d');
    draw(x, await shot('tetsundo', 0, { mode: 'hover', face: FACES.happy, fov: 30, cam: [0.32, -0.12, 2.0], look: [0, -0.22, 0], w: 480, h: 480 }), 16, 52, 480, 480);
    band(x, '浪人パンチ', S / 2, 82, 460, 112, -0.12, '#fff', '#111');
    add('てつんど・スティック', c);
  }
  // 3. エブン（炎の歌声）
  {
    const [c, x] = canvas();
    radial(x, S, S / 2, S * 0.7, 520, [[0, '#ffe14d'], [0.45, '#ff7a1f'], [1, '#d92b2b']]);
    speedLines(x, S, S / 2, S * 0.62, 'rgba(255,240,180,0.55)', 60, 170);
    draw(x, await happy('even', 1, 470, 470), 21, 66, 470, 470);
    band(x, '浪人パンチ', S / 2, 84, 460, 112, -0.12, '#ffd400', '#111');
    add('エブン・炎', c);
  }
  // 4. 町田ブラザーズ（4人）
  {
    const [c, x] = canvas();
    x.fillStyle = '#111';
    x.fillRect(0, 0, S, S);
    const ids = [['tora', '#ffd400'], ['even', '#ff5a3a'], ['naot', '#3aa0ff'], ['toriki', '#38d16a']];
    for (let i = 0; i < 4; i++) {
      const cx = (i % 2) * 256, cy = Math.floor(i / 2) * 256;
      x.fillStyle = ids[i][1];
      x.fillRect(cx + 6, cy + 6, 244, 244);
      draw(x, await happy(ids[i][0], 0, 260, 260), cx - 2, cy + 6, 260, 260);
    }
    x.save();
    x.translate(S / 2, S / 2);
    x.rotate(-0.12);
    x.fillStyle = '#111';
    x.fillRect(-230, -46, 460, 92);
    x.restore();
    text(x, '浪人パンチ', S / 2, S / 2 + 2, { size: 70, italic: true, color: '#fff', rot: -0.12 });
    add('町田の4人', c);
  }
  // 5. てつんどのスペシャル（カットイン）
  {
    const [c, x] = canvas();
    grad(x, S, [[0, '#14213d'], [1, '#0b1020']]);
    speedLines(x, S, S * 0.55, S * 0.45, 'rgba(255,255,255,0.75)', 80, 150);
    x.save();
    x.translate(S / 2, S * 0.83);
    x.rotate(-0.2);
    x.fillStyle = '#ffd400';
    x.fillRect(-400, -52, 800, 104);
    x.restore();
    draw(x, await shot('tetsundo', 0, { mode: 'cutin', fov: 32, cam: [-0.2, -0.2, 1.65], look: [-0.05, -0.2, 0], rotY: -0.42, w: 500, h: 500 }), 6, 0, 500, 500);
    text(x, '浪人パンチ', S / 2, S * 0.84, { size: 74, italic: true, color: '#111', rot: -0.2 });
    add('てつんど・必殺技', c);
  }
  // 6. グローブの一撃（顔は小さく、グローブを大きく）
  {
    const [c, x] = canvas();
    rays(x, S, S * 0.5, S * 0.52, '#2f8cff', '#5aa6ff', 20);
    speedLines(x, S, S * 0.5, S * 0.52, 'rgba(255,255,255,0.9)', 54, 200);
    draw(x, await shot('tetsundo', 0, { mode: 'punch', phase: 0.3, side: 1, heavy: false, aim: 'glove', fov: 44, cam: [0.35, 0.12, 0.62], look: [-0.22, -0.02, -0.25], w: 520, h: 520 }), -4, -4, 520, 520);
    text(x, '浪', 404, 104, { size: 150, color: '#ffd400', stroke: '#111', lw: 26, shadow: '#111', sx: 6, sy: 8 });
    add('パンチの一撃', c);
  }
  // 7. 文字だけ（タイトルロゴ）
  {
    const [c, x] = canvas();
    rays(x, S, S / 2, S / 2, '#ffd400', '#ffe55a');
    text(x, '浪人', S / 2, 178, { size: 190, italic: true, color: '#ffd400', stroke: '#111', lw: 40, shadow: '#111', sx: 10, sy: 12, rot: -0.1 });
    text(x, 'パンチ', S / 2, 360, { size: 140, italic: true, color: '#fff', stroke: '#111', lw: 34, shadow: '#111', sx: 9, sy: 11, rot: -0.1 });
    add('文字だけ（ロゴ）', c);
  }
  // 8. RPF（近未来）
  {
    const [c, x] = canvas();
    grad(x, S, [[0, '#0d1530'], [1, '#05070f']]);
    x.strokeStyle = 'rgba(0,229,255,0.18)';
    x.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      hexPath(x, S / 2, S / 2, 60 + i * 34, Math.PI / 6);
      x.stroke();
    }
    x.strokeStyle = '#00e5ff';
    x.lineWidth = 8;
    hexPath(x, S / 2, S / 2, 200, Math.PI / 6);
    x.stroke();
    text(x, 'RPF', S / 2 - 4, S / 2 - 6, { size: 168, italic: true, weight: 700, font: EN, color: '#ffd400', glow: 'rgba(255,212,0,0.8)', glowR: 26 });
    text(x, 'RONIN PUNCH FLIGHT', S / 2, S / 2 + 110, { size: 30, weight: 700, font: EN, color: '#00e5ff', spacing: 2 });
    add('RPF（近未来）', c);
  }
  // 9. 青 vs 赤
  {
    const [c, x] = canvas();
    x.fillStyle = '#2f8cff';
    x.fillRect(0, 0, S, S);
    x.fillStyle = '#ff3f5e';
    x.beginPath();
    x.moveTo(S * 0.62, 0);
    x.lineTo(S, 0);
    x.lineTo(S, S);
    x.lineTo(S * 0.38, S);
    x.closePath();
    x.fill();
    x.save();
    x.beginPath();
    x.rect(0, 0, S, S);
    x.clip();
    draw(x, await face('tora', 0, 320, 320, { cam: [0.45, 0.05, 1.55] }), -20, 150, 320, 320);
    draw(x, await face('even', 1, 320, 320, { cam: [-0.45, 0.05, 1.55] }), 212, 40, 320, 320);
    x.restore();
    x.strokeStyle = '#fff';
    x.lineWidth = 14;
    x.beginPath();
    x.moveTo(S * 0.62, 0);
    x.lineTo(S * 0.38, S);
    x.stroke();
    text(x, 'VS', S / 2, S / 2, { size: 120, italic: true, weight: 700, font: EN, color: '#ffd400', stroke: '#111', lw: 22 });
    add('青 vs 赤', c);
  }
  // 10. てつんど×みのり
  {
    const [c, x] = canvas();
    radial(x, S, S / 2, S / 2, 400, [[0, '#ffe3ef'], [1, '#ff8fc0']]);
    petals(x, 26, 7);
    draw(x, await happy('tetsundo', 0, 330, 330, { cam: [0.5, 0.05, 1.6] }), -6, 150, 330, 330);
    draw(x, await happy('minori', 0, 330, 330, { cam: [-0.5, 0.05, 1.6] }), 188, 150, 330, 330);
    text(x, '♥', S / 2, 178, { size: 120, color: '#ff3f7e', stroke: '#fff', lw: 16 });
    band(x, '浪人パンチ', S / 2, 74, 440, 100, -0.08, '#fff', '#e0306b');
    add('てつんど×みのり', c);
  }
  // 11. 10人の輪
  {
    const [c, x] = canvas();
    rays(x, S, S / 2, S / 2, '#ffd400', '#ffe55a');
    const ids = ['tetsundo', 'minori', 'even', 'tora', 'naot', 'toriki', 'hayata', 'shouta', 'takanobu', 'chijiwa'];
    for (let i = 0; i < ids.length; i++) {
      const a = -Math.PI / 2 + (i / ids.length) * Math.PI * 2;
      const cx = S / 2 + Math.cos(a) * 178, cy = S / 2 + Math.sin(a) * 178;
      x.fillStyle = '#111';
      x.beginPath();
      x.arc(cx, cy, 62, 0, Math.PI * 2);
      x.fill();
      x.save();
      x.beginPath();
      x.arc(cx, cy, 56, 0, Math.PI * 2);
      x.clip();
      x.fillStyle = '#fff';
      x.fillRect(cx - 60, cy - 60, 120, 120);
      draw(x, await happy(ids[i], 0, 150, 150), cx - 75, cy - 70, 150, 150);
      x.restore();
    }
    text(x, '浪人', S / 2, S / 2 - 34, { size: 92, italic: true, color: '#ffd400', stroke: '#111', lw: 22 });
    text(x, 'パンチ', S / 2, S / 2 + 46, { size: 70, italic: true, color: '#fff', stroke: '#111', lw: 18 });
    add('10人の輪', c);
  }
  // 12. 空を飛ぶ
  {
    const [c, x] = canvas();
    grad(x, S, [[0, '#4aa8ff'], [0.7, '#bfe6ff'], [1, '#ffffff']]);
    x.fillStyle = 'rgba(255,255,255,0.9)';
    for (const [cx, cy, r] of [[90, 450, 70], [160, 470, 60], [400, 480, 90], [470, 450, 60], [300, 500, 70]]) {
      x.beginPath();
      x.arc(cx, cy, r, 0, Math.PI * 2);
      x.fill();
    }
    petals(x, 14, 3);
    // ジェットのすじ
    x.strokeStyle = 'rgba(0,229,255,0.85)';
    x.lineWidth = 18;
    x.lineCap = 'round';
    x.beginPath();
    x.moveTo(-10, 500);
    x.quadraticCurveTo(120, 430, 200, 340);
    x.stroke();
    draw(x, await shot('tetsundo', 0, { mode: 'fly', speed: 1, t: 0.3, aim: 'root', fov: 34, cam: [2.6, 0.9, 2.2], look: [0, 0.1, 0], rotY: 0.2, w: 500, h: 500 }), 20, 40, 500, 500);
    band(x, '浪人パンチ', S / 2, 74, 440, 100, -0.06, '#ffd400', '#111');
    add('空を飛ぶ', c);
  }
  // 13. 六角のエンブレム（ゲームの画面と同じ）
  {
    const [c, x] = canvas();
    grad(x, S, [[0, '#18244a'], [1, '#070b18']]);
    x.save();
    hexPath(x, S / 2, S / 2 - 18, 196, Math.PI / 6);
    x.fillStyle = '#ffd400';
    x.fill();
    x.clip();
    rays(x, S, S / 2, S / 2, '#ffd400', '#ffe55a', 18);
    draw(x, await happy('tora', 0, 420, 420), 46, 46, 420, 420);
    x.restore();
    x.strokeStyle = '#00e5ff';
    x.lineWidth = 10;
    hexPath(x, S / 2, S / 2 - 18, 196, Math.PI / 6);
    x.stroke();
    x.save();
    x.translate(S / 2, 446);
    x.fillStyle = '#00e5ff';
    x.beginPath();
    x.moveTo(-200, -34);
    x.lineTo(212, -34);
    x.lineTo(200, 34);
    x.lineTo(-212, 34);
    x.closePath();
    x.fill();
    x.restore();
    text(x, 'RONIN PUNCH', S / 2, 448, { size: 46, italic: true, weight: 700, font: EN, color: '#0b1020' });
    add('六角エンブレム', c);
  }
  // 14. サクラとグローブ
  {
    const [c, x] = canvas();
    radial(x, S, S / 2, S * 0.45, 420, [[0, '#ffd6e7'], [1, '#ff7eb3']]);
    petals(x, 40, 11, ['#ffffff', '#ffe1ec', '#ffc6dc']);
    draw(x, await shot('even', 1, { mode: 'punch', phase: 0.3, side: 1, heavy: false, aim: 'glove', fov: 44, cam: [-0.3, 0.1, 0.6], look: [0.2, -0.02, -0.25], w: 520, h: 520 }), -4, 20, 520, 520);
    band(x, '浪人パンチ', S / 2, 80, 450, 108, -0.1, '#fff', '#e0306b');
    add('サクラとグローブ', c);
  }
  // 15. てつんど・ドアップ（集中線）
  {
    const [c, x] = canvas();
    x.fillStyle = '#fff';
    x.fillRect(0, 0, S, S);
    speedLines(x, S, S / 2, S * 0.55, '#111', 90, 200);
    draw(x, await face('tetsundo', 0, 520, 520, { face: FACES.attack, cam: [0.1, 0.02, 1.25] }), -4, 30, 520, 520);
    text(x, 'ドゴッ!', 128, 92, { size: 100, italic: true, color: '#ff3f5e', stroke: '#111', lw: 22, rot: -0.2 });
    add('てつんど・マンガ', c);
  }
  // 16. 10人の集合（全身）
  {
    const [c, x] = canvas();
    rays(x, S, S / 2, S * 0.7, '#ffd400', '#ffe55a');
    const ids = ['naot', 'toriki', 'tora', 'hayata', 'takanobu', 'shouta', 'chijiwa', 'even', 'minori', 'tetsundo'];
    const pos = [[-6, 150], [86, 150], [178, 150], [270, 150], [362, 150], [-30, 250], [70, 250], [170, 250], [270, 250], [362, 250]];
    for (let i = 0; i < ids.length; i++) {
      const img = await shot(ids[i], 0, { mode: 'hover', face: FACES.happy, fov: 30, cam: [0.35, -0.6, 3.3], look: [0, -0.72, 0], w: 180, h: 280 });
      const [px, py] = pos[i];
      draw(x, img, px, py, 180, 280);
    }
    band(x, '浪人パンチ', S / 2, 80, 460, 112, -0.1);
    add('みんな集合', c);
  }
  // 17. てつんどの顔（今の形）
  {
    const [c, x] = canvas();
    rays(x, S, S / 2, S * 0.62, '#ffd400', '#ffe55a');
    draw(x, await happy('tetsundo', 0, 470, 470), 21, 70, 470, 470);
    band(x, '浪人パンチ', S / 2, 84, 460, 112);
    add('てつんど・笑顔（今の形）', c);
  }
  // 18. タイトルロゴ（空とサクラ）
  {
    const [c, x] = canvas();
    grad(x, S, [[0, '#62b6ff'], [0.75, '#d8f0ff'], [1, '#ffffff']]);
    petals(x, 22, 5);
    text(x, '浪人パンチ', S / 2 - 6, 210, { size: 90, italic: true, color: '#ffd400', stroke: '#111', lw: 24, shadow: '#111', sx: 7, sy: 9, rot: -0.1 });
    text(x, 'フライト', S / 2, 330, { size: 100, italic: true, color: '#ffd400', stroke: '#111', lw: 26, shadow: '#111', sx: 7, sy: 9, rot: -0.1 });
    text(x, 'RONIN PUNCH FLIGHT', S / 2, 438, { size: 30, weight: 700, font: EN, color: '#14213d', spacing: 2 });
    add('タイトルロゴ', c);
  }
  // 19. 3人（ドラ・てつんど・エブン）
  {
    const [c, x] = canvas();
    rays(x, S, S / 2, S * 0.8, '#3aa0ff', '#64b6ff', 22);
    draw(x, await happy('even', 0, 300, 300, { cam: [-0.4, 0.05, 1.6] }), 250, 190, 300, 300);
    draw(x, await happy('tora', 0, 300, 300, { cam: [0.4, 0.05, 1.6] }), -38, 190, 300, 300);
    draw(x, await happy('tetsundo', 0, 330, 330), 91, 150, 330, 330);
    band(x, '浪人パンチ', S / 2, 84, 460, 112);
    add('3人', c);
  }
  // 20. グローブのエンブレム（近未来）
  {
    const [c, x] = canvas();
    grad(x, S, [[0, '#16224a'], [1, '#060a16']]);
    x.save();
    hexPath(x, S / 2, S / 2, 214, Math.PI / 6);
    x.clip();
    rays(x, S, S / 2, S / 2, '#13204a', '#1b2c60', 18);
    draw(x, await shot('tetsundo', 0, { mode: 'punch', phase: 0.3, side: 1, heavy: false, aim: 'glove', fov: 40, cam: [0.32, 0.1, 0.6], look: [-0.18, -0.02, -0.25], w: 480, h: 480 }), 16, 16, 480, 480);
    x.restore();
    x.strokeStyle = '#00e5ff';
    x.lineWidth = 10;
    hexPath(x, S / 2, S / 2, 214, Math.PI / 6);
    x.stroke();
    text(x, 'RPF', 392, 92, { size: 80, italic: true, weight: 700, font: EN, color: '#ffd400', glow: 'rgba(255,212,0,0.8)', glowR: 16 });
    add('グローブのエンブレム', c);
  }
  window.__icons = out;
}
main().catch((e) => {
  window.__iconsErr = String(e && e.stack ? e.stack : e);
});
