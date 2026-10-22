// アニメ調のえフェクトの土台（fx.js から使う）
//  ・キックフライト風：足のジェットから出る、太くて長い光の帯（チームの色・まん中は白く光る）
//  ・ヒット：白黄色のトゲの星・速い衝撃の輪・のびる火花・強い攻撃は白い破片と集中線
//  ・バウンティラッシュ風：太いふちどりのカタカナの擬音（ドゴッ! など）
//  ・セル塗りのけむり（上が明るく下が暗い、ふくらんで、ふちから消える）
// 描く回数を少なくするため、ぜんぶ「まとめ描き」（光の帯で1回・光で1回・けむりで1回・文字で1回）
// 形の板（テクスチャ）と材質は最初に1回だけ作り、試合をまたいで使い回す（userData.shared）
import * as THREE from 'three';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _c = new THREE.Color();
const rnd = (a, b) => a + Math.random() * (b - a);
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ===== 形の板（テクスチャ）を作る =====
function mkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
// 毎回同じ形になる乱数（芯と外側を同じ形で描くため）
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// 白で描いた「層」の濃さ（アルファ）を R・G・B に入れて1枚にする（データとして使う板）
function packLayers(w, h, layers) {
  const c = mkCanvas(w, h);
  const x = c.getContext('2d', { willReadFrequently: true });
  const img = x.createImageData(w, h);
  const d = img.data;
  const L = layers.map((draw) => {
    if (!draw) return null;
    const lc = mkCanvas(w, h);
    const lx = lc.getContext('2d', { willReadFrequently: true });
    draw(lx, w, h);
    return lx.getImageData(0, 0, w, h).data;
  });
  for (let i = 0, n = w * h * 4; i < n; i += 4) {
    d[i] = L[0] ? L[0][i + 3] : 0;
    d[i + 1] = L[1] ? L[1][i + 3] : 0;
    d[i + 2] = L[2] ? L[2][i + 3] : 0;
    d[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return c;
}
function texOf(canvas, srgb) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.userData.shared = true;
  return t;
}
const TAU = Math.PI * 2;
const polar = (cx, cy, r, a) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
function poly(x, pts) {
  x.beginPath();
  pts.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])));
  x.closePath();
  x.fill();
}
function radial(x, cx, cy, r, stops) {
  const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (const [k, a] of stops) g.addColorStop(k, `rgba(255,255,255,${a})`);
  x.fillStyle = g;
  x.beginPath();
  x.arc(cx, cy, r, 0, TAU);
  x.fill();
}
// ぼかしフィルターは端末によってはとても重いので使わない（やわらかいふちは halo で作る）
const blur = () => {};

// ---- 光のえフェクトの板：4×4 のマス（1マス 256px）。R = 白い芯、G = 色のつく外側 ----
const FXS = 1024, FXC = 256, FXPAD = 4;
export const CELL = { GLOW: 0, STAR: 1, STAR2: 2, LINES: 3, SPARK: 4, SHARD: 5, FLARE: 6, HEX: 7, HEXF: 8, SLASH: 9, SHOCK: 10, STAR4: 11 };
function drawCell(x, id, core) {
  if (!core && (id === CELL.STAR || id === CELL.STAR2 || id === CELL.STAR4 || id === CELL.SPARK || id === CELL.LINES || id === CELL.SHARD)) {
    // ふちをやわらかく：少し大きく・うすく描いてから、ふつうに描く
    x.save();
    x.globalAlpha = 0.32;
    x.translate(128, 128);
    x.scale(1.07, id === CELL.SPARK || id === CELL.SHARD ? 1.35 : 1.07);
    x.translate(-128, -128);
    drawShape(x, id, core);
    x.restore();
  }
  drawShape(x, id, core);
}
function drawShape(x, id, core) {
  const c = 128, R = 118;
  const r = rng(1000 + id * 77);
  x.fillStyle = '#fff';
  x.strokeStyle = '#fff';
  if (id === CELL.GLOW) {
    if (core) radial(x, c, c, R * 0.5, [[0, 1], [0.3, 0.8], [0.65, 0.2], [1, 0]]);
    else radial(x, c, c, R, [[0, 1], [0.18, 0.78], [0.42, 0.34], [0.7, 0.1], [1, 0]]);
  } else if (id === CELL.STAR || id === CELL.STAR2) {
    // アニメのヒットの星（長短のトゲ）
    const n = id === CELL.STAR ? 10 : 14;
    const pts = [];
    const k = core ? 0.6 : 1;
    for (let i = 0; i < n; i++) {
      const a = ((i + (r() - 0.5) * 0.45) / n) * TAU;
      const ro = R * (i % 2 ? 0.52 + r() * 0.2 : 0.84 + r() * 0.16) * k;
      const ai = ((i + 0.5 + (r() - 0.5) * 0.3) / n) * TAU;
      pts.push(polar(c, c, ro, a), polar(c, c, R * (core ? 0.2 : id === CELL.STAR ? 0.34 : 0.3), ai));
    }
    blur(x, core ? 0.8 : 1.2);
    poly(x, pts);
    blur(x, 0);
    radial(x, c, c, R * (core ? 0.3 : 0.42), [[0, 1], [0.6, 0.9], [1, 0]]);
  } else if (id === CELL.LINES) {
    // 集中線のように外へ広がる光の線
    blur(x, 0.8);
    for (let i = 0; i < 46; i++) {
      const a = r() * TAU, r0 = R * (0.3 + r() * 0.26), r1 = R * (0.8 + r() * 0.2);
      const hw = (2.2 + r() * 4.2) * (core ? 0.42 : 1);
      const nx = -Math.sin(a), ny = Math.cos(a);
      const m = r0 + (r1 - r0) * 0.22;
      const [mx, my] = polar(c, c, m, a);
      poly(x, [polar(c, c, r0, a), [mx + nx * hw, my + ny * hw], polar(c, c, r1, a), [mx - nx * hw, my - ny * hw]]);
    }
    blur(x, 0);
  } else if (id === CELL.SPARK) {
    // 火花の筋（+x が進む向き。うしろは細く）
    const hr = core ? 22 : 54, hx = 190, tail = core ? 40 : 6;
    blur(x, core ? 1 : 3);
    x.beginPath();
    x.moveTo(tail, c);
    x.quadraticCurveTo(hx - 60, c - hr, hx, c - hr);
    x.arc(hx, c, hr, -Math.PI / 2, Math.PI / 2);
    x.quadraticCurveTo(hx - 60, c + hr, tail, c);
    x.fill();
    blur(x, 0);
  } else if (id === CELL.SHARD) {
    // 角ばった白い破片（+x がとがった先）
    const P = [[250, 125], [74, 100], [8, 133], [96, 153]];
    if (core) {
      const cx = 110, cy = 128;
      poly(x, P.map(([px, py]) => [cx + (px - cx) * 0.5, cy + (py - cy) * 0.42]));
    } else poly(x, P);
  } else if (id === CELL.FLARE) {
    // 十字のきらめき
    const w = core ? 2.6 : 7;
    const lg = (horiz) => {
      const g = horiz ? x.createLinearGradient(6, 0, 250, 0) : x.createLinearGradient(0, 6, 0, 250);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      if (horiz) poly(x, [[6, c], [c, c - w], [250, c], [c, c + w]]);
      else poly(x, [[c, 6], [c + w, c], [c, 250], [c - w, c]]);
    };
    blur(x, core ? 0.6 : 2);
    lg(true);
    lg(false);
    blur(x, 0);
    if (core) radial(x, c, c, 16, [[0, 1], [0.5, 0.8], [1, 0]]);
    else radial(x, c, c, R * 0.42, [[0, 0.95], [0.35, 0.45], [1, 0]]);
  } else if (id === CELL.HEX || id === CELL.HEXF) {
    const pts = [];
    for (let i = 0; i < 6; i++) pts.push(polar(c, c, R * 0.92, (i / 6) * TAU));
    if (id === CELL.HEX) {
      x.lineWidth = core ? 5 : 15;
      x.lineJoin = 'miter';
      blur(x, core ? 0.5 : 2);
      x.beginPath();
      pts.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])));
      x.closePath();
      x.stroke();
      blur(x, 0);
    } else if (!core) {
      const g = x.createRadialGradient(c, c, 0, c, c, R);
      g.addColorStop(0, 'rgba(255,255,255,0.35)');
      g.addColorStop(1, 'rgba(255,255,255,0.95)');
      x.fillStyle = g;
      poly(x, pts);
    }
  } else if (id === CELL.SLASH) {
    // 三日月の風の刃
    blur(x, core ? 0.6 : 1.5);
    x.beginPath();
    x.arc(c, c, R * 0.95, 0, TAU);
    x.fill();
    x.globalCompositeOperation = 'destination-out';
    x.beginPath();
    x.arc(c + R * (core ? 0.1 : 0.3), c, R * (core ? 0.9 : 0.8), 0, TAU);
    x.fill();
    x.globalCompositeOperation = 'source-over';
    blur(x, 0);
  } else if (id === CELL.SHOCK) {
    // 衝撃の輪（外側がはっきり光り、内側はうすく）
    if (core) radial(x, c, c, R, [[0, 0], [0.84, 0], [0.92, 1], [0.97, 0.4], [1, 0]]);
    else radial(x, c, c, R, [[0, 0], [0.42, 0.04], [0.72, 0.2], [0.88, 0.8], [0.95, 1], [1, 0]]);
  } else if (id === CELL.STAR4) {
    // 長い4本のトゲ＋短い4本（大きい当たり・ジャスト回避の光）
    const sp = (a, len, w) => {
      const nx = -Math.sin(a), ny = Math.cos(a);
      const [tx, ty] = polar(c, c, len, a);
      poly(x, [[c + nx * w, c + ny * w], [tx, ty], [c - nx * w, c - ny * w], polar(c, c, w * 0.6, a + Math.PI)]);
    };
    blur(x, core ? 0.6 : 1.5);
    for (let i = 0; i < 4; i++) sp((i / 4) * TAU, R * (core ? 0.8 : 1), core ? 4.5 : 12);
    for (let i = 0; i < 4; i++) sp(((i + 0.5) / 4) * TAU, R * (core ? 0.36 : 0.5), core ? 3 : 7);
    blur(x, 0);
    radial(x, c, c, R * (core ? 0.16 : 0.34), [[0, 1], [0.5, 0.75], [1, 0]]);
  }
}
let _fxAtlas = null;
export function fxAtlas() {
  if (_fxAtlas) return _fxAtlas;
  const layer = (core) => (x) => {
    for (const k of Object.keys(CELL)) {
      const id = CELL[k];
      x.save();
      x.translate((id % 4) * FXC, (id >> 2) * FXC);
      x.beginPath();
      x.rect(FXPAD, FXPAD, FXC - FXPAD * 2, FXC - FXPAD * 2);
      x.clip();
      drawCell(x, id, core);
      x.restore();
    }
  };
  _fxAtlas = texOf(packLayers(FXS, FXS, [layer(true), layer(false), null]), false);
  return _fxAtlas;
}
const cellUV = (id) => {
  const col = id % 4, row = id >> 2;
  const s = FXC / FXS, p = FXPAD / FXS;
  return [col * s + p, 1 - (row + 1) * s + p, s - 2 * p, s - 2 * p];
};
const CELL_UV = Object.values(CELL).map(cellUV);

