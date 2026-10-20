// こうげき・ダメージ・飛び道具
import * as THREE from 'three';
import { COMBAT, elemMul, MOVE } from './config.js';
import { clamp } from './util.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class Combat {
  constructor(match) {
    this.match = match;
    this.projectiles = [];
    this.areas = [];
  }

  // 攻撃できる相手（パンチャー＋攻撃できるダルマ）
  targetsFor(p) {
    const out = this._t || (this._t = []);
    out.length = 0;
    for (const o of this.match.punchers) if (o.team !== p.team && o.alive) out.push(o);
    for (const g of this.match.guardians) if (g.team !== p.team && g.attackable()) out.push(g);
    return out;
  }

  autoAttack(p, dt) {
    const A = p.atk;
    A.cd -= dt;
    A.comboT -= dt;
    if (A.comboT <= 0) A.combo = 0;
    const atkDef = p.def.attack;
    if (A.phase >= 0) {
      A.phase += dt / A.dur;
      // パンチが当たる瞬間
      if (A.pending && A.phase >= 0.32) {
        const t = A.pending;
        A.pending = null;
        if (t.alive !== false && (t.attackable ? t.attackable() : true)) {
          const reach = atkDef.range + (t.radius || 0.8) + 0.9 + (p.buffs.big > 0 ? 2.5 : 0);
          if (t.pos.distanceTo(p.pos) <= reach) this.meleeHit(p, t, A.hitIdx);
        }
        // ビッグエブンは周りにも当たる
        if (p.buffs.big > 0) this.bigSplash(p, t);
      }
      if (A.phase >= 1) A.phase = -1;
    }
    if (!p.canAct() || p.charge || p.state === 'dash' || p.state === 'uturn' || p.state === 'step' || p.state === 'special') return;
    if (A.cd > 0 || A.phase >= 0) return;
    // ねらう相手
    const target = this.pickTarget(p);
    if (!target) return;
    const idx = A.combo % atkDef.dmg.length;
    const gap = atkDef.gap[idx] * (p.buffs.ikemen > 0 ? 0.75 : 1);
    A.cd = gap;
    A.dur = Math.min(gap * 0.95, 0.42);
    A.phase = 0;
    A.hitIdx = idx;
    A.heavy = idx === atkDef.heavyAt;
    A.side = A.side === 1 ? 0 : 1;
    A.combo++;
    A.comboT = 0.95;
    if (atkDef.kind === 'melee') {
      A.pending = target;
      // 相手へ少し踏みこむ
      _v.subVectors(target.pos, p.pos);
      const d = _v.length();
      if (d > 1.6) p.vel.addScaledVector(_v.normalize(), Math.min(9, d * 3));
      this.match.sfx(A.heavy ? 'swingHeavy' : 'swing', p);
    } else {
      this.shoot(p, target, atkDef.dmg[idx]);
    }
  }

  pickTarget(p) {
    const atkDef = p.def.attack;
    const range = atkDef.range + (p.buffs.big > 0 ? 2.5 : 0);
    const L = p.lock;
    if (L && L.alive) {
      const d = L.pos.distanceTo(p.pos);
      if (d <= range + (L.radius || 0.8)) return L;
    }
    let best = null, bestD = 1e9;
    const cone = atkDef.kind === 'melee' ? COMBAT.autoCone : 0.8;
    for (const t of this.targetsFor(p)) {
      _v.subVectors(t.pos, p.pos);
      const d = _v.length();
      const r = range + (t.radius || 0.8);
      if (d > r) continue;
      const dot = d > 0.01 ? _v.dot(p.forward) / d : 1;
      if (dot < cone && d > 2.2) continue;
      // 遠くを撃つときは間に壁がないか
      if (atkDef.kind !== 'melee' && d > 6) {
        _v.normalize();
        const hit = this.match.world.raycast(p.pos, _v, d - (t.radius || 0.8));
        if (hit < d - (t.radius || 0.8) - 0.5) continue;
      }
      const score = d - dot * 2 + (t.isGuardian ? 6 : 0);
      if (score < bestD) {
        bestD = score;
        best = t;
      }
    }
    return best;
  }

  meleeHit(p, t, idx) {
    const atkDef = p.def.attack;
    const heavy = idx === atkDef.heavyAt;
    const dmg = atkDef.dmg[idx] * p.def.atk;
    _v.subVectors(t.pos, p.pos).normalize();
    this.damage(p, t, dmg, { elem: true, kind: 'normal', heavy, dir: _v.clone(), knock: heavy ? COMBAT.knockback : 3.5, stun: heavy ? COMBAT.stunHeavy : 0, melee: true });
  }

  bigSplash(p, main) {
    for (const t of this.targetsFor(p)) {
      if (t === main) continue;
      if (t.pos.distanceTo(p.pos) < 5.5) {
        _v.subVectors(t.pos, p.pos).normalize();
        this.damage(p, t, 160 * p.def.atk, { elem: true, kind: 'normal', heavy: true, dir: _v.clone(), knock: 14, stun: 0.3 });
      }
    }
  }

  dashHit(p, t) {
    const atkDef = p.def.attack;
    _v.subVectors(t.pos, p.pos).normalize();
    this.damage(p, t, atkDef.dmg[0] * p.def.atk * COMBAT.dashAttackBonus * 1.4, { elem: true, kind: 'dash', heavy: true, dir: _v.clone(), knock: 19, stun: 0.5, cancel: true, melee: true });
    this.match.fx.shock && this.match.fx.shock(t.pos, 0xffffff, 3.5);
  }

  shoot(p, t, base) {
    const sp = p.def.attack.projSpeed || 40;
    // 少し先を読んでねらう
    _v.copy(t.pos);
    const d = t.pos.distanceTo(p.pos);
    if (t.vel) _v.addScaledVector(t.vel, (d / sp) * 0.6);
    _v.sub(p.pos).normalize();
    const start = p.pos.clone().addScaledVector(p.forward, 0.9);
    start.y += 0.3;
    this.spawnProjectile({
      owner: p,
      pos: start,
      vel: _v.clone().multiplyScalar(sp),
      dmg: base * p.def.atk,
      radius: 0.55,
      life: (p.def.attack.range + 4) / sp,
      kind: 'ink',
      opts: { elem: true, kind: 'normal', knock: 2.5 },
      homing: t,
      turn: 2.2,
    });
    this.match.sfx('shot', p);
  }

  // ===== ダメージの計算 =====
  // opts: {elem, kind, heavy, dir, knock, stun, cancel, melee, noJust, fixed}
  damage(src, t, base, opts = {}) {
    const M = this.match;
    if (!t || (t.alive === false)) return 0;
    if (t.isGuardian) return t.takeDamage(src, base, opts);
    if (t.invuln > 0 || t.state === 'special') {
      if (t.justT > 0 && (t.state === 'step' || t.state === 'roll') && !opts.noJust) this.justDodge(t, src, opts);
      else M.fx.miss && M.fx.miss(t);
      return 0;
    }
    // ジャスト回避：フリックの直後に攻撃が来た
    if (t.justT > 0 && (t.state === 'step' || t.state === 'roll') && !opts.noJust) {
      this.justDodge(t, src, opts);
      return 0;
    }
    let dmg = base;
    let weak = false;
    if (opts.elem && src && src.elem) {
      const m = elemMul(src.elem, t.elem);
      dmg *= m;
      weak = m > 1.01;
    }
    if (src && src.buffs && src.buffs.atkT > 0) dmg *= 1 + src.buffs.atk;
    if (src && src.buffs && src.buffs.ikemen > 0) dmg *= 1.5;
    if (src && src.isPlayer === false && M.diff) dmg *= M.diff.dmg;
    if (t.buffs.big > 0) dmg *= 0.5;
    dmg = Math.round(dmg);
    // バリア
    if (t.buffs.shield > 0) {
      const a = Math.min(t.buffs.shield, dmg);
      t.buffs.shield -= a;
      dmg -= a;
      M.fx.shieldHit && M.fx.shieldHit(t);
      if (dmg <= 0) return 0;
    }
    t.hp -= dmg;
    t.lastHitBy = src;
    t.lastHitT = M.time;
    if (src && src.stats) {
      src.stats.dmg += dmg;
      if (opts.kind === 'normal' || opts.kind === 'dash') src.stats.hits++;
      src.addSP(dmg * COMBAT.specialPerDamage);
      src.lastAssist = t;
      src.lastAssistT = M.time;
    }
    t.addSP(dmg * COMBAT.specialPerDamage * 0.35);
    // ディスクの溜め中ならキャンセル
    if (t.charge && (opts.cancel || opts.kind === 'disk' || opts.kind === 'ks' || opts.kind === 'special' || opts.heavy)) {
      M.fx.chargeBreak && M.fx.chargeBreak(t);
      t.omCd[t.charge.slot] = Math.max(t.omCd[t.charge.slot] * 0.5, 2);
      t.charge = null;
    }
    // ひるみ・ふっとび
    const big = t.buffs.big > 0;
    if (opts.knock && opts.dir && !big) {
      t.vel.addScaledVector(opts.dir, opts.knock);
    }
    if (opts.stun && !big) {
      t.stunT = Math.max(t.stunT, opts.stun);
      t.dash = null;
      if (t.state === 'dash' || t.state === 'cruise' || t.state === 'fly') t.state = 'hover';
    } else if (!big && opts.kind !== 'dot') {
      t.hurtT = Math.max(t.hurtT, opts.heavy ? 0.3 : 0.14);
    }
    if ((opts.heavy || opts.stun > 0.3) && !big) M.mode.onKnock && M.mode.onKnock(t, src);
    M.fx.hit && M.fx.hit(t, src, dmg, { weak, heavy: opts.heavy, kind: opts.kind });
    M.sfx(opts.heavy ? 'hitHeavy' : 'hit', t, src);
    if (src && (src.isPlayer || t.isPlayer) && (opts.melee || opts.heavy)) M.hitStop(opts.heavy ? COMBAT.hitStop * 1.6 : COMBAT.hitStop);
    if (t.hp <= 0) {
      t.hp = 0;
      M.ko(t, src);
    }
    return dmg;
  }

  justDodge(t, src, opts) {
    const M = this.match;
    t.justT = 0;
    t.invuln = Math.max(t.invuln, 0.35);
    t.addSP(0.06);
    M.fx.just && M.fx.just(t);
    M.sfx('just', t);
    if (src && src.stunT != null && opts.melee) {
      src.stunT = Math.max(src.stunT, 0.8);
      src.atk.phase = -1;
      src.atk.pending = null;
    }
    if (t.isPlayer) M.slowmo(0.35, 0.35);
  }

  heal(t, v) {
    t.heal(v);
  }

  // ===== 飛び道具 =====
  spawnProjectile(o) {
    o.age = 0;
    o.hitSet = new Set();
    o.mesh = this.match.fx.projectileMesh ? this.match.fx.projectileMesh(o) : null;
    this.projectiles.push(o);
    return o;
  }

  addArea(o) {
    o.age = 0;
    o.mesh = this.match.fx.areaMesh ? this.match.fx.areaMesh(o) : null;
    this.areas.push(o);
    return o;
  }

  update(dt) {
    const W = this.match.world;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.age += dt;
      // 追いかける
      if (pr.homing && pr.homing.alive !== false && (!pr.homing.attackable || pr.homing.attackable())) {
        _v.subVectors(pr.homing.pos, pr.pos);
        const d = _v.length();
        if (d > 0.01) {
          const sp = pr.vel.length();
          _v.multiplyScalar(sp / d);
          const k = 1 - Math.exp(-(pr.turn || 2) * dt);
          pr.vel.lerp(_v, k).setLength(sp);
        }
      }
      if (pr.boomerang) {
        // 行って帰ってくる
        if (pr.age > pr.boomerang.out) {
          _v.subVectors(pr.owner.pos, pr.pos);
          const d = _v.length();
          if (d < 1.5 || pr.age > pr.life) {
            this.removeProj(i);
            continue;
          }
          pr.vel.lerp(_v.normalize().multiplyScalar(pr.boomerang.speed), 1 - Math.exp(-6 * dt));
          if (pr.age - pr.boomerang.out > 0.05 && !pr.back) {
            pr.back = true;
            pr.hitSet.clear();
          }
        }
      }
      const step = pr.vel.length() * dt;
      _v2.copy(pr.vel).normalize();
      if (!pr.ghost) {
        const h = W.raycast(pr.pos, _v2, step + pr.radius * 0.5);
        if (h < step + pr.radius * 0.5) {
          pr.pos.addScaledVector(_v2, h);
          if (pr.boomerang && !pr.back) {
            pr.age = pr.boomerang.out + 0.01;
          } else {
            this.explode(pr);
            this.removeProj(i);
            continue;
          }
        }
      }
      pr.pos.addScaledVector(pr.vel, dt);
      if (pr.gravity) pr.vel.y -= pr.gravity * dt;
      // 当たり
      let done = false;
      for (const t of this.targetsFor(pr.owner)) {
        if (pr.hitSet.has(t)) continue;
        const r = pr.radius + (t.radius || 0.8);
        if (t.pos.distanceToSquared(pr.pos) <= r * r) {
          pr.hitSet.add(t);
          _v.copy(pr.vel).normalize();
          if (pr.onHit) pr.onHit(pr, t);
          else this.damage(pr.owner, t, pr.dmg, { ...pr.opts, dir: _v.clone() });
          if (pr.aoe) this.explode(pr, t);
          if (!pr.pierce) {
            done = true;
            break;
          }
        }
      }
      if (done || pr.age >= pr.life) {
        if (!done && pr.aoe && !pr.boomerang) this.explode(pr);
        this.removeProj(i);
        continue;
      }
      if (pr.mesh) {
        pr.mesh.position.copy(pr.pos);
        if (pr.spin) pr.mesh.rotation.y += pr.spin * dt;
        else pr.mesh.lookAt(_v.copy(pr.pos).add(pr.vel));
      }
    }
    // 罠・結界
    for (let i = this.areas.length - 1; i >= 0; i--) {
      const a = this.areas[i];
      a.age += dt;
      if (a.update) a.update(a, dt);
      if (a.age >= a.life || a.dead) {
        if (a.mesh) a.mesh.parent && a.mesh.parent.remove(a.mesh);
        if (a.onEnd) a.onEnd(a);
        this.areas.splice(i, 1);
      }
    }
  }

  explode(pr, except) {
    if (!pr.aoe) {
      this.match.fx.puff && this.match.fx.puff(pr.pos, pr.color || 0xffffff);
      return;
    }
    const A = pr.aoe;
    this.match.fx.boom && this.match.fx.boom(pr.pos, A.color || 0xff7a3d, A.r);
    this.match.sfx('boom', null, null, pr.pos);
    for (const t of this.targetsFor(pr.owner)) {
      if (t === except) continue;
      const d = t.pos.distanceTo(pr.pos);
      if (d <= A.r + (t.radius || 0.8)) {
        _v.subVectors(t.pos, pr.pos).normalize();
        this.damage(pr.owner, t, A.dmg, { kind: 'disk', dir: _v.clone(), knock: A.knock || 8, stun: A.stun || 0, heavy: !!A.stun, noJust: false });
      }
    }
  }

  removeProj(i) {
    const pr = this.projectiles[i];
    if (pr.mesh && pr.mesh.parent) pr.mesh.parent.remove(pr.mesh);
    this.projectiles.splice(i, 1);
  }

  clear() {
    for (const pr of this.projectiles) if (pr.mesh && pr.mesh.parent) pr.mesh.parent.remove(pr.mesh);
    for (const a of this.areas) if (a.mesh && a.mesh.parent) a.mesh.parent.remove(a.mesh);
    this.projectiles.length = 0;
    this.areas.length = 0;
  }
}
