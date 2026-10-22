// えフェクト：火花・数字・波紋・光の筋・つぶ
// アニメ調の光（ヒットの星・衝撃の輪・破片）・擬音の文字・セル塗りのけむり・ジェットの光の帯は vfx.js でまとめ描き
import * as THREE from 'three';
import { glowTex, toon, addOutline, canvasTex, sakuraTex, shareMark, disposeDeep } from './gfx.js';
import { TEAM, ELEM } from './config.js';
import { KIND_COLOR, OMAMORI } from './characters.js';
import { buildMonster, poseMonster, summonSpot, monsterMouth, SUMMON_TURN, SUMMON_SCALE } from './monsters.js';
import { rand, clamp, el } from './util.js';
import { VFX, CELL, WORD } from './vfx.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _d = new THREE.Vector3();
const _c0 = new THREE.Vector3();
const _p = new THREE.Vector3();
const _w = new THREE.Vector3();
const _ca = new THREE.Color();
const _cb = new THREE.Color();
// d の向き（sign で逆向き）のまわりに少しばらつく向き
function randDirLocal(out, d, sign, spread) {
  out.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(spread).addScaledVector(d, sign);
  if (out.lengthSq() < 1e-4) out.set(0, 1, 0);
  return out.normalize();
}
const lerpAngle = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
// 属性の差し色（火：だいだい、風：みどり、水：水色）
const ACCENT = { fire: 0xff6a1a, wind: 0x4dff7a, water: 0x2fc8ff };
// ジェットの光の帯の色（根元は明るいチームの色＋白い芯、うしろは濃いチームの色）。青＝水色がかった青、赤＝ピンクがかった赤
const JET = {
  0: { head: new THREE.Color(0x2aaeff).multiplyScalar(2.0), tail: new THREE.Color(0x1064ff).multiplyScalar(1.6), glow: 0x8fdcff },
  1: { head: new THREE.Color(0xff3c74).multiplyScalar(2.0), tail: new THREE.Color(0xff1040).multiplyScalar(1.6), glow: 0xff8aa8 },
};
// 強い当たりの擬音
const HIT_WORDS = [WORD.DOGO, WORD.BAKI, WORD.DOKA, WORD.BASHI];
const DARK = new THREE.Color(0x2a2238);
const GRAY = new THREE.Color(0xd9dbe4);
const WARM = new THREE.Color(0xffd77a);
const easeOutBack = (k) => 1 + 2.4 * Math.pow(k - 1, 3) + 1.4 * Math.pow(k - 1, 2);
// 技を出してから消えるまで（種類ごと）
const ACT_DUR = { ATK: 0.75, HEAL: 0.9, BUFF: 0.9, TRAP: 0.8, WARP: 0.65, MOVE: 0.7 };
// 呼び出しの光（六角の輪・光の柱・かけら）
const hexGeo = shareMark(new THREE.RingGeometry(0.82, 1, 6, 1));
const hexFill = shareMark(new THREE.CircleGeometry(0.8, 6));
const beamGeo = shareMark(new THREE.CylinderGeometry(1, 1, 1, 18, 1, true));
const shardGeo = shareMark(new THREE.TetrahedronGeometry(0.2, 0));
const shardMats = new Map();
const shardMat = (c) => shardMats.get(c) || (shardMats.set(c, shareMark(new THREE.MeshBasicMaterial({ color: c }))), shardMats.get(c));

// ===== つぶ（Points でまとめて描く）=====
class Particles {
  constructor(scene, max = 700) {
    this.max = max;
    this.n = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { map: { value: glowTex() }, scale: { value: 600 } },
      vertexShader:
        'attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA;\n' +
        'uniform float scale; void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / max(0.5, -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D map; varying vec3 vC; varying float vA; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC * 1.6, t.a * vA);\n#include <colorspace_fragment>\n}',
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.p = [];
    for (let i = 0; i < max; i++) this.p.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, s0: 1, s1: 0, r: 1, g: 1, b: 1, drag: 0, grav: 0 });
    this.free = [];
    this.live = [];
  }
  emit(x, y, z, vx, vy, vz, life, s0, s1, color, drag = 1.5, grav = 0) {
    let q;
    if (this.live.length >= this.max) q = this.live.shift();
    else q = this.free.pop() || this.p[this.live.length];
    q.x = x;
    q.y = y;
    q.z = z;
    q.vx = vx;
    q.vy = vy;
    q.vz = vz;
    q.life = life;
    q.max = life;
    q.s0 = s0;
    q.s1 = s1;
    const c = _col.set(color);
    q.r = c.r;
    q.g = c.g;
    q.b = c.b;
    q.drag = drag;
    q.grav = grav;
    this.live.push(q);
  }
  update(dt) {
    const L = this.live;
    let w = 0;
    for (let i = 0; i < L.length; i++) {
      const q = L[i];
      q.life -= dt;
      if (q.life <= 0) {
        this.free.push(q);
        continue;
      }
      const k = Math.exp(-q.drag * dt);
      q.vx *= k;
      q.vy = q.vy * k - q.grav * dt;
      q.vz *= k;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.z += q.vz * dt;
      L[w++] = q;
      const i3 = (w - 1) * 3;
      this.pos[i3] = q.x;
      this.pos[i3 + 1] = q.y;
      this.pos[i3 + 2] = q.z;
      this.col[i3] = q.r;
      this.col[i3 + 1] = q.g;
      this.col[i3 + 2] = q.b;
      const t = q.life / q.max;
      this.size[w - 1] = q.s1 + (q.s0 - q.s1) * t;
      this.alpha[w - 1] = Math.min(1, t * 1.6);
    }
    L.length = w;
    this.geo.setDrawRange(0, w);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
  }
}
const _col = new THREE.Color();