// ---- けむりの板：2×2 のマス。R = 光の当たる所（上・左）、G = 消えていく順（中ほど遅い）、B = 形 ----
let _smokeAtlas = null;
export function smokeAtlas() {
  if (_smokeAtlas) return _smokeAtlas;
  const S = 512, C = 256;
  const blobs = [];
  for (let k = 0; k < 4; k++) {
    const r = rng(500 + k * 31);
    const L = [{ x: 128 + (r() - 0.5) * 10, y: 136, r: 54 + r() * 8 }];
    const n = 5 + (k % 2);
    for (let i = 0; i < n; i++) {
      const a = ((i + r() * 0.6) / n) * TAU, d = 40 + r() * 20;
      const br = 28 + r() * 16;
      L.push({ x: 128 + Math.cos(a) * d, y: 128 + Math.sin(a) * d * 0.85, r: Math.min(br, 116 - d) });
    }
    const spots = [];
    for (let i = 0; i < 26; i++) spots.push({ x: 128 + (r() - 0.5) * 170, y: 128 + (r() - 0.5) * 150, r: 8 + r() * 16, a: 0.12 + r() * 0.2 });
    blobs.push({ L, spots });
  }
  const each = (x, f) => {
    blobs.forEach((b, k) => {
      x.save();
      x.translate((k % 2) * C, (k >> 1) * C);
      f(b);
      x.restore();
    });
  };
  const lit = (x) =>
    each(x, (b) => {
      x.fillStyle = '#fff';
      blur(x, 1.2);
      for (const o of b.L) {
        x.beginPath();
        x.arc(o.x - o.r * 0.22, o.y - o.r * 0.34, o.r * 0.8, 0, TAU);
        x.fill();
      }
      blur(x, 0);
      // 全体の下のほうは影
      x.globalCompositeOperation = 'destination-out';
      const g = x.createLinearGradient(0, 150, 0, 200);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,1)');
      x.fillStyle = g;
      x.fillRect(0, 150, 256, 106);
      x.globalCompositeOperation = 'source-over';
    });
  const field = (x) =>
    each(x, (b) => {
      x.globalCompositeOperation = 'lighter';
      for (const o of b.L) radial(x, o.x, o.y, o.r, [[0, 1], [0.45, 0.72], [1, 0.02]]);
      for (const s of b.spots) radial(x, s.x, s.y, s.r, [[0, s.a], [1, 0]]);
      x.globalCompositeOperation = 'source-over';
    });
  const shape = (x) =>
    each(x, (b) => {
      x.fillStyle = '#fff';
      for (const o of b.L) {
        x.beginPath();
        x.arc(o.x, o.y, o.r, 0, TAU);
        x.fill();
      }
    });
  _smokeAtlas = texOf(packLayers(S, S, [lit, field, shape]), false);
  return _smokeAtlas;
}
const SMOKE_UV = [0, 1, 2, 3].map((k) => [(k % 2) * 0.5 + 0.004, 1 - ((k >> 1) + 1) * 0.5 + 0.004, 0.492, 0.492]);

