// スキル：パンチャースキル（KS）・スペシャル（SS）・お守り（ディスク）
import * as THREE from 'three';
import { OMAMORI } from './characters.js';
import { MOVE, COMBAT } from './config.js';
import { clamp } from './util.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const CHARGE = { ATK: 0.85, HEAL: 0.75, BUFF: 0.65, TRAP: 0.95, WARP: 0.8, MOVE: 0.45 };
// タイプごとの得意（発動が早い）
const AFFINITY = {
  attack: { ATK: 0.85, TRAP: 1.2 },
  speed: { MOVE: 0.8, WARP: 0.85, HEAL: 1.15 },
  support: { HEAL: 0.75, BUFF: 0.8, ATK: 1.1 },
};

export class Skills {
  constructor(match) {
    this.match = match;
    this.active = [];
  }

  chargeTime(p, om) {
    const a = AFFINITY[p.def.type] || {};
    return CHARGE[om.kind] * (a[om.kind] || 1);
  }

  aimDir(p, out) {
    const L = p.lock && p.lock.alive ? p.lock : this.match.combat.pickTarget(p);
    if (L) {
      out.subVectors(L.pos, p.pos).normalize();
      return L;
    }
    out.copy(p.forward);
    return null;
  }

  // ===== パンチャースキル =====
  useKS(p) {
    const M = this.match;
    const id = p.def.skill.id;
    M.fx.skillName && M.fx.skillName(p, p.def.skill.name);
    if (id === 'tigerRush') {
      const t = this.aimDir(p, _v);
      p.state = 'skill';
      p.stateT = 0;
      this.active.push({ p, kind: 'rush', t: 0, dur: 0.55, dir: _v.clone(), target: t, hits: new Map(), count: 0 });
      M.sfx('ksTora', p);
      return true;
    }
    if (id === 'goggleDive') {
      this.aimDir(p, _v);
      p.state = 'skill';
      p.stateT = 0;
      p.invuln = Math.max(p.invuln, 0.3);
      this.active.push({ p, kind: 'dive', t: 0, dur: 0.5, dir: _v.clone(), hit: new Set() });
      M.sfx('ksEven', p);
      return true;
    }
    if (id === 'flash') {
      this.aimDir(p, _v);
      M.fx.flash && M.fx.flash(p, _v.clone());
      M.sfx('ksAomachi', p);
      for (const t of M.combat.targetsFor(p)) {
        _v2.subVectors(t.pos, p.pos);
        const d = _v2.length();
        if (d > 15) continue;
        if (d > 1.5 && _v2.dot(_v) / d < 0.62) continue;
        if (t.isGuardian) {
          M.combat.damage(p, t, 180 * p.def.atk, { kind: 'ks' });
          continue;
        }
        M.combat.damage(p, t, 150 * p.def.atk, { kind: 'ks', stun: 1.4, dir: _v2.normalize().clone(), knock: 2 });
        M.fx.dizzy && M.fx.dizzy(t, 1.4);
      }
      return true;
    }
    return false;
  }

