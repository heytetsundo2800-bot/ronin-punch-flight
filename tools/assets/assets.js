// アイコンとOGP画像を作る（ゲームの3Dモデルから）
import * as THREE from 'three';
import { Portraits } from '../../src/portraits.js';
const R = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
R.outputColorSpace = THREE.SRGBColorSpace;
const P = new Portraits(R);
const load = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = src; });
function logoText(ctx, x, y, size, rot = -0.1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `italic 900 ${size}px "Hiragino Maru Gothic ProN","Noto Sans CJK JP","Noto Sans JP",sans-serif`;
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.16;
  ctx.strokeStyle = '#111';
  ctx.fillStyle = '#111';
  ctx.fillText('浪人パンチ', 4, -size * 0.55 + size * 0.1);
  ctx.strokeText('浪人パンチ', 0, -size * 0.55);
  ctx.fillStyle = '#ffd400';
  ctx.fillText('浪人パンチ', 0, -size * 0.55);
  ctx.fillStyle = '#111';
  ctx.fillText('フライト', 4, size * 0.55 + size * 0.1);
  ctx.strokeText('フライト', 0, size * 0.55);
  ctx.fillStyle = '#ffd400';
  ctx.fillText('フライト', 0, size * 0.55);
  ctx.restore();
}
function rays(ctx, w, h, cx, cy, c1, c2) {
  ctx.fillStyle = c1;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = c2;
  for (let i = 0; i < 24; i++) {
    const a0 = (i / 24) * Math.PI * 2, a1 = a0 + Math.PI / 24;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a0) * 3000, cy + Math.sin(a0) * 3000);
    ctx.lineTo(cx + Math.cos(a1) * 3000, cy + Math.sin(a1) * 3000);
    ctx.fill();
  }
}
async function main() {
  const out = {};
  const toraFace = await load(P.render('tora', 0, 'face', 384, 384));
  // v1.4：勝ちポーズ（ひざから上）を大きく
  const tora = await load(P.render('tora', 0, 'hero:win', 480, 600));
  const even = await load(P.render('even', 1, 'hero:win', 480, 600));
  const ao = await load(P.render('aomachi', 0, 'hero:win', 480, 600));
  // アイコン（顔＋黄色）
  for (const [name, size, pad] of [['icon-512', 512, 0], ['icon-192', 192, 0], ['apple-touch-icon', 180, 0], ['icon-maskable', 512, 0.12]]) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    rays(ctx, size, size, size / 2, size * 0.62, '#ffd400', '#ffe55a');
    const s = size * (1 - pad * 2);
    const o = size * pad;
    ctx.drawImage(toraFace, o - s * 0.06, o + s * 0.02, s * 1.12, s * 1.12);
    // 黒い帯に「浪」
    ctx.fillStyle = '#111';
    ctx.save();
    ctx.translate(o + s * 0.5, o + s * 0.16);
    ctx.rotate(-0.12);
    ctx.fillRect(-s * 0.45, -s * 0.11, s * 0.9, s * 0.22);
    ctx.fillStyle = '#ffd400';
    ctx.font = `italic 900 ${s * 0.16}px "Hiragino Maru Gothic ProN","Noto Sans CJK JP",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('浪人パンチ', 0, s * 0.01);
    ctx.restore();
    out[name] = c.toDataURL('image/png');
  }
  // OGP（1200x630）
  const c = document.createElement('canvas');
  c.width = 1200;
  c.height = 630;
  const ctx = c.getContext('2d');
  rays(ctx, 1200, 630, 820, 380, '#ffd400', '#ffe55a');
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  ctx.fillRect(0, 560, 1200, 70);
  // 下は画面の外まで（絵の下の切れ目を見せない）
  ctx.drawImage(even, 548, 186, 360, 450);
  ctx.drawImage(ao, 872, 170, 372, 465);
  ctx.drawImage(tora, 684, 108, 424, 530);
  logoText(ctx, 330, 270, 120);
  ctx.save();
  ctx.translate(330, 470);
  ctx.rotate(-0.1);
  ctx.fillStyle = '#111';
  ctx.fillRect(-250, -34, 500, 68);
  ctx.fillStyle = '#fff';
  ctx.font = '900 40px "Hiragino Maru Gothic ProN","Noto Sans CJK JP",sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('4対4の空中バトル', 0, 2);
  ctx.restore();
  ctx.fillStyle = '#111';
  ctx.font = '900 30px "Hiragino Maru Gothic ProN","Noto Sans CJK JP",sans-serif';
  ctx.fillText('一浪の空で、殴りあえ。スマホでそのまま遊べる', 40, 600);
  out.og = c.toDataURL('image/png');
  window.__assets = out;
}
main();
