// CPUのあたま（プレイヤーと同じ「操作」を出して動く）
import * as THREE from 'three';
import { MOVE, COMBAT } from './config.js';
import { OMAMORI } from './characters.js';
import { clamp, wrapAngle, rand } from './util.js';

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _t = new THREE.Vector3();
const UPV = new THREE.Vector3(0, 1, 0);

export class Brain {
  constructor(p, match, role) {
    this.p = p;
    this.m = match;
    this.role = role; // 'collector' | 'dropper' | 'support'
    this.think = rand(0, 0.3);
    this.goal = null; // {pos, kind, obj, arrive}
    this.avoid = null;
    this.avoidT = 0;
    this.stuckT = 0;
    this.lastDist = 1e9;
    this.dodgeCd = 0;
    this.skillCd = rand(0.5, 1.5);
    this.dashCd = 0;
    this.reserve = null;
    this.noise = new THREE.Vector3();
    this.noiseT = 0;
    this.ignore = new Map(); // 取れない物 → いつまで無視するか
    this.holdOffT = 0;
  }
  ignored(o) {
    const t = this.ignore.get(o);
    if (t == null) return false;
    if (t < this.m.time) {
      this.ignore.delete(o);
      return false;
    }
    return true;
  }
  ignoreSet(o, sec) {
    this.ignore.set(o, this.m.time + sec);
  }

  get diff() {
    return this.m.diff;
  }

  update(dt) {
    const p = this.p;
    const I = p.intent;
    I.hold = false;
    I.stickX = 0;
    I.stickY = 0;
    if (!p.alive || this.m.phase !== 'play') return;
    this.think -= dt;
    this.dodgeCd -= dt;
    this.skillCd -= dt;
    this.dashCd -= dt;
    this.avoidT -= dt;
    this.noiseT -= dt;
    if (this.think <= 0) {
      this.think = this.diff.react * rand(0.7, 1.3);
      this.decide();
    }
    this.react(dt);
    if (this.goal) this.steer(dt);
  }

  // ===== 何をするか決める =====
  decide() {
    const p = this.p, M = this.m, mode = M.mode;
    const enemies = M.punchers.filter((o) => o.team !== p.team && o.alive);
    // 近くの敵
    let near = null, nd = 1e9;
    for (const e of enemies) {
      const d = e.pos.distanceTo(p.pos);
      if (d < nd) {
        nd = d;
        near = e;
      }
    }
    const hpLow = p.hp < p.maxHp * 0.35;
    let goal = null;
    if (mode.key === 'scramble') goal = this.decideScramble(enemies, near, nd, hpLow);
    else if (mode.key === 'flag') goal = this.decideFlag(enemies, near, nd, hpLow);
    else goal = this.decideBall(enemies, near, nd, hpLow);
    // 目の前の敵とは戦う（大事な目的の途中は、すぐ近くでねらってくる敵だけ）
    const busy = goal && ['deposit', 'guardian', 'goalrun', 'carry'].includes(goal.kind);
    if (near) {
      const threat = nd < 4.5 && near.lock === p;
      if (!busy && nd < 11 && (this.role !== 'collector' || nd < 5 || near.lock === p)) {
        if (!p.lock || p.lock.isGuardian || p.lock.pos.distanceTo(p.pos) > 18) p.lock = near;
        if (!goal || goal.kind === 'collect' || goal.kind === 'guard' || goal.kind === 'escort') goal = { kind: 'fight', obj: near, arrive: 2.2 };
      } else if (busy && threat && goal.kind !== 'deposit' && Math.random() < 0.5) {
        p.lock = near;
        goal = { kind: 'fight', obj: near, arrive: 2.2 };
      }
    }
    if (goal && goal.kind === 'guardian' && goal.obj && goal.obj.pos.distanceTo(p.pos) < 20) p.lock = goal.obj;
    if (goal && goal.kind !== 'fight' && goal.kind !== 'guardian' && p.lock && !p.lock.isGuardian && p.lock.pos.distanceTo(p.pos) > 16) p.lock = null;
    this.goal = goal;
    this.useSkills(enemies, near, nd, hpLow);
  }