  // ===== スペシャル =====
  useSpecial(p) {
    const M = this.match;
    p.state = 'special';
    p.stateT = 0;
    p.invuln = Math.max(p.invuln, 1.3);
    p.vel.multiplyScalar(0.2);
    M.cutin(p);
    this.active.push({ p, kind: 'special', t: 0, dur: 1.05 });
    M.sfx('special', p);
  }
  fireSpecial(p) {
    const M = this.match;
    const id = p.def.special.id;
    p.state = 'hover';
    p.stateT = 0;
    if (id === 'roar') {
      M.fx.shock && M.fx.shock(p.pos, 0xffb020, 14);
      M.fx.shock && M.fx.shock(p.pos, 0xffffff, 9);
      M.fx.laughs && M.fx.laughs(p);
      M.shake(0.6, 0.5);
      for (const t of M.combat.targetsFor(p)) {
        _v.subVectors(t.pos, p.pos);
        const d = _v.length();
        if (d > 14 + (t.radius || 0.8)) continue;
        _v.normalize();
        if (t.isGuardian) {
          M.combat.damage(p, t, 900 * p.def.atk, { kind: 'special' });
          continue;
        }
        M.combat.damage(p, t, 620 * p.def.atk, { elem: true, kind: 'special', heavy: true, dir: _v.clone(), knock: 22, stun: 1.5 });
      }
    } else if (id === 'bigEven') {
      p.buffs.big = 8;
      p.model.userData.bigT = 0;
      M.fx.shock && M.fx.shock(p.pos, 0x7af0ff, 8);
      M.shake(0.4, 0.3);
    } else if (id === 'glassesOff') {
      p.buffs.ikemen = 8;
      if (p.model.userData.glasses) p.model.userData.glasses.visible = false;
      M.fx.sparkle && M.fx.sparkle(p, 8);
      for (const t of M.combat.targetsFor(p)) {
        if (t.isGuardian) continue;
        if (t.pos.distanceTo(p.pos) < 16) {
          t.stunT = Math.max(t.stunT, 2.6);
          t.dash = null;
          t.lock = null;
          if (t.remote && M.netHit) M.netHit(t, { s: 2.6, ul: 1 });
          M.fx.hearts && M.fx.hearts(t, 2.6);
        }
      }
      for (const a of M.punchers) {
        if (a.team !== p.team || !a.alive) continue;
        if (a.pos.distanceTo(p.pos) < 22) a.heal(a.maxHp * 0.3);
      }
    }
  }
  endBig(p) {
    p.buffs.big = 0;
  }
  endIkemen(p) {
    p.buffs.ikemen = 0;
    if (p.model.userData.glasses) p.model.userData.glasses.visible = true;
  }

