// 小さな道具箱（数学・乱数・保存）
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => clamp((v - a) / (b - a), 0, 1);
// フレームレートに左右されない追従（k は 1 秒あたりの強さ）
export const damp = (a, b, k, dt) => b + (a - b) * Math.exp(-k * dt);
export const wrapAngle = (a) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};
export const angleDamp = (a, b, k, dt) => a + wrapAngle(b - a) * (1 - Math.exp(-k * dt));
export const approach = (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeOutBack = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

// 決まった並びの乱数（ステージの配置などに使う）
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randi = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export function shuffle(arr, rnd = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const fmtTime = (s) => {
  s = Math.max(0, Math.ceil(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};

// 保存（学校の端末やプライベートブラウズで localStorage が使えないときはメモリに置く）
const mem = {};
let lsOk = null;
function lsAvailable() {
  if (lsOk !== null) return lsOk;
  try {
    const k = '__rpf_t';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    lsOk = true;
  } catch (e) {
    lsOk = false;
  }
  return lsOk;
}
export const store = {
  ok: () => lsAvailable(),
  get(key, fallback = null) {
    try {
      const raw = lsAvailable() ? window.localStorage.getItem(key) : mem[key];
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  },
  set(key, value) {
    const raw = JSON.stringify(value);
    try {
      if (lsAvailable()) window.localStorage.setItem(key, raw);
      else mem[key] = raw;
    } catch (e) {
      mem[key] = raw;
    }
  },
  del(key) {
    try {
      if (lsAvailable()) window.localStorage.removeItem(key);
    } catch (e) {}
    delete mem[key];
  },
};

export function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 端末の判定
export const UA = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
export const isIOS = /iP(hone|ad|od)/.test(UA) || (/Macintosh/.test(UA) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);
export const isAndroid = /Android/.test(UA);
export const isLINE = / Line\//i.test(UA);
export const isInApp = isLINE || /FBAN|FBAV|Instagram|Twitter|TikTok/i.test(UA);
export const isStandalone = () =>
  (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
  (typeof navigator !== 'undefined' && navigator.standalone === true);
export const hasTouch = () => typeof window !== 'undefined' && ('ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0);

export function vibrate(ms) {
  try {
    if (navigator.vibrate) navigator.vibrate(ms);
  } catch (e) {}
}

// v1.8：文字をコピーする（iPhone の古い Safari・LINE のブラウザでも使えるように、だめなら選んでコピーする方法で）
export async function copyText(t) {
  t = String(t);
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && (typeof window === 'undefined' || window.isSecureContext !== false)) {
      await navigator.clipboard.writeText(t);
      return true;
    }
  } catch (e) {}
  try {
    const ta = document.createElement('textarea');
    ta.value = t;
    ta.setAttribute('readonly', '');
    // 16px 以上にしないと iPhone で画面が拡大される
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, t.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return !!ok;
  } catch (e) {
    return false;
  }
}

// v1.8：フレンドコード（8文字）を、貼りつけた文やリンクの中から取り出す
//   「ABCD2345」「abcd 2345」「…フレンドコード：ABCD2345」「https://…/?f=ABCD2345&…」のどれでもOK
const FC_CHARS = /^[A-HJ-NP-Z2-9]{8}$/;
export function pickFriendCode(text) {
  const s = String(text || '').normalize('NFKC').toUpperCase();
  const u = s.match(/[?&]F=([A-Z0-9]{8})(?![A-Z0-9])/);
  if (u && FC_CHARS.test(u[1])) return u[1];
  const toks = s.split(/[^A-Z0-9]+/).filter((x) => FC_CHARS.test(x));
  if (toks.length) return toks[toks.length - 1];
  const all = s.replace(/[^A-Z0-9]/g, '');
  return FC_CHARS.test(all) ? all : '';
}
