// 操作（タッチ・マウス・キーボード）
// 長押し＝前へ飛ぶ／スライド＝旋回（仮想スティック）／タップ＝ブーストダッシュ
// フリック＝回避（上＝前、下＝後ろ、左右）／上→下の連続フリック＝180度ターン
// 操作のしかた（scheme）：
//  'two'（両手・ふだん）：画面の左半分＝上の操作ぜんぶ（飛ぶ・旋回・タップ・フリック）
//                        画面の右半分＝なぞって視点（向き）を直接まわす。タップはブースト
//  'one'（片手）：画面のどこでも上の操作（キックフライトと同じ）
import { MOVE } from './config.js';
import { clamp } from './util.js';

const TAP_TIME = 0.3; // これより短く、指を動かさずに離したらタップ（少し長めに押してもブーストになる）
const TAP_SLOP = 14; // タップとみなす指のずれ(px)
const HOLD_DELAY = 0.19; // これより長く押すと飛びはじめる（それより前に指が動いたら、その場で向きを変える）
const FLICK_TIME = 0.3;
const FLICK_DIST = 30;
const FLICK_SPEED = 0.32; // px/ms
const DOUBLE_FLICK = 0.52; // 上→下 の連続フリックの受付
const LOOK_RAD_PER_PX = 0.0075; // 右の親指でなぞったときの、1px あたりの向きの変わり方（約0.43度。右半分を端から端まで＝約90度）

export class Input {
  constructor(surface, ringEl, knobEl) {
    this.surface = surface;
    this.ringEl = ringEl;
    this.knobEl = knobEl;
    this.enabled = false;
    this.invertY = false;
    this.invertX = false;
    this.sens = 1;
    this.lookSens = 1; // 右の親指の速さ（せっていで変える）
    this.events = [];
    this.hold = false;
    this.stickX = 0;
    this.stickY = 0;
    this.lookX = 0; // このフレームで右の親指がまわした向き（ラジアン。右＝プラス）
    this.lookY = 0; // 上＝プラス
    this.lookPX = 0; // まだ使っていない、なぞった量（px）
    this.lookPY = 0;
    this.scheme = 'two'; // 'two' 両手 / 'one' 片手
    this.main = null; // スティックを動かしている指
    this.keys = new Set();
    this.lastFlick = null;
    this.now = () => performance.now() / 1000;
    this.isMoving = () => false; // 飛んでいる最中か（試合側が教える）
    this._onDown = this.onDown.bind(this);
    this._onMove = this.onMove.bind(this);
    this._onUp = this.onUp.bind(this);
    this._onKey = this.onKey.bind(this);
    this._onKeyUp = this.onKeyUp.bind(this);
    surface.addEventListener('pointerdown', this._onDown, { passive: false });
    window.addEventListener('pointermove', this._onMove, { passive: false });
    window.addEventListener('pointerup', this._onUp, { passive: false });
    window.addEventListener('pointercancel', this._onUp, { passive: false });
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('keyup', this._onKeyUp);
    // iPhone の長押しメニュー・ダブルタップ拡大・スクロールを止める
    const stop = (e) => {
      if (e.cancelable) e.preventDefault();
    };
    surface.addEventListener('touchstart', stop, { passive: false });
    surface.addEventListener('touchmove', stop, { passive: false });
    surface.addEventListener('contextmenu', stop);
    this.pointers = new Map();
  }
  destroy() {
    this.surface.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
    window.removeEventListener('pointercancel', this._onUp);
    window.removeEventListener('keydown', this._onKey);
    window.removeEventListener('keyup', this._onKeyUp);
  }
  reset() {
    this.events.length = 0;
    this.hold = false;
    this.stickX = this.stickY = 0;
    this.lookX = this.lookY = 0;
    this.lookPX = this.lookPY = 0;
    this.main = null;
    this.pointers.clear();
    this.showRing(false);
  }
  push(ev) {
    if (this.enabled) this.events.push(ev);
  }