// ===== 波紋の輪 =====
const ringGeo = shareMark(new THREE.RingGeometry(0.85, 1, 48));
// 飛び道具の形と色は使い回す（1発ごとに作るとGPUのメモリがふえていく）
const PC = {};
const pcache = (key, make) => PC[key] || (PC[key] = shareMark(make()));
const addSpr = (m, key, color, size, opacity = 0.85, z = 0) => {
  const s = new THREE.Sprite(pcache(key, () => new THREE.SpriteMaterial({ map: glowTex(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending })));
  s.scale.set(size, size, 1);
  s.position.z = z;
  m.add(s);
  return s;
};
const addMat = (key, color, op = 1) =>
  pcache(key, () => {
    const mt = new THREE.MeshBasicMaterial({ color, transparent: op < 1, opacity: op, depthWrite: op >= 1 });
    if (op < 1) mt.blending = THREE.AdditiveBlending;
    return mt;
  });
// モンスターの技の弾（前が +Z）
function projTemplate(k) {
  const m = new THREE.Group();
  if (k === 'akahon') {
    // ブレイズドレイク：追いかける火の玉
    m.add(new THREE.Mesh(pcache('fbCore', () => new THREE.IcosahedronGeometry(0.42, 1)), addMat('fbCoreM', 0xfff0a0)));
    const shell = new THREE.Mesh(pcache('fbShell', () => new THREE.IcosahedronGeometry(0.62, 1)), addMat('fbShellM', 0xff6a1a, 0.55));
    m.add(shell);
    const tail = new THREE.Mesh(pcache('fbTail', () => new THREE.ConeGeometry(0.55, 2.2, 10, 1, true)), addMat('fbTailM', 0xff8a2a, 0.5));
    tail.rotation.x = -Math.PI / 2;
    tail.position.z = -1.2;
    m.add(tail);
    addSpr(m, 'fbS', 0xff7a2a, 3.4, 0.75);
    m.userData.trail = 0xff8a2a;
  } else if (k === 'tangocho') {
    // ゲイルファルコン：回るかまいたち（三日月の刃）
    const crescent = pcache('wbG', () => {
      const s = new THREE.Shape();
      s.absarc(0, 0, 1.0, 0.25 * Math.PI, 1.75 * Math.PI, false);
      s.absarc(0.38, 0, 0.78, 1.6 * Math.PI, 0.4 * Math.PI, true);
      const g = new THREE.ShapeGeometry(s, 16);
      g.rotateX(-Math.PI / 2);
      return g;
    });
    const mat = pcache('wbM', () => new THREE.MeshBasicMaterial({ color: 0xd8ffb0, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    for (let i = 0; i < 2; i++) {
      const b = new THREE.Mesh(crescent, mat);
      b.rotation.y = i * Math.PI;
      b.scale.setScalar(0.85);
      m.add(b);
    }
    addSpr(m, 'wbS', 0x9dff4a, 2.6, 0.6);
    m.userData.trail = 0x9dff4a;
  } else if (k === 'pencil') {
    // ランスナーヴァル：まっすぐ速い水の槍
    const lance = new THREE.Mesh(pcache('alG', () => new THREE.ConeGeometry(0.2, 2.0, 10)), addMat('alM', 0xdaf8ff));
    lance.rotation.x = Math.PI / 2;
    lance.position.z = 0.3;
    m.add(lance);
    const sheath = new THREE.Mesh(pcache('alG2', () => new THREE.ConeGeometry(0.36, 2.6, 12, 1, true)), addMat('alM2', 0x3be6ff, 0.45));
    sheath.rotation.x = Math.PI / 2;
    sheath.position.z = 0.05;
    m.add(sheath);
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(pcache('alR', () => new THREE.TorusGeometry(0.34, 0.035, 6, 24)), addMat('alRM', 0x9af6ff, 0.8));
      r.position.z = -0.4 - i * 0.45;
      r.scale.setScalar(1 + i * 0.25);
      m.add(r);
    }
    addSpr(m, 'alS', 0x3be6ff, 2.4, 0.7, 0.6);
    m.userData.trail = 0x6ad8ff;
  }
  return m;
}
// ロビー（ディスク画面）用：技の弾の見た目だけ
export function projectileLook(kind) {
  return pcache('tpl_' + kind, () => projTemplate(kind)).clone();
}
// 方眼の結界（グリッドオクトパス）
const gridTexCache = {};
function gridTex(team) {
  if (gridTexCache[team]) return gridTexCache[team];
  const col = TEAM[team].color;
  const t = canvasTex(256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = col;
    ctx.lineWidth = 3;
    const R = 16;
    for (let y = -1; y < 12; y++)
      for (let x = -1; x < 10; x++) {
        const cx = x * R * 1.732 + (y % 2 ? R * 0.866 : 0), cy = y * R * 1.5;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
          ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        }
        ctx.closePath();
        ctx.stroke();
      }
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.92, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  t.userData.shared = true;
  gridTexCache[team] = t;
  return t;
}

export class FX {
  constructor(match, layer) {
    this.match = match;
    this.scene = match.scene;
    this.layer = layer; // 数字を出す DOM
    this.parts = new Particles(this.scene);
    this.rings = []; // 昔の波紋（いまは vfx でまとめ描き）
    this.nums = [];
    this.labels = [];
    this.auras = new Map();
    this.camPos = new THREE.Vector3();
    this.summons = new Map(); // ディスクのモンスター（人ごとに1体）
    this.leaving = []; // 次のモンスターに替わって、消えていくところのモンスター
    this.shards = [];
    this.beams = [];
    this.projMeshes = new Set();
    this.time = 0;
    // アニメ調のえフェクト（光の帯・ヒット・擬音・けむり）。まとめ描きで4回だけ
    this.vfx = new VFX(this.scene, { low: !!(match.app && match.app.lowGfx) });
    this.jets = new Map(); // 人ごと：ジェットの帯・着地の見はり
  }

  // ===== 毎フレーム =====
  update(dt, cam) {
    this.camPos.copy(cam.position);
    this.time += dt;
    this.parts.update(dt);
    this.updateSummons(dt);
    this.updateShards(dt);
    // 技の弾のうしろの光
    for (const m of this.projMeshes) {
      if (!m.parent) {
        this.projMeshes.delete(m);
        continue;
      }
      const c = m.userData.trail;
      if (c && m.visible && Math.random() < dt * 45) this.parts.emit(m.position.x + rand(-0.2, 0.2), m.position.y + rand(-0.2, 0.2), m.position.z + rand(-0.2, 0.2), rand(-1, 1), rand(-1, 1), rand(-1, 1), 0.38, 1.1, 0.1, c, 2);
    }
    // 足のジェットの光の帯（キックフライト風）と、強い着地のけむり
    const V = this.vfx;
    V.low = !!(this.match.app && this.match.app.lowGfx);
    let slot = 0;
    for (const p of this.match.punchers) {
      this.jetStep(p, slot++, dt);
      // スペシャルがたまった人は白いオーラ
      if (p.alive && p.sp >= 1 && Math.random() < dt * 30) {
        this.parts.emit(p.pos.x + rand(-0.6, 0.6), p.pos.y + rand(-0.9, 0.9), p.pos.z + rand(-0.6, 0.6), 0, rand(1, 2.5), 0, 0.5, 0.9, 0.2, 0xffffff, 2);
      }
      if (p.alive && p.buffs.atkT > 0 && Math.random() < dt * 20) this.parts.emit(p.pos.x + rand(-0.5, 0.5), p.pos.y + rand(-0.8, 0.6), p.pos.z + rand(-0.5, 0.5), 0, 2, 0, 0.4, 0.6, 0.1, 0xff5a3d, 2);
      if (p.alive && p.buffs.ikemen > 0 && Math.random() < dt * 25) this.parts.emit(p.pos.x + rand(-0.9, 0.9), p.pos.y + rand(-0.5, 1.2), p.pos.z + rand(-0.9, 0.9), 0, 1.2, 0, 0.6, 0.7, 0.05, 0xfff2a8, 1.5);
      if (p.alive && p.buffs.shield > 0 && Math.random() < dt * 14) this.parts.emit(p.pos.x + rand(-0.9, 0.9), p.pos.y + rand(-0.9, 0.9), p.pos.z + rand(-0.9, 0.9), 0, 0, 0, 0.35, 0.8, 0.1, 0x7ad0ff, 2);
      if (p.alive && p.charge && Math.random() < dt * 30) {
        const c = KIND_COLOR[(this.match.omOf(p.charge.id) || {}).kind] || '#ffffff';
        const a = rand(0, 6.28);
        this.parts.emit(p.pos.x + Math.cos(a) * 1.5, p.pos.y - 0.6, p.pos.z + Math.sin(a) * 1.5, -Math.cos(a) * 2, 3, -Math.sin(a) * 2, 0.45, 0.7, 0.1, c, 1);
      }
    }
    // 光・けむり・擬音・帯をまとめて動かして書きこむ（波紋の輪もここ）
    V.update(dt, cam, this.time);
    // 数字・ことば（画面の位置を毎フレーム計算）
    const W = this.match.viewW, H = this.match.viewH;
    for (let i = this.nums.length - 1; i >= 0; i--) {
      const n = this.nums[i];
      n.t += dt;
      const k = n.t / n.life;
      _v.copy(n.pos);
      _v.y += n.rise * Math.min(1, n.t * 3);
      _v.project(cam);
      if (k >= 1 || _v.z > 1) {
        n.el.remove();
        this.nums.splice(i, 1);
        continue;
      }
      const x = (_v.x * 0.5 + 0.5) * W + n.dx, y = (-_v.y * 0.5 + 0.5) * H;
      const pop = n.t < 0.12 ? 0.6 + (n.t / 0.12) * 0.6 : 1.2 - Math.min(0.2, (n.t - 0.12) * 1.2);
      n.el.style.transform = `translate(${x}px, ${y}px) translate(-50%,-50%) scale(${pop})`;
      n.el.style.opacity = k > 0.7 ? (1 - k) / 0.3 : 1;
    }
  }

  // ===== 数字 =====
  num(pos, text, cls, life = 0.9, rise = 1.4) {
    if (this.nums.length > 40) {
      const old = this.nums.shift();
      old.el.remove();
    }
    const e = el('div', 'fxnum ' + (cls || ''), text);
    this.layer.appendChild(e);
    this.nums.push({ el: e, pos: pos.clone(), t: 0, life, rise, dx: rand(-14, 14) });
  }

  // ===== ジェットの光の帯（足ごとに1本）=====
  jetStep(p, slot, dt) {
    const V = this.vfx;
    let J = this.jets.get(p);
    if (!J) {
      J = { px: p.pos.x, py: p.pos.y, pz: p.pos.z, spd: 0, vy: 0, ground: !!p.ground, landT: 0, st: p.state };
      this.jets.set(p, J);
    }
    // 速さは位置の変化から（オンラインのほかの人の画面でも同じように出る）
    if (dt > 1e-4) {
      const dx = p.pos.x - J.px, dy = p.pos.y - J.py, dz = p.pos.z - J.pz;
      const sp = Math.sqrt(dx * dx + dy * dy + dz * dz) / dt;
      if (sp < 140) {
        J.spd += (sp - J.spd) * Math.min(1, dt * 12);
        J.vy += (dy / dt - J.vy) * Math.min(1, dt * 16);
      }
    }
    J.px = p.pos.x;
    J.py = p.pos.y;
    J.pz = p.pos.z;
    if (slot >= 8) return;
    const st = p.state;
    const speed = Math.max(J.spd, p.vel ? p.vel.length() : 0);
    const air = !p.ground || st === 'dash' || st === 'skill' || st === 'roll';
    const on = p.alive && air && (st === 'dash' || st === 'roll' || st === 'skill' || ((st === 'cruise' || st === 'fly') && speed > 5));
    const big = p.buffs && p.buffs.big > 0 ? 2.2 : 1;
    const w = (st === 'dash' || st === 'skill' ? 0.5 : st === 'roll' ? 0.44 : 0.38) * big;
    const pal = JET[p.team] || JET[0];
    const me = p === this.match.player;
    const legs = p.model && p.model.userData.parts && p.model.userData.parts.legs;
    const near = p.pos.distanceToSquared(this.camPos) < 3600;
    for (let i = 0; i < 2; i++) {
      const leg = legs && legs[i];
      if (!leg || (!on && V.rib.R[slot * 2 + i].n === 0)) {
        if (!leg) V.rib.feed(slot * 2 + i, p.pos, false, this.time, w, pal.head, pal.tail, 1);
        continue;
      }
      (leg.jet || leg.foot || leg.knee).getWorldPosition(_p);
      _p.addScaledVector(p.forward, -0.05 * big);
      V.rib.feed(slot * 2 + i, _p, on, this.time, me ? w * 0.6 : w, pal.head, pal.tail, me ? 0.75 : 1, me ? 6.8 : 0);
      // かかとの噴射口の光
      if (on && near) V.glowNow(_p, (0.55 + Math.random() * 0.16) * big * (st === 'dash' ? 1.25 : 1) * (me ? 0.6 : 1), pal.glow, me ? 1.5 : 2.2, me ? 0.7 : 1.5);
    }
    // ブーストの出だし：足もとに光の輪と火花（状態の変化で見るので、オンラインのほかの端末でも出る）
    if (st === 'dash' && J.st !== 'dash' && p.alive && near && legs) this.boostFx(p, pal, big);
    J.st = st;
    // 強い着地：けむりが横に広がる
    const g = !!p.ground;
    J.landT -= dt;
    if (g && !J.ground && p.alive && J.landT <= 0 && near) {
      const fall = -J.vy;
      if (fall > 7 || J.spd > 19) {
        this.landFx(p, clamp(Math.max(fall, J.spd * 0.6) / 13, 0.7, 1.6));
        J.landT = 0.45;
      }
    }
    J.ground = g;
  }
  boostFx(p, pal, big) {
    const V = this.vfx;
    _p.copy(p.pos).addScaledVector(p.forward, -0.7 * big);
    _p.y -= 0.45 * big;
    V.ring(_p, pal.glow, 0.25 * big, 1.5 * big, 0.2, true, 0.9, 'ring', 1.6);
    V.spark({ cell: CELL.STAR4, pos: _p, s0: 0.5 * big, s1: 1.9 * big, life: 0.16, ease: 1, rot: rand(-0.3, 0.3), color: pal.glow, i: 1.8, core: 1.6, fadePow: 1.5 });
    for (let i = 0; i < 6; i++) {
      randDirLocal(_v, p.forward, -1, 0.45);
      V.spark({ cell: CELL.SPARK, pos: _p, vel: _v.multiplyScalar(rand(10, 18)), drag: 6, s0: 0.14 * big, s1: 0.04, align: 0.03, life: rand(0.15, 0.25), color: i % 2 ? pal.glow : 0xffffff, i: 2.0, core: 1.2 });
    }
  }
  landFx(p, k) {
    _p.copy(p.pos);
    _p.y -= 0.68;
    this.vfx.smokeBurst(_p, { n: 7, flat: true, r: 0.5, speed: 5.5 * k, size: 0.55 + 0.45 * k, life: 0.7, light: 0xf3f1ec, shade: 0x98a0bf, grav: -0.4, drag: 4.2, erode: 0.25 });
    this.vfx.ring(_p, 0xffffff, 0.4, 2.4 * k, 0.3, false, 0.55);
  }

  // ===== 擬音 =====
  // 自分がかかわる当たり、またはカメラの近く（25m）だけ（画面がごちゃごちゃしないように）
  wordOk(t, src) {
    const P = this.match.player;
    return t === P || src === P || (t && t.pos && t.pos.distanceToSquared(this.camPos) < 625);
  }
  wordAt(id, at, frac, side = 0, top = false) {
    const V = this.vfx;
    const sd = side || (Math.random() < 0.5 ? -1 : 1);
    _w.copy(at).addScaledVector(V.camUp, rand(0.8, 1.15)).addScaledVector(V.camRight, sd * rand(0.7, 1.1));
    // 画面からはみ出さないように、文字の大きさのぶん内がわへ（同じ奥行きのまま）
    const cam = this.match.camera;
    if (cam) {
      _w.project(cam);
      if (_w.z > -1 && _w.z < 1) {
        const mx = Math.min(0.9, frac * 1.15 + 0.02);
        const my = Math.min(0.8, frac * (cam.aspect || 0.5) * 0.55 + 0.05);
        _w.x = clamp(_w.x, -1 + mx, 1 - mx);
        _w.y = clamp(_w.y, -1 + my, 1 - my);
      }
      _w.unproject(cam);
    }
    V.word(id, _w, frac, sd * rand(0.1, 0.22), top);
  }

  hit(t, src, dmg, o = {}) {
    const p = t.pos;
    const heavy = !!o.heavy;
    // ふっとぶ向き（攻撃した人 → 当たった人）。当たった所は、相手の体の少し手前
    if (src && src.pos && src !== t) _d.subVectors(p, src.pos);
    else _d.subVectors(p, this.camPos);
    if (_d.lengthSq() < 1e-6) _d.set(0, 0, 1);
    _d.normalize();
    _c0.copy(p).addScaledVector(_d, t.isGuardian ? -(t.radius || 2) * 0.6 : -0.35);
    _c0.y += t.isGuardian ? 0.6 : 0.25;
    const far = p.distanceToSquared(this.camPos) > 6400;
    if (!far) {
      const s = clamp(0.8 + dmg / 1600, 0.8, 1.3);
      const elem = src && src.elem && ACCENT[src.elem] ? src.elem : null;
      this.vfx.impact(_c0, _d, s, { heavy, main: o.guardian ? 0xffd34d : undefined, accent: elem ? ACCENT[elem] : o.guardian ? 0xffd34d : null, elem, weak: !!o.weak });
      const color = o.guardian ? 0xffd34d : heavy ? 0xffe06b : 0xffffff;
      for (let i = 0; i < (heavy ? 5 : 2); i++) this.parts.emit(_c0.x, _c0.y, _c0.z, rand(-1, 1) * 8, rand(-0.5, 1) * 8, rand(-1, 1) * 8, rand(0.15, 0.3), rand(0.25, 0.45), 0.04, color, 5);
      // 強い当たりは擬音（ドゴッ! など）
      if (heavy && !o.guardian && this.wordOk(t, src)) {
        const id = o.kind === 'dash' ? WORD.DON : o.kind === 'ks' || o.kind === 'special' ? (Math.random() < 0.5 ? WORD.ZUGAN : WORD.DON) : HIT_WORDS[(Math.random() * HIT_WORDS.length) | 0];
        this.wordAt(id, _c0, o.kind === 'dash' || o.kind === 'special' ? 0.5 : 0.42);
      }
    }
    const mine = t.isPlayer;
    const byMe = src && src.isPlayer;
    let cls = mine ? 'hurt' : byMe ? 'mine' : 'other';
    if (o.weak) cls += ' weak';
    if (o.heavy) cls += ' big';
    if (!mine && !byMe && !o.guardian && Math.random() < 0.5) return; // 遠くの殴り合いは数字を減らす
    this.num(_v.copy(p).add(new THREE.Vector3(0, 1.2, 0)), String(dmg) + (o.weak ? '<b>WEAK</b>' : ''), cls);
  }
  healNum(p, v) {
    this.num(_v.copy(p.pos).add(new THREE.Vector3(0, 1.3, 0)), '+' + v, 'heal');
  }
  miss(t) {
    this.num(_v.copy(t.pos).add(new THREE.Vector3(0, 1.3, 0)), 'MISS', 'miss', 0.6);
  }
  // ジャスト回避：水色の十字の光・集中線・輪・破片
  just(t) {
    const V = this.vfx;
    const c = t.pos;
    V.spark({ cell: CELL.FLARE, pos: c, s0: 1.2, s1: 5.2, life: 0.36, ease: 1, rot: rand(-0.15, 0.15), color: 0x8fe6ff, i: 2.2, core: 2.6, occ: 0.08, fadePow: 1.5 });
    V.spark({ cell: CELL.STAR4, pos: c, s0: 0.6, s1: 2.8, life: 0.3, ease: 2, rot: Math.PI / 4, color: 0xc8f6ff, i: 2.0, core: 2.2, fadePow: 1.4, hold: 0.3 });
    V.spark({ cell: CELL.LINES, pos: c, s0: 2.4, s1: 6, life: 0.24, ease: 1, rot: rand(0, 6.28), color: 0x6fd8ff, i: 1.5, core: 0.9, occ: 0.05, fadePow: 1.2 });
    V.ring(c, 0x9fe3ff, 0.5, 3.8, 0.4, true, 0.95);
    V.ring(c, 0xffffff, 0.3, 2.2, 0.22, true, 0.85);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 6.28 + rand(-0.2, 0.2);
      _v.copy(V.camRight).multiplyScalar(Math.cos(a)).addScaledVector(V.camUp, Math.sin(a));
      V.spark({ cell: CELL.SHARD, pos: c, vel: _v.multiplyScalar(rand(14, 20)), drag: 7, s0: 0.7, s1: 0.2, asp: 0.6, align: 0.004, life: 0.3, color: 0x9fe8ff, i: 2.0, core: 1.4, occ: 0.3 });
    }
    for (let i = 0; i < 12; i++) {
      const a = rand(0, 6.28);
      this.parts.emit(c.x, c.y, c.z, Math.cos(a) * 6, rand(-2, 3), Math.sin(a) * 6, 0.5, 1.1, 0.2, 0xbfe8ff, 3);
    }
    this.num(_v.copy(c).add(new THREE.Vector3(0, 1.6, 0)), 'JUST!', 'just', 0.9, 1.0);
    if (this.wordOk(t, null)) this.wordAt(WORD.HYUN, c, 0.4);
  }
  shieldHit(t) {
    this.ring(t.pos, 0x7ad0ff, 1.2, 1.8, 0.22, true, 0.8, hexGeo);
    this.vfx.spark({ cell: CELL.HEXF, pos: t.pos, s0: 2.6, s1: 3.2, life: 0.18, ease: 1, rot: rand(0, 6.28), color: 0x7ad0ff, i: 0.9, core: 0, fadePow: 1.5 });
  }

  // 波紋の輪（まとめ描き。geo で形：丸・六角の輪・六角の板）
  ring(pos, color, r0, r1, life, face = false, op = 0.9, geo = ringGeo) {
    this.vfx.ring(pos, color, r0, r1, life, face, op, geo === hexGeo ? 'hex' : geo === hexFill ? 'hexf' : 'ring');
  }
  shock(pos, color, r) {
    const V = this.vfx;
    this.ring(pos, color, 0.5, r, 0.5, false, 0.95);
    this.ring(pos, color, 0.5, r * 0.8, 0.4, true, 0.7);
    V.spark({ cell: CELL.SHOCK, pos, s0: 1, s1: r * (r >= 8 ? 1.3 : 1.9), life: 0.42, ease: 1, color, i: r >= 8 ? 0.55 : 1.2, core: r >= 8 ? 0.5 : 1.2, occ: 0, fadePow: 1.3 });
    for (let i = 0; i < 18; i++) {
      const a = rand(0, 6.28);
      this.parts.emit(pos.x, pos.y, pos.z, Math.cos(a) * r * 1.6, rand(-2, 2), Math.sin(a) * r * 1.6, 0.5, 0.8, 0.15, color, 3);
    }
    if (r >= 8) {
      // スペシャルの衝撃：大きな光・集中線・地面を走るけむり・擬音
      V.spark({ cell: CELL.GLOW, pos, s0: 1.5, s1: Math.min(5, r * 0.4), life: 0.18, ease: 1, color: 0xffffff, i: 1.6, core: 1.4, fadePow: 2 });
      V.spark({ cell: CELL.LINES, pos, s0: 2.5, s1: Math.min(9, r * 0.7), life: 0.28, ease: 1, rot: rand(0, 6.28), color, i: 1.2, core: 0.8, occ: 0.05, fadePow: 1.3 });
      _p.copy(pos);
      _p.y -= 0.6;
      _ca.set(color).lerp(GRAY, 0.55);
      V.smokeBurst(_p, { n: 12, flat: true, r: 1, speed: r * 1.5, size: 1.5, life: 0.85, light: _ca.getHex(), shade: 0x8a90b4, grav: -0.6, drag: 3.4 });
      if (this.match.player && (pos.distanceToSquared(this.match.player.pos) < 400 || pos.distanceToSquared(this.camPos) < 625)) this.wordAt(WORD.DODODO, pos, 0.62, 1);
    } else {
      V.spark({ cell: CELL.STAR4, pos, s0: 0.8, s1: r * 1.2, life: 0.2, ease: 1, rot: rand(-0.3, 0.3), color, i: 1.8, core: 2.0, fadePow: 1.6 });
    }
  }
  // 爆発：火の玉の光・トゲの星・衝撃の輪・火の粉・セル塗りのけむり（火の色 → 灰色）
  boom(pos, color, r) {
    const V = this.vfx;
    _ca.set(color);
    V.spark({ cell: CELL.GLOW, pos, s0: r * 0.8, s1: r * 2.4, life: 0.2, ease: 1, color: 0xfff1c8, i: 2.6, core: 2.4, fadePow: 1.6 });
    V.spark({ cell: CELL.STAR2, pos, s0: r * 0.5, s1: r * 2.1, life: 0.22, ease: 2, rot: rand(0, 6.28), color, i: 2.2, core: 2.0, occ: 0.2, fadePow: 1.5, hold: 0.3 });
    V.spark({ cell: CELL.SHOCK, pos, s0: r * 0.6, s1: r * 2.6, life: 0.4, ease: 1, color, i: 1.4, core: 1.3, occ: 0.06, fadePow: 1.2 });
    this.ring(pos, color, 0.5, r * 1.3, 0.45, true, 0.9);
    const n = Math.min(18, 8 + r * 2) | 0;
    for (let i = 0; i < n; i++) {
      _v.set(rand(-1, 1), rand(-0.4, 1), rand(-1, 1)).normalize();
      V.spark({ cell: CELL.SPARK, pos, vel: _v.multiplyScalar(rand(2.5, 4.5) * r + 4), drag: 4, grav: 9, s0: 0.22, s1: 0.06, align: 0.03, life: rand(0.3, 0.55), color: i % 3 ? 0xffb02e : 0xffffff, i: 2.4, core: 1.4, fadePow: 1 });
    }
    // けむり（色は爆発の色から：明るい所は白っぽく、影は暗い紫寄り）
    _cb.copy(_ca).lerp(DARK, 0.45);
    _ca.lerp(WARM, 0.62);
    V.smokeBurst(pos, { n: Math.min(14, 6 + r * 1.4), r: r * 0.35, speed: r * 2.1 + 2, size: r * 0.6 + 0.6, life: 1.05, light: _ca.getHex(), shade: _cb.getHex(), light1: 0xe8e6e2, shade1: 0x727896, up: 0.25, delay: 0.05 });
    for (let i = 0; i < 10; i++) {
      this.parts.emit(pos.x, pos.y, pos.z, rand(-1, 1) * r * 3, rand(-1, 1) * r * 3, rand(-1, 1) * r * 3, rand(0.3, 0.6), rand(0.5, 0.9), 0.05, i % 3 ? color : 0xffffff, 3.5);
    }
    if (r >= 5.5 && pos.distanceToSquared(this.camPos) < 900) this.wordAt(WORD.DOKAN, pos, 0.55, 1);
  }
  puff(pos, color) {
    for (let i = 0; i < 5; i++) this.parts.emit(pos.x, pos.y, pos.z, rand(-3, 3), rand(-3, 3), rand(-3, 3), 0.3, 0.7, 0.1, color, 4);
    if (pos.distanceToSquared(this.camPos) < 2500) {
      _ca.set(color).lerp(GRAY, 0.6);
      this.vfx.smokeBurst(pos, { n: 2, r: 0.1, speed: 1.5, size: 0.7, life: 0.45, light: _ca.getHex(), shade: 0x8f97b8, erode: 0.2 });
      this.vfx.spark({ cell: CELL.GLOW, pos, s0: 0.4, s1: 1.2, life: 0.1, color, i: 2, core: 1.5, fadePow: 1.5 });
    }
  }
  pickup(p, at) {
    for (let i = 0; i < 6; i++) this.parts.emit(at.x, at.y, at.z, rand(-3, 3), rand(0, 4), rand(-3, 3), 0.4, 0.8, 0.1, 0xff8fc0, 3);
    if (p.isPlayer) this.num(_v.copy(p.pos).add(new THREE.Vector3(0, 1.2, 0)), '+1', 'pick', 0.6, 1.2);
  }
  scatter(pos, n) {
    for (let i = 0; i < n * 4; i++) this.parts.emit(pos.x, pos.y, pos.z, rand(-8, 8), rand(-2, 10), rand(-8, 8), 0.8, 1.0, 0.2, 0xff8fc0, 1.5, 6);
  }
  deposit(p, g) {
    _v.subVectors(g.pos, p.pos);
    this.parts.emit(p.pos.x, p.pos.y, p.pos.z, _v.x * 2.2, _v.y * 2.2 + 3, _v.z * 2.2, 0.45, 1.1, 0.4, 0xff8fc0, 0.5);
    if (p.isPlayer) this.num(_v2.copy(g.pos).add(new THREE.Vector3(0, 4.5, 0)), '+1', 'pick', 0.5, 1.5);
  }
  // 壁キック：壁に白いトゲの光、壁にそって広がるけむり
  wallKick(p, n) {
    const V = this.vfx;
    _p.copy(p.pos).addScaledVector(n, -0.7);
    this.ring(_p, 0xffffff, 0.4, 2.4, 0.25, true, 0.9);
    V.spark({ cell: CELL.STAR, pos: _p, s0: 0.5, s1: 2.0, life: 0.14, ease: 2, rot: rand(0, 6.28), color: 0xfff3b8, i: 2.0, core: 2.2, occ: 0.2, fadePow: 1.6 });
    V.smokeBurst(_p, { n: 5, dir: n, spread: 1.4, r: 0.3, speed: 4.5, size: 0.85, life: 0.65, light: 0xf5f4f0, shade: 0x9aa2c0, grav: -0.4, erode: 0.25 });
    for (let i = 0; i < 6; i++) {
      _v.set(n.x * 6 + rand(-4, 4), n.y * 6 + rand(-4, 4), n.z * 6 + rand(-4, 4));
      V.spark({ cell: CELL.SPARK, pos: _p, vel: _v, drag: 5, grav: 6, s0: 0.16, s1: 0.05, align: 0.03, life: 0.25, color: 0xffffff, i: 2.2, core: 1.2 });
    }
  }
  // 倒した：大きな光・チームの色の星と集中線・白い破片・けむり・擬音「ズドーン!!」
  ko(p) {
    const V = this.vfx;
    const c = p.pos;
    const T = TEAM[p.team];
    V.spark({ cell: CELL.GLOW, pos: c, s0: 1.4, s1: 4, life: 0.16, ease: 1, color: 0xffffff, i: 1.7, core: 1.6, fadePow: 2 });
    V.spark({ cell: CELL.STAR, pos: c, s0: 0.8, s1: 3.7, life: 0.3, ease: 2, rot: rand(0, 6.28), color: T.light, i: 1.9, core: 1.2, occ: 0.3, fadePow: 1.5, hold: 0.3 });
    V.spark({ cell: CELL.STAR4, pos: c, delay: 0.04, s0: 1.2, s1: 5.2, life: 0.3, ease: 1, rot: rand(-0.3, 0.3), color: T.hex, i: 1.7, core: 1.4, occ: 0.2, fadePow: 1.6 });
    V.spark({ cell: CELL.LINES, pos: c, s0: 2, s1: 6.2, life: 0.24, ease: 1, rot: rand(0, 6.28), color: 0xffffff, i: 1.25, core: 1.0, occ: 0.08, fadePow: 1.3 });
    V.ring(c, 0xffffff, 0.5, 4.2, 0.4, true, 1);
    V.ring(c, T.hex, 0.5, 6, 0.55, true, 0.9);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * 6.28 + rand(-0.25, 0.25);
      _v.copy(V.camRight).multiplyScalar(Math.cos(a)).addScaledVector(V.camUp, Math.sin(a)).addScaledVector(V.camFwd, rand(-0.3, 0.3));
      V.spark({ cell: CELL.SHARD, pos: c, vel: _v.multiplyScalar(rand(16, 26)), drag: 7, s0: rand(0.7, 1.0), s1: 0.22, asp: 0.6, align: 0.004, life: rand(0.25, 0.38), color: 0xffffff, i: 1.7, core: 1.2, occ: 0.5 });
    }
    for (let i = 0; i < 14; i++) {
      _v.set(rand(-1, 1), rand(-0.5, 1), rand(-1, 1)).normalize();
      V.spark({ cell: CELL.SPARK, pos: c, vel: _v.multiplyScalar(rand(12, 26)), drag: 4, grav: 8, s0: 0.24, s1: 0.06, align: 0.03, life: rand(0.3, 0.55), color: i % 2 ? T.hex : 0xffffff, i: 2.4, core: 1.5 });
    }
    _ca.set(T.light).lerp(GRAY, 0.35);
    _cb.set(T.dark).lerp(DARK, 0.3);
    V.smokeBurst(c, { n: 9, r: 0.6, speed: 6.5, size: 1.5, life: 1.05, light: _ca.getHex(), shade: _cb.getHex(), light1: 0xeeeef2, shade1: 0x767ea2, up: 0.15, delay: 0.06 });
    for (let i = 0; i < 10; i++) this.parts.emit(c.x, c.y, c.z, rand(-1, 1) * 9, rand(-1, 1) * 9, rand(-1, 1) * 9, rand(0.3, 0.6), rand(0.4, 0.8), 0.05, i % 3 ? T.hex : 0xffffff, 3.5);
    const P = this.match.player;
    if (p === P || p.killedBy === P || c.distanceToSquared(this.camPos) < 625) this.wordAt(WORD.ZUDON, c, 0.72, 1, true);
  }
  respawn(p) {
    this.ring(p.pos, TEAM[p.team].light, 0.3, 3.5, 0.5, false, 0.9);
    for (let i = 0; i < 20; i++) this.parts.emit(p.pos.x + rand(-1, 1), p.pos.y - 1, p.pos.z + rand(-1, 1), 0, rand(4, 9), 0, 0.6, 0.9, 0.1, TEAM[p.team].light, 2);
  }
  trail(p, color) {
    for (let i = 0; i < 2; i++) this.parts.emit(p.pos.x + rand(-0.5, 0.5), p.pos.y + rand(-0.5, 0.5), p.pos.z + rand(-0.5, 0.5), 0, 0, 0, 0.5, 1.4, 0.2, color, 1);
  }
  flash(p, dir) {
    for (let i = 0; i < 30; i++) {
      const s = rand(4, 22);
      this.parts.emit(p.pos.x, p.pos.y + 0.4, p.pos.z, dir.x * s + rand(-4, 4), dir.y * s + rand(-3, 3), dir.z * s + rand(-4, 4), 0.35, 2.4, 0.4, 0xffffff, 3);
    }
    _p.copy(p.pos).addScaledVector(dir, 2);
    this.ring(_p, 0xffffff, 0.5, 6, 0.3, true, 1);
    const V = this.vfx;
    V.spark({ cell: CELL.FLARE, pos: _p, s0: 2, s1: 9, life: 0.32, ease: 1, rot: rand(-0.2, 0.2), color: 0xfff6c8, i: 2.6, core: 3, fadePow: 1.6 });
    V.spark({ cell: CELL.GLOW, pos: _p, s0: 2, s1: 6, life: 0.2, ease: 1, color: 0xffffff, i: 2.6, core: 2.4, fadePow: 1.8 });
    V.spark({ cell: CELL.LINES, pos: _p, s0: 3, s1: 10, life: 0.24, ease: 1, rot: rand(0, 6.28), color: 0xfff2b0, i: 1.6, core: 1.2, fadePow: 1.3 });
    if (this.match.player && this.match.player === p) this.match.screenFlash('#ffffff', 0.25);
    if (this.wordOk(p, null)) this.wordAt(WORD.PIKA, _p, 0.55, 1);
  }
  dizzy(t, dur) {
    this.num(_v.copy(t.pos).add(new THREE.Vector3(0, 1.9, 0)), '★', 'dizzy', dur, 0.2);
  }
  hearts(t, dur) {
    for (let i = 0; i < 3; i++) setTimeout(() => t.alive && this.num(_v.copy(t.pos).add(new THREE.Vector3(rand(-0.6, 0.6), 1.6, 0)), '♥', 'heart', 1.2, 1.8), i * 300);
  }
  sparkle(p) {
    for (let i = 0; i < 40; i++) {
      const a = rand(0, 6.28);
      this.parts.emit(p.pos.x, p.pos.y, p.pos.z, Math.cos(a) * 10, rand(-2, 6), Math.sin(a) * 10, 0.9, 1.6, 0.1, i % 2 ? 0xfff2a8 : 0xffb0e0, 2);
    }
    this.ring(p.pos, 0xffd1f0, 0.5, 16, 0.6, false, 0.9);
    for (let i = 0; i < 7; i++) {
      _p.set(p.pos.x + rand(-1.4, 1.4), p.pos.y + rand(-0.6, 1.6), p.pos.z + rand(-1.4, 1.4));
      this.vfx.spark({ cell: CELL.FLARE, pos: _p, delay: i * 0.06, s0: 0.3, s1: rand(1.6, 2.6), life: 0.4, ease: 2, rot: rand(-0.3, 0.3), color: i % 2 ? 0xfff2a8 : 0xffb0e0, i: 2.4, core: 2.4, fadePow: 1.4, hold: 0.3 });
    }
    this.num(_v.copy(p.pos).add(new THREE.Vector3(0, 2.2, 0)), 'キラーン', 'kira', 1.2, 1.2);
  }
  laughs(p) {
    const words = ['ガハハ', 'ワハハ', 'ハハハ!!'];
    words.forEach((w, i) => setTimeout(() => this.num(_v.copy(p.pos).add(new THREE.Vector3(rand(-3, 3), 2 + i * 0.6, rand(-3, 3))), w, 'laugh', 1.1, 2), i * 120));
  }
  healFx(p) {
    for (let i = 0; i < 16; i++) this.parts.emit(p.pos.x + rand(-0.8, 0.8), p.pos.y - 0.8, p.pos.z + rand(-0.8, 0.8), 0, rand(3, 6), 0, 0.7, 0.8, 0.1, 0x5dffa0, 1);
    this.ring(p.pos, 0x5dffa0, 0.4, 2.4, 0.4, false, 0.8);
  }
  buffFx(p, color) {
    this.ring(p.pos, color, 0.4, 2.6, 0.4, false, 0.9);
    for (let i = 0; i < 14; i++) this.parts.emit(p.pos.x + rand(-0.8, 0.8), p.pos.y - 0.8, p.pos.z + rand(-0.8, 0.8), 0, rand(3, 6), 0, 0.6, 0.8, 0.1, color, 1);
  }
  warpFx(pos) {
    this.ring(pos, 0x7af0ff, 0.3, 3, 0.35, true, 0.9);
    this.vfx.spark({ cell: CELL.STAR4, pos, s0: 0.5, s1: 3, life: 0.25, ease: 1, rot: rand(-0.3, 0.3), color: 0x7af0ff, i: 2.2, core: 2, fadePow: 1.5 });
    for (let i = 0; i < 16; i++) this.parts.emit(pos.x, pos.y, pos.z, rand(-6, 6), rand(-6, 6), rand(-6, 6), 0.3, 0.9, 0.1, 0x7af0ff, 4);
  }
  elemSwitch(p) {
    const c = ELEM[p.elem].hex;
    this.ring(p.pos, c, 0.3, 2.2, 0.35, true, 0.9);
    if (p.isPlayer) this.num(_v.copy(p.pos).add(new THREE.Vector3(0, 1.8, 0)), ELEM[p.elem].name + 'に変えた', 'elem', 0.9, 0.8);
  }
  chargeIcon(p, om) {
    // 溜めの合図（光の輪）＋ディスクのモンスターを呼ぶ
    this.ring(p.pos, new THREE.Color(KIND_COLOR[om.kind]).getHex(), 0.3, 1.8, 0.5, true, 0.9);
    this.summon(p, om);
  }
  chargeBreak(p) {
    this.num(_v.copy(p.pos).add(new THREE.Vector3(0, 1.8, 0)), 'キャンセル!', 'break', 0.8, 1);
    for (let i = 0; i < 14; i++) this.parts.emit(p.pos.x, p.pos.y + 1, p.pos.z, rand(-6, 6), rand(-2, 6), rand(-6, 6), 0.5, 0.7, 0.1, 0xcccccc, 2, 8);
    const s = this.summons.get(p);
    if (s) this.shatter(s);
  }

  // ===== ディスクのモンスター =====
  // 溜めはじめにキャラの横へ呼び出す → 技を出す（summonAct）→ 消える。溜めを止められたら割れる
  summon(p, om) {
    if (!om || !om.mon || !p.pos) return;
    const old = this.summons.get(p);
    if (old) {
      // 前のモンスターは消える動きを最後まで見せる（別のリストで動かす）
      this.summons.delete(p);
      this.leaveSummon(old);
      this.leaving.push(old);
    }
    const g = buildMonster(om.mon);
    g.rotation.order = 'YXZ';
    // 重いとき（軽い画質）は、ふちどりを消す
    if (this.match.app && this.match.app.lowGfx) g.traverse((o) => o.name === 'outline' && (o.visible = false));
    const base = g.scale.x * SUMMON_SCALE;
    const s = { p, om, g, base, phase: 'appear', t: 0, age: 0, wait: 0, pos: new THREE.Vector3(), yaw: (p.yaw || 0) + SUMMON_TURN, target: null, actDur: 0.75 };
    summonSpot(p, s.pos);
    g.position.copy(s.pos);
    g.scale.setScalar(0.01);
    this.scene.add(g);
    this.summons.set(p, s);
    this.portal(s, true);
    this.sfx(om.rare === 'SR' || om.rare === 'UR' ? 'summonSR' : 'summon', p);
  }
  // この端末だけで鳴らす（オンラインでは、えフェクトといっしょに各端末で鳴る）
  sfx(name, p) {
    const M = this.match;
    const f = M.sfxLocal || M.sfx;
    if (f) f.call(M, name, p);
  }
  // 呼び出しの光（レア度が高いほど派手）
  portal(s, open) {
    const om = s.om;
    const c = ELEM[om.elem].hex;
    const pos = s.pos;
    const rank = om.rare === 'SR' || om.rare === 'UR' ? 2 : om.rare === 'R' ? 1 : 0;
    this.ring(pos, c, 0.4, 2.6 + rank * 0.6, 0.45, true, 0.95, hexGeo);
    this.ring(pos, 0xffffff, 0.2, 1.4 + rank * 0.4, 0.3, true, 0.8, hexGeo);
    if (open) this.ring(pos, c, 0.3, 1.2, 0.25, true, 0.5, hexFill);
    const n = 14 + rank * 12;
    for (let i = 0; i < n; i++) {
      const a = rand(0, 6.28), sp = rand(3, 7 + rank * 2);
      this.parts.emit(pos.x, pos.y, pos.z, Math.cos(a) * sp, rand(-3, 4), Math.sin(a) * sp, rand(0.3, 0.55), rand(0.6, 1.2), 0.1, i % 3 ? c : 0xffffff, 3);
    }
    if (rank >= 2 && open) {
      // 光の柱
      const mat = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
      const m = new THREE.Mesh(beamGeo, mat);
      m.position.copy(pos);
      m.scale.set(1.1, 14, 1.1);
      this.scene.add(m);
      this.beams.push({ m, t: 0, life: 0.55 });
      if (s.p === this.match.player && this.match.screenFlash) this.match.screenFlash('#' + new THREE.Color(c).getHexString(), 0.12);
    }
  }
  summonAct(p, id) {
    const om = OMAMORI[id];
    if (!om) return;
    let s = this.summons.get(p);
    if (!s || s.om.id !== id || s.phase === 'leave') {
      // 呼び出しが届かなかったとき（遅れて入ったなど）は、ここで呼ぶ
      this.summon(p, om);
      s = this.summons.get(p);
      if (!s) return;
    }
    s.phase = 'act';
    s.t = 0;
    s.actDur = ACT_DUR[om.kind] || 0.75;
    if (s.g.scale.x < s.base * 0.6) s.g.scale.setScalar(s.base * 0.6);
    const c = ELEM[om.elem].hex;
    monsterMouth(p, om.mon, _v);
    this.ring(_v, c, 0.2, 1.8, 0.3, true, 0.95);
    if (om.rare === 'SR' || om.rare === 'UR') this.ring(_v, 0xffffff, 0.3, 3.0, 0.35, true, 0.7, hexGeo);
    if (om.kind === 'HEAL' || om.kind === 'BUFF') {
      // モンスターから力をもらう光
      for (let i = 0; i < 22; i++) {
        _v2.subVectors(p.pos, s.pos).multiplyScalar(rand(2.4, 3.4));
        this.parts.emit(s.pos.x + rand(-0.4, 0.4), s.pos.y + rand(-0.4, 0.4), s.pos.z + rand(-0.4, 0.4), _v2.x + rand(-1, 1), _v2.y + rand(-1, 1), _v2.z + rand(-1, 1), 0.4, 1.0, 0.2, i % 2 ? c : 0xffffff, 1.5);
      }
    } else if (om.kind === 'TRAP') {
      s.target = p.pos.clone(); // その場所へもぐりこむ
    } else if (om.kind === 'WARP') {
      this.ring(p.pos, c, 0.4, 3.2, 0.4, true, 0.9, hexGeo);
    }
  }
  removeSummon(s) {
    if (s.g.parent) s.g.parent.remove(s.g);
    if (this.summons.get(s.p) === s) this.summons.delete(s.p);
    const i = this.leaving.indexOf(s);
    if (i >= 0) this.leaving.splice(i, 1);
  }
  leaveSummon(s) {
    if (s.phase === 'leave') return;
    s.phase = 'leave';
    s.t = 0;
  }
  // 溜めを止められた：モンスターが割れて消える
  shatter(s) {
    const c = ELEM[s.om.elem].hex;
    const pos = s.g.position;
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(shardGeo, shardMat(i % 3 ? c : 0xffffff));
      m.position.set(pos.x + rand(-0.5, 0.5), pos.y + rand(-0.4, 0.5), pos.z + rand(-0.5, 0.5));
      const sc = rand(0.6, 1.4) * s.base;
      m.scale.setScalar(sc);
      this.scene.add(m);
      this.shards.push({ m, v: new THREE.Vector3(rand(-7, 7), rand(-1, 7), rand(-7, 7)), w: new THREE.Vector3(rand(-12, 12), rand(-12, 12), rand(-12, 12)), t: 0, life: rand(0.45, 0.75), s0: sc });
    }
    this.ring(pos, c, 0.4, 2.4, 0.3, true, 0.9, hexGeo);
    for (let i = 0; i < 14; i++) this.parts.emit(pos.x, pos.y, pos.z, rand(-6, 6), rand(-3, 6), rand(-6, 6), 0.4, 0.8, 0.1, c, 3);
    this.sfx('shatter', s.p);
    this.removeSummon(s);
  }
  updateShards(dt) {
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const q = this.shards[i];
      q.t += dt;
      q.v.y -= 14 * dt;
      q.m.position.addScaledVector(q.v, dt);
      q.m.rotation.x += q.w.x * dt;
      q.m.rotation.y += q.w.y * dt;
      q.m.rotation.z += q.w.z * dt;
      const k = q.t / q.life;
      q.m.scale.setScalar(Math.max(0.001, q.s0 * (1 - k * k)));
      if (k >= 1) {
        this.scene.remove(q.m);
        this.shards.splice(i, 1);
      }
    }
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.t += dt;
      const k = b.t / b.life;
      b.m.material.opacity = 0.7 * (1 - k);
      const w = 1.1 * (1 - k * 0.8);
      b.m.scale.set(w, 14, w);
      if (k >= 1) {
        this.scene.remove(b.m);
        b.m.material.dispose();
        this.beams.splice(i, 1);
      }
    }
  }
  updateSummons(dt) {
    for (const s of [...this.summons.values(), ...this.leaving]) {
      const p = s.p, g = s.g, U = g.userData;
      s.t += dt;
      s.age += dt;
      if (!p.alive && s.phase !== 'leave') {
        this.shatter(s);
        continue;
      }
      if (s.age > 6 && s.phase !== 'leave') this.leaveSummon(s);
      summonSpot(p, _v);
      if (s.target && (s.phase === 'act' || s.phase === 'leave')) {
        // 罠：その場所へ飛びこんで、そこで消える
        const k = s.phase === 'leave' ? 1 : Math.min(1, s.t / (s.actDur * 0.6));
        _v.lerp(s.target, k * k);
      }
      s.pos.lerp(_v, 1 - Math.exp(-14 * dt));
      s.yaw = lerpAngle(s.yaw, (p.yaw || 0) + SUMMON_TURN, 1 - Math.exp(-10 * dt));
      let scale = s.base;
      let ph = s.phase, k = 0;
      const charging = p.charge && p.charge.id === s.om.id;
      if (s.phase === 'appear') {
        const a = Math.min(1, s.t / 0.24);
        scale = s.base * Math.max(0.01, easeOutBack(a));
        ph = 'charge';
        k = 0;
        if (a >= 1) {
          s.phase = 'charge';
          s.t = 0;
        }
      } else if (s.phase === 'charge') {
        k = Math.min(1, s.t / 0.8);
        // 溜めが終わったのに技が来ない（届かない）ときは、少し待って消す
        if (!charging) {
          s.wait += dt;
          if (s.wait > 0.6) this.leaveSummon(s);
        } else s.wait = 0;
        if (Math.random() < dt * 24) {
          const c = ELEM[s.om.elem].hex;
          const a = rand(0, 6.28);
          this.parts.emit(s.pos.x + Math.cos(a) * 1.2, s.pos.y - 0.8, s.pos.z + Math.sin(a) * 1.2, -Math.cos(a) * 1.5, rand(2, 4), -Math.sin(a) * 1.5, 0.45, 0.6, 0.1, c, 1);
        }
      } else if (s.phase === 'act') {
        k = Math.min(1, s.t / s.actDur);
        if (k >= 1) this.leaveSummon(s);
      } else if (s.phase === 'leave') {
        const a = Math.min(1, s.t / 0.3);
        scale = s.base * (1 - a) * (1 + a * 0.3);
        ph = 'idle';
        if (a >= 1) {
          const c = ELEM[s.om.elem].hex;
          for (let i = 0; i < 10; i++) this.parts.emit(g.position.x, g.position.y, g.position.z, rand(-3, 3), rand(1, 6), rand(-3, 3), 0.4, 0.9, 0.1, c, 2);
          this.removeSummon(s);
          continue;
        }
      }
      poseMonster(g, ph, k, s.age);
      const f = p.flatFwd || _v3.set(0, 0, 1);
      g.position.copy(s.pos).addScaledVector(f, U.push * s.base);
      g.position.y += (U.lift - U.dive * 1.2) * s.base;
      g.rotation.set(U.tilt || 0, s.yaw, 0);
      g.scale.setScalar(scale);
      // 見えない人（倒された・遠い）は描かない
      g.visible = p.model ? p.model.visible !== false || p === this.match.player : true;
    }
  }
  skillName(p, name, om) {
    // 画面に出るのは近くの人だけ
    const cam = this.camPos;
    if (p.pos.distanceTo(cam) > 45 && !p.isPlayer) return;
    this.num(_v.copy(p.pos).add(new THREE.Vector3(0, 2.1, 0)), name, 'skill t' + p.team, 1.1, 0.6);
  }
  noBoost(p) {
    if (p.isPlayer) this.num(_v.copy(p.pos).add(new THREE.Vector3(0, 1.5, 0)), 'ブースト切れ', 'miss', 0.6, 0.6);
  }

  // ===== 飛び道具の見た目 =====
  projectileMesh(o) {
    let m;
    const k = o.kind;
    if (k === 'ink') {
      const team = o.owner && o.owner.team != null ? o.owner.team : 0;
      // インクの玉：黒い芯＋チームの色で光るふち（空の前でも「穴」に見えないように）
      m = new THREE.Mesh(pcache('inkG2', () => new THREE.SphereGeometry(0.24, 10, 8)), pcache('inkM', () => new THREE.MeshBasicMaterial({ color: 0x1b2a4a })));
      const glow = new THREE.Sprite(pcache('inkS2' + team, () => new THREE.SpriteMaterial({ map: glowTex(), color: new THREE.Color(TEAM[team].hex).multiplyScalar(1.5), transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending })));
      glow.scale.set(1.15, 1.15, 1);
      m.add(glow);
    } else if (k === 'akahon' || k === 'tangocho' || k === 'pencil') {
      m = pcache('tpl_' + k, () => projTemplate(k)).clone();
    } else if (k === 'guardianShot') {
      const team = o.team || 0;
      m = new THREE.Sprite(pcache('gsS' + team, () => new THREE.SpriteMaterial({ map: glowTex(), color: TEAM[team].hex, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending })));
      m.scale.set(2.6, 2.6, 1);
    } else {
      m = new THREE.Mesh(pcache('defG', () => new THREE.SphereGeometry(0.4, 8, 6)), pcache('defM', () => new THREE.MeshBasicMaterial({ color: 0xffffff })));
    }
    m.position.copy(o.pos);
    this.scene.add(m);
    if (m.userData && m.userData.trail) this.projMeshes.add(m);
    return m;
  }
  areaMesh(a) {
    const g = new THREE.Group();
    if (a.kind === 'mine') {
      // ボムビートルがうずくまって待つ
      const b = buildMonster('beetle');
      b.scale.setScalar(0.5);
      // 小さいので、ふちどりは描かない（描く数をへらす）
      b.traverse((o) => o.name === 'outline' && (o.visible = false));
      b.rotation.y = rand(0, 6.28);
      g.add(b);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: TEAM[a.team].hex, transparent: true, opacity: 0.8, depthWrite: false }));
      glow.scale.set(2.8, 2.8, 1);
      g.add(glow);
      g.userData.blink = glow;
    } else {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(a.r, 40), new THREE.MeshBasicMaterial({ color: TEAM[a.team].hex, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
      disc.rotation.x = -Math.PI / 2;
      g.add(disc);
      const grid = new THREE.Mesh(new THREE.CircleGeometry(a.r * 0.98, 40), new THREE.MeshBasicMaterial({ map: gridTex(a.team), transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
      grid.rotation.x = -Math.PI / 2;
      grid.position.y = 0.05;
      g.add(grid);
      const ring = new THREE.Mesh(new THREE.RingGeometry(a.r - 0.3, a.r, 48), new THREE.MeshBasicMaterial({ color: TEAM[a.team].hex, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      g.add(ring);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(a.r, 24, 12), new THREE.MeshBasicMaterial({ color: TEAM[a.team].light, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide }));
      g.add(dome);
    }
    g.position.copy(a.pos);
    this.scene.add(g);
    return g;
  }

  clear() {
    for (const s of [...this.summons.values(), ...this.leaving]) this.removeSummon(s);
    for (const q of this.shards) this.scene.remove(q.m);
    this.shards.length = 0;
    for (const b of this.beams) {
      this.scene.remove(b.m);
      b.m.material.dispose();
    }
    this.beams.length = 0;
    this.projMeshes.clear();
    this.vfx.clear();
    this.vfx.dispose();
    this.jets.clear();
    this.rings.length = 0;
    for (const n of this.nums) n.el.remove();
    this.nums.length = 0;
    this.scene.remove(this.parts.points);
    this.parts.geo.dispose();
    this.parts.mat.dispose();
  }
  // 罠・結界の見た目を消す（形はその場で作ったもの）
  disposeArea(mesh) {
    if (!mesh) return;
    if (mesh.parent) mesh.parent.remove(mesh);
    disposeDeep(mesh);
  }
}
