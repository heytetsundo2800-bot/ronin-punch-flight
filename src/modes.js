// ルール：スクランブル／フラッグフライト／ラピッドボール
import * as THREE from 'three';
import { TEAM, MATCH_TIME } from './config.js';
import { buildDaruma } from './stage.js';
import { toon, addOutline, glowTex, canvasTex, shareMark } from './gfx.js';
import { clamp, damp, rand, pick, TAU } from './util.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

// ===== ダルマ（ガーディアン）=====
export class Guardian {
  constructor(match, team, pos) {
    this.match = match;
    this.team = team;
    this.isGuardian = true;
    this.pos = pos.clone();
    this.radius = 3.7;
    this.model = buildDaruma(team);
    this.model.position.copy(this.pos);
    this.model.rotation.y = team === 0 ? 0 : Math.PI;
    match.scene.add(this.model);
    match.world.add({ t: 'sph', x: pos.x, y: pos.y, z: pos.z, r: 3.3, kind: 'guardian' });
    this.fireCd = 1;
    this.shakeT = 0;
    this.alive = true;
    this.name = TEAM[team].name + 'のダルマ';
    this.elem = null;
    this.vel = new THREE.Vector3();
    this.mode = null; // ルールが中身を決める
  }
  attackable() {
    return this.mode ? this.mode.guardianAttackable(this) : false;
  }
  takeDamage(src, dmg, opts) {
    if (!this.attackable()) return 0;
    dmg = Math.round(dmg * (src && src.buffs && src.buffs.atkT > 0 ? 1 + src.buffs.atk : 1));
    this.shakeT = 0.3;
    if (src && src.stats) {
      src.stats.dmg += dmg;
      src.addSP(dmg / 9000);
    }
    this.match.fx.hit && this.match.fx.hit(this, src, dmg, { guardian: true });
    this.match.sfx('hitGuardian', this, src);
    this.mode.guardianHit(this, src, dmg);
    return dmg;
  }
  update(dt, t) {
    const m = this.model;
    const bob = Math.sin(t * 1.3 + this.team) * 0.35;
    m.position.set(this.pos.x, this.pos.y + bob, this.pos.z);
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      m.position.x += (Math.random() - 0.5) * 0.5;
      m.position.y += (Math.random() - 0.5) * 0.3;
    }
    const U = m.userData;
    U.halo.rotation.z += dt * 0.6;
    // 近くの敵をうつ
    this.fireCd -= dt;
    if (this.mode && !this.match.netClient && this.mode.guardianShoots(this) && this.fireCd <= 0) {
      let best = null, bd = 17;
      for (const p of this.match.punchers) {
        if (p.team === this.team || !p.alive) continue;
        const d = p.pos.distanceTo(this.pos);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      if (best) {
        this.fireCd = 1.05;
        _v.subVectors(best.pos, this.pos).normalize();
        this.match.combat.spawnProjectile({
          owner: this,
          pos: this.pos.clone().addScaledVector(_v, 4),
          vel: _v.clone().multiplyScalar(34),
          dmg: 300,
          radius: 0.9,
          life: 1.0,
          kind: 'guardianShot',
          team: this.team,
          homing: best,
          turn: 4,
          opts: { kind: 'guardian', knock: 9, stun: 0.25, heavy: true },
        });
        this.match.sfx('guardianShot', this);
      }
    }
  }
  // 飛び道具の owner として使えるように
  addSP() {}
  get stats() {
    return null;
  }
}