  onDown(e) {
    if (!this.enabled) return;
    if (e.cancelable) e.preventDefault();
    try {
      this.surface.setPointerCapture && this.surface.setPointerCapture(e.pointerId);
    } catch (err) {}
    const t = this.now();
    const p = { id: e.pointerId, x0: e.clientX, y0: e.clientY, ax: e.clientX, ay: e.clientY, x: e.clientX, y: e.clientY, t0: t, moved: 0, minDy: 0, maxDy: 0, isMain: false, mode: 'pending', hist: [[e.clientX, e.clientY, t]] };
    // 両手：画面の右半分で押した指は「視点の指」（なぞると向きが変わる。飛んだりフリックしたりはしない）
    p.look = this.scheme === 'two' && e.clientX >= this.splitX();
    this.pointers.set(e.pointerId, p);
    if (p.look) return;
    if (!this.main) {
      p.isMain = true;
      this.main = p;
      // 飛んでいる最中に触ったら、そのまま飛び続ける
      if (this.isMoving()) p.mode = 'fly';
      this.showRing(true, p.ax, p.ay);
      this.updateKnob(0, 0);
      this.push({ type: 'press' });
    }
  }
  onMove(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    if (e.cancelable) e.preventDefault();
    if (p.look) {
      this.lookPX += e.clientX - p.x;
      this.lookPY += e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      p.moved = Math.max(p.moved, Math.hypot(p.x - p.x0, p.y - p.y0));
      return;
    }
    p.x = e.clientX;
    p.y = e.clientY;
    const t = this.now();
    p.hist.push([p.x, p.y, t]);
    if (p.hist.length > 12) p.hist.shift();
    const dx = p.x - p.x0, dy = p.y - p.y0;
    p.moved = Math.max(p.moved, Math.hypot(dx, dy));
    p.minDy = Math.min(p.minDy, dy);
    p.maxDy = Math.max(p.maxDy, dy);
    // 押してすぐ指を動かした＝その場で向きを変える（飛ばない）
    if (p.mode === 'pending' && p.moved > 12) p.mode = t - p.t0 < HOLD_DELAY ? 'look' : 'fly';
    if (p.isMain) {
      // スティックの中心は指が遠くへ行くとついてくる
      const R = MOVE.stickRadius;
      let ox = p.x - p.ax, oy = p.y - p.ay;
      const d = Math.hypot(ox, oy);
      const lim = R * 1.25;
      if (d > lim) {
        p.ax += (ox / d) * (d - lim);
        p.ay += (oy / d) * (d - lim);
        ox = p.x - p.ax;
        oy = p.y - p.ay;
        this.showRing(true, p.ax, p.ay);
      }
      this.updateKnob(ox, oy);
    }
  }
  onUp(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    const t = this.now();
    const dur = t - p.t0;
    if (p.look) {
      if (e.type !== 'pointercancel' && dur < TAP_TIME && p.moved < TAP_SLOP) this.push({ type: 'tap', dur });
      return;
    }
    const dx = p.x - p.x0, dy = p.y - p.y0;
    const dist = Math.hypot(dx, dy);
    // 最後の0.12秒の速さでフリックを見る
    let vx = 0, vy = 0;
    for (let i = p.hist.length - 1; i >= 0; i--) {
      if (t - p.hist[i][2] > 0.14 || i === 0) {
        const h = p.hist[i];
        const dt = Math.max(0.016, t - h[2]);
        vx = (p.x - h[0]) / (dt * 1000);
        vy = (p.y - h[1]) / (dt * 1000);
        break;
      }
    }
    const speed = Math.hypot(vx, vy);
    // V字（上に行って戻る／下に行って戻る）＝180度ターン
    const vUp = p.minDy < -24 && dy - p.minDy > 36 && dy > -12;
    const vDown = p.maxDy > 24 && p.maxDy - dy > 36 && dy < 12;
    if (e.type !== 'pointercancel' && dur < 0.55 && (vUp || vDown) && Math.abs(dx) < 40) {
      this.push({ type: 'uturn', dur });
    } else if (e.type !== 'pointercancel') {
      if (dur < TAP_TIME && dist < TAP_SLOP) {
        this.push({ type: 'tap', dur });
      } else if ((dur < FLICK_TIME && dist > FLICK_DIST) || (speed > FLICK_SPEED * 1.4 && dist > FLICK_DIST * 0.8)) {
        // 上に行ってから下に戻った（Vの字）＝180度ターン
        if (p.minDy < -24 && dy > 16 && dur < 0.5) {
          this.push({ type: 'uturn', dur });
        } else {
          const fx = speed > 0.05 ? vx : dx, fy = speed > 0.05 ? vy : dy;
          const dir = quantize8(fx, fy);
          // 上と下のフリックを続けて（順番はどちらでも）→ 180度ターン
          const lf = this.lastFlick;
          if (lf && t - lf.t < DOUBLE_FLICK && Math.abs(dir.x) < 0.5 && Math.abs(lf.dir.x) < 0.5 && ((dir.y > 0.5 && lf.dir.y < -0.5) || (dir.y < -0.5 && lf.dir.y > 0.5))) {
            this.push({ type: 'uturn', dur });
            this.lastFlick = null;
          } else {
            this.push({ type: 'flick', dir, dur });
            this.lastFlick = { dir, t };
          }
        }
      }
    }
    if (p.isMain) {
      this.main = null;
      this.showRing(false);
      // ほかの指が残っていたら、それをスティックにする
      for (const q of this.pointers.values()) {
        if (q.look) continue;
        q.isMain = true;
        q.ax = q.x;
        q.ay = q.y;
        this.main = q;
        this.showRing(true, q.ax, q.ay);
        break;
      }
    }
  }