  decideScramble(enemies, near, nd, hpLow) {
    const p = this.p, M = this.m, mode = M.mode;
    const carry = p.carry.sakura.length;
    const own = M.guardians[p.team], foe = M.guardians[1 - p.team];
    const cap = this.role === 'collector' ? 13 : this.role === 'support' ? 8 : 5;
    const late = M.timeLeft < 22;
    if (carry > 0 && (carry >= cap || (hpLow && carry >= 2) || (late && carry >= 4 && p.pos.distanceTo(own.pos) < 60))) {
      return { kind: 'deposit', pos: own.pos, arrive: 7, obj: own };
    }
    // 敵のたくさん持っている人を落とす
    if (this.role !== 'collector' || carry === 0) {
      let rich = null, rv = 0;
      for (const e of enemies) {
        const v = e.carry.sakura.length - e.pos.distanceTo(p.pos) * 0.08;
        if (e.carry.sakura.length >= 4 && v > rv) {
          rv = v;
          rich = e;
        }
      }
      if (rich && (this.role === 'dropper' || rich.pos.distanceTo(p.pos) < 35)) return { kind: 'fight', obj: rich, arrive: 2.2 };
    }
    // ダルマをたたく
    if (this.role === 'dropper' && mode.deposit[foe.team].length >= 4 && carry < 3 && !hpLow) {
      return { kind: 'guardian', obj: foe, pos: foe.pos, arrive: 5 };
    }
    // 自分のダルマを守る
    if (this.role === 'support' && mode.deposit[p.team].length >= 5) {
      for (const e of enemies) if (e.pos.distanceTo(own.pos) < 20) return { kind: 'fight', obj: e, arrive: 2.2 };
    }
    // いちばん近いサクラ（味方とかぶらないように）
    let best = null, bd = 1e9;
    const res = M.aiReserve;
    for (const it of mode.field.items) {
      if (it.state !== 'field' || this.ignored(it)) continue;
      const owner = res.get(it);
      if (owner && owner !== this && owner.p.alive) continue;
      let d = it.pos.distanceTo(p.pos);
      // 敵陣は少し遠く感じる
      if ((p.team === 0 && it.pos.z > 40) || (p.team === 1 && it.pos.z < -40)) d *= 1.3;
      if (d < bd) {
        bd = d;
        best = it;
      }
    }
    if (this.reserve && res.get(this.reserve) === this) res.delete(this.reserve);
    if (best) {
      res.set(best, this);
      this.reserve = best;
      return { kind: 'collect', pos: best.pos, arrive: 0.5, obj: best };
    }
    if (carry > 0) return { kind: 'deposit', pos: own.pos, arrive: 7, obj: own };
    return near ? { kind: 'fight', obj: near, arrive: 2.2 } : null;
  }

  decideFlag(enemies, near, nd, hpLow) {
    const p = this.p, M = this.m, mode = M.mode;
    const mine = mode.flags[p.team], theirs = mode.flags[1 - p.team];
    if (p.carry.flag) {
      if (p.carry.flag.team === p.team) return { kind: 'carry', pos: mode.goals[p.team], arrive: 1 };
      // 敵の旗をうばった：遠くへにげる
      return { kind: 'carry', pos: M.stage.bases[p.team].respawn[0], arrive: 3 };
    }
    // 敵の運び屋をとめる
    if (theirs.state === 'carried' && theirs.carrier && theirs.carrier.team !== p.team && (this.role !== 'collector' || theirs.carrier.pos.distanceTo(p.pos) < 30)) {
      return { kind: 'fight', obj: theirs.carrier, arrive: 2 };
    }
    // 自分の旗を敵が持っている
    if (mine.state === 'carried' && mine.carrier && mine.carrier.team !== p.team) return { kind: 'fight', obj: mine.carrier, arrive: 2 };
    // 自分の旗を取りに行く／味方の運び屋を守る
    if (mine.wait <= 0 && mine.state !== 'carried') {
      const goers = M.punchers.filter((o) => o.team === p.team && o.alive && o.brain && o.brain.goal && o.brain.goal.kind === 'getflag' && o !== p).length;
      if (this.role === 'collector' || goers < 1 || mine.pos.distanceTo(p.pos) < 25) return { kind: 'getflag', pos: mine.pos, arrive: 0.5 };
    }
    if (mine.state === 'carried' && mine.carrier && mine.carrier.team === p.team && mine.carrier !== p) {
      // 運び屋の近くの敵をねらう
      for (const e of enemies) if (e.pos.distanceTo(mine.carrier.pos) < 18) return { kind: 'fight', obj: e, arrive: 2 };
      return { kind: 'escort', obj: mine.carrier, arrive: 6 };
    }
    // 相手の旗のまわりで待ちぶせ
    if (theirs.wait <= 0 && this.role === 'dropper') return { kind: 'guard', pos: theirs.pos, arrive: 8 };
    return near ? { kind: 'fight', obj: near, arrive: 2.2 } : { kind: 'guard', pos: mine.pos, arrive: 8 };
  }