// ===== サクラ（クリスタル）=====
class SakuraField {
  constructor(match, points) {
    this.match = match;
    const n = points.length;
    this.items = points.map((p, i) => ({ id: i, home: p.clone(), pos: p.clone(), state: 'field', carrier: null, from: new THREE.Vector3(), t: 0, phase: Math.random() * TAU }));
    // 花びら形の結晶：八面体をのばした形
    const geo = new THREE.OctahedronGeometry(0.9, 0);
    geo.scale(0.75, 1.25, 0.75);
    const mat = new THREE.MeshToonMaterial({ color: 0xff8fc0, emissive: 0xff4f9a, emissiveIntensity: 0.35, gradientMap: toon(0xffffff).gradientMap });
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.frustumCulled = false;
    match.scene.add(this.mesh);
    // 光（1つの点の集まりで描く：描く回数を減らす）
    const gg = new THREE.BufferGeometry();
    this.gpos = new Float32Array(n * 3);
    gg.setAttribute('position', new THREE.BufferAttribute(this.gpos, 3).setUsage(THREE.DynamicDrawUsage));
    this.gmat = new THREE.PointsMaterial({ map: glowTex(), color: 0xff7fb8, size: 3.6, sizeAttenuation: true, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending });
    this.glow = new THREE.Points(gg, this.gmat);
    this.glow.frustumCulled = false;
    match.scene.add(this.glow);
    this.m4 = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.s = new THREE.Vector3();
  }
  update(dt, t, cosmetic = false) {
    const M = this.match;
    for (const it of this.items) {
      if (it.state === 'returning') {
        it.t += dt / 1.1;
        const k = Math.min(1, it.t);
        it.pos.lerpVectors(it.from, it.home, k);
        it.pos.y += Math.sin(k * Math.PI) * 6;
        if (k >= 1) {
          it.state = 'field';
          it.pos.copy(it.home);
        }
      } else if (it.state === 'field') {
        // 近くの人に吸い寄せられる
        let best = null, bd = 3.6;
        for (const p of M.punchers) {
          if (!p.alive || p.carry.flag) continue;
          const d = p.pos.distanceTo(it.pos);
          if (d < bd) {
            bd = d;
            best = p;
          }
        }
        if (best) {
          _v.subVectors(best.pos, it.pos);
          if (bd < 1.6 + best.radius * 0.4) {
            if (!cosmetic) M.mode.pickup(best, it);
          } else {
            it.pos.addScaledVector(_v.normalize(), Math.min(bd, 22 * dt));
          }
        } else if (it.pos.distanceToSquared(it.home) > 0.01) {
          it.pos.lerp(it.home, 1 - Math.exp(-2 * dt));
        }
      }
    }
    // 見た目
    const mesh = this.mesh;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      const vis = it.state === 'field' || it.state === 'returning';
      const sc = vis ? 1 : 0;
      this.q.setFromAxisAngle(_v2.set(0, 1, 0), t * 1.6 + it.phase);
      this.s.setScalar(sc);
      _v.copy(it.pos);
      _v.y += Math.sin(t * 2 + it.phase) * 0.25;
      this.m4.compose(_v, this.q, this.s);
      mesh.setMatrixAt(i, this.m4);
      const i3 = i * 3;
      if (vis) {
        this.gpos[i3] = _v.x;
        this.gpos[i3 + 1] = _v.y;
        this.gpos[i3 + 2] = _v.z;
      } else {
        this.gpos[i3] = 0;
        this.gpos[i3 + 1] = -9999;
        this.gpos[i3 + 2] = 0;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.glow.geometry.attributes.position.needsUpdate = true;
  }
  dispose() {
    this.match.scene.remove(this.mesh);
    this.match.scene.remove(this.glow);
  }
}

// ===== スクランブル =====
export class Scramble {
  constructor(match) {
    this.match = match;
    this.key = 'scramble';
    this.total = match.stage.sakuraPoints.length;
    this.field = new SakuraField(match, match.stage.sakuraPoints);
    this.deposit = [[], []]; // ダルマに預けたサクラ（預けた順）
    this.segHp = 330;
    this.dmgAcc = [0, 0];
    this.depositT = new Map();
    for (const g of match.guardians) g.mode = this;
  }
  depN(team) {
    return this.depCount ? this.depCount[team] : this.deposit[team].length;
  }
  guardianAttackable(g) {
    return this.depN(g.team) > 0;
  }
  guardianShoots(g) {
    return this.depN(g.team) > 0;
  }
  guardianHit(g, src, dmg) {
    this.dmgAcc[g.team] += dmg;
    let n = 0;
    while (this.dmgAcc[g.team] >= this.segHp && this.deposit[g.team].length) {
      this.dmgAcc[g.team] -= this.segHp;
      const it = this.deposit[g.team].shift();
      this.returnHome(it, g.pos);
      n++;
    }
    if (!this.deposit[g.team].length) this.dmgAcc[g.team] = 0;
    if (n > 0 && src && src.stats) src.stats.score += n * 15;
    this.match.alertGuardian(g.team);
  }
  score(team) {
    let n = this.depN(team);
    for (const p of this.match.punchers) if (p.team === team) n += p.carry.sakura.length;
    return n;
  }
  // ===== オンライン対戦：状態を送る・受けとる・見た目だけ動かす =====
  netWrite(w) {
    w.u8(this.deposit[0].length);
    w.u8(this.deposit[1].length);
    for (const it of this.field.items) {
      const st = it.state === 'field' ? 0 : it.state === 'carried' ? 1 : it.state === 'deposited' ? 2 : 3;
      w.u8(st);
      if (st === 3) {
        w.i16(it.from.x * 10);
        w.i16(it.from.y * 10);
        w.i16(it.from.z * 10);
        w.u8(it.t * 250);
      }
    }
  }
  netRead(r) {
    this.depCount = [r.u8(), r.u8()];
    for (const it of this.field.items) {
      const st = r.u8();
      if (st === 3) {
        const x = r.i16() / 10, y = r.i16() / 10, z = r.i16() / 10, t = r.u8() / 250;
        if (it.state !== 'returning') {
          it.state = 'returning';
          it.from.set(x, y, z);
          it.pos.copy(it.from);
          it.t = t;
        }
      } else {
        const ns = st === 0 ? 'field' : st === 1 ? 'carried' : 'deposited';
        if (ns === 'field' && it.state !== 'field') it.pos.copy(it.home);
        it.state = ns;
      }
    }
  }
  netVisual(dt, t) {
    this.field.update(dt, t, true);
  }
  fieldCount() {
    return this.field.items.filter((i) => i.state === 'field' || i.state === 'returning').length;
  }
  pickup(p, it) {
    if (it.state !== 'field') return;
    it.state = 'carried';
    it.carrier = p;
    p.carry.sakura.push(it);
    p.stats.pick++;
    p.stats.score += 10;
    p.addSP(0.012);
    this.match.fx.pickup && this.match.fx.pickup(p, it.pos);
    this.match.sfx('pickup', p);
  }
  returnHome(it, from) {
    it.state = 'returning';
    it.carrier = null;
    it.from.copy(from);
    it.pos.copy(from);
    it.t = 0;
  }
  // 倒されたら持っていたサクラは元の場所へ
  onKO(victim) {
    const list = victim.carry.sakura;
    if (list.length) this.match.fx.scatter && this.match.fx.scatter(victim.pos, Math.min(list.length, 12));
    for (const it of list) this.returnHome(it, victim.pos);
    victim.carry.sakura = [];
  }
  onKnock() {}
  nearOwnGuardian(p) {
    const g = this.match.guardians[p.team];
    return p.pos.distanceTo(g.pos) < 11;
  }
  canDeposit(p) {
    return p.alive && p.carry.sakura.length > 0 && this.nearOwnGuardian(p);
  }
  update(dt, t) {
    this.field.update(dt, t);
    // 預ける：ボタン長押し（CPUは近づけば自動）で1個ずつ
    for (const p of this.match.punchers) {
      if (!this.canDeposit(p)) {
        this.depositT.set(p, 0);
        continue;
      }
      const want = p.cpu ? true : p.depositHeld;
      if (!want) {
        this.depositT.set(p, 0);
        continue;
      }
      let acc = (this.depositT.get(p) || 0) + dt;
      while (acc >= 0.11 && p.carry.sakura.length) {
        acc -= 0.11;
        const it = p.carry.sakura.pop();
        it.state = 'deposited';
        it.carrier = null;
        this.deposit[p.team].push(it);
        p.stats.dep++;
        p.stats.score += 5;
        this.match.fx.deposit && this.match.fx.deposit(p, this.match.guardians[p.team]);
        this.match.sfx('deposit', p);
      }
      this.depositT.set(p, acc);
    }
  }
  timeUp() {
    return true;
  }
  result() {
    const a = this.score(0), b = this.score(1);
    return { winner: a > b ? 0 : b > a ? 1 : -1, scores: [a, b], unit: '個' };
  }
  minimap(list) {
    for (const it of this.field.items) if (it.state === 'field') list.push({ kind: 'sakura', pos: it.pos });
  }
  hudExtra() {
    return null;
  }
  dispose() {
    this.field.dispose();
  }
}

// ===== フラッグフライト =====
function makeFlagMesh(team) {
  const T = TEAM[team];
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4.2, 8), toon(0xeeeeee));
  pole.position.y = 2.1;
  addOutline(pole, 0x222222, 0.04);
  g.add(pole);
  const cloth = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 1.5, 6, 2),
    new THREE.MeshToonMaterial({
      color: T.hex,
      side: THREE.DoubleSide,
      gradientMap: toon(0xffffff).gradientMap,
      map: canvasTex(128, 80, (ctx, w, h) => {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 48px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillText('合', w / 2 + 2, h / 2 + 3);
        ctx.fillStyle = '#ffffff';
        ctx.fillText('合', w / 2, h / 2);
      }),
    })
  );
  cloth.position.set(1.3, 3.3, 0);
  g.add(cloth);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), toon(0xffc93c));
  ball.position.y = 4.3;
  g.add(ball);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: T.hex, transparent: true, opacity: 0.6, depthWrite: false }));
  glow.scale.set(6, 6, 1);
  glow.position.y = 2.5;
  g.add(glow);
  g.userData.cloth = cloth;
  return g;
}