  onKey(e) {
    if (!this.enabled) return;
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    if (this.keys.has(k)) return;
    this.keys.add(k);
    const map = { j: 'tap', enter: 'tap', e: ['flick', 1, 0], q: ['flick', -1, 0], x: ['flick', 0, 1], c: ['flick', 0, -1], r: 'uturn' };
    const m = map[k];
    if (m === 'tap') this.push({ type: 'tap' });
    else if (m === 'uturn') this.push({ type: 'uturn' });
    else if (m) this.push({ type: 'flick', dir: { x: m[1], y: m[2] } });
    if (k >= '1' && k <= '5') this.push({ type: 'skill', slot: +k - 1 });
    if (k === 'f') this.push({ type: 'special' });
    if (k === 'tab' || k === 'l') {
      e.preventDefault();
      this.push({ type: 'lockNext' });
    }
  }
  onKeyUp(e) {
    this.keys.delete(e.key.toLowerCase());
  }

  // 毎フレーム：飛んでいるか、スティックの向き
  sample() {
    let hold = false, sx = 0, sy = 0;
    const p = this.main;
    if (p) {
      const now = this.now();
      const dur = now - p.t0;
      if (p.mode === 'pending' && dur > HOLD_DELAY) p.mode = 'fly';
      hold = p.mode === 'fly';
      // 指がすばやく動いている（フリックの途中）ときは向きを変えない
      let fast = false;
      if (dur < FLICK_TIME && p.hist.length > 1) {
        const h = p.hist[Math.max(0, p.hist.length - 4)];
        const ddt = Math.max(0.008, now - h[2]);
        fast = Math.hypot(p.x - h[0], p.y - h[1]) / (ddt * 1000) > 0.55;
      }
      const R = MOVE.stickRadius;
      let ox = (p.x - p.ax) / R, oy = (p.y - p.ay) / R;
      const d = Math.hypot(ox, oy);
      const dz = MOVE.stickDead / R;
      if (d < dz) {
        ox = oy = 0;
      } else {
        const k = Math.min(1, (d - dz) / (1 - dz)) / d;
        ox *= k;
        oy *= k;
      }
      sx = fast ? 0 : curve(ox);
      sy = fast ? 0 : curve(-oy);
    }
    // キーボード
    const K = this.keys;
    if (K.has('a') || K.has('arrowleft')) sx = -1;
    if (K.has('d') || K.has('arrowright')) sx = 1;
    if (K.has('w') || K.has('arrowup')) sy = 1;
    if (K.has('s') || K.has('arrowdown')) sy = -1;
    if (K.has(' ') || K.has('shift')) hold = true;
    this.hold = hold && this.enabled;
    // 指を右へ＝右を向く（キックフライトと同じ）。せっていで反対にもできる
    this.stickX = clamp(sx * this.sens * (this.invertX ? -1 : 1), -1, 1);
    this.stickY = clamp(sy * this.sens * (this.invertY ? -1 : 1), -1, 1);
    // 右の親指：なぞった分だけ向きを変える（指を上へ＝上を向く）
    const k = LOOK_RAD_PER_PX * this.lookSens;
    this.lookX = this.enabled ? this.lookPX * k * (this.invertX ? -1 : 1) : 0;
    this.lookY = this.enabled ? -this.lookPY * k * (this.invertY ? -1 : 1) : 0;
    this.lookPX = this.lookPY = 0;
  }
  // 両手のとき、左と右を分ける位置（画面のまん中）
  splitX() {
    const r = this.surface.getBoundingClientRect ? this.surface.getBoundingClientRect() : null;
    return r && r.width ? r.left + r.width * 0.5 : (window.innerWidth || 0) * 0.5;
  }
  // いま視点の指が画面にふれているか
  looking() {
    for (const q of this.pointers.values()) if (q.look) return true;
    return false;
  }

  showRing(on, x, y) {
    if (!this.ringEl) return;
    if (!on) {
      this.ringEl.style.opacity = '0';
      return;
    }
    this.ringEl.style.opacity = '1';
    this.ringEl.style.transform = `translate(${x}px, ${y}px)`;
  }
  updateKnob(ox, oy) {
    if (!this.knobEl) return;
    const R = MOVE.stickRadius;
    const d = Math.hypot(ox, oy);
    const k = d > R ? R / d : 1;
    this.knobEl.style.transform = `translate(${ox * k}px, ${oy * k}px)`;
  }
}

function curve(v) {
  return Math.sign(v) * Math.pow(Math.abs(v), 1.35);
}
function quantize8(x, y) {
  const a = Math.atan2(y, x);
  const s = Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
  const qx = Math.round(Math.cos(s) * 1000) / 1000;
  const qy = Math.round(Math.sin(s) * 1000) / 1000;
  return { x: qx, y: qy }; // y は画面の下向きがプラス
}