  decideBall(enemies, near, nd, hpLow) {
    const p = this.p, M = this.m, mode = M.mode;
    const foe = 1 - p.team;
    const carry = p.carry.balls.length;
    const hasRapid = p.carry.balls.some((b) => b.rapid);
    const open = mode.goalOpen(foe);
    const ring = mode.rings[foe];
    // ゴールが開いていて、ボールを持っている → くぐる
    if (carry > 0 && open) {
      const side = Math.sign(p.pos.z - ring.pos.z) || -Math.sign(ring.pos.z) || 1;
      const front = ring.pos.clone();
      front.z += side * 7;
      const through = ring.pos.clone();
      through.z -= side * 9;
      const lateral = Math.hypot(p.pos.x - ring.pos.x, p.pos.y - ring.pos.y);
      if (Math.abs(p.pos.z - ring.pos.z) > 5 && lateral > 2.5) return { kind: 'goalrun', pos: front, arrive: 2.5, then: through };
      return { kind: 'goalrun', pos: through, arrive: 1 };
    }
    // ゴールが開いている：近くのボールを拾ってから行く
    if (open) {
      let best = null, bd = 30;
      for (const b of mode.balls) {
        if (b.state !== 'field' || this.ignored(b)) continue;
        const d = b.pos.distanceTo(p.pos);
        if (d < bd) {
          bd = d;
          best = b;
        }
      }
      if (best) return { kind: 'collect', pos: best.pos, arrive: 0.5, obj: best };
    }
    // 自分たちのゴールが開いている：運び屋を止める
    if (mode.goalOpen(p.team)) {
      let carrier = null, cd = 60;
      for (const e of enemies) {
        if (!e.carry.balls.length) continue;
        const d = e.pos.distanceTo(p.pos);
        if (d < cd) {
          cd = d;
          carrier = e;
        }
      }
      if (carrier && (this.role !== 'collector' || cd < 25)) return { kind: 'fight', obj: carrier, arrive: 2 };
    }
    // ボールを持っている人は、相手ゴールの手前で待つ（ダルマが倒れるのを待つ）
    if ((carry >= 2 || hasRapid) && this.role === 'collector') {
      const stage = ring.pos.clone().lerp(new THREE.Vector3(0, 36, 0), 0.32);
      return { kind: 'guard', pos: stage, arrive: 5 };
    }
    // ラピッドボールを追う
    const rapid = mode.balls.find((b) => b.rapid && b.state === 'field');
    if (rapid && rapid.pos.distanceTo(p.pos) < 70 && (this.role === 'collector' || rapid.pos.distanceTo(p.pos) < 30)) return { kind: 'collect', pos: rapid.pos, arrive: 0.5, obj: rapid };
    // 敵の運び屋
    for (const e of enemies) if (e.carry.balls.length >= 2 && e.pos.distanceTo(p.pos) < 35) return { kind: 'fight', obj: e, arrive: 2 };
    // ダルマをたおしに行く
    // （もう倒れていてゴールが開いているなら、たたかずにボールを取りに行く）
    if (!open && this.role !== 'collector' && !hpLow && carry < 2) return { kind: 'guardian', obj: M.guardians[foe], pos: M.guardians[foe].pos, arrive: 5 };
    // ボールを集める
    let best = null, bd = 1e9;
    for (const b of mode.balls) {
      if (b.state !== 'field' || this.ignored(b)) continue;
      const d = b.pos.distanceTo(p.pos);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    if (best) return { kind: 'collect', pos: best.pos, arrive: 0.5, obj: best };
    if (carry > 0) return { kind: 'guard', pos: ring.pos.clone().lerp(new THREE.Vector3(0, 36, 0), 0.32), arrive: 5 };
    return near ? { kind: 'fight', obj: near, arrive: 2.2 } : null;
  }

  // ===== スキルを使う =====
  useSkills(enemies, near, nd, hpLow) {
    const p = this.p, D = this.diff;
    if (this.skillCd > 0 || !p.canAct()) return;
    if (Math.random() > D.skill) {
      this.skillCd = rand(0.8, 1.6);
      return;
    }
    const ev = p.intent.events;
    const target = p.lock && p.lock.alive ? p.lock : null;
    const td = target ? target.pos.distanceTo(p.pos) : 1e9;
    // スペシャル
    if (p.sp >= 1) {
      let n = 0;
      for (const e of enemies) if (e.pos.distanceTo(p.pos) < 13) n++;
      const id = p.def.special.id;
      if ((id === 'roar' && n >= 1) || (id === 'bigEven' && n >= 1 && nd < 9) || (id === 'glassesOff' && (n >= 2 || (n >= 1 && hpLow)))) {
        ev.push({ type: 'special' });
        this.skillCd = 1.5;
        return;
      }
    }
    // 回復
    for (let i = 0; i < p.omamori.length; i++) {
      const om = OMAMORI[p.omamori[i]];
      if (p.omCd[i] > 0) continue;
      const slot = i < 2 ? i : i + 1;
      if (om.kind === 'HEAL' && hpLow) {
        ev.push({ type: 'skill', slot });
        this.skillCd = 1.2;
        return;
      }
      if (om.kind === 'ATK' && target && td < 22 && td > 3) {
        ev.push({ type: 'skill', slot });
        this.skillCd = rand(1.0, 2.2);
        return;
      }
      if (om.kind === 'BUFF' && target && td < 10) {
        ev.push({ type: 'skill', slot });
        this.skillCd = 1.2;
        return;
      }
      if (om.kind === 'TRAP' && near && nd < 8) {
        ev.push({ type: 'skill', slot });
        this.skillCd = 1.2;
        return;
      }
      if (om.id === 'homewarp' && this.goal && this.goal.kind === 'deposit' && p.pos.distanceTo(this.goal.pos) > 70) {
        ev.push({ type: 'skill', slot });
        this.skillCd = 1.2;
        return;
      }
      if ((om.kind === 'MOVE' || om.id === 'warp') && this.goal && this.goal.pos && p.pos.distanceTo(this.goal.pos) > 45 && Math.random() < 0.4) {
        ev.push({ type: 'skill', slot });
        this.skillCd = 1.5;
        return;
      }
    }
    // パンチャースキル
    if (p.ksCd <= 0 && target) {
      const id = p.def.skill.id;
      if ((id === 'tigerRush' && td < 10) || (id === 'goggleDive' && td < 16 && td > 3) || (id === 'flash' && td < 13)) {
        ev.push({ type: 'skill', slot: 2 });
        this.skillCd = 1.0;
        return;
      }
    }
    this.skillCd = rand(0.4, 1.0);
  }

  // ===== その場の反応：よける =====
  react(dt) {
    const p = this.p, D = this.diff;
    if (this.dodgeCd > 0 || !p.canAct()) return;
    for (const e of this.m.punchers) {
      if (e.team === p.team || !e.alive) continue;
      if (e.atk.phase >= 0 && e.atk.phase < 0.2 && e.atk.pending === p) {
        if (Math.random() < D.dodge) {
          const s = Math.random() < 0.5 ? -1 : 1;
          p.intent.events.push({ type: 'flick', dir: { x: s, y: Math.random() < 0.3 ? -0.7 : 0 } });
          this.dodgeCd = 1.2;
          return;
        }
        this.dodgeCd = 0.5;
      }
    }
    // 飛んでくる弾
    for (const pr of this.m.combat.projectiles) {
      if (pr.owner.team === p.team) continue;
      if (pr.pos.distanceToSquared(p.pos) < 36 && Math.random() < D.dodge * 0.6) {
        const s = Math.random() < 0.5 ? -1 : 1;
        p.intent.events.push({ type: 'flick', dir: { x: s, y: 0 } });
        this.dodgeCd = 1.3;
        return;
      }
    }
  }

  // ===== 目的地へ飛ぶ =====
  steer(dt) {
    const p = this.p, g = this.goal, I = p.intent, W = this.m.world;
    let target;
    if (g.obj && g.obj.pos && (g.kind === 'fight' || g.kind === 'escort' || g.kind === 'guardian' || g.kind === 'collect')) target = g.obj.pos;
    else target = g.pos;
    if (!target) return;
    if (g.kind === 'fight' && (!g.obj.alive || g.obj.alive === false)) {
      this.goal = null;
      return;
    }
    _d.subVectors(target, p.pos);
    const dist = _d.length();
    // 到着
    if (dist < (g.arrive || 1)) {
      if (g.then) {
        g.pos = g.then;
        g.then = null;
      } else if (g.kind === 'deposit' || g.kind === 'guard' || g.kind === 'escort') {
        // その場でまわりを見る
        I.stickX = 0.25;
        return;
      }
      if (g.kind === 'fight' || g.kind === 'guardian') {
        // 近くで戦う：少し回りこむ
        if (g.kind === 'guardian' && !p.lock) p.lock = g.obj;
        I.stickX = Math.sin(this.m.time * 1.3 + p.slot) * 0.4;
        return;
      }
    }
    _d.normalize();
    // ぶつかりそうなら、よける向きをさがす
    const look = clamp(p.vel.length() * 1.1, 7, 22);
    if (this.avoidT > 0 && this.avoid) {
      _d.copy(this.avoid);
    } else {
      const h = W.raycast(p.pos, _d, Math.min(look, dist));
      if (h < Math.min(look, dist) - 0.5) {
        const tries = [
          [0.75, 0],
          [0.4, 0.8],
          [0.4, -0.8],
          [0, 1.2],
          [0, -1.2],
          [-0.6, 0],
          [1.3, 0],
        ];
        let found = null;
        const yaw = Math.atan2(_d.x, _d.z), pit = Math.asin(clamp(_d.y, -1, 1));
        for (const [dp, dy] of tries) {
          const pp = clamp(pit + dp, -1.3, 1.3), yy = yaw + dy;
          _v.set(Math.sin(yy) * Math.cos(pp), Math.sin(pp), Math.cos(yy) * Math.cos(pp));
          if (W.raycast(p.pos, _v, look) >= look - 0.5) {
            found = _v.clone();
            break;
          }
        }
        if (found) {
          this.avoid = found;
          this.avoidT = 0.6;
          _d.copy(found);
        }
      }
    }
    // 引っかかったら
    if (dist > this.lastDist - 0.15 * dt * 10 && p.vel.length() < 2 && I.hold) this.stuckT += dt;
    else this.stuckT = Math.max(0, this.stuckT - dt);
    this.lastDist = dist;
    if (this.stuckT > 1.2) {
      this.stuckT = 0;
      this.stuckTotal = (this.stuckTotal || 0) + 1;
      // 同じ物をねらって2回引っかかったら、しばらくあきらめる（島の下のボールなど）
      this.stuckN = (this.stuckN || 0) + 1;
      if (g.obj && this.stuckN >= 2) {
        this.ignoreSet(g.obj, 7);
        this.stuckN = 0;
      }
      this.escape();
    }
    // 同じ場所をねらっているのに、なかなか近づけない（島のふちの下で上の物をねらう、など）
    const wd = this.wd || (this.wd = { tgt: new THREE.Vector3(1e9, 0, 0), best: 1e9, t: 0 });
    if (wd.tgt.distanceToSquared(target) > 9) {
      wd.tgt.copy(target);
      wd.best = dist;
      wd.t = 0;
    } else if (dist < wd.best - 1.2) {
      wd.best = dist;
      wd.t = 0;
    } else wd.t += dt;
    const roam = g.kind === 'fight' || g.kind === 'guard' || g.kind === 'escort' || g.kind === 'guardian';
    if (!roam && wd.t > 3.5 && dist > (g.arrive || 1) + 1.5) {
      wd.t = 0;
      wd.best = dist;
      this.stuckTotal = (this.stuckTotal || 0) + 1;
      this.escape();
      if (g.obj) {
        // しばらく別の物をねらう（すぐに考え直す）
        this.ignoreSet(g.obj, 8);
        this.goal = null;
        this.think = 0;
        return;
      }
    }
    if (this.holdOffT > 0) this.holdOffT -= dt;
    // ぶれ（難しさで変わる）
    if (this.noiseT <= 0) {
      this.noiseT = rand(0.4, 1.0);
      const k = (1 - this.diff.aim) * 0.6;
      this.noise.set(rand(-k, k), rand(-k, k) * 0.5, 0);
    }
    const ty = Math.atan2(_d.x, _d.z) + this.noise.x;
    const tp = Math.asin(clamp(_d.y, -1, 1)) + this.noise.y;
    const ey = wrapAngle(ty - p.yaw);
    const ep = clamp(tp, -MOVE.pitchLimit, MOVE.pitchLimit) - p.pitch;
    // ロック中は自動で向くのでスティックは弱め
    const k = p.lock ? 0.6 : 2.6;
    I.stickX = clamp(-ey * k, -1, 1); // スティック右＝右回り（yaw が減る）
    I.stickY = clamp(ep * k, -1, 1);
    // 大きく向きがちがうときは、止まって向きを変えてから飛ぶ
    const facing = Math.abs(ey) < 1.2 && Math.abs(ep) < 1.0;
    I.hold = facing && dist > (g.arrive || 1) * 0.8 && !(this.holdOffT > 0);
    // 遠いときはブースト
    if (facing && Math.abs(ey) < 0.25 && dist > 30 && p.boost >= 3 && this.dashCd <= 0 && p.state !== 'dash') {
      p.intent.events.push({ type: 'tap' });
      this.dashCd = rand(1.5, 3.5);
    }
    // ダッシュ攻撃
    if (g.kind === 'fight' && p.lock === g.obj && dist < 14 && dist > 5 && p.boost >= 3 && this.dashCd <= 0 && p.def.attack.kind === 'melee' && Math.random() < this.diff.aim * 0.5) {
      p.intent.events.push({ type: 'tap' });
      this.dashCd = rand(2, 4);
    }
  }
}

// 引っかかったときの逃げ道：まわりでいちばんひらけている向きへしばらく飛ぶ
Brain.prototype.escape = function () {
  const p = this.p, W = this.m.world;
  let best = null, bestD = -1;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rand(-0.15, 0.15);
    const pit = [-0.45, 0, 0.55, 1.1][i % 4];
    _t.set(Math.sin(a) * Math.cos(pit), Math.sin(pit), Math.cos(a) * Math.cos(pit));
    const d = W.raycast(p.pos, _t, 26);
    if (d > bestD + 0.5) {
      bestD = d;
      best = _t.clone();
    }
  }
  this.avoid = best || new THREE.Vector3(rand(-1, 1), 0.3, rand(-1, 1)).normalize();
  this.avoidT = 1.3;
  this.holdOffT = 0;
};

export function assignRoles(team) {
  // スピード→集める、アタック→落とす、サポート→守る。かぶったら順番に
  const roles = [];
  const want = { speed: 'collector', attack: 'dropper', support: 'support' };
  const left = ['collector', 'dropper', 'support', 'collector'];
  for (const p of team) {
    let r = want[p.def.type];
    if (roles.filter((x) => x === r).length >= 2) r = left.find((x) => !roles.includes(x)) || 'collector';
    roles.push(r);
  }
  return roles;
}