export class FlagFlight {
  constructor(match) {
    this.match = match;
    this.key = 'flag';
    this.delivered = [0, 0];
    this.flags = [0, 1].map((team) => {
      const mesh = makeFlagMesh(team);
      match.scene.add(mesh);
      return { team, idx: 0, home: match.stage.flagSpawns[team][0].clone(), pos: match.stage.flagSpawns[team][0].clone(), state: 'home', carrier: null, holdT: 0, mesh, wait: 0, dropT: 0 };
    });
    this.goals = [0, 1].map((team) => match.stage.bases[team].flagGoal.clone());
    // ゴールの目印
    this.goalMeshes = [0, 1].map((team) => {
      const T = TEAM[team];
      const g = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(7, 0.35, 8, 48), new THREE.MeshBasicMaterial({ color: T.hex, transparent: true, opacity: 0.85 }));
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(7, 40), new THREE.MeshBasicMaterial({ color: T.hex, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false }));
      disc.rotation.x = -Math.PI / 2;
      g.add(disc);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 30, 32, 1, true), new THREE.MeshBasicMaterial({ color: T.hex, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
      beam.position.y = 15;
      g.add(beam);
      g.position.copy(this.goals[team]);
      match.scene.add(g);
      return g;
    });
    for (const g of match.guardians) g.mode = this;
  }
  guardianAttackable() {
    return false;
  }
  guardianShoots() {
    return false;
  }
  guardianHit() {}
  score(team) {
    return this.delivered[team];
  }
  progress(team) {
    const f = this.flags[team];
    if (f.wait > 0) return 0;
    const start = this.match.stage.flagSpawns[team][f.idx];
    const total = start.distanceTo(this.goals[team]);
    return clamp(1 - f.pos.distanceTo(this.goals[team]) / total, 0, 1);
  }
  update(dt, t) {
    const M = this.match;
    for (const f of this.flags) {
      if (f.wait > 0) {
        f.wait -= dt;
        f.mesh.visible = false;
        if (f.wait <= 0) {
          f.mesh.visible = true;
          f.state = 'home';
          f.pos.copy(f.home);
          M.announce(TEAM[f.team].name + 'の旗が出た！', f.team);
        }
        continue;
      }
      if (f.state === 'carried') {
        const c = f.carrier;
        if (!c || !c.alive) {
          this.drop(f, c ? c.pos : f.pos);
        } else {
          f.pos.copy(c.pos);
          if (c.team !== f.team) {
            // 敵が自分の旗を持っている：8秒で元の場所へ
            f.holdT += dt;
            if (f.holdT >= 8) {
              c.carry.flag = null;
              f.carrier = null;
              f.state = 'home';
              f.pos.copy(f.home);
              f.holdT = 0;
              M.announce('旗がもどされた！', c.team);
              c.stats.score += 30;
            }
          } else if (c.pos.distanceTo(this.goals[f.team]) < 7.5) {
            // ゴール！
            c.carry.flag = null;
            this.delivered[f.team]++;
            c.stats.score += 100;
            M.announce(TEAM[f.team].name + ' フラッグ ' + this.delivered[f.team] + '本目！', f.team, true);
            M.sfx('goal', c);
            M.fx.boom && M.fx.boom(c.pos, TEAM[f.team].hex, 6);
            f.carrier = null;
            f.idx = Math.min(f.idx + 1, M.stage.flagSpawns[f.team].length - 1);
            f.home.copy(M.stage.flagSpawns[f.team][f.idx]);
            f.state = 'wait';
            f.wait = 3;
            if (this.delivered[f.team] >= 3) M.finish('ノックアウト勝利！');
          }
        }
      } else {
        if (f.state === 'dropped') {
          f.dropT += dt;
          if (f.dropT > 25) {
            f.state = 'home';
            f.pos.copy(f.home);
          }
        }
        // 拾う
        for (const p of M.punchers) {
          if (!p.alive || p.carry.flag || p.stunT > 0) continue;
          if (p.pos.distanceTo(f.pos) < 2.6) {
            f.state = 'carried';
            f.carrier = p;
            f.holdT = 0;
            p.carry.flag = f;
            if (p.team === f.team) {
              M.announce(p.displayName + 'が旗を取った！', p.team);
              p.stats.score += 20;
            } else {
              M.announce(p.displayName + 'が敵の旗をうばった！', p.team);
            }
            M.sfx('flag', p);
            break;
          }
        }
      }
      // 見た目
      const m = f.mesh;
      if (f.state === 'carried' && f.carrier) {
        m.position.copy(f.carrier.pos);
        m.position.y += 0.6;
        m.rotation.y = f.carrier.visYaw + Math.PI;
      } else {
        m.position.copy(f.pos);
        m.position.y += -1.6 + Math.sin(t * 2) * 0.2;
        m.rotation.y += dt * 0.8;
      }
      const cl = m.userData.cloth;
      cl.rotation.y = Math.sin(t * 6 + f.team) * 0.25;
    }
    for (const g of this.goalMeshes) g.children[0].rotation.z += dt * 0.5;
  }
  netWrite(w) {
    w.u8(this.delivered[0]);
    w.u8(this.delivered[1]);
    for (const f of this.flags) {
      w.u8(f.wait > 0 ? 3 : f.state === 'carried' ? 1 : f.state === 'dropped' ? 2 : 0);
      w.u8(f.idx);
      w.i8(f.carrier && f.carrier.netId != null ? f.carrier.netId : -1);
      w.u8(Math.max(0, f.wait) * 10);
      w.vec(f.pos);
    }
  }
  netRead(r) {
    const M = this.match;
    this.delivered[0] = r.u8();
    this.delivered[1] = r.u8();
    for (const p of M.punchers) p.carry.flag = null;
    for (const f of this.flags) {
      const st = r.u8();
      f.idx = r.u8();
      const c = r.i8();
      f.wait = r.u8() / 10;
      r.vec(f.pos);
      f.state = st === 1 ? 'carried' : st === 2 ? 'dropped' : st === 3 ? 'wait' : 'home';
      f.carrier = st === 1 && c >= 0 ? M.punchers[c] || null : null;
      if (f.carrier) f.carrier.carry.flag = f;
      const sp = M.stage.flagSpawns[f.team][f.idx];
      if (sp) f.home.copy(sp);
    }
  }
  netVisual(dt, t) {
    for (const f of this.flags) {
      const m = f.mesh;
      m.visible = !(f.wait > 0);
      if (f.state === 'carried' && f.carrier) {
        f.pos.copy(f.carrier.pos);
        m.position.copy(f.carrier.pos);
        m.position.y += 0.6;
        m.rotation.y = f.carrier.visYaw + Math.PI;
      } else {
        m.position.copy(f.pos);
        m.position.y += -1.6 + Math.sin(t * 2) * 0.2;
        m.rotation.y += dt * 0.8;
      }
      m.userData.cloth.rotation.y = Math.sin(t * 6 + f.team) * 0.25;
    }
    for (const g of this.goalMeshes) g.children[0].rotation.z += dt * 0.5;
  }
  drop(f, at) {
    if (f.carrier) f.carrier.carry.flag = null;
    f.carrier = null;
    f.state = 'dropped';
    f.dropT = 0;
    f.holdT = 0;
    f.pos.copy(at);
    this.match.announce('旗が落ちた！', f.team);
  }
  dropFlag(p) {
    if (p.carry.flag) this.drop(p.carry.flag, p.pos);
  }
  onKO(victim) {
    if (victim.carry.flag) this.drop(victim.carry.flag, victim.pos);
  }
  onKnock(p) {
    if (p.carry.flag) this.drop(p.carry.flag, p.pos);
  }
  canDeposit() {
    return false;
  }
  timeUp() {
    return true;
  }
  result() {
    const a = this.delivered[0], b = this.delivered[1];
    let winner = a > b ? 0 : b > a ? 1 : -1;
    let reason = '';
    if (winner < 0) {
      const pa = this.progress(0), pb = this.progress(1);
      if (Math.abs(pa - pb) > 0.01) {
        winner = pa > pb ? 0 : 1;
        reason = '旗をゴールに近づけたほうの勝ち';
      }
    }
    return { winner, scores: [a, b], unit: '本', reason };
  }
  minimap(list) {
    for (const f of this.flags) if (f.wait <= 0) list.push({ kind: 'flag', team: f.team, pos: f.pos });
    for (let i = 0; i < 2; i++) list.push({ kind: 'goal', team: i, pos: this.goals[i] });
  }
  hudExtra() {
    return { flag: [this.progress(0), this.progress(1)] };
  }
  dispose() {
    for (const f of this.flags) this.match.scene.remove(f.mesh);
    for (const g of this.goalMeshes) this.match.scene.remove(g);
  }
}

