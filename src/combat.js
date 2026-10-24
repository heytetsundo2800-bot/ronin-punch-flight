// こうげき・ダメージ・飛び道具
import * as THREE from 'three';
import { COMBAT, elemMul, MOVE } from './config.js';
import { clamp } from './util.js';
import { slowOn } from './kits.js';

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
    // CPUの強さ（v1.7）：いちばん弱いCPUは攻撃しない
    const lv = p.cpu ? p.cpuLv : null;
    if (lv && lv.atk === false) return;
    // ねらう相手（近くにいなければ、遠くを撃てるキャラは遠くの敵へ撃つ）
    const target = this.pickTarget(p);
    if (!target) {
      const far = atkDef.shot ? this.pickShotTarget(p) : null;
      if (far) this.startShot(p, far, lv);
      return;
    }
    A.shotNow = false;
    const idx = A.combo % atkDef.dmg.length;
    // 弱いCPUは、攻撃と攻撃のあいだが長い
    const gap = atkDef.gap[idx] * (p.buffs.ikemen > 0 ? 0.75 : 1) * (lv && lv.atkRate ? lv.atkRate : 1);
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

  // 遠くを撃つ相手：ロックオンした敵（とどけば）か、前にいていちばん近い敵。間に壁があれば撃たない
  pickShotTarget(p) {
    const S = p.def.attack.shot;
    const L = p.lock;
    if (L && L.alive !== false && (!L.attackable || L.attackable())) {
      const d = L.pos.distanceTo(p.pos);
      if (d <= S.range + (L.radius || 0.8) && this.clearShot(p, L, d)) return L;
    }
    let best = null, bestS = 1e9;
    for (const t of this.targetsFor(p)) {
      _v.subVectors(t.pos, p.pos);
      const d = _v.length();
      if (d > S.range + (t.radius || 0.8) || d < 0.5) continue;
      const dot = _v.dot(p.forward) / d;
      if (dot < 0.86) continue;
      if (!this.clearShot(p, t, d)) continue;
      const sc = d - dot * 6 + (t.isGuardian ? 8 : 0);
      if (sc < bestS) {
        bestS = sc;
        best = t;
      }
    }
    return best;
  }
  clearShot(p, t, d) {
    _v2.subVectors(t.pos, p.pos).normalize();
    const r = t.radius || 0.8;
    return this.match.world.raycast(p.pos, _v2, d - r) >= d - r - 0.5;
  }
  // 遠くへ撃つ（てつんどのビートショット）。近くの連打とは別に数える
  startShot(p, t, lv) {
    const A = p.atk, S = p.def.attack.shot;
    const i = (A.shotN || 0) % S.dmg.length;
    A.shotN = (A.shotN || 0) + 1;
    const gap = S.gap[i] * (p.buffs.ikemen > 0 ? 0.75 : 1) * (lv && lv.atkRate ? lv.atkRate : 1);
    A.cd = gap;
    A.dur = Math.min(gap * 0.95, 0.34);
    A.phase = 0;
    A.shotNow = true;
    A.pending = null;
    A.hitIdx = i;
    A.heavy = i === S.heavyAt;
    A.side = A.side === 1 ? 0 : 1;
    this.shootAlt(p, t, i);
  }
  shootAlt(p, t, i) {
    const S = p.def.attack.shot;
    const sp = S.projSpeed || 48;
    _v.copy(t.pos);
    const d = t.pos.distanceTo(p.pos);
    if (t.vel) _v.addScaledVector(t.vel, (d / sp) * 0.6);
    _v.sub(p.pos).normalize();
    const start = p.pos.clone().addScaledVector(p.forward, 0.9);
    start.y += 0.35;
    const heavy = i === S.heavyAt;
    this.spawnProjectile({
      owner: p,
      pos: start,
      vel: _v.clone().multiplyScalar(sp),
      dmg: S.dmg[i] * p.def.atk,
      radius: (S.radius || 0.6) * (heavy ? 1.35 : 1),
      life: (S.range + 6) / sp,
      kind: S.proj || 'ink',
      opts: { elem: true, kind: 'normal', knock: heavy ? 8 : 2.5, heavy },
      homing: t,
      turn: S.turn || 2.6,
      big: heavy,
      spin: 18,
    });
    this.match.sfx('shot', p);
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
    const A = p.def.attack;
    const sp = A.projSpeed || 40;
    // 少し先を読んでねらう
    _v.copy(t.pos);
    const d = t.pos.distanceTo(p.pos);
    if (t.vel) _v.addScaledVector(t.vel, (d / sp) * 0.6);
    // 重さのある弾（ゲロ・ボール）は、山なりに少し上をねらう
    if (A.gravity) _v.y += 0.5 * A.gravity * (d / sp) * (d / sp);
    _v.sub(p.pos).normalize();
    const start = p.pos.clone().addScaledVector(p.forward, 0.9);
    start.y += 0.3;
    const heavy = A.heavyAt != null && p.atk.hitIdx === A.heavyAt;
    const pr = {
      owner: p,
      pos: start,
      vel: _v.clone().multiplyScalar(sp),
      dmg: base * p.def.atk,
      radius: (A.radius || 0.55) * (heavy ? 1.4 : 1),
      life: (A.range + 4) / sp,
      kind: A.proj || 'ink',
      opts: { elem: true, kind: 'normal', knock: heavy ? 9 : 2.5, heavy },
      homing: A.gravity ? null : t,
      turn: A.turn || 2.2,
      gravity: A.gravity || 0,
      big: heavy,
    };
    // 当たるとおそくなる弾（ゲロ・くしゃみ）
    if (A.splashSlow) {
      pr.onHit = (q, tt) => {
        if (this.damage(q.owner, tt, q.dmg, { ...q.opts, dir: _v.copy(q.vel).normalize().clone() }) > 0) slowOn(tt, A.splashSlow, 1.2);
      };
    }
    this.spawnProjectile(pr);
    this.match.sfx(A.proj === 'voice' ? 'voice' : 'shot', p);
  }

  // ===== ダメージの計算 =====
  // opts: {elem, kind, heavy, dir, knock, stun, cancel, melee, noJust, fixed}
  damage(src, t, base, opts = {}) {
    const M = this.match;
    if (!t || (t.alive === false)) return 0;
    // ダルマへのダメージも、CPUの強さに合わせる（v1.7）
    if (t.isGuardian) return t.takeDamage(src, src && src.cpu && src.cpuLv ? base * src.cpuLv.dmg : base, opts);
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
    // 技・相性の効果（攻撃力アップ／受けるダメージの増減）
    if (src && src.modAtk) dmg *= Math.max(0.3, 1 + src.modAtk);
    if (t.modDef) dmg *= Math.max(0.35, 1 + t.modDef);
    // CPUの強さ（1人ずつ。敵のダルマの弾は guardK）
    if (src && src.cpu && src.cpuLv) dmg *= src.cpuLv.dmg;
    else if (src && src.cpu && M.diff) dmg *= M.diff.dmg;
    if (dmg <= 0 && src && src.cpu) return 0;
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
    if (M.skills.onDamaged) M.skills.onDamaged(t, src, dmg, opts);
    // ディスクの溜め中ならキャンセル
    let cc = null;
    if (t.charge && (opts.cancel || opts.kind === 'disk' || opts.kind === 'ks' || opts.kind === 'special' || opts.heavy)) {
      M.fx.chargeBreak && M.fx.chargeBreak(t);
      t.omCd[t.charge.slot] = Math.max(t.omCd[t.charge.slot] * 0.5, 2);
      cc = { slot: t.charge.slot, cd: t.omCd[t.charge.slot] };
      t.charge = null;
    }
    // ひるみ・ふっとび（巨大化・ブチギレ中はひるまない）
    const big = t.buffs.big > 0 || t.armor;
    let kv = null, stunV = 0, hurtV = 0;
    if (opts.knock && opts.dir && !big) {
      t.vel.addScaledVector(opts.dir, opts.knock);
      kv = opts.dir.clone().multiplyScalar(opts.knock);
    }
    if (opts.stun && !big) {
      t.stunT = Math.max(t.stunT, opts.stun);
      t.dash = null;
      if (t.state === 'dash' || t.state === 'cruise' || t.state === 'fly') t.state = 'hover';
      stunV = opts.stun;
    } else if (!big && opts.kind !== 'dot') {
      hurtV = opts.heavy ? 0.3 : 0.14;
      t.hurtT = Math.max(t.hurtT, hurtV);
    }
    // オンライン対戦：ほかの端末で動かしている人には、ふっとび・ひるみを知らせる
    if (t.remote && M.netHit) M.netHit(t, { k: kv, s: stunV, h: hurtV, cc });
    // （おなかのギュルル などの小さな止まり＝soft では、持ち物を落とさない）
    if ((opts.heavy || opts.stun > 0.3) && !big && !opts.soft) M.mode.onKnock && M.mode.onKnock(t, src);
    M.fx.hit && M.fx.hit(t, src, dmg, { weak, heavy: opts.heavy, kind: opts.kind });
    M.sfx(opts.heavy ? 'hitHeavy' : 'hit', t, src);
    M.hitFeedback(t, src, !!opts.heavy, !!opts.melee, opts.stun || 0);
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
    M.justFeedback(t);
    if (src && src.stunT != null && opts.melee) {
      src.stunT = Math.max(src.stunT, 0.8);
      src.atk.phase = -1;
      src.atk.pending = null;
      if (src.remote && M.netHit) M.netHit(src, { s: 0.8, ap: 1 });
    }
  }

  heal(t, v) {
    t.heal(v);
  }

  // ===== 飛び道具 =====
  spawnProjectile(o) {
    o.age = 0;
    o.nid = this.nid = ((this.nid || 0) + 1) & 0xffff;
    o.hitSet = new Set();
    o.mesh = this.match.fx.projectileMesh ? this.match.fx.projectileMesh(o) : null;
    this.projectiles.push(o);
    return o;
  }

  addArea(o) {
    o.age = 0;
    o.nid = this.nid = ((this.nid || 0) + 1) & 0xffff;
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
        if (a.mesh) this.match.fx.disposeArea ? this.match.fx.disposeArea(a.mesh) : a.mesh.parent && a.mesh.parent.remove(a.mesh);
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