// ---- 擬音の文字：先に1回だけ描いておく（太いふちどり・ななめ・上から下へ色が変わる）----
const FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Hiragino Kaku Gothic Pro", "Noto Sans CJK JP", "Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif';
const WSTYLE = {
  hit: { fill: ['#ffffff', '#fff27a', '#ffa21a'], mid: '#ffffff', out: '#2b0d00' },
  big: { fill: ['#ffffff', '#ffd84a', '#ff5a14'], mid: '#fff6dc', out: '#2a0500' },
  ko: { fill: ['#ffffff', '#ff9aa6', '#ff2448'], mid: '#ffffff', out: '#26000a' },
  boom: { fill: ['#fffbe0', '#ffc23a', '#ff4a1a'], mid: '#fff6e0', out: '#2a0800' },
  just: { fill: ['#ffffff', '#c4f6ff', '#36c4ff'], mid: '#ffffff', out: '#03203c' },
  sp: { fill: ['#ffffff', '#ffb6ef', '#b43cff'], mid: '#ffffff', out: '#1c0430' },
  flash: { fill: ['#ffffff', '#fffbd0', '#ffd83a'], mid: '#ffffff', out: '#3a2200' },
};
export const WORD = {
  DOGO: 0, BAKI: 1, DOKA: 2, GA: 3, DON: 4, ZUGAN: 5, ZUDON: 6, DOKAN: 7, HYUN: 8, DODODO: 9, PIKA: 10, BASHI: 11,
};
const WORDS = [
  ['ドゴッ!', 'hit'], ['バキッ!', 'hit'], ['ドカッ!', 'hit'], ['ガッ!', 'hit'],
  ['ドンッ!!', 'big'], ['ズガァン!!', 'big'], ['ズドーン!!', 'ko'], ['ドカーン!!', 'boom'],
  ['ヒュンッ!', 'just'], ['ドドドドッ!!', 'sp'], ['ピカーッ!!', 'flash'], ['バシィッ!', 'hit'],
];
const WS = 1024, WCW = 512, WCH = 170;
let _wordAtlas = null;
const WORD_UV = [];
export function wordAtlas() {
  if (_wordAtlas) return _wordAtlas;
  const cv = mkCanvas(WS, WS);
  const x = cv.getContext('2d');
  const fs = 112;
  const skew = 0.2;
  WORDS.forEach(([text, style], i) => {
    const st = WSTYLE[style];
    const ox = (i % 2) * WCW, oy = Math.floor(i / 2) * WCH;
    x.font = `900 ${fs}px ${FONT}`;
    const tw = x.measureText(text).width;
    const outW = fs * 0.3;
    const need = tw + skew * fs + outW + 14;
    const sc = Math.min(1, (WCW - 16) / need);
    const wordW = Math.min(WCW - 4, need * sc + 10);
    const cx = ox + WCW / 2, cy = oy + WCH / 2 + 4;
    const draw = (dx, dy, mode, color, lw) => {
      x.setTransform(sc, 0, -skew * sc, sc, cx + dx, cy + dy);
      x.font = `900 ${fs}px ${FONT}`;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.lineJoin = 'round';
      x.miterLimit = 2;
      if (mode === 'stroke') {
        x.strokeStyle = color;
        x.lineWidth = lw;
        x.strokeText(text, 0, 0);
      } else {
        x.fillStyle = color;
        x.fillText(text, 0, 0);
      }
    };
    // 影 → 外の太いふち → 内の白いふち → 色
    draw(5, 7, 'stroke', st.out, outW + 6);
    draw(5, 7, 'fill', st.out);
    draw(0, 0, 'stroke', st.out, outW);
    draw(0, 0, 'stroke', st.mid, fs * 0.13);
    // 色は上から下へ（文字の中の座標で作る）
    const g = x.createLinearGradient(0, -fs * 0.42, 0, fs * 0.42);
    g.addColorStop(0, st.fill[0]);
    g.addColorStop(0.38, st.fill[1]);
    g.addColorStop(1, st.fill[2]);
    draw(0, 0, 'fill', g);
    x.setTransform(1, 0, 0, 1, 0, 0);
    WORD_UV[i] = { uv: [(cx - wordW / 2) / WS, 1 - (oy + WCH) / WS, wordW / WS, WCH / WS], asp: wordW / WCH };
  });
  _wordAtlas = texOf(cv, true);
  _wordAtlas.anisotropy = 2;
  return _wordAtlas;
}