// ===== ラピッドボール =====
// ボールは何度も出たり消えたりするので、見た目をひとつ作って複製する
const BALL_TPL = {};
function makeBallMesh(rapid) {
  const k = rapid ? 'r' : 'n';
  if (!BALL_TPL[k]) {
    const t = buildBallMesh(rapid);
    t.traverse((o) => {
      if (o.geometry) shareMark(o.geometry);
      if (o.material) {
        shareMark(o.material);
        if (o.material.map) shareMark(o.material.map);
      }
    });
    BALL_TPL[k] = t;
  }
  return BALL_TPL[k].clone();
}
function buildBallMesh(rapid) {
  const g = new THREE.Group();
  const tex = canvasTex(128, 64, (ctx, w, h) => {
    if (rapid) {
      const gr = ctx.createLinearGradient(0, 0, w, 0);
      ['#ff4d4d', '#ffb340', '#ffe94d', '#4dff88', '#4dc3ff', '#9b6bff', '#ff4dd2'].forEach((c, i, a) => gr.addColorStop(i / (a.length - 1), c));
      ctx.fillStyle = gr;
    } else ctx.fillStyle = '#fff6d8';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = rapid ? '#ffffff' : '#ff8a3d';
    ctx.lineWidth = 6;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo((i * w) / 4, 0);
      ctx.lineTo((i * w) / 4 + 16, h);
      ctx.stroke();
    }
  });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(rapid ? 1.15 : 0.75, 18, 12), new THREE.MeshToonMaterial({ map: tex, gradientMap: toon(0xffffff).gradientMap, emissive: rapid ? 0x553355 : 0x332200, emissiveIntensity: 0.4 }));
  addOutline(ball, rapid ? 0x5a2a7a : 0x7a4a1a, 0.06);
  g.add(ball);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: rapid ? 0xff66ff : 0xffcc66, transparent: true, opacity: 0.6, depthWrite: false }));
  glow.scale.set(rapid ? 7 : 3.6, rapid ? 7 : 3.6, 1);
  g.add(glow);
  return g;
}