  // ===== お守り =====
  fireOmamori(p, id, slot) {
    const M = this.match;
    const om = OMAMORI[id];
    if (!p.alive) return;
    M.fx.skillName && M.fx.skillName(p, om.name, om);
    p.stats.om++;
    const lv = (p.omLv && p.omLv[slot]) || 1;
    const atk = p.def.atk * (1 + (lv - 1) * 0.08);
    switch (id) {
      case 'akahon': {
        const t = this.aimDir(p, _v);
        M.combat.spawnProjectile({
          owner: p,
          pos: p.pos.clone().addScaledVector(_v, 1.2).add(new THREE.Vector3(0, 0.6, 0)),
          vel: _v.clone().multiplyScalar(24),
          dmg: 420 * atk,
          radius: 0.8,
          life: 2.6,
          kind: 'akahon',
          homing: t,
          turn: 3.4,
          opts: { kind: 'disk', heavy: true, knock: 12, stun: 0.5 },
          aoe: { r: 3.2, dmg: 160 * atk, color: 0xff5a3d, knock: 8 },
        });
        M.sfx('missile', p);
        break;
      }
      case 'tangocho': {
        this.aimDir(p, _v);
        M.combat.spawnProjectile({
          owner: p,
          pos: p.pos.clone().addScaledVector(_v, 1.0),
          vel: _v.clone().multiplyScalar(30),
          dmg: 150 * atk,
          radius: 1.3,
          life: 1.9,
          kind: 'tangocho',
          pierce: true,
          spin: 18,
          boomerang: { out: 0.5, speed: 34 },
          opts: { kind: 'disk', knock: 4 },
        });
        M.sfx('boomerang', p);
        break;
      }
      case 'pencil': {
        const t = this.aimDir(p, _v);
        M.combat.spawnProjectile({
          owner: p,
          pos: p.pos.clone().addScaledVector(_v, 1.0),
          vel: _v.clone().multiplyScalar(58),
          dmg: 340 * atk,
          radius: 0.6,
          life: 0.75,
          kind: 'pencil',
          homing: t,
          turn: 1.2,
          opts: { kind: 'disk', heavy: true, knock: 10, stun: 0.35 },
        });
        M.sfx('missile', p);
        break;
      }
      case 'drink':
        p.heal(p.maxHp * 0.3);
        M.fx.healFx && M.fx.healFx(p);
        M.sfx('heal', p);
        break;
      case 'eyemask':
        for (const a of M.punchers) {
          if (a.team !== p.team || !a.alive) continue;
          if (a === p || a.pos.distanceTo(p.pos) < 13) {
            a.buffs.regen = 0.07;
            a.buffs.regenT = 5;
            M.fx.healFx && M.fx.healFx(a);
          }
        }
        M.sfx('heal', p);
        break;
      case 'hachimaki':
        p.buffs.atk = 0.35;
        p.buffs.atkT = 8;
        M.fx.buffFx && M.fx.buffFx(p, 0xff5a3d);
        M.sfx('buff', p);
        break;
      case 'coffee':
        p.buffs.spd = 0.3;
        p.buffs.spdT = 6;
        p.boost = Math.min(6, p.boost + 2);
        M.fx.buffFx && M.fx.buffFx(p, 0x5ad7ff);
        M.sfx('buff', p);
        break;
      case 'shield':
        p.buffs.shield = 700;
        p.buffs.shieldT = 8;
        M.fx.buffFx && M.fx.buffFx(p, 0x7ad0ff);
        M.sfx('buff', p);
        break;
      case 'keshigomu': {
        const pos = p.pos.clone();
        M.combat.addArea({
          owner: p,
          team: p.team,
          pos,
          r: 3.4,
          life: 20,
          kind: 'mine',
          update: (a) => {
            for (const t of M.combat.targetsFor(p)) {
              if (t.isGuardian) continue;
              if (t.pos.distanceTo(a.pos) < a.r + 0.6) {
                a.dead = true;
                M.combat.explode({ owner: p, pos: a.pos, aoe: { r: 4.2, dmg: 380 * atk, color: 0xff8a3d, knock: 10, stun: 1.2 } });
                break;
              }
            }
          },
        });
        M.sfx('trap', p);
        break;
      }
      case 'marksheet': {
        M.combat.addArea({
          owner: p,
          team: p.team,
          pos: p.pos.clone(),
          r: 7.5,
          life: 7,
          kind: 'field',
          update: (a) => {
            for (const t of M.punchers) {
              if (t.team === p.team || !t.alive) continue;
              if (t.pos.distanceTo(a.pos) < a.r) {
                t.buffs.slow = 0.5;
                t.buffs.slowT = Math.max(t.buffs.slowT, 0.3);
              }
            }
          },
        });
        M.sfx('trap', p);
        break;
      }
      case 'warp': {
        _v.copy(p.forward);
        const d = M.world.raycast(p.pos, _v, 17);
        const dist = Math.max(0, Math.min(16, d - 1.5));
        M.fx.warpFx && M.fx.warpFx(p.pos);
        p.pos.addScaledVector(_v, dist);
        p.invuln = Math.max(p.invuln, 0.35);
        M.fx.warpFx && M.fx.warpFx(p.pos);
        M.sfx('warp', p);
        break;
      }
      case 'homewarp': {
        const b = M.stage.bases[p.team];
        M.fx.warpFx && M.fx.warpFx(p.pos);
        p.pos.copy(b.respawn[p.slot % b.respawn.length]);
        p.vel.set(0, 0, 0);
        p.yaw = b.faceYaw;
        p.invuln = Math.max(p.invuln, 0.6);
        p.lock = null;
        M.fx.warpFx && M.fx.warpFx(p.pos);
        M.sfx('warp', p);
        break;
      }
      case 'jet': {
        p.state = 'skill';
        p.stateT = 0;
        p.invuln = Math.max(p.invuln, 0.6);
        this.active.push({ p, kind: 'jet', t: 0, dur: 0.6, dir: p.forward.clone() });
        M.sfx('dash', p);
        break;
      }
      case 'fuwa':
        p.boost = 6;
        p.invuln = Math.max(p.invuln, 1.2);
        M.fx.buffFx && M.fx.buffFx(p, 0xffffff);
        M.sfx('buff', p);
        break;
    }
  }

