// えフェクト：火花・数字・波紋・光の筋・つぶ
import * as THREE from 'three';
import { glowTex, toon, addOutline, canvasTex, sakuraTex, shareMark, disposeDeep } from './gfx.js';
import { TEAM, ELEM } from './config.js';
import { KIND_COLOR } from './characters.js';
import { rand, clamp, el } from './util.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

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
      fragmentShader: 'uniform sampler2D map; varying vec3 vC; varying float vA; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC, t.a * vA); }',
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

// ===== 光の筋（足もとから）=====
class Trail {
  constructor(scene, color, n = 22) {
    this.n = n;
    this.pts = [];
    for (let i = 0; i < n; i++) this.pts.push(new THREE.Vector3());
    this.count = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 2 * 3);
    this.al = new Float32Array(n * 2);
    const idx = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    g.setIndex(idx);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.al, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { color: { value: new THREE.Color(color) } },
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 color; varying float vA; void main(){ gl_FragColor = vec4(color + vec3(0.25), vA); }',
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    scene.add(this.mesh);
    this.width = 0.55;
    this.fade = 0;
  }
  setColor(c) {
    this.mat.uniforms.color.value.set(c);
  }
  update(head, on, camPos, dt, width = 0.55) {
    // 点を後ろへずらす
    const P = this.pts;
    if (on || this.fade > 0) {
      for (let i = this.n - 1; i > 0; i--) P[i].copy(P[i - 1]);
      P[0].copy(head);
      if (this.count < this.n) this.count++;
    }
    this.fade = on ? 1 : Math.max(0, this.fade - dt * 3);
    if (!on && this.fade <= 0) {
      this.count = 0;
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    for (let i = 0; i < this.n; i++) {
      const a = P[i], b = P[Math.min(i + 1, this.count - 1)] || a;
      _v.subVectors(a, b);
      if (_v.lengthSq() < 1e-6) _v.set(0, 0, 1);
      _v2.subVectors(camPos, a);
      _v.cross(_v2).normalize();
      const k = i < this.count ? 1 - i / this.n : 0;
      const w = width * k;
      const i6 = i * 6;
      this.pos[i6] = a.x + _v.x * w;
      this.pos[i6 + 1] = a.y + _v.y * w;
      this.pos[i6 + 2] = a.z + _v.z * w;
      this.pos[i6 + 3] = a.x - _v.x * w;
      this.pos[i6 + 4] = a.y - _v.y * w;
      this.pos[i6 + 5] = a.z - _v.z * w;
      const al = k * k * 0.85 * this.fade;
      this.al[i * 2] = al;
      this.al[i * 2 + 1] = al;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.alpha.needsUpdate = true;
  }
  dispose(scene) {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

// ===== 波紋の輪 =====
const ringGeo = shareMark(new THREE.RingGeometry(0.85, 1, 48));
// 飛び道具の形と色は使い回す（1発ごとに作るとGPUのメモリがふえていく）
const PC = {};
const pcache = (key, make) => PC[key] || (PC[key] = shareMark(make()));
function projTemplate(k) {
  const m = new THREE.Group();
  if (k === 'akahon') {
    const book = new THREE.Mesh(pcache('akG', () => new THREE.BoxGeometry(0.9, 1.2, 0.35)), toon(0xd8202a));
    addOutline(book, 0x3a0a0a, 0.05);
    book.rotation.x = Math.PI / 2;
    m.add(book);
    const glow = new THREE.Sprite(pcache('akS', () => new THREE.SpriteMaterial({ map: glowTex(), color: 0xff5a3d, transparent: true, opacity: 0.7, depthWrite: false })));
    glow.scale.set(3, 3, 1);
    m.add(glow);
  } else if (k === 'tangocho') {
    for (let i = 0; i < 3; i++) {
      const c = new THREE.Mesh(pcache('tgG', () => new THREE.BoxGeometry(1.2, 0.05, 0.7)), toon(i === 1 ? 0x38d16a : 0xffffff));
      c.rotation.y = (i / 3) * Math.PI;
      c.position.y = i * 0.06;
      m.add(c);
    }
    const ring = new THREE.Mesh(pcache('tgR', () => new THREE.TorusGeometry(0.2, 0.04, 6, 12)), toon(0xc0c0c0));
    ring.rotation.x = Math.PI / 2;
    m.add(ring);
  } else if (k === 'pencil') {
    const body = new THREE.Mesh(pcache('pnB', () => new THREE.CylinderGeometry(0.16, 0.16, 1.6, 6)), toon(0xffc93c));
    body.rotation.x = Math.PI / 2;
    m.add(body);
    const tip = new THREE.Mesh(pcache('pnT', () => new THREE.ConeGeometry(0.16, 0.45, 6)), toon(0xf2d0a0));
    tip.rotation.x = Math.PI / 2;
    tip.position.z = 1.0;
    m.add(tip);
  }
  return m;
}

export class FX {
  constructor(match, layer) {
    this.match = match;
    this.scene = match.scene;
    this.layer = layer; // 数字を出す DOM
    this.parts = new Particles(this.scene);
    this.trails = new Map();
    this.rings = [];
    this.nums = [];
    this.labels = [];
    this.auras = new Map();
    this.camPos = new THREE.Vector3();
  }

  // ===== 毎フレーム =====
  update(dt, cam) {
    this.camPos.copy(cam.position);
    this.parts.update(dt);
    // 足もとの光
    for (const p of this.match.punchers) {
      let tr = this.trails.get(p);
      if (!tr) {
        tr = [new Trail(this.scene, TEAM[p.team].light), new Trail(this.scene, TEAM[p.team].light)];
        this.trails.set(p, tr);
      }
      const on = p.alive && p.model.visible && (p.state === 'dash' || p.state === 'cruise' || p.state === 'roll' || (p.state === 'fly' && p.vel.length() > 6) || p.state === 'skill');
      const w = p.state === 'dash' || p.state === 'skill' ? 0.75 : 0.42;
      for (let i = 0; i < 2; i++) {
        const leg = p.model.userData.parts.legs[i];
        leg.knee.getWorldPosition(_v);
        _v.addScaledVector(p.forward, -0.35);
        tr[i].update(_v, on, this.camPos, dt, w * (p.buffs.big > 0 ? 2 : 1));
      }
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
    // 輪
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / r.life;
      const s = r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - k, 2));
      r.mesh.scale.setScalar(s);
      r.mesh.material.opacity = (1 - k) * r.op;
      if (r.face) r.mesh.lookAt(this.camPos);
      if (k >= 1) {
        this.scene.remove(r.mesh);
        r.mesh.material.dispose();
        this.rings.splice(i, 1);
      }
    }
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

  hit(t, src, dmg, o = {}) {
    const p = t.pos;
    const color = o.guardian ? 0xffd34d : o.heavy ? 0xffe06b : 0xffffff;
    for (let i = 0; i < (o.heavy ? 16 : 9); i++) {
      this.parts.emit(p.x, p.y + 0.3, p.z, rand(-1, 1) * 9, rand(-0.5, 1) * 9, rand(-1, 1) * 9, rand(0.18, 0.35), rand(0.5, 0.9), 0.05, color, 5);
    }
    this.ring(p, o.heavy ? 0xffe06b : 0xffffff, 0.3, o.heavy ? 2.6 : 1.6, 0.22, true, 0.9);
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
  just(t) {
    for (let i = 0; i < 24; i++) {
      const a = rand(0, 6.28);
      this.parts.emit(t.pos.x, t.pos.y, t.pos.z, Math.cos(a) * 6, rand(-2, 3), Math.sin(a) * 6, 0.6, 1.4, 0.2, 0xbfe8ff, 3);
    }
    this.ring(t.pos, 0x9fe3ff, 0.5, 3.5, 0.4, true, 0.9);
    this.num(_v.copy(t.pos).add(new THREE.Vector3(0, 1.6, 0)), 'JUST!', 'just', 0.9, 1.0);
  }
  shieldHit(t) {
    this.ring(t.pos, 0x7ad0ff, 1.2, 1.7, 0.2, true, 0.7);
  }

  ring(pos, color, r0, r1, life, face = false, op = 0.9) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    m.position.copy(pos);
    if (!face) m.rotation.x = -Math.PI / 2;
    m.scale.setScalar(r0);
    this.scene.add(m);
    this.rings.push({ mesh: m, t: 0, life, r0, r1, face, op });
  }
  shock(pos, color, r) {
    this.ring(pos, color, 0.5, r, 0.5, false, 0.95);
    this.ring(pos, color, 0.5, r * 0.8, 0.4, true, 0.7);
    for (let i = 0; i < 30; i++) {
      const a = rand(0, 6.28);
      this.parts.emit(pos.x, pos.y, pos.z, Math.cos(a) * r * 1.6, rand(-2, 2), Math.sin(a) * r * 1.6, 0.5, 1.2, 0.2, color, 3);
    }
  }
  boom(pos, color, r) {
    for (let i = 0; i < 40; i++) {
      this.parts.emit(pos.x, pos.y, pos.z, rand(-1, 1) * r * 3, rand(-1, 1) * r * 3, rand(-1, 1) * r * 3, rand(0.3, 0.7), rand(1.2, 2.2), 0.1, i % 3 ? color : 0xffffff, 3.5);
    }
    this.ring(pos, color, 0.5, r * 1.3, 0.45, true, 0.9);
  }
  puff(pos, color) {
    for (let i = 0; i < 8; i++) this.parts.emit(pos.x, pos.y, pos.z, rand(-3, 3), rand(-3, 3), rand(-3, 3), 0.3, 0.7, 0.1, color, 4);
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
  wallKick(p, n) {
    this.ring(p.pos, 0xffffff, 0.4, 2.2, 0.25, true, 0.9);
    for (let i = 0; i < 10; i++) this.parts.emit(p.pos.x, p.pos.y, p.pos.z, n.x * 6 + rand(-3, 3), n.y * 6 + rand(-3, 3), n.z * 6 + rand(-3, 3), 0.3, 0.6, 0.05, 0xffffff, 3);
  }
  ko(p) {
    this.boom(p.pos, TEAM[p.team].hex, 2.5);
    this.ring(p.pos, 0xffffff, 0.5, 5, 0.5, true, 0.95);
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
    this.ring(_v.copy(p.pos).addScaledVector(dir, 2), 0xffffff, 0.5, 6, 0.3, true, 1);
    if (this.match.player && this.match.player === p) this.match.screenFlash('#ffffff', 0.25);
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
    for (let i = 0; i < 16; i++) this.parts.emit(pos.x, pos.y, pos.z, rand(-6, 6), rand(-6, 6), rand(-6, 6), 0.3, 0.9, 0.1, 0x7af0ff, 4);
  }
  elemSwitch(p) {
    const c = ELEM[p.elem].hex;
    this.ring(p.pos, c, 0.3, 2.2, 0.35, true, 0.9);
    if (p.isPlayer) this.num(_v.copy(p.pos).add(new THREE.Vector3(0, 1.8, 0)), ELEM[p.elem].name + 'に変えた', 'elem', 0.9, 0.8);
  }
  chargeIcon(p, om) {
    // 溜めの合図（光の輪）
    this.ring(p.pos, new THREE.Color(KIND_COLOR[om.kind]).getHex(), 0.3, 1.8, 0.5, true, 0.9);
  }
  chargeBreak(p) {
    this.num(_v.copy(p.pos).add(new THREE.Vector3(0, 1.8, 0)), 'キャンセル!', 'break', 0.8, 1);
    for (let i = 0; i < 14; i++) this.parts.emit(p.pos.x, p.pos.y + 1, p.pos.z, rand(-6, 6), rand(-2, 6), rand(-6, 6), 0.5, 0.7, 0.1, 0xcccccc, 2, 8);
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
      m = new THREE.Mesh(pcache('inkG', () => new THREE.SphereGeometry(0.32, 10, 8)), pcache('inkM', () => new THREE.MeshBasicMaterial({ color: 0x1b2a4a })));
      const glow = new THREE.Sprite(pcache('inkS' + team, () => new THREE.SpriteMaterial({ map: glowTex(), color: TEAM[team].hex, transparent: true, opacity: 0.8, depthWrite: false })));
      glow.scale.set(1.6, 1.6, 1);
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
    return m;
  }
  areaMesh(a) {
    const g = new THREE.Group();
    if (a.kind === 'mine') {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 0.7), toon(0xffffff));
      addOutline(m, 0x333333, 0.05);
      g.add(m);
      const band = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.52, 0.35), toon(0x3a6cff));
      g.add(band);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: TEAM[a.team].hex, transparent: true, opacity: 0.8, depthWrite: false }));
      glow.scale.set(2.5, 2.5, 1);
      g.add(glow);
    } else {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(a.r, 40), new THREE.MeshBasicMaterial({ color: TEAM[a.team].hex, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
      disc.rotation.x = -Math.PI / 2;
      g.add(disc);
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
    for (const [, tr] of this.trails) tr.forEach((t) => t.dispose(this.scene));
    this.trails.clear();
    for (const r of this.rings) this.scene.remove(r.mesh);
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