// ---- 光の帯の板：よこ（帯のはば）＝白い芯と色の外側、たて（帯の長さ）＝少しのむら ----
let _ribTex = null;
export function ribbonTex() {
  if (_ribTex) return _ribTex;
  const W = 64, H = 256;
  const d = new Uint8Array(W * H * 4);
  const r = rng(77);
  const ph = [r() * TAU, r() * TAU, r() * TAU, r() * TAU];
  for (let y = 0; y < H; y++) {
    const v = (y / H) * TAU;
    const n1 = 0.5 + 0.5 * (0.55 * Math.sin(v * 3 + ph[0]) + 0.3 * Math.sin(v * 7 + ph[1]) + 0.15 * Math.sin(v * 13 + ph[2]));
    const n2 = 0.5 + 0.5 * Math.sin(v * 5 + ph[3]);
    const wob = 0.05 * Math.sin(v * 4 + ph[1]);
    for (let xx = 0; xx < W; xx++) {
      const u = (xx + 0.5) / W * 2 - 1;
      const uc = u - wob;
      const core = Math.exp(-uc * uc * 42) * (0.78 + 0.22 * n2);
      const edge = 1 - Math.pow(Math.abs(u), 6);
      const body = (0.35 * Math.exp(-u * u * 2.2) + 0.65 * Math.exp(-u * u * 7)) * edge * (0.82 + 0.18 * n1);
      const i = (y * W + xx) * 4;
      d[i] = Math.round(Math.min(1, core) * 255);
      d[i + 1] = Math.round(Math.min(1, body) * 255);
      d[i + 2] = 0;
      d[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(d, W, H, THREE.RGBAFormat);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  t.userData.shared = true;
  _ribTex = t;
  return t;
}

// ===== 材質（色は線形。足し算と重ね塗りを1つでできる「かけ合わせ済みのアルファ」で混ぜる）=====
const PREMUL = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor };
const SPRITE_VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iShape;
attribute vec4 iUv;
attribute vec4 iCol;
attribute vec4 iPrm;
uniform float pull;
varying vec2 vUv;
varying vec2 vQ;
varying vec4 vCol;
varying vec4 vPrm;
varying vec3 vAux;
void main() {
  vec2 q = position.xy;
  float w = iShape.x;
  float h = iShape.y;
  float rot = iShape.z;
  float al = iShape.w;
  vec4 mv;
  if (al < -0.5) {
    // 地面と平行な板（波紋）
    float c = cos(rot), s = sin(rot);
    vec2 o = vec2(q.x * w, q.y * h);
    o = vec2(o.x * c - o.y * s, o.x * s + o.y * c);
    mv = viewMatrix * vec4(iPos + vec3(o.x, 0.0, o.y), 1.0);
  } else {
    mv = viewMatrix * vec4(iPos, 1.0);
    if (al > 0.0) {
      // 動く向きにのばす（火花・破片）
      vec3 vv = (viewMatrix * vec4(iVel, 0.0)).xyz;
      float l = length(vv.xy);
      if (l > 1e-4) rot = atan(vv.y, vv.x);
      w += l * al;
    }
    // カメラのほうへ少し寄せる（キャラの体にめりこまない）。画面での大きさ・位置は同じ
    float dd = max(length(mv.xyz), 1e-3);
    float f = 1.0 - min(pull, max(0.0, (dd - 0.6) * 0.5)) / dd;
    mv.xyz *= f;
    float c = cos(rot), s = sin(rot);
    vec2 o = vec2(q.x * w, q.y * h) * f;
    mv.xy += vec2(o.x * c - o.y * s, o.x * s + o.y * c);
  }
  gl_Position = projectionMatrix * mv;
  vUv = iUv.xy + (q + 0.5) * iUv.zw;
  vQ = q * 2.0;
  vCol = iCol;
  vPrm = iPrm;
  vAux = iVel;
}`;
// 光：R＝白い芯、G＝色の外側。vPrm = (うすさ, 芯の明るさ, 輪の内がわ, 輪なら1)
const GLOW_FRAG = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying vec2 vQ;
varying vec4 vCol;
varying vec4 vPrm;
void main() {
  vec2 m;
  if (vPrm.w > 0.5) {
    float d = length(vQ);
    float hw = (1.0 - vPrm.z) * 0.5;
    float x = clamp(1.0 - abs(d - 1.0 + hw) / hw, 0.0, 1.0);
    m = vec2(x * x * x * x, x * x * (3.0 - 2.0 * x));
  } else {
    m = texture2D(map, vUv).rg;
  }
  float f = vPrm.x;
  vec3 col = vCol.rgb * m.y + vec3(vPrm.y * m.x);
  gl_FragColor = vec4(col * f, min(1.0, m.y * vCol.a) * f);
  #include <colorspace_fragment>
}`;
// けむり：明るい色（vCol）と影の色（vAux）の2色。vPrm.z が大きいほど、ふちから消えていく
const SMOKE_FRAG = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vCol;
varying vec4 vPrm;
varying vec3 vAux;
void main() {
  vec4 t = texture2D(map, vUv);
  float e = vPrm.z;
  float cov = smoothstep(e, e + 0.09, t.g) * smoothstep(0.35, 0.65, t.b);
  float a = cov * vPrm.x;
  if (a < 0.003) discard;
  float rim = 1.0 - smoothstep(e + 0.09, e + 0.24, t.g);
  vec3 col = mix(vAux, vCol.rgb, smoothstep(0.4, 0.6, t.r));
  col *= 1.0 - rim * 0.12;
  gl_FragColor = vec4(col * a, a);
  #include <colorspace_fragment>
}`;
// 文字：vPrm.z で一瞬白く光る
const TEXT_FRAG = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vPrm;
void main() {
  vec4 t = texture2D(map, vUv);
  float a = t.a * vPrm.x;
  if (a < 0.003) discard;
  // 一瞬の白い光は、明るい所（文字の色の部分）だけ。黒いふちは黒いまま
  float lum = max(t.r, max(t.g, t.b));
  vec3 col = mix(t.rgb, vec3(1.0), vPrm.z * smoothstep(0.25, 0.7, lum)) * vPrm.y;
  gl_FragColor = vec4(col * a, a);
  #include <colorspace_fragment>
}`;
const RIB_VERT = /* glsl */ `
attribute vec4 rib;
attribute vec3 color;
varying vec4 vR;
varying vec3 vC;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vR = rib;
  // カメラのすぐ前（自分の帯）はうすくして、画面をふさがない
  vR.w *= smoothstep(1.2, 5.2, -mv.z);
  vC = color;
  gl_Position = projectionMatrix * mv;
}`;
const RIB_FRAG = /* glsl */ `
uniform sampler2D map;
uniform float time;
varying vec4 vR;
varying vec3 vC;
void main() {
  vec4 t = texture2D(map, vec2(vR.y, vR.x - time * 1.7));
  float age = vR.z;
  float a = vR.w;
  float k = 1.0 - age;
  float core = t.r * k * k;
  vec3 col = vC * t.g + vec3(1.7 * core);
  gl_FragColor = vec4(col * a, min(1.0, t.g * 0.55 * k) * a);
  #include <colorspace_fragment>
}`;
const _mats = {};
function mat(key, frag, map, opts = {}) {
  if (_mats[key]) return _mats[key];
  const m = new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, pull: { value: opts.pull || 0 } },
    vertexShader: SPRITE_VERT,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    depthTest: opts.depthTest !== false,
    side: THREE.DoubleSide,
    ...PREMUL,
  });
  // 両面を1回で描く（透明な両面の材質は three.js が2回に分けて描くので、それを止めて描く回数を半分に）
  m.forceSinglePass = true;
  m.userData.shared = true;
  _mats[key] = m;
  return m;
}
let _ribMat = null;
function ribMat() {
  if (_ribMat) return _ribMat;
  _ribMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: ribbonTex() }, time: { value: 0 } },
    vertexShader: RIB_VERT,
    fragmentShader: RIB_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    ...PREMUL,
  });
  _ribMat.forceSinglePass = true;
  _ribMat.userData.shared = true;
  return _ribMat;
}
// 板1枚の形（4つの角）。まとめ描きごとに持つ（片づけで共有の物を消さないように）
const QUAD_POS = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]);
const QUAD_IDX = [0, 1, 2, 0, 2, 3];

// ===== まとめて描く板の集まり（1回で描く）=====
// 1枚ごとの動き：位置・速さ・空気の抵抗・重さ・大きさの変化・回転・色・うすれかた
const EASE = [(k) => k, (k) => 1 - Math.pow(1 - k, 3), (k) => (k < 1 ? 1 + 2.70158 * Math.pow(k - 1, 3) + 1.70158 * Math.pow(k - 1, 2) : 1), (k) => 1 - (1 - k) * (1 - k)];
class Batch {
  constructor(scene, max, material, renderOrder) {
    this.max = max;
    this.scene = scene;
    const g = new THREE.InstancedBufferGeometry();
    g.setIndex(QUAD_IDX);
    g.setAttribute('position', new THREE.BufferAttribute(QUAD_POS.slice(), 3));
    const A = (n) => new THREE.InstancedBufferAttribute(new Float32Array(max * n), n).setUsage(THREE.DynamicDrawUsage);
    this.aPos = A(3);
    this.aVel = A(3);
    this.aShape = A(4);
    this.aUv = A(4);
    this.aCol = A(4);
    this.aPrm = A(4);
    g.setAttribute('iPos', this.aPos);
    g.setAttribute('iVel', this.aVel);
    g.setAttribute('iShape', this.aShape);
    g.setAttribute('iUv', this.aUv);
    g.setAttribute('iCol', this.aCol);
    g.setAttribute('iPrm', this.aPrm);
    g.instanceCount = 0;
    this.geo = g;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);
    this.pool = [];
    for (let i = 0; i < max; i++) this.pool.push(newSprite());
    this.live = [];
    this.n = 0;
  }
  get() {
    if (this.live.length >= this.max) return null;
    const s = this.pool.pop() || newSprite();
    resetSprite(s);
    this.live.push(s);
    return s;
  }
  // 書きこみ（1枚ぶん）
  put(s, x, y, z, w, h, rot, align, uv, fade, core, prm2, prm3) {
    const i = this.n;
    if (i >= this.max) return;
    this.n++;
    const P = this.aPos.array, V = this.aVel.array, S = this.aShape.array, U = this.aUv.array, C = this.aCol.array, R = this.aPrm.array;
    const i3 = i * 3, i4 = i * 4;
    P[i3] = x;
    P[i3 + 1] = y;
    P[i3 + 2] = z;
    V[i3] = s.ax;
    V[i3 + 1] = s.ay;
    V[i3 + 2] = s.az;
    S[i4] = w;
    S[i4 + 1] = h;
    S[i4 + 2] = rot;
    S[i4 + 3] = align;
    U[i4] = uv[0];
    U[i4 + 1] = uv[1];
    U[i4 + 2] = uv[2];
    U[i4 + 3] = uv[3];
    C[i4] = s.r;
    C[i4 + 1] = s.g;
    C[i4 + 2] = s.b;
    C[i4 + 3] = s.occ;
    R[i4] = fade;
    R[i4 + 1] = core;
    R[i4 + 2] = prm2;
    R[i4 + 3] = prm3;
  }
  finish(warm) {
    const n = this.n;
    this.geo.instanceCount = n;
    for (const a of [this.aPos, this.aVel, this.aShape, this.aUv, this.aCol, this.aPrm]) {
      if (a.clearUpdateRanges) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, Math.max(1, n) * a.itemSize);
      }
      a.needsUpdate = true;
    }
    this.mesh.visible = n > 0 || warm;
    this.n = 0;
  }
  clear() {
    for (const s of this.live) this.pool.push(s);
    this.live.length = 0;
  }
  dispose() {
    this.scene.remove(this.mesh);
    this.geo.dispose();
  }
}
function newSprite() {
  return { t: 0, life: 1, delay: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, drag: 0, grav: 0, s0: 1, s1: 1, ease: 1, asp: 1, rot: 0, spin: 0, align: 0, cell: 0, r: 1, g: 1, b: 1, occ: 0, core: 0, fadeIn: 0, fadePow: 1, hold: 0, ring: 0, ax: 0, ay: 0, az: 0, kind: 0, r1: 1, g1: 1, b1: 1, sr: 0.5, sg: 0.5, sb: 0.6, sr1: 0.5, sg1: 0.5, sb1: 0.6, e0: 0.4, word: 0, frac: 0.4 };
}
function resetSprite(s) {
  s.t = 0;
  s.delay = 0;
  s.vx = s.vy = s.vz = 0;
  s.drag = 0;
  s.grav = 0;
  s.ease = 1;
  s.asp = 1;
  s.rot = 0;
  s.spin = 0;
  s.align = 0;
  s.occ = 0;
  s.core = 0;
  s.fadeIn = 0;
  s.fadePow = 1;
  s.hold = 0;
  s.ring = 0;
  s.kind = 0;
}

