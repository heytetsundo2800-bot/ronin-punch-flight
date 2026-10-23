// スキル：パンチャースキル（KS）・スペシャル（SS）・ディスク（モンスターの技）
import * as THREE from 'three';
import { OMAMORI } from './characters.js';
import { monsterMouth } from './monsters.js';
import { MOVE, COMBAT } from './config.js';
import { clamp } from './util.js';
import { useKit, fireKit, updateKit, onModEnd, onBigEnd, onDamaged, onKO, kitSkillName, burnOn, slowOn, dropHalf } from './kits.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const CHARGE = { ATK: 0.85, HEAL: 0.75, BUFF: 0.65, TRAP: 0.95, WARP: 0.8, MOVE: 0.45 };
// タイプごとの得意（発動が早い）
const AFFINITY = {
  attack: { ATK: 0.85, TRAP: 1.2 },
  speed: { MOVE: 0.8, WARP: 0.85, HEAL: 1.15 },
  support: { HEAL: 0.75, BUFF: 0.8, ATK: 1.1 },
  power: { BUFF: 0.8, HEAL: 0.9, MOVE: 1.15 },
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
    M.fx.skillName && M.fx.skillName(p, kitSkillName(p));
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
    // v1.5 の仲間の技（kits.js）
    return useKit(this, p);
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
    } else fireKit(this, p);
  }
  endBig(p) {
    p.buffs.big = 0;
    onBigEnd(this, p);
  }
  // 技の効き目が切れたとき・ダメージを受けたとき・倒されたとき（kits.js）
  onModEnd(p, tag) {
    onModEnd(this, p, tag);
  }
  onDamaged(t, src, dmg, opts) {
    onDamaged(this, t, src, dmg, opts);
  }
  onKO(victim, killer) {
    onKO(this, victim, killer);
  }
  endIkemen(p) {
    p.buffs.ikemen = 0;
    if (p.model.userData.glasses) p.model.userData.glasses.visible = true;
  }

  // モンスターの口（技が出るところ）から、ねらう方向
  mouthAim(p, om, out) {
    const o = monsterMouth(p, om.mon, new THREE.Vector3());
    // キャラとモンスターのあいだに壁があるときは、キャラの前から出す
    _v2.subVectors(o, p.pos);
    const d = _v2.length();
    if (d > 0.01 && this.match.world && this.match.world.raycast) {
      _v2.divideScalar(d);
      if (this.match.world.raycast(p.pos, _v2, d + 0.6) < d + 0.4) o.copy(p.pos).addScaledVector(p.forward, 1.2);
    }
    const L = p.lock && p.lock.alive ? p.lock : this.match.combat.pickTarget(p);
    if (L) out.subVectors(L.pos, o).normalize();
    else out.copy(p.forward);
    return { o, t: L || null };
  }

  // ===== ディスク（モンスターがキャラの横に出て、技を出す）=====
  fireOmamori(p, id, slot) {
    const M = this.match;
    const om = OMAMORI[id];
    if (!p.alive) return;
    M.fx.skillName && M.fx.skillName(p, om.move || om.name, om);
    M.fx.summonAct && M.fx.summonAct(p, id);
    p.stats.om++;
    const lv = (p.omLv && p.omLv[slot]) || 1;
    const atk = p.def.atk * (1 + (lv - 1) * 0.08);
    switch (id) {
      case 'akahon': {
        const { o, t } = this.mouthAim(p, om, _v);
        M.combat.spawnProjectile({
          owner: p,
          pos: o,
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
        const { o } = this.mouthAim(p, om, _v);
        M.combat.spawnProjectile({
          owner: p,
          pos: o,
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
        const { o, t } = this.mouthAim(p, om, _v);
        M.combat.spawnProjectile({
          owner: p,
          pos: o,
          vel: _v.clone().multiplyScalar(58),
          dmg: 340 * atk,
          radius: 0.6,
          life: 0.75,
          kind: 'pencil',
          homing: t,
          turn: 1.2,
          opts: { kind: 'disk', heavy: true, knock: 10, stun: 0.35 },
          // 学食カレー：当たるとやけど
          onHit: (q, tt) => {
            if (M.combat.damage(q.owner, tt, q.dmg, { ...q.opts, dir: _v2.copy(q.vel).normalize().clone() }) > 0) burnOn(tt, q.owner, 50 * atk, 2.5);
          },
        });
        M.sfx('missile', p);
        break;
      }
      case 'cookie': {
        // うんち出る出るクッキー：山なりに投げる。当たるとおなかがゆるくなる
        const { o, t } = this.mouthAim(p, om, _v);
        const sp = 30, g = 14;
        if (t) {
          // 山なりで届くように、少し上をねらう（落ちる分）
          const d = t.pos.distanceTo(o);
          _v.y += (0.5 * g * d) / (sp * sp);
          _v.normalize();
        }
        M.combat.spawnProjectile({
          owner: p,
          pos: o,
          vel: _v.clone().multiplyScalar(sp),
          dmg: 190 * atk,
          radius: 0.9,
          life: 2.4,
          kind: 'cookie',
          gravity: g,
          spin: 9,
          opts: { kind: 'disk', knock: 5, stun: 0.3 },
          onHit: (q, tt) => {
            const d = M.combat.damage(q.owner, tt, q.dmg, { ...q.opts, dir: _v2.copy(q.vel).normalize().clone() });
            if (d > 0 && !tt.isGuardian && tt.alive) {
              tt.poopT = Math.max(tt.poopT || 0, 6.5);
              tt.poopTick = Math.min(tt.poopTick || 0.7, 0.7);
              tt.poopSrc = q.owner;
              M.fx.say && M.fx.say(tt, 'ギュルル…', 'poop', 1.4);
            }
          },
        });
        M.sfx('boomerang', p);
        break;
      }
      case 'drink':
        p.heal(p.maxHp * 0.3);
        M.fx.healFx && M.fx.healFx(p);
        M.fx.say && M.fx.say(p, 'アイスどうぞ〜', 'heal');
        M.sfx('heal', p);
        break;
      case 'eki': {
        // 駅で助ける先生：いちばんHPが少ない味方（自分も）を助ける
        let best = p, bv = p.hp / p.maxHp;
        for (const a of M.punchers) {
          if (a.team !== p.team || !a.alive || a.pos.distanceTo(p.pos) > 32) continue;
          const v = a.hp / a.maxHp;
          if (v < bv) {
            bv = v;
            best = a;
          }
        }
        best.heal(best.maxHp * 0.35 * (1 + (lv - 1) * 0.08));
        best.buffs.shield = Math.max(best.buffs.shield || 0, 300);
        best.buffs.shieldT = Math.max(best.buffs.shieldT || 0, 4);
        M.fx.healFx && M.fx.healFx(best);
        M.fx.buffFx && M.fx.buffFx(best, 0x7ad0ff);
        M.fx.say && M.fx.say(p, '大丈夫ですか？大丈夫じゃないですよね！', 'heal', 1.6);
        M.sfx('heal', p);
        break;
      }
      case 'mameta': {
        // まめた：なんでも食べる。クッキーがデッキにあると2倍
        const dbl = p.omamori.includes('cookie');
        p.heal(p.maxHp * (dbl ? 0.4 : 0.2) * (1 + (lv - 1) * 0.08));
        M.fx.healFx && M.fx.healFx(p);
        M.fx.say && M.fx.say(p, dbl ? 'クッキーもぐもぐ！（2倍）' : 'もぐもぐ', 'eat', 1.3);
        M.sfx('heal', p);
        break;
      }
      case 'ramen':
        // 学食ラーメン大盛り：たくさん回復、おなかいっぱいで少しおそく
        p.heal(p.maxHp * 0.45 * (1 + (lv - 1) * 0.08));
        slowOn(p, 0.25, 3);
        M.fx.healFx && M.fx.healFx(p);
        M.fx.say && M.fx.say(p, '大盛りいただきます！', 'noodle', 1.3);
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
        // 駅伝カントク：近くの味方みんなのやる気アップ
        for (const a of M.punchers) {
          if (a.team !== p.team || !a.alive || (a !== p && a.pos.distanceTo(p.pos) > 30)) continue;
          a.addMod('kantoku', { atk: 0.2 * (1 + (lv - 1) * 0.08), spd: 0.15 }, 6);
          M.fx.buffFx && M.fx.buffFx(a, 0xff5a3d);
        }
        M.fx.say && M.fx.say(p, '大作戦、発動！', 'fire', 1.4);
        M.sfx('buff', p);
        break;
      case 'coffee':
        // ロケッツ・ライブ：スピードアップ＋ブースト。近くの味方も少し速く。てつんどは攻撃力も
        p.buffs.spd = 0.3;
        p.buffs.spdT = 6;
        p.boost = Math.min(6, p.boost + 2);
        if (p.def.id === 'tetsundo') p.addMod('rockets', { atk: 0.25 }, 6);
        for (const a of M.punchers) {
          if (a.team !== p.team || !a.alive || a === p || a.pos.distanceTo(p.pos) > 12) continue;
          a.addMod('live', { spd: 0.15 }, 4);
          M.fx.buffFx && M.fx.buffFx(a, 0x5ad7ff);
        }
        M.fx.buffFx && M.fx.buffFx(p, 0x5ad7ff);
        M.fx.notes && M.fx.notes(p, 5);
        M.fx.say && M.fx.say(p, p.def.id === 'tetsundo' ? 'ロケッツ、いくぞ！' : '♪ロケッツ♪', 'note', 1.3);
        M.sfx('drum', p);
        break;
      case 'shield':
        // 楽器の先生：バリア。近くの味方にも小さいバリア
        p.buffs.shield = 700;
        p.buffs.shieldT = 8;
        for (const a of M.punchers) {
          if (a.team !== p.team || !a.alive || a === p || a.pos.distanceTo(p.pos) > 11) continue;
          a.buffs.shield = Math.max(a.buffs.shield || 0, 250);
          a.buffs.shieldT = Math.max(a.buffs.shieldT || 0, 6);
          M.fx.buffFx && M.fx.buffFx(a, 0x7ad0ff);
        }
        M.fx.buffFx && M.fx.buffFx(p, 0x7ad0ff);
        M.fx.notes && M.fx.notes(p, 3);
        M.sfx('buff', p);
        break;
      case 'keshigomu': {
        // 学食の油そば：油の水たまり。入った敵はつるっとすべる（同じ人は2秒に1回）
        const slip = new Map();
        M.combat.addArea({
          owner: p,
          team: p.team,
          pos: p.pos.clone(),
          r: 5.2,
          life: 14,
          kind: 'oil',
          update: (a) => {
            for (const t of M.punchers) {
              if (t.team === p.team || !t.alive) continue;
              if (t.pos.distanceTo(a.pos) > a.r + 0.6) continue;
              slowOn(t, 0.45, 0.4);
              if ((slip.get(t) || -9) > M.time - 2) continue;
              slip.set(t, M.time);
              const ang = Math.random() * Math.PI * 2;
              M.combat.damage(p, t, 60 * atk, { kind: 'disk', dir: _v2.set(Math.cos(ang), 0.15, Math.sin(ang)).clone(), knock: 7, stun: 0.3, soft: true });
              M.fx.say && M.fx.say(t, 'つるっ！', 'oil');
            }
          },
        });
        M.sfx('trap', p);
        break;
      }
      case 'marksheet': {
        // 出席にきびしい先生：欠席スタンプ。近づいた敵はスタン＋しばらくディスクが使えない
        M.combat.addArea({
          owner: p,
          team: p.team,
          pos: p.pos.clone(),
          r: 3.6,
          life: 20,
          kind: 'stamp',
          update: (a) => {
            for (const t of M.punchers) {
              if (t.team === p.team || !t.alive) continue;
              if (t.pos.distanceTo(a.pos) > a.r + 0.6) continue;
              if (t.invuln > 0 || t.state === 'special') continue; // 無敵のあいだはふまない
              a.dead = true;
              _v2.subVectors(t.pos, a.pos).normalize();
              M.fx.shock && M.fx.shock(a.pos, 0xff3a3a, 5);
              if (M.combat.damage(p, t, 150 * atk, { kind: 'disk', dir: _v2.clone(), knock: 4, stun: 1.2, heavy: true }) > 0) {
                t.diskLock = Math.max(t.diskLock || 0, 4);
                if (t.charge) t.charge = null;
                if (t.remote && M.netHit) M.netHit(t, { dl: 4 });
                M.fx.say && M.fx.say(t, '欠席！', 'judge', 1.4);
              }
              M.sfx('hitHeavy', t);
              break;
            }
          },
        });
        M.sfx('trap', p);
        break;
      }
      case 'tani': {
        // 単位くれそうな先生：にこにこ近づいてきた敵は、単位（持ち物）を落とす
        M.combat.addArea({
          owner: p,
          team: p.team,
          pos: p.pos.clone(),
          r: 4.2,
          life: 18,
          kind: 'tani',
          update: (a) => {
            for (const t of M.punchers) {
              if (t.team === p.team || !t.alive) continue;
              if (t.pos.distanceTo(a.pos) > a.r + 0.6) continue;
              if (t.invuln > 0 || t.state === 'special') continue; // 無敵のあいだはかからない
              a.dead = true;
              const n = dropHalf(M, t);
              slowOn(t, 0.5, 4);
              M.combat.damage(p, t, 90 * atk, { kind: 'disk', noJust: true });
              M.fx.shock && M.fx.shock(a.pos, 0x7ad0ff, 5);
              M.fx.say && M.fx.say(t, n ? '単位を落とした…' : '単位…ない…', 'water', 1.5);
              M.sfx('trap', t);
              break;
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
      case 'screw': {
        // スクリュー先生：うずをまいて真上へ。近くの敵を上にふっとばす
        p.state = 'skill';
        p.stateT = 0;
        p.invuln = Math.max(p.invuln, 0.5);
        this.active.push({ p, kind: 'screw', t: 0, dur: 0.6, hit: new Set(), atk });
        M.sfx('dash', p);
        break;
      }
      case 'book': {
        // ブック：前へ突っ走る。ぶつかった敵をはねとばす
        p.state = 'skill';
        p.stateT = 0;
        p.invuln = Math.max(p.invuln, 0.3);
        this.aimDir(p, _v);
        this.active.push({ p, kind: 'book', t: 0, dur: 0.55, dir: _v.clone(), hit: new Set(), atk });
        M.fx.say && M.fx.say(p, 'ワンッ！', 'kira');
        M.sfx('dash', p);
        break;
      }
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
      // v1.5 の仲間の技（続くもの）
      const kr = updateKit(this, a, dt);
      if (kr) {
        if (kr === 'done') {
          const j = this.active.indexOf(a);
          if (j >= 0) this.active.splice(j, 1);
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
      if (a.kind === 'screw') {
        // 上へ。体はくるくる回る（roll）
        p.vel.set(p.forward.x * 6, 30, p.forward.z * 6);
        p.roll = (a.t * 26) % (Math.PI * 2);
        if (!a.local) {
          if (Math.random() < 0.7) M.fx.trail && M.fx.trail(p, 0xff8a3d);
          for (const t of M.combat.targetsFor(p)) {
            if (a.hit.has(t)) continue;
            if (t.pos.distanceTo(p.pos) > 4.5 + (t.radius || 0.8)) continue;
            a.hit.add(t);
            _v2.subVectors(t.pos, p.pos);
            _v2.y = Math.abs(_v2.y) + 3;
            _v2.normalize();
            M.combat.damage(p, t, 230 * (a.atk || 1), { elem: true, kind: 'disk', heavy: true, dir: _v2.clone(), knock: 18, stun: 0.5 });
          }
        }
        if (a.t >= a.dur) {
          p.roll = 0;
          p.state = 'hover';
          p.vel.multiplyScalar(0.3);
          this.active.splice(i, 1);
        }
        continue;
      }
      if (a.kind === 'book') {
        p.vel.copy(a.dir).multiplyScalar(52);
        p.yaw = Math.atan2(a.dir.x, a.dir.z);
        if (!a.local) {
          if (Math.random() < 0.7) M.fx.trail && M.fx.trail(p, 0x7ad0ff);
          for (const t of M.combat.targetsFor(p)) {
            if (a.hit.has(t)) continue;
            if (t.pos.distanceTo(p.pos) > 2.8 + (t.radius || 0.8)) continue;
            a.hit.add(t);
            _v2.subVectors(t.pos, p.pos).normalize();
            M.combat.damage(p, t, 180 * (a.atk || 1), { elem: true, kind: 'disk', heavy: true, dir: _v2.clone(), knock: 15, stun: 0.35 });
          }
        }
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