  update(dt) {
    const M = this.match;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i];
      const p = a.p;
      a.t += dt;
      if (!p.alive) {
        this.active.splice(i, 1);
        if (p.state === 'skill') p.state = 'hover';
        continue;
      }
      if (a.kind === 'special') {
        if (a.t >= a.dur) {
          this.fireSpecial(p);
          this.active.splice(i, 1);
        }
        continue;
      }
      if (a.kind === 'rush') {
        if (a.target && a.target.alive !== false) {
          _v.subVectors(a.target.pos, p.pos);
          if (_v.length() > 2.2) a.dir.lerp(_v.normalize(), 1 - Math.exp(-8 * dt)).normalize();
        }
        p.vel.copy(a.dir).multiplyScalar(26);
        p.yaw = Math.atan2(a.dir.x, a.dir.z);
        p.atk.phase = (a.t * 7) % 1;
        p.atk.side = Math.floor(a.t * 14) % 2;
        for (const t of M.combat.targetsFor(p)) {
          if (t.pos.distanceTo(p.pos) > 3.6 + (t.radius || 0.8)) continue;
          const last = a.hits.get(t) || -1;
          if (a.t - last < 0.1) continue;
          a.hits.set(t, a.t);
          a.count++;
          _v2.subVectors(t.pos, p.pos).normalize();
          M.combat.damage(p, t, 115 * p.def.atk, { elem: true, kind: 'ks', dir: _v2.clone(), knock: 4, melee: true });
          // 相手をいっしょに運ぶ
          if (t.vel) t.vel.copy(p.vel).multiplyScalar(0.9);
          if (t.remote && M.netHit) M.netHit(t, { vs: t.vel.clone() });
        }
        if (a.t >= a.dur) {
          for (const t of M.combat.targetsFor(p)) {
            if (t.pos.distanceTo(p.pos) > 4.4 + (t.radius || 0.8)) continue;
            _v2.subVectors(t.pos, p.pos).normalize();
            M.combat.damage(p, t, 260 * p.def.atk, { elem: true, kind: 'ks', heavy: true, dir: _v2.clone(), knock: 20, stun: 0.6, melee: true });
          }
          p.atk.phase = -1;
          p.state = 'hover';
          p.vel.multiplyScalar(0.3);
          this.active.splice(i, 1);
        }
        continue;
      }
      if (a.kind === 'dive') {
        p.vel.copy(a.dir).multiplyScalar(44);
        p.yaw = Math.atan2(a.dir.x, a.dir.z);
        p.pitch = clamp(Math.asin(clamp(a.dir.y, -1, 1)), -MOVE.pitchLimit, MOVE.pitchLimit);
        M.fx.trail && M.fx.trail(p, 0x7af0ff);
        for (const t of M.combat.targetsFor(p)) {
          if (a.hit.has(t)) continue;
          if (t.pos.distanceTo(p.pos) > 2.6 + (t.radius || 0.8)) continue;
          a.hit.add(t);
          _v2.subVectors(t.pos, p.pos).normalize();
          M.combat.damage(p, t, 210 * p.def.atk, { elem: true, kind: 'ks', heavy: true, dir: _v2.clone(), knock: 14, stun: 0.4 });
        }
        if (a.t >= a.dur) {
          p.buffs.spd = Math.max(p.buffs.spd, 0.25);
          p.buffs.spdT = Math.max(p.buffs.spdT, 3);
          p.state = 'cruise';
          p.vel.multiplyScalar(0.45);
          this.active.splice(i, 1);
        }
        continue;
      }
      if (a.kind === 'jet') {
        p.vel.copy(a.dir).multiplyScalar(48);
        if (a.t >= a.dur) {
          p.state = 'cruise';
          p.vel.multiplyScalar(0.4);
          this.active.splice(i, 1);
        }
        continue;
      }
    }
  }

  clear() {
    this.active.length = 0;
  }
}