// ===== ジェットの光の帯（足ごとに1本・最大16本）=====
const RIB_LIFE = 0.62;
class Ribbons {
  constructor(scene, nR = 16, nP = 25) {
    this.nR = nR;
    this.nP = nP;
    this.step = RIB_LIFE / (nP - 2);
    const nV = nR * nP * 2;
    this.pos = new Float32Array(nV * 3);
    this.rib = new Float32Array(nV * 4);
    this.col = new Float32Array(nV * 3);
    const idx = [];
    for (let r = 0; r < nR; r++)
      for (let i = 0; i < nP - 1; i++) {
        const a = (r * nP + i) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    const g = new THREE.BufferGeometry();
    g.setIndex(idx);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('rib', new THREE.BufferAttribute(this.rib, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.geo = g;
    this.mesh = new THREE.Mesh(g, ribMat());
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);
    this.scene = scene;
    this.R = [];
    for (let r = 0; r < nR; r++) {
      const P = [];
      for (let i = 0; i < nP; i++) P.push(new THREE.Vector3());
      this.R.push({ P, T: new Float32Array(nP), D: new Float32Array(nP), n: 0, w: 0.4, on: false, head: new THREE.Color(), tail: new THREE.Color(), alpha: 1, side: new THREE.Vector3(1, 0, 0), clean: false, near: 0 });
    }
  }
  // 毎フレーム：足の位置を入れる（on のときだけ帯がのびる）
  // near：カメラからこの距離より近い所はうすくする（自分の帯が画面をふさがないように。0 なら使わない）
  feed(slot, p, on, now, width, head, tail, alpha, near = 0) {
    const R = this.R[slot];
    if (!R) return;
    const P = R.P, T = R.T, D = R.D;
    // 古い点を消す
    while (R.n > 0 && now - T[R.n - 1] > RIB_LIFE) R.n--;
    if (on) {
      // ワープ・復活などで大きく飛んだら、帯をつなげない
      if (R.n > 1 && P[1].distanceToSquared(p) > 64) R.n = 0;
      if (R.n === 0) {
        P[0].copy(p);
        P[1].copy(p);
        T[0] = T[1] = now;
        D[0] = D[1] = 0;
        R.n = 2;
      } else if (R.n === 1) {
        P[1].copy(P[0]);
        T[1] = T[0];
        D[1] = D[0];
        R.n = 2;
      }
      if (now - T[1] >= this.step) {
        // いまの頭を1つの点として残す
        const n = Math.min(this.nP, R.n + 1);
        for (let i = n - 1; i >= 1; i--) {
          P[i].copy(P[i - 1]);
          T[i] = T[i - 1];
          D[i] = D[i - 1];
        }
        R.n = n;
      }
      P[0].copy(p);
      T[0] = now;
      D[0] = D[1] + P[0].distanceTo(P[1]);
      R.w = width;
      R.head.copy(head);
      R.tail.copy(tail);
      R.alpha = alpha;
      R.near = near;
    }
    R.on = on;
  }
  build(cam, now) {
    let last = -1;
    const nP = this.nP;
    const pos = this.pos, rib = this.rib, col = this.col;
    for (let r = 0; r < this.nR; r++) {
      const R = this.R[r];
      const base = r * nP * 2;
      const n = R.n;
      if (n < 2) {
        // 使っていない帯は、1回だけ見えなくしておく
        if (!R.clean) {
          this.degenerate(base, 0);
          R.clean = true;
        }
        continue;
      }
      R.clean = false;
      last = r;
      const P = R.P;
      let dist = 0;
      const side = R.side;
      for (let i = 0; i < n; i++) {
        const a = P[i];
        if (i === 0) _v.subVectors(P[0], P[1]);
        else if (i === n - 1) _v.subVectors(P[n - 2], P[n - 1]);
        else _v.subVectors(P[i - 1], P[i + 1]);
        if (i > 0) dist += a.distanceTo(P[i - 1]);
        _v2.subVectors(cam, a);
        _v3.crossVectors(_v, _v2);
        const l = _v3.length();
        if (l > 1e-5) {
          _v3.multiplyScalar(1 / l);
          if (_v3.dot(side) < 0) _v3.negate();
          side.copy(_v3);
        }
        const age = Math.min(1, Math.max(0, (now - R.T[i]) / RIB_LIFE));
        const k = 1 - age;
        // 根元は細く → すぐ太く → うしろへ細く
        const w = R.w * Math.pow(k, 0.55) * (0.36 + 0.64 * smooth(0, 0.6, dist));
        let al = Math.pow(k, 1.15) * R.alpha;
        if (R.near > 0) al *= smooth(R.near * 0.55, R.near, _v2.length());
        const j = base + i * 2;
        const j3 = j * 3, j4 = j * 4;
        pos[j3] = a.x + side.x * w;
        pos[j3 + 1] = a.y + side.y * w;
        pos[j3 + 2] = a.z + side.z * w;
        pos[j3 + 3] = a.x - side.x * w;
        pos[j3 + 4] = a.y - side.y * w;
        pos[j3 + 5] = a.z - side.z * w;
        const u = R.D[i] * 0.22;
        rib[j4] = u;
        rib[j4 + 1] = 0;
        rib[j4 + 2] = age;
        rib[j4 + 3] = al;
        rib[j4 + 4] = u;
        rib[j4 + 5] = 1;
        rib[j4 + 6] = age;
        rib[j4 + 7] = al;
        _c.copy(R.head).lerp(R.tail, Math.min(1, age * 1.4));
        col[j3] = col[j3 + 3] = _c.r;
        col[j3 + 1] = col[j3 + 4] = _c.g;
        col[j3 + 2] = col[j3 + 5] = _c.b;
      }
      this.degenerate(base, n);
    }
    const g = this.geo;
    g.setDrawRange(0, (last + 1) * (nP - 1) * 6);
    g.attributes.position.needsUpdate = true;
    g.attributes.rib.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    return last + 1;
  }
  // 使っていない点は、同じ場所に重ねて見えなくする
  degenerate(base, from) {
    const nP = this.nP;
    const pos = this.pos, rib = this.rib;
    const s = base + Math.max(0, from - 1) * 2;
    const x = pos[s * 3], y = pos[s * 3 + 1], z = pos[s * 3 + 2];
    for (let i = from; i < nP; i++) {
      const j = base + i * 2;
      for (let e = 0; e < 2; e++) {
        const q = j + e;
        pos[q * 3] = x;
        pos[q * 3 + 1] = y;
        pos[q * 3 + 2] = z;
        rib[q * 4 + 3] = 0;
      }
    }
  }
  reset(slot) {
    if (this.R[slot]) this.R[slot].n = 0;
  }
  clear() {
    for (const R of this.R) R.n = 0;
  }
  dispose() {
    this.scene.remove(this.mesh);
    this.geo.dispose();
  }
}

// ===== えフェクトの係 =====
export class VFX {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.low = !!opts.low;
    this.add = new Batch(scene, 420, mat('glow', GLOW_FRAG, fxAtlas(), { pull: 1.0 }), 6);
    this.smoke = new Batch(scene, 110, mat('smoke', SMOKE_FRAG, smokeAtlas(), { pull: 0.5 }), 3);
    this.text = new Batch(scene, 3, mat('text', TEXT_FRAG, wordAtlas(), { depthTest: false }), 60);
    this.rib = new Ribbons(scene);
    this.camPos = new THREE.Vector3();
    this.camRight = new THREE.Vector3(1, 0, 0);
    this.camUp = new THREE.Vector3(0, 1, 0);
    this.camFwd = new THREE.Vector3(0, 0, -1);
    this.imm = []; // このフレームだけ描く光（ジェットの噴射口など）
    this.immN = 0;
    this.frame = 0;
    this.time = 0;
    this.wordT = -9;
    this.tanHalf = Math.tan((35 * Math.PI) / 180);
    this.aspect = 0.46;
  }

  // ---- 1枚の光を出す ----
  spark(o) {
    const s = this.add.get();
    if (!s) return null;
    return fill(s, o);
  }
  puff(o) {
    const s = this.smoke.get();
    if (!s) return null;
    return fill(s, o);
  }
  // このフレームだけの光
  glowNow(pos, size, color, intensity, core, rot = 0, cell = CELL.GLOW, occ = 0) {
    let q = this.imm[this.immN];
    if (!q) {
      q = { x: 0, y: 0, z: 0, size: 1, r: 1, g: 1, b: 1, core: 0, rot: 0, cell: 0, occ: 0 };
      this.imm.push(q);
    }
    this.immN++;
    q.x = pos.x;
    q.y = pos.y;
    q.z = pos.z;
    q.size = size;
    _c.set(color);
    q.r = _c.r * intensity;
    q.g = _c.g * intensity;
    q.b = _c.b * intensity;
    q.core = core;
    q.rot = rot;
    q.cell = cell;
    q.occ = occ;
  }

  // ---- 波紋の輪（向き：face＝カメラを向く／そうでなければ地面と平行）----
  ring(pos, color, r0, r1, life, face, op, kind = 'ring', intensity = 1.35) {
    const s = this.add.get();
    if (!s) return;
    s.x = pos.x;
    s.y = pos.y;
    s.z = pos.z;
    s.life = life;
    const k = kind === 'ring' ? 2 : 2.28;
    s.s0 = r0 * k;
    s.s1 = r1 * k;
    s.ease = 3;
    s.fadePow = 1;
    // 大きな輪はうすく（画面いっぱいの白い壁にならないように）
    const big = r1 > 4.5 ? Math.pow(4.5 / r1, 0.75) : 1;
    setCol(s, color, intensity * op * big);
    s.core = 0.9 * op * big;
    s.occ = 0.12;
    s.align = face ? 0 : -1;
    s.rot = kind === 'ring' ? 0 : Math.random() * TAU;
    if (kind === 'ring') {
      s.ring = 0.84;
      s.cell = 0;
    } else s.cell = kind === 'hex' ? CELL.HEX : CELL.HEXF;
  }

  // ---- アニメのヒット ----
  // c：当たった所、d：ふっとぶ向き、s：大きさ、o：{heavy, main, accent, elem, weak, guardian}
  impact(c, d, s, o = {}) {
    const heavy = !!o.heavy;
    const low = this.low;
    const main = o.main != null ? o.main : heavy ? 0xffc93a : 0xffeea0;
    // 1) 白い光（一瞬）
    this.spark({ cell: CELL.GLOW, pos: c, s0: 0.6 * s, s1: (heavy ? 1.9 : 0.95) * s, life: heavy ? 0.11 : 0.06, ease: 1, color: 0xffffff, i: heavy ? 1.5 : 1.0, core: heavy ? 1.2 : 0.8, fadePow: 2 });
    // 2) トゲの星
    this.spark({ cell: Math.random() < 0.5 ? CELL.STAR : CELL.STAR2, pos: c, s0: 0.4 * s, s1: (heavy ? 2.3 : 1.25) * s, life: heavy ? 0.18 : 0.12, ease: 2, rot: rnd(0, TAU), spin: rnd(-3, 3), color: main, i: 1.9, core: 1.15, occ: 0.3, fadePow: 1.6, hold: 0.35 });
    // 3) 速い衝撃の輪
    this.ring(c, heavy ? main : 0xffffff, 0.2 * s, (heavy ? 1.9 : 1.05) * s, heavy ? 0.22 : 0.15, true, 0.9, 'ring', 1.5);
    // 4) 火花（ふっとぶ向きに多め）
    const n = Math.round((heavy ? 12 : 6) * (low ? 0.6 : 1));
    const acc = o.accent;
    for (let i = 0; i < n; i++) {
      randDir(_v, d, 0.75);
      const sp = heavy ? rnd(12, 24) : rnd(8, 15);
      const col = acc != null && i % 3 === 0 ? acc : i % 2 ? main : 0xffffff;
      this.spark({ cell: CELL.SPARK, pos: c, vel: _v.multiplyScalar(sp * s), drag: 6.5, grav: 7, s0: 0.16 * s, s1: 0.05 * s, asp: 0.9, align: 0.028, life: rnd(0.16, 0.3), color: col, i: 2.0, core: 1.4, fadePow: 1.3 });
    }
    if (heavy) {
      // 5) 集中線のような光の線
      this.spark({ cell: CELL.LINES, pos: c, s0: 1.1 * s, s1: 3.1 * s, life: 0.15, ease: 1, rot: rnd(0, TAU), color: 0xffffff, i: 1.25, core: 1.0, occ: 0.1, fadePow: 1.4 });
      // 6) 2つめの星（色つき・少しおくれて大きく）
      this.spark({ cell: CELL.STAR4, pos: c, delay: 0.025, s0: 0.8 * s, s1: 2.5 * s, life: 0.18, ease: 1, rot: rnd(-0.4, 0.4), color: acc != null ? acc : main, i: 1.7, core: 1.7, occ: 0.15, fadePow: 1.8 });
      // 7) 白い角ばった破片（画面にそって外へ）
      const m = low ? 4 : 7;
      for (let i = 0; i < m; i++) {
        const a = (i / m) * TAU + rnd(-0.3, 0.3);
        _v.copy(this.camRight).multiplyScalar(Math.cos(a)).addScaledVector(this.camUp, Math.sin(a)).addScaledVector(d, rnd(0, 0.5));
        this.spark({ cell: CELL.SHARD, pos: c, vel: _v.multiplyScalar(rnd(13, 21) * s), drag: 9, s0: 0.55 * s, s1: 0.16 * s, asp: 0.62, align: 0.004, life: rnd(0.2, 0.3), color: 0xffffff, i: 1.6, core: 1.2, occ: 0.5, fadePow: 1.2 });
      }
    }
    // 8) 属性の色（火：火の粉、風：かまいたち、水：しぶき）
    if (acc != null && o.elem) {
      const k = o.weak ? 1.5 : 1;
      if (o.elem === 'fire') {
        for (let i = 0; i < Math.round(5 * k); i++) {
          randDir(_v, d, 1.2);
          this.spark({ cell: CELL.GLOW, pos: c, vel: _v.multiplyScalar(rnd(3, 8)), drag: 3, grav: -5, s0: rnd(0.3, 0.5) * s, s1: 0.05, life: rnd(0.35, 0.6), color: i % 2 ? 0xff7a1a : 0xffc23a, i: 2.6, core: 0.8, occ: 0.1, fadePow: 1 });
        }
      } else if (o.elem === 'wind') {
        for (let i = 0; i < (heavy ? 2 : 1); i++) this.spark({ cell: CELL.SLASH, pos: c, s0: 0.7 * s, s1: (heavy ? 2.1 : 1.4) * s, life: 0.2, ease: 1, rot: rnd(0, TAU), spin: rnd(9, 14) * (Math.random() < 0.5 ? -1 : 1), color: acc, i: 1.8, core: 1.5, occ: 0.25, fadePow: 1.5 });
      } else if (o.elem === 'water') {
        for (let i = 0; i < Math.round(6 * k); i++) {
          randDir(_v, d, 1.1);
          _v.y += 0.5;
          this.spark({ cell: CELL.SPARK, pos: c, vel: _v.multiplyScalar(rnd(7, 13)), drag: 2.2, grav: 22, s0: 0.16 * s, s1: 0.08 * s, asp: 0.8, align: 0.02, life: rnd(0.3, 0.45), color: acc, i: 2.2, core: 1.2, occ: 0.3, fadePow: 0.8 });
        }
        this.ring(c, acc, 0.25 * s, (heavy ? 1.8 : 1.15) * s, 0.25, true, 0.8, 'ring', 1.4);
      }
    }
  }

  // ---- セル塗りのけむり ----
  // o: {n, r (広がり), speed, size, life, light, shade, light1, shade1, up, flat, dir}
  smokeBurst(c, o) {
    const n = Math.max(1, Math.round((o.n || 6) * (this.low ? 0.6 : 1)));
    for (let i = 0; i < n; i++) {
      if (o.flat) {
        const a = (i / n) * TAU + rnd(-0.3, 0.3);
        _v.set(Math.cos(a), rnd(0.05, 0.25), Math.sin(a));
      } else if (o.dir) {
        randDir(_v, o.dir, o.spread || 0.9);
      } else {
        _v.set(rnd(-1, 1), rnd(-0.6, 1), rnd(-1, 1));
        if (_v.lengthSq() < 0.01) _v.set(0, 1, 0);
        _v.normalize();
      }
      if (o.up) _v.y += o.up;
      const sp = (o.speed || 4) * rnd(0.55, 1.1);
      const s = this.puff({ pos: _v2.copy(c).addScaledVector(_v, (o.r || 0.3) * rnd(0.3, 1)), vel: _v.multiplyScalar(sp), drag: o.drag || 3.4, grav: o.grav != null ? o.grav : -1.4, s0: (o.size || 1) * rnd(0.35, 0.55), s1: (o.size || 1) * rnd(0.95, 1.3), ease: 1, life: (o.life || 0.9) * rnd(0.8, 1.15), rot: rnd(-0.35, 0.35), spin: rnd(-0.5, 0.5), cell: (Math.random() * 4) | 0, color: o.light || 0xf4f4f6, fadePow: 0.6, delay: o.delay ? rnd(0, o.delay) : 0 });
      if (!s) break;
      s.kind = 1;
      setShade(s, o.shade || 0x8f97b8);
      if (o.light1 != null) {
        _c.set(o.light1);
        s.r1 = _c.r;
        s.g1 = _c.g;
        s.b1 = _c.b;
        _c.set(o.shade1 != null ? o.shade1 : o.shade || 0x8f97b8);
        s.sr1 = _c.r;
        s.sg1 = _c.g;
        s.sb1 = _c.b;
        s.kind = 2;
      }
      s.e0 = o.erode != null ? o.erode : 0.35;
    }
  }

  // ---- 擬音の文字（同時に3つまで）----
  word(id, pos, frac = 0.42, tilt = null, top = false) {
    if (!WORD_UV[id]) return;
    const B = this.text;
    // 続けて出さない（top：倒したときなど、直前の文字と入れかえる）
    if (this.time - this.wordT < 0.12) {
      if (!top) return;
      if (B.live.length) B.pool.push(B.live.pop());
    }
    this.wordT = this.time;
    if (B.live.length >= B.max) {
      // いちばん古いものを消して入れかえる
      const old = B.live.shift();
      B.pool.push(old);
    }
    const s = B.get();
    if (!s) return;
    s.x = pos.x;
    s.y = pos.y;
    s.z = pos.z;
    s.life = 0.72;
    s.word = id;
    s.frac = frac;
    s.rot = tilt != null ? tilt : rnd(0.1, 0.24) * (Math.random() < 0.5 ? -1 : 1);
    s.vy = 0.6;
    s.delay = 0.045; // 当たった瞬間の光が少し引いてから出す（文字が光にうもれない）
  }

  // ===== 毎フレーム =====
  update(dt, cam, now) {
    this.time = now;
    this.frame++;
    const warm = this.frame < 3; // 最初の数フレームは描いて、シェーダーを先に用意しておく
    cam.updateMatrixWorld();
    const e = cam.matrixWorld.elements;
    this.camRight.set(e[0], e[1], e[2]);
    this.camUp.set(e[4], e[5], e[6]);
    this.camFwd.set(-e[8], -e[9], -e[10]);
    this.camPos.setFromMatrixPosition(cam.matrixWorld);
    if (cam.isPerspectiveCamera) {
      this.tanHalf = Math.tan((cam.fov * Math.PI) / 360);
      this.aspect = cam.aspect || 0.46;
    }
    this.stepBatch(this.add, dt, false);
    for (let i = 0; i < this.immN; i++) {
      const q = this.imm[i];
      const s = _immS;
      s.r = q.r;
      s.g = q.g;
      s.b = q.b;
      s.occ = q.occ;
      this.add.put(s, q.x, q.y, q.z, q.size, q.size, q.rot, 0, CELL_UV[q.cell], 1, q.core, 0, 0);
    }
    this.immN = 0;
    this.add.finish(warm);
    this.stepBatch(this.smoke, dt, true);
    this.smoke.finish(warm);
    this.stepText(dt);
    this.text.finish(warm);
    ribMat().uniforms.time.value = now;
    const nr = this.rib.build(this.camPos, now);
    this.rib.mesh.visible = nr > 0 || warm;
  }
  stepBatch(B, dt, smoke) {
    const L = B.live;
    let w = 0;
    for (let i = 0; i < L.length; i++) {
      const s = L[i];
      if (s.delay > 0) {
        s.delay -= dt;
        L[w++] = s;
        continue;
      }
      s.t += dt;
      if (s.t >= s.life) {
        B.pool.push(s);
        continue;
      }
      L[w++] = s;
      const k = s.t / s.life;
      if (s.drag) {
        const f = Math.exp(-s.drag * dt);
        s.vx *= f;
        s.vy *= f;
        s.vz *= f;
      }
      s.vy -= s.grav * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      s.rot += s.spin * dt;
      const size = s.s0 + (s.s1 - s.s0) * EASE[s.ease](Math.min(1, k));
      let fade = s.fadeIn > 0 ? Math.min(1, s.t / s.fadeIn) : 1;
      const kk = s.hold > 0 ? Math.max(0, (k - s.hold) / (1 - s.hold)) : k;
      fade *= Math.pow(1 - kk, s.fadePow);
      s.ax = s.vx;
      s.ay = s.vy;
      s.az = s.vz;
      if (smoke) {
        // けむり：色が変わり（火→灰色）、後半はふちから消える
        const sr = s.r, sg = s.g, sb = s.b;
        if (s.kind === 2) {
          const m = smooth(0.05, 0.55, k);
          s.r = sr + (s.r1 - sr) * m;
          s.g = sg + (s.g1 - sg) * m;
          s.b = sb + (s.b1 - sb) * m;
          s.ax = s.sr + (s.sr1 - s.sr) * m;
          s.ay = s.sg + (s.sg1 - s.sg) * m;
          s.az = s.sb + (s.sb1 - s.sb) * m;
        } else {
          s.ax = s.sr;
          s.ay = s.sg;
          s.az = s.sb;
        }
        s.occ = 1;
        const er = smooth(s.e0, 1, k) * 0.92;
        const fd = Math.min(1, s.t / 0.04) * (1 - smooth(0.85, 1, k));
        B.put(s, s.x, s.y, s.z, size, size, s.rot, 0, SMOKE_UV[s.cell], fd, 0, er, 0);
        s.r = sr;
        s.g = sg;
        s.b = sb;
      } else {
        const w0 = size, h0 = size * s.asp;
        B.put(s, s.x, s.y, s.z, w0, h0, s.rot, s.align, s.ring ? CELL_UV[0] : CELL_UV[s.cell], fade, s.core * fade, s.ring, s.ring ? 1 : 0);
      }
    }
    L.length = w;
  }
  // 文字：画面での大きさが一定になるように（遠いと少しだけ小さく）
  stepText(dt) {
    const B = this.text;
    const L = B.live;
    let w = 0;
    for (let i = 0; i < L.length; i++) {
      const s = L[i];
      if (s.delay > 0) {
        s.delay -= dt;
        L[w++] = s;
        continue;
      }
      s.t += dt;
      if (s.t >= s.life) {
        B.pool.push(s);
        continue;
      }
      L[w++] = s;
      s.y += s.vy * dt;
      s.vy *= Math.exp(-3 * dt);
      const info = WORD_UV[s.word];
      _v.set(s.x - this.camPos.x, s.y - this.camPos.y, s.z - this.camPos.z);
      const depth = Math.max(0.5, _v.dot(this.camFwd));
      const t = s.t;
      // ポンと出る：小さく → 大きく → 少しもどる → 最後は少し大きくなって消える
      let sc;
      if (t < 0.07) sc = 0.35 + (t / 0.07) * 0.95;
      else if (t < 0.16) sc = 1.3 - ((t - 0.07) / 0.09) * 0.3;
      else sc = 1 + Math.max(0, t - s.life + 0.2) * 0.6;
      const far = 1 - smooth(10, 26, depth) * 0.3;
      const W = 2 * depth * this.tanHalf * this.aspect * s.frac * far * sc;
      const fade = 1 - smooth(s.life - 0.18, s.life, t);
      const flash = t < 0.035 ? 0.75 : t < 0.075 ? 0.75 * (1 - (t - 0.035) / 0.04) : 0;
      const wob = Math.sin(t * 34) * 0.05 * Math.max(0, 1 - t * 4);
      B.put(s, s.x, s.y, s.z, W, W / info.asp, s.rot + wob, 0, info.uv, fade, 0.88, flash, 0);
    }
    L.length = w;
  }
  clear() {
    this.add.clear();
    this.smoke.clear();
    this.text.clear();
    this.rib.clear();
    this.immN = 0;
  }
  dispose() {
    this.add.dispose();
    this.smoke.dispose();
    this.text.dispose();
    this.rib.dispose();
  }
}
const _immS = newSprite();

function setCol(s, color, intensity) {
  _c.set(color);
  s.r = _c.r * intensity;
  s.g = _c.g * intensity;
  s.b = _c.b * intensity;
}
function setShade(s, color) {
  _c.set(color);
  s.sr = _c.r;
  s.sg = _c.g;
  s.sb = _c.b;
}
// 1枚の設定（o.pos, vel, s0, s1, life, ...）
function fill(s, o) {
  s.x = o.pos.x;
  s.y = o.pos.y;
  s.z = o.pos.z;
  if (o.vel) {
    s.vx = o.vel.x;
    s.vy = o.vel.y;
    s.vz = o.vel.z;
  }
  s.life = o.life || 0.3;
  s.delay = o.delay || 0;
  s.drag = o.drag || 0;
  s.grav = o.grav || 0;
  s.s0 = o.s0 != null ? o.s0 : 1;
  s.s1 = o.s1 != null ? o.s1 : s.s0;
  s.ease = o.ease != null ? o.ease : 1;
  s.asp = o.asp || 1;
  s.rot = o.rot || 0;
  s.spin = o.spin || 0;
  s.align = o.align || 0;
  s.cell = o.cell || 0;
  setCol(s, o.color != null ? o.color : 0xffffff, o.i != null ? o.i : 1);
  s.occ = o.occ || 0;
  s.core = o.core || 0;
  s.fadePow = o.fadePow != null ? o.fadePow : 1;
  s.fadeIn = o.fadeIn || 0;
  s.hold = o.hold || 0;
  s.ring = 0;
  return s;
}
// d のまわりの、ばらつく向き（spread が大きいほど広い）
function randDir(out, d, spread) {
  out.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1));
  if (out.lengthSq() < 1e-4) out.set(0, 1, 0);
  out.normalize().multiplyScalar(spread);
  if (d) out.add(d);
  if (out.lengthSq() < 1e-4) out.set(0, 1, 0);
  return out.normalize();
}

// タイトル画面のあいだに、形の板を先に作っておく（最初の試合が始まるときに止まらないように）
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const pre = () => {
    try {
      fxAtlas();
      smokeAtlas();
      wordAtlas();
      ribbonTex();
    } catch (e) {}
  };
  if (window.requestIdleCallback) window.requestIdleCallback(pre, { timeout: 4000 });
  else setTimeout(pre, 1800);
}