export class RapidBall {
  constructor(match) {
    this.match = match;
    this.key = 'ball';
    this.scoreV = [0, 0];
    this.balls = [];
    this.maxField = 9;
    this.spawnCd = 0;
    this.segHp = 420;
    this.gstate = [0, 1].map(() => ({ hp: 6 * this.segHp, down: 0, regenCd: 0 }));
    this.rapidOut = false;
    this.overtime = 0;
    // ゴールのリング（相手のダルマのうしろ）
    this.rings = [0, 1].map((team) => {
      const T = TEAM[team];
      const b = match.stage.bases[team];
      const g = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(6.2, 0.55, 10, 48), toon(T.hex));
      addOutline(ring, T.dark, 0.08);
      g.add(ring);
      const barrier = new THREE.Mesh(
        new THREE.CircleGeometry(6.0, 40),
        new THREE.MeshBasicMaterial({
          color: T.light,
          transparent: true,
          opacity: 0.45,
          side: THREE.DoubleSide,
          depthWrite: false,
          map: canvasTex(128, 128, (ctx, w, h) => {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, w, h);
            ctx.strokeStyle = 'rgba(0,0,0,0.35)';
            ctx.lineWidth = 3;
            for (let y = 0; y < h; y += 16)
              for (let x = (y / 16) % 2 ? 8 : 0; x < w; x += 16) {
                ctx.beginPath();
                for (let k = 0; k < 6; k++) {
                  const a = (k / 6) * TAU;
                  ctx.lineTo(x + Math.cos(a) * 7, y + Math.sin(a) * 7);
                }
                ctx.closePath();
                ctx.stroke();
              }
          }),
        })
      );
      g.add(barrier);
      g.position.copy(b.goal);
      match.scene.add(g);
      return { team, mesh: g, barrier, pos: b.goal.clone(), normal: new THREE.Vector3(0, 0, 1) };
    });
    for (const g of match.guardians) g.mode = this;
    this.lastPos = new Map();
  }
  guardianAttackable(g) {
    return this.gstate[g.team].down <= 0;
  }
  guardianShoots(g) {
    return this.gstate[g.team].down <= 0;
  }
  goalOpen(team) {
    return this.gstate[team].down > 0;
  }
  guardianHit(g, src, dmg) {
    const s = this.gstate[g.team];
    s.hp -= dmg;
    s.regenCd = 4;
    this.match.alertGuardian(g.team);
    if (s.hp <= 0) {
      s.hp = 0;
      s.down = 15;
      this.match.announce(TEAM[g.team].name + 'のゴールが開いた！', 1 - g.team, true);
      this.match.sfx('guardianDown', g);
      this.match.fx.boom && this.match.fx.boom(g.pos, TEAM[g.team].hex, 8);
      if (src && src.stats) src.stats.score += 40;
      g.model.visible = false;
    }
  }
  score(team) {
    return this.scoreV[team];
  }
  spawnBall(rapid, at) {
    const S = this.match.stage;
    const pos = at ? at.clone() : pick(S.ballSpawns).clone().add(new THREE.Vector3(rand(-4, 4), rand(-1, 2), rand(-4, 4)));
    const mesh = makeBallMesh(rapid);
    mesh.position.copy(pos);
    this.match.scene.add(mesh);
    this.nextBall = ((this.nextBall || 0) + 1) & 0xffff;
    const b = { id: this.nextBall, pos, vel: new THREE.Vector3(), state: 'field', carrier: null, value: rapid ? 10 : 1, rapid, mesh, wanderT: 0, seen: false, noPickT: 0 };
    this.balls.push(b);
    if (rapid) {
      this.match.announce('ラピッドボール出現！（10点）', -1, true);
      this.match.sfx('rapid', null);
    }
    return b;
  }
  update(dt, t) {
    const M = this.match;
    // ボールを補充
    const fieldN = this.balls.filter((b) => !b.rapid).length;
    this.spawnCd -= dt;
    if (fieldN < this.maxField && this.spawnCd <= 0) {
      this.spawnBall(false);
      this.spawnCd = 2.5;
    }
    if (!this.rapidOut && M.timeLeft <= 60) {
      this.rapidOut = true;
      this.spawnBall(true, M.stage.rapidSpawn.clone());
    }
    // ダルマの回復と復活
    for (let i = 0; i < 2; i++) {
      const s = this.gstate[i];
      if (s.down > 0) {
        s.down -= dt;
        if (s.down <= 0) {
          s.hp = 6 * this.segHp;
          M.guardians[i].model.visible = true;
          M.announce(TEAM[i].name + 'のゴールが閉じた', i);
        }
      } else {
        s.regenCd -= dt;
        if (s.regenCd <= 0) s.hp = Math.min(6 * this.segHp, s.hp + (this.segHp / 6) * dt);
      }
      const r = this.rings[i];
      r.barrier.visible = s.down <= 0;
      r.mesh.children[0].material.emissive && (r.mesh.children[0].material.emissiveIntensity = s.down > 0 ? 0.6 : 0);
      r.mesh.rotation.z += dt * (s.down > 0 ? 1.5 : 0.2);
    }
    // ボール
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      if (b.state === 'carried') {
        const c = b.carrier;
        if (!c || !c.alive) {
          this.dropBall(b, c ? c.pos : b.pos);
          continue;
        }
        const k = c.carry.balls.indexOf(b);
        const a = t * 3 + k * 1.3;
        b.pos.set(c.pos.x + Math.cos(a) * 1.4, c.pos.y + 0.8 + Math.sin(a * 0.7) * 0.3, c.pos.z + Math.sin(a) * 1.4);
      } else {
        b.noPickT -= dt;
        b.pos.addScaledVector(b.vel, dt);
        b.vel.multiplyScalar(Math.exp(-1.5 * dt));
        if (b.rapid) {
          // ラピッドボールはふらふら動く
          b.wanderT -= dt;
          if (b.wanderT <= 0) {
            b.wanderT = rand(1.2, 2.5);
            b.vel.set(rand(-1, 1), rand(-0.4, 0.4), rand(-1, 1)).normalize().multiplyScalar(9);
          }
          b.pos.x = clamp(b.pos.x, -60, 60);
          b.pos.z = clamp(b.pos.z, -60, 60);
          b.pos.y = clamp(b.pos.y, 12, M.stage.rapidTop || 60);
        }
        M.world.resolveSphere(b.pos, 0.8, b.vel, (this._hi = this._hi || { ground: false, hitWall: false, wallNormal: new THREE.Vector3() }));
        if (b.noPickT <= 0) {
          for (const p of M.punchers) {
            if (!p.alive || p.stunT > 0) continue;
            if (p.carry.balls.length >= 6) continue;
            if (p.pos.distanceTo(b.pos) < 2.3 + (b.rapid ? 0.6 : 0)) {
              b.state = 'carried';
              b.carrier = p;
              p.carry.balls.push(b);
              p.stats.score += b.rapid ? 30 : 5;
              M.sfx('pickup', p);
              if (b.rapid) M.announce(p.displayName + 'がラピッドボールを取った！', p.team, true);
              break;
            }
          }
        }
      }
      b.mesh.position.copy(b.pos);
      b.mesh.children[0].rotation.y += dt * 2;
    }
    // ゴールをくぐったか（前のフレームの位置とくらべる）
    for (const p of M.punchers) {
      const last = this.lastPos.get(p);
      if (!last) {
        this.lastPos.set(p, p.pos.clone());
        continue;
      }
      if (p.alive && p.carry.balls.length) {
        const enemy = 1 - p.team;
        const r = this.rings[enemy];
        if (this.goalOpen(enemy) && crossesRing(last, p.pos, r.pos, 6.4)) this.scoreGoal(p);
      }
      last.copy(p.pos);
    }
    // 延長：時間切れのとき負けているチームのゴールが開いていたら
  }
  scoreGoal(p) {
    const M = this.match;
    let pts = 0;
    for (const b of p.carry.balls) {
      pts += b.value;
      M.scene.remove(b.mesh);
      const i = this.balls.indexOf(b);
      if (i >= 0) this.balls.splice(i, 1);
      if (b.rapid) setTimeout(() => M.running && this.spawnBall(true, M.stage.rapidSpawn.clone()), 1500);
    }
    p.carry.balls = [];
    this.scoreV[p.team] += pts;
    p.stats.score += pts * 20;
    M.announce(p.displayName + ' ゴール！ +' + pts, p.team, true);
    M.sfx('goal', p);
    M.fx.boom && M.fx.boom(p.pos, TEAM[p.team].hex, 7);
  }
  netWrite(w) {
    w.u16(this.scoreV[0]);
    w.u16(this.scoreV[1]);
    for (const s of this.gstate) {
      w.u16(s.hp);
      w.u8(Math.max(0, s.down) * 10);
    }
    w.u8(this.rapidOut ? 1 : 0);
    w.u8(Math.min(255, this.balls.length));
    for (const b of this.balls.slice(0, 255)) {
      w.u16(b.id);
      w.u8((b.rapid ? 1 : 0) | (b.state === 'carried' ? 2 : 0));
      w.i8(b.carrier && b.carrier.netId != null ? b.carrier.netId : -1);
      w.vec(b.pos);
    }
  }
  netRead(r) {
    const M = this.match;
    this.scoreV[0] = r.u16();
    this.scoreV[1] = r.u16();
    for (const s of this.gstate) {
      s.hp = r.u16();
      s.down = r.u8() / 10;
    }
    this.rapidOut = r.u8() === 1;
    const n = r.u8();
    const seen = new Set();
    for (const p of M.punchers) p.carry.balls = [];
    for (let i = 0; i < n; i++) {
      const id = r.u16(), fl = r.u8(), c = r.i8();
      let b = this.balls.find((x) => x.id === id);
      if (!b) {
        const rapid = (fl & 1) === 1;
        const mesh = makeBallMesh(rapid);
        M.scene.add(mesh);
        b = { id, pos: new THREE.Vector3(), net: new THREE.Vector3(), vel: new THREE.Vector3(), state: 'field', carrier: null, value: rapid ? 10 : 1, rapid, mesh, fresh: true };
        this.balls.push(b);
      }
      r.vec(b.net || (b.net = new THREE.Vector3()));
      if (b.fresh) {
        b.pos.copy(b.net);
        b.fresh = false;
      }
      b.state = fl & 2 ? 'carried' : 'field';
      b.carrier = b.state === 'carried' && c >= 0 ? M.punchers[c] || null : null;
      if (b.carrier) b.carrier.carry.balls.push(b);
      seen.add(id);
    }
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      if (seen.has(b.id)) continue;
      M.scene.remove(b.mesh);
      this.balls.splice(i, 1);
    }
  }
  netVisual(dt, t) {
    const M = this.match;
    for (let i = 0; i < 2; i++) {
      const s = this.gstate[i];
      const r = this.rings[i];
      r.barrier.visible = s.down <= 0;
      r.mesh.rotation.z += dt * (s.down > 0 ? 1.5 : 0.2);
      M.guardians[i].model.visible = s.down <= 0;
    }
    for (const b of this.balls) {
      if (b.state === 'carried' && b.carrier) {
        const c = b.carrier;
        const k = c.carry.balls.indexOf(b);
        const a = t * 3 + k * 1.3;
        b.pos.set(c.pos.x + Math.cos(a) * 1.4, c.pos.y + 0.8 + Math.sin(a * 0.7) * 0.3, c.pos.z + Math.sin(a) * 1.4);
      } else if (b.net) b.pos.lerp(b.net, 1 - Math.exp(-12 * dt));
      b.mesh.position.copy(b.pos);
      b.mesh.children[0].rotation.y += dt * 2;
    }
  }
  dropBall(b, at) {
    if (b.carrier) {
      const arr = b.carrier.carry.balls;
      const i = arr.indexOf(b);
      if (i >= 0) arr.splice(i, 1);
    }
    b.carrier = null;
    b.state = 'field';
    b.pos.copy(at);
    b.vel.set(rand(-1, 1), rand(0.2, 1), rand(-1, 1)).normalize().multiplyScalar(rand(8, 14));
    b.noPickT = 0.6;
  }
  dropAll(p) {
    for (const b of p.carry.balls.slice()) this.dropBall(b, p.pos);
    p.carry.balls = [];
  }
  onKO(victim) {
    this.dropAll(victim);
  }
  onKnock(p) {
    if (p.carry.balls.length) this.dropAll(p);
  }
  canDeposit() {
    return false;
  }
  timeUp() {
    // 負けているチームが相手ゴールを開けていたら延長（最大25秒）
    const a = this.scoreV[0], b = this.scoreV[1];
    if (a === b) return true;
    const losing = a < b ? 0 : 1;
    if (this.goalOpen(1 - losing) && this.overtime < 25) return false;
    return true;
  }
  result() {
    const a = this.scoreV[0], b = this.scoreV[1];
    return { winner: a > b ? 0 : b > a ? 1 : -1, scores: [a, b], unit: '点' };
  }
  minimap(list, viewer) {
    for (const b of this.balls) {
      if (b.state !== 'field') continue;
      // ボールは近づくまでマップに出ない（ラピッドボールは見える）
      let near = b.rapid;
      if (!near)
        for (const p of this.match.punchers)
          if (p.team === viewer.team && p.alive && p.pos.distanceTo(b.pos) < 40) {
            near = true;
            break;
          }
      if (near) list.push({ kind: b.rapid ? 'rapid' : 'ball', pos: b.pos });
    }
    for (let i = 0; i < 2; i++) list.push({ kind: 'ring', team: i, pos: this.rings[i].pos, open: this.goalOpen(i) });
  }
  hudExtra() {
    return { gHp: this.gstate.map((s) => (s.down > 0 ? -s.down : s.hp / (6 * this.segHp))) };
  }
  dispose() {
    for (const b of this.balls) this.match.scene.remove(b.mesh);
    for (const r of this.rings) this.match.scene.remove(r.mesh);
  }
}

// 線分 a→b がリング（中心 c、半径 r、z向きの面）を通ったか
function crossesRing(a, b, c, r) {
  const da = a.z - c.z, db = b.z - c.z;
  if ((da > 0) === (db > 0)) return false;
  const k = da / (da - db);
  const x = a.x + (b.x - a.x) * k - c.x;
  const y = a.y + (b.y - a.y) * k - c.y;
  return x * x + y * y <= r * r;
}

export function createMode(key, match) {
  if (key === 'flag') return new FlagFlight(match);
  if (key === 'ball') return new RapidBall(match);
  return new Scramble(match);
}
