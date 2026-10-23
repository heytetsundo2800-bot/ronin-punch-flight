// v1.5 で増えた仲間の技（パンチャースキル・スペシャル・とくせい）と、相性の効果
// ダメージや効き目はホスト（オンラインでは部屋をつくった人）だけが計算する。
// 入った人の端末では、自分のキャラの動き（突進・ジャンプなど）だけ clientKit でまねする
import * as THREE from 'three';
import { MOVE } from './config.js';
import { clamp } from './util.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

// 見た目のしるし（頭の上のマーク・オーラ）。オンラインでも送る
export const STATUS = { rage: 1, drunk: 2, poop: 4, sleep: 8, reveal: 16, stink: 32, exposed: 64, happy: 128, charm: 256, burn: 512, armor: 1024, call: 2048, slow: 4096 };

// ===== 相性（同じチーム／敵どうし）=====
// pair：同じチームなら2人とも強くなる。enemy：敵どうしだと2人とも少し弱くなる
export const PAIRS = [
  { a: 'koudai', b: 'mana', name: 'コーダイ×まな', enemy: true },
  { a: 'tetsundo', b: 'minori', name: 'てつんど×みのり' },
  { a: 'shouta', b: 'ayana', name: 'しょうた×あやな' },
  { a: 'even', b: 'yuka', name: 'エブン×ゆか', kick: true },
];
export const MACHIDA = ['tora', 'even', 'naot', 'toriki'];
const PAIR_BUFF = { atk: 0.12, def: -0.08, spd: 0 };
const ENEMY_DEBUFF = { atk: -0.1, def: 0.05, spd: 0 };
const MACHIDA_BUFF = { atk: 0.15, def: 0, spd: 0.1 };

// 試合の最初に1回（ホストも入った人も、同じ組み合わせから同じ結果になる）
export function applySynergy(M) {
  const list = [];
  const P = M.punchers;
  for (const p of P) p.syn = { atk: 0, def: 0, spd: 0, tags: [] };
  const add = (p, b, tag) => {
    p.syn.atk += b.atk;
    p.syn.def += b.def;
    p.syn.spd += b.spd;
    p.syn.tags.push(tag);
  };
  for (const pr of PAIRS) {
    for (const team of [0, 1]) {
      const A = P.filter((p) => p.team === team && p.def.id === pr.a);
      const B = P.filter((p) => p.team === team && p.def.id === pr.b);
      if (A.length && B.length) {
        for (const p of [...A, ...B]) add(p, PAIR_BUFF, pr.name);
        list.push({ team, name: pr.name, good: true, kick: !!pr.kick });
      }
    }
    if (pr.enemy) {
      // 敵どうし（同じチームにも相手がいる人はのぞく）
      for (const p of P) {
        const other = p.def.id === pr.a ? pr.b : p.def.id === pr.b ? pr.a : null;
        if (!other) continue;
        const mate = P.some((q) => q.team === p.team && q.def.id === other);
        const foe = P.some((q) => q.team !== p.team && q.def.id === other);
        if (!mate && foe) {
          add(p, ENEMY_DEBUFF, pr.name + '（敵どうし）');
          if (!list.some((x) => x.key === pr.name && x.bad)) list.push({ team: -1, key: pr.name, name: pr.name + '（敵どうし…）', bad: true });
        }
      }
    }
  }
  for (const team of [0, 1]) {
    const mem = P.filter((p) => p.team === team);
    if (MACHIDA.every((id) => mem.some((p) => p.def.id === id))) {
      for (const p of mem) if (MACHIDA.includes(p.def.id)) add(p, MACHIDA_BUFF, '町田');
      list.push({ team, name: '町田ブラザーズ', good: true, machida: true });
    }
  }
  for (const p of P) p.sumMods();
  // ゆかのキック（同じチームのエブンを10秒ごとに蹴る）
  M.kicks = [];
  for (const team of [0, 1]) {
    const yk = P.filter((p) => p.team === team && p.def.id === 'yuka');
    const ev = P.filter((p) => p.team === team && p.def.id === 'even');
    // 蹴るのは、エブン1人につきゆか1人まで（2人いても2回にはならない）
    for (const e of ev) if (yk.length) M.kicks.push({ y: yk[0], e, t: 10 });
  }
  M.synergies = list;
  return list;
}

// 毎フレーム（ホストだけ）：ゆかのキック・ナオTのやさしい壁・ちじわの鼻
export function updateSynergy(M, dt) {
  if (M.netClient) return;
  for (const k of M.kicks || []) {
    if (!k.y.alive || !k.e.alive) continue;
    k.t -= dt;
    if (k.t > 0) continue;
    const e = k.e;
    // 無敵・スペシャル中は待つ（1秒後にもう一度）
    if (e.invuln > 0 || e.state === 'special') {
      k.t = 1;
      continue;
    }
    k.t = 10;
    // HPが半分くらいになる（このキックでは倒れない）
    const cut = Math.floor(e.hp * 0.5);
    if (cut > 0) {
      e.hp -= cut;
      e.lastHitBy = k.y;
      e.lastHitT = M.time;
      M.fx.kick && M.fx.kick(e, k.y);
      M.fx.hit && M.fx.hit(e, k.y, cut, { heavy: true, kind: 'ks' });
      M.sfx('hitHeavy', e);
    }
    // エブンは蹴られてうれしい（少しのあいだ強くなる）
    e.addMod('happy', { atk: 0.3 }, 4);
  }
  M._kitT = (M._kitT || 0) - dt;
  if (M._kitT > 0) return;
  M._kitT = 0.5;
  for (const n of M.punchers) {
    if (!n.alive || n.def.id !== 'naot') continue;
    // ナオT のまわりの味方は、受けるダメージが少しへる
    for (const a of M.punchers) {
      if (a.team !== n.team || !a.alive || a === n) continue;
      if (a.pos.distanceToSquared(n.pos) < 64) a.addMod('gentle', { def: -0.1 }, 0.7);
    }
  }
}

// 自分のチームから見える敵（あやなの情報収集・うわさ＝その敵に reveal のしるし、ちじわの鼻＝ちじわの近く）
export function revealed(M, team, e) {
  if (e.status & STATUS.reveal) return true;
  for (const a of M.punchers) {
    if (a.team !== team || !a.alive) continue;
    if (a.def.id === 'chijiwa' && a.pos.distanceToSquared(e.pos) < 35 * 35) return true;
  }
  return false;
}

// 見た目のしるしを計算（ホストと、自分で動かしている人）
export function statusOf(p) {
  let s = 0;
  const m = p.mods;
  if (m.has('temper') || m.has('snap') || m.has('chug')) s |= STATUS.rage;
  if (p.drunkT > 0) s |= STATUS.drunk;
  if (p.poopT > 0) s |= STATUS.poop;
  if (p.sleepT > M_now(p)) s |= STATUS.sleep;
  if (m.has('rumor') || m.has('exposed')) s |= STATUS.reveal; // 場所を知られている
  if (m.has('stink')) s |= STATUS.stink;
  if (m.has('judged') || m.has('exposed')) s |= STATUS.exposed;
  if (m.has('happy')) s |= STATUS.happy;
  if (p.charmT > M_now(p)) s |= STATUS.charm;
  if (p.burnT > 0) s |= STATUS.burn;
  if (p.armor) s |= STATUS.armor;
  if (p.callT > M_now(p)) s |= STATUS.call;
  if (p.buffs.slowT > 0) s |= STATUS.slow;
  return s;
}
const M_now = (p) => (p.match ? p.match.time : 0);

// ===== 小さな道具 =====
function enemiesNear(M, p, r, pos = p.pos, withGuardians = true) {
  const out = [];
  for (const t of M.combat.targetsFor(p)) {
    if (!withGuardians && t.isGuardian) continue;
    const rr = r + (t.radius || 0.8);
    if (t.pos.distanceToSquared(pos) <= rr * rr) out.push(t);
  }
  return out;
}
function enemiesCone(M, p, dir, range, cos, withGuardians = true) {
  const out = [];
  for (const t of M.combat.targetsFor(p)) {
    if (!withGuardians && t.isGuardian) continue;
    _v2.subVectors(t.pos, p.pos);
    const d = _v2.length();
    if (d > range + (t.radius || 0.8)) continue;
    if (d > 1.6 && _v2.dot(dir) / d < cos) continue;
    out.push(t);
  }
  return out;
}
function alliesNear(M, p, r, self = true) {
  const out = [];
  for (const a of M.punchers) {
    if (a.team !== p.team || !a.alive) continue;
    if (a === p) {
      if (self) out.push(a);
      continue;
    }
    if (a.pos.distanceToSquared(p.pos) <= r * r) out.push(a);
  }
  return out;
}
// ねらう向き（ロックした相手・近くの敵・前）
function aim(S, p, out) {
  return S.aimDir(p, out);
}
// ダメージなしで動けなくする（メロメロ・ねむり・電話）
function hold(M, t, dur, kind) {
  if (!t || t.isGuardian || !t.alive || t.invuln > 0 || t.state === 'special') return;
  if (t.buffs.big > 0 || t.armor) dur *= 0.4;
  t.stunT = Math.max(t.stunT, dur);
  t.dash = null;
  if (t.state === 'dash' || t.state === 'cruise' || t.state === 'fly') t.state = 'hover';
  let cc = null;
  if (t.charge) {
    M.fx.chargeBreak && M.fx.chargeBreak(t);
    t.omCd[t.charge.slot] = Math.max(t.omCd[t.charge.slot] * 0.5, 2);
    cc = { slot: t.charge.slot, cd: t.omCd[t.charge.slot] };
    t.charge = null;
  }
  if (kind === 'charm') {
    t.charmT = M.time + dur;
    t.lock = null;
  }
  if (kind === 'sleep') t.sleepT = M.time + dur;
  if (kind === 'call') t.callT = M.time + dur;
  // ほかの端末の人にも：止まる・ロックが外れる・溜めていたディスクが止まる
  if (t.remote && M.netHit) M.netHit(t, { s: dur, ul: kind === 'charm' ? 1 : 0, cc });
  if (kind === 'charm') M.fx.hearts && M.fx.hearts(t, dur);
  if (kind === 'sleep') M.fx.zzz && M.fx.zzz(t, dur);
}
// おそくする。強いほうが勝つ（強さと長さを別々の技から取らない）。弱くて長いほうは、強いのが切れたあとに続く
function slowDown(t, amt, dur) {
  if (!t || t.isGuardian || !t.buffs) return;
  const B = t.buffs;
  if (B.slowT <= 0) {
    B.slow = amt;
    B.slowT = dur;
    return;
  }
  if (amt > B.slow + 0.001) {
    if (B.slowT > dur && (!B.slowNext || B.slowNext.t < B.slowT)) B.slowNext = { amt: B.slow, t: B.slowT };
    B.slow = amt;
    B.slowT = dur;
  } else if (amt >= B.slow - 0.001) B.slowT = Math.max(B.slowT, dur);
  else if (dur > B.slowT) {
    const n = B.slowNext;
    if (!n || n.t < dur) B.slowNext = { amt, t: dur };
  }
}
function burn(t, src, dps, dur) {
  if (!t || t.isGuardian) return;
  t.burnDps = Math.max(t.burnT > 0 ? t.burnDps : 0, dps);
  t.burnT = Math.max(t.burnT, dur);
  t.burnSrc = src;
}
// ディスク（skills.js）からも使う
export const burnOn = (t, src, dps, dur) => burn(t, src, dps, dur);
export const slowOn = (t, amt, dur) => slowDown(t, amt, dur);
// 持ち物を落とす（単位くれそうな先生）：サクラは半分、ボールと旗は全部。落とした数を返す
export function dropHalf(M, t) {
  const mode = M.mode;
  if (!t || !t.carry || M.netClient) return 0;
  const sk = t.carry.sakura;
  if (sk && sk.length && mode.returnHome) {
    const n = Math.ceil(sk.length / 2);
    const out = sk.splice(sk.length - n, n);
    for (const it of out) mode.returnHome(it, t.pos);
    M.fx.scatter && M.fx.scatter(t.pos, Math.min(n, 12));
    return n;
  }
  if (t.carry.balls && t.carry.balls.length && mode.onKnock) {
    const n = t.carry.balls.length;
    mode.onKnock(t);
    return n;
  }
  if (t.carry.flag && mode.dropFlag) {
    mode.dropFlag(t);
    return 1;
  }
  return 0;
}
function heal(M, a, frac) {
  a.heal(a.maxHp * frac);
  M.fx.healFx && M.fx.healFx(a);
}

// ===== パンチャースキル =====
// 名前が変わる技（トリキの三大欲求）
export function kitSkillName(p) {
  if (p.def.skill.id === 'desires') return ['食欲', '睡眠欲', 'モテたい'][(p.desireIdx || 0) % 3];
  return p.def.skill.name;
}

export function useKit(S, p) {
  const M = S.match;
  const id = p.def.skill.id;
  const A = p.def.atk;
  switch (id) {
    case 'drumRoll': {
      p.state = 'skill';
      p.stateT = 0;
      S.active.push({ p, kind: 'drumRoll', t: 0, dur: 1.2, next: 0 });
      M.fx.say && M.fx.say(p, 'ドコドコドコ', 'beat');
      M.sfx('drum', p);
      return true;
    }
    case 'chug': {
      p.addMod('chug', { atk: 0.4 }, 6);
      M.fx.say && M.fx.say(p, 'ゴクゴク…', 'drunk');
      M.fx.buffFx && M.fx.buffFx(p, 0xffc93c);
      M.sfx('gulp', p);
      return true;
    }
    case 'bikeDash': {
      aim(S, p, _v);
      _v.y *= 0.4;
      _v.normalize();
      p.state = 'skill';
      p.stateT = 0;
      p.invuln = Math.max(p.invuln, 0.3);
      S.active.push({ p, kind: 'bike', t: 0, dur: 1.0, dir: _v.clone(), hit: new Set() });
      M.fx.bike && M.fx.bike(p, 1.05);
      M.fx.say && M.fx.say(p, '静岡まで！', 'wind');
      M.sfx('dash', p);
      return true;
    }
    case 'spicyBreath': {
      S.active.push({ p, kind: 'breath', t: 0, dur: 0.85, next: 0, range: 10, cos: 0.82, dmg: 85 * A, burn: [55 * A, 3], color: 0xff6a1a, knock: 3 });
      M.fx.breath && M.fx.breath(p, 0xff6a1a, 10, 0.85, 'fire');
      M.fx.say && M.fx.say(p, 'からっ！！', 'fire');
      M.sfx('fire', p);
      return true;
    }
    case 'iceFrappe': {
      const tgt = aim(S, p, _v);
      const o = p.pos.clone().addScaledVector(p.forward, 1.0);
      o.y += 0.3;
      M.combat.spawnProjectile({
        owner: p,
        pos: o,
        vel: _v.clone().multiplyScalar(40),
        dmg: 200 * A,
        radius: 0.8,
        life: 0.9,
        kind: 'ice',
        homing: tgt,
        turn: 2.6,
        opts: { kind: 'ks', knock: 6, elem: true },
        onHit: (q, t) => {
          if (M.combat.damage(q.owner, t, q.dmg, { ...q.opts, dir: _v3.copy(q.vel).normalize().clone() }) > 0) {
            slowDown(t, 0.5, 3);
            M.fx.say && M.fx.say(t, 'ヒヤッ', 'water');
          }
        },
      });
      M.sfx('shot', p);
      return true;
    }
    case 'lookCheck': {
      aim(S, p, _v);
      M.fx.flash && M.fx.flash(p, _v.clone());
      for (const t of enemiesCone(M, p, _v, 16, 0.6, false)) {
        t.addMod('judged', { def: 0.25 }, 6);
        M.fx.say && M.fx.say(t, 'ナシ', 'judge');
      }
      M.fx.say && M.fx.say(p, 'うーん…', 'wind');
      M.sfx('flash', p);
      return true;
    }
    case 'moriTalk': {
      aim(S, p, _v);
      M.fx.say && M.fx.say(p, 'ウイスキー1リットルいけるし', 'talk', 1.6);
      for (const t of enemiesCone(M, p, _v, 12, 0.55, false)) {
        hold(M, t, 1.2, 'stun');
        M.fx.say && M.fx.say(t, 'えっ…?', 'talk');
      }
      p.addMod('mori', { atk: 0.3 }, 4);
      M.sfx('buff', p);
      return true;
    }
    case 'smile': {
      for (const a of alliesNear(M, p, 14)) heal(M, a, 0.18);
      aim(S, p, _v);
      for (const t of enemiesCone(M, p, _v, 8, 0.5, false)) hold(M, t, 0.8, 'charm');
      M.fx.sparkle && M.fx.sparkle(p);
      M.fx.say && M.fx.say(p, 'ニコッ', 'kira');
      M.sfx('heal', p);
      return true;
    }
    case 'noodleTrap': {
      const pos = p.pos.clone().addScaledVector(p.flatFwd, 4);
      M.combat.addArea({
        owner: p,
        team: p.team,
        pos,
        r: 5.5,
        life: 8,
        kind: 'noodle',
        tick: 0,
        update: (a, dt) => {
          a.tick -= dt;
          const dot = a.tick <= 0;
          if (dot) a.tick = 0.5;
          for (const t of M.punchers) {
            if (t.team === p.team || !t.alive) continue;
            if (t.pos.distanceToSquared(a.pos) < (a.r + 0.6) * (a.r + 0.6)) {
              slowDown(t, 0.6, 0.35);
              if (dot) M.combat.damage(p, t, 22 * A, { kind: 'dot' });
            }
          }
        },
      });
      M.fx.say && M.fx.say(p, 'のびのび…', 'noodle');
      M.sfx('trap', p);
      return true;
    }
    case 'bigEat': {
      heal(M, p, 0.35);
      p.addMod('eat', { atk: 0.2 }, 6);
      M.fx.say && M.fx.say(p, 'もぐもぐ', 'eat');
      M.sfx('heal', p);
      return true;
    }
    case 'desires': {
      const k = (p.desireIdx || 0) % 3;
      p.desireIdx = k + 1;
      if (k === 0) {
        heal(M, p, 0.25);
        M.fx.say && M.fx.say(p, 'もぐもぐ（食欲）', 'eat');
        M.sfx('heal', p);
      } else if (k === 1) {
        for (const t of enemiesNear(M, p, 9, p.pos, false)) hold(M, t, 2.2, 'sleep');
        M.fx.shock && M.fx.shock(p.pos, 0xb7a6ff, 9);
        M.fx.say && M.fx.say(p, 'ふわぁ…（睡眠欲）', 'sleep');
        M.sfx('heal', p);
      } else {
        aim(S, p, _v);
        p.state = 'skill';
        p.stateT = 0;
        p.invuln = Math.max(p.invuln, 0.25);
        S.active.push({ p, kind: 'mote', t: 0, dur: 0.45, dir: _v.clone(), hit: new Set() });
        M.fx.say && M.fx.say(p, 'モテたい！', 'kira');
        M.sfx('dash', p);
      }
      return true;
    }
    case 'twoLiter': {
      heal(M, p, 0.3);
      p.addMod('water2l', { spd: 0.25 }, 5);
      for (const a of alliesNear(M, p, 8, false)) heal(M, a, 0.1);
      M.fx.say && M.fx.say(p, 'ぐびぐび', 'water');
      M.sfx('heal', p);
      return true;
    }
    case 'oniden': {
      const tgt = aim(S, p, _v) || null;
      S.active.push({ p, kind: 'calls', t: 0, n: 0, next: 0, target: tgt });
      M.fx.say && M.fx.say(p, 'プルルル…', 'call');
      M.sfx('call', p);
      return true;
    }
    case 'intel': {
      // 敵全員の場所と体力が10秒見える（exposed のしるし）。守りも少し下がる
      for (const t of M.punchers) if (t.team !== p.team && t.alive) t.addMod('exposed', { def: 0.15 }, 10);
      M.fx.shock && M.fx.shock(p.pos, 0x7dffb0, 10);
      M.fx.say && M.fx.say(p, '情報ゲット', 'wind');
      M.sfx('buff', p);
      return true;
    }
    case 'flyKick': {
      aim(S, p, _v);
      p.state = 'skill';
      p.stateT = 0;
      p.invuln = Math.max(p.invuln, 0.3);
      S.active.push({ p, kind: 'kick', t: 0, dur: 0.45, dir: _v.clone(), hit: new Set() });
      M.fx.say && M.fx.say(p, 'えいっ！', 'fire');
      M.sfx('dash', p);
      return true;
    }
  }
  return false;
}

// 入った人の端末：自分のキャラの動きだけまねする（効き目はホスト）
export function clientKit(S, p) {
  const id = p.def.skill.id;
  if (id === 'bikeDash') {
    aim(S, p, _v);
    _v.y *= 0.4;
    _v.normalize();
    p.state = 'skill';
    p.stateT = 0;
    p.invuln = Math.max(p.invuln, 0.3);
    S.active.push({ p, kind: 'bike', t: 0, dur: 1.0, dir: _v.clone(), hit: new Set(), local: true });
    return true;
  }
  if (id === 'flyKick') {
    aim(S, p, _v);
    p.state = 'skill';
    p.stateT = 0;
    p.invuln = Math.max(p.invuln, 0.3);
    S.active.push({ p, kind: 'kick', t: 0, dur: 0.45, dir: _v.clone(), hit: new Set(), local: true });
    return true;
  }
  if (id === 'drumRoll') {
    p.state = 'skill';
    p.stateT = 0;
    S.active.push({ p, kind: 'drumRoll', t: 0, dur: 1.2, next: 0, local: true });
    return true;
  }
  if (id === 'spicyBreath') {
    S.active.push({ p, kind: 'breath', t: 0, dur: 0.85, local: true });
    return true;
  }
  if (id === 'desires') {
    const k = (p.desireIdx || 0) % 3;
    p.desireIdx = k + 1;
    if (k === 2) {
      aim(S, p, _v);
      p.state = 'skill';
      p.stateT = 0;
      p.invuln = Math.max(p.invuln, 0.25);
      S.active.push({ p, kind: 'mote', t: 0, dur: 0.45, dir: _v.clone(), hit: new Set(), local: true });
    }
    return true;
  }
  return false;
}
export function clientSpecial(S, p) {
  const id = p.def.special.id;
  if (id === 'bodyPress') {
    S.active.push({ p, kind: 'press', t: 0, phase: 0, local: true });
    return true;
  }
  if (id === 'kaijuBreath') {
    S.active.push({ p, kind: 'beam', t: 0, dur: 1.2, local: true });
    return true;
  }
  return false;
}

// ===== スペシャル =====
export function fireKit(S, p) {
  const M = S.match;
  const id = p.def.special.id;
  const A = p.def.atk;
  switch (id) {
    case 'soulSong':
      S.active.push({ p, kind: 'song', t: 0, beats: [0, 0.45, 0.9], bi: 0 });
      M.fx.notes && M.fx.notes(p, 6);
      M.fx.say && M.fx.say(p, 'ラ〜♪', 'note', 1.6);
      return true;
    case 'drumSolo':
      S.active.push({ p, kind: 'solo', t: 0, beats: [0, 0.5, 1.0, 1.6], bi: 0 });
      M.fx.drums && M.fx.drums(p, 2.1);
      return true;
    case 'reverse': {
      aim(S, p, _v);
      M.fx.breath && M.fx.breath(p, 0xc9d14a, 16, 0.9, 'vomit');
      M.fx.say && M.fx.say(p, 'オエェェ…', 'drunk', 1.4);
      for (const t of enemiesCone(M, p, _v, 16, 0.76)) {
        _v2.subVectors(t.pos, p.pos).normalize();
        if (M.combat.damage(p, t, (t.isGuardian ? 600 : 520) * A, { elem: true, kind: 'special', heavy: true, dir: _v2.clone(), knock: 9 }) > 0) slowDown(t, 0.5, 4);
      }
      M.shake(0.4, 0.4);
      M.sfx('vomit', p);
      return true;
    }
    case 'freshWind': {
      M.fx.shock && M.fx.shock(p.pos, 0x7dff9a, 12);
      M.fx.shock && M.fx.shock(p.pos, 0xffffff, 8);
      M.fx.tornado && M.fx.tornado(p, 1.2);
      for (const t of enemiesNear(M, p, 12)) {
        _v2.subVectors(t.pos, p.pos).normalize();
        _v2.y = Math.max(_v2.y, 0.35);
        M.combat.damage(p, t, (t.isGuardian ? 500 : 380) * A, { elem: true, kind: 'special', heavy: true, dir: _v2.normalize().clone(), knock: 24, stun: 0.6 });
      }
      for (const a of alliesNear(M, p, 18)) {
        a.addMod('fresh', { spd: 0.3 }, 6);
        M.fx.buffFx && M.fx.buffFx(a, 0x7dff9a);
      }
      M.fx.say && M.fx.say(p, 'さわやか〜', 'wind', 1.4);
      M.shake(0.4, 0.4);
      return true;
    }
    case 'spicyMuscle':
      p.buffs.big = 8;
      p.model.userData.bigT = 0;
      M.fx.shock && M.fx.shock(p.pos, 0xff6a1a, 8);
      M.fx.say && M.fx.say(p, 'ムキッ！！', 'fire', 1.4);
      M.shake(0.4, 0.3);
      return true;
    case 'snapRage':
      p.addMod('snap', { atk: 0.6, spd: 0.25, armor: true }, 7);
      M.fx.shock && M.fx.shock(p.pos, 0xff3a3a, 9);
      M.fx.say && M.fx.say(p, 'ブチッ！！', 'rage', 1.4);
      M.shake(0.35, 0.3);
      return true;
    case 'idolDance':
      M.fx.sparkle && M.fx.sparkle(p);
      M.fx.notes && M.fx.notes(p, 5);
      for (const t of enemiesNear(M, p, 14, p.pos, false)) hold(M, t, 2.2, 'charm');
      for (const a of alliesNear(M, p, 18)) {
        a.addMod('idol', { spd: 0.25 }, 6);
        M.fx.buffFx && M.fx.buffFx(a, 0xffb0e0);
      }
      M.fx.say && M.fx.say(p, 'キラッ☆', 'kira', 1.4);
      return true;
    case 'whisky':
      p.addMod('whisky', { atk: 0.2 }, 2.6);
      S.active.push({ p, kind: 'breath', t: 0, dur: 2.5, next: 0, range: 12, cos: 0.84, dmg: 75 * A, burn: [45 * A, 2], color: 0xff8a1f, knock: 2.5, sp: true });
      M.fx.breath && M.fx.breath(p, 0xff8a1f, 12, 2.5, 'fire');
      M.fx.say && M.fx.say(p, 'ゴクゴク…ブハーッ！', 'fire', 1.6);
      return true;
    case 'visualMax':
      M.fx.sparkle && M.fx.sparkle(p);
      M.fx.shock && M.fx.shock(p.pos, 0xfff2a8, 15);
      for (const t of enemiesNear(M, p, 15, p.pos, false)) hold(M, t, 1.8, 'charm');
      for (const a of alliesNear(M, p, 20)) {
        a.buffs.regen = 0.06;
        a.buffs.regenT = 5;
        M.fx.healFx && M.fx.healFx(a);
      }
      M.fx.say && M.fx.say(p, 'ビジュ全開', 'kira', 1.4);
      return true;
    case 'noBath':
      p.addMod('stink', {}, 8);
      S.active.push({ p, kind: 'stink', t: 0, dur: 8, next: 0 });
      M.fx.say && M.fx.say(p, '3日目…', 'stink', 1.4);
      return true;
    case 'bodyPress':
      S.active.push({ p, kind: 'press', t: 0, phase: 0 });
      M.fx.say && M.fx.say(p, 'いくぞー！', 'fire');
      return true;
    case 'naitei':
      for (const a of M.punchers) {
        if (a.team !== p.team || !a.alive) continue;
        a.addMod('naitei', { atk: 0.25, spd: 0.15 }, 8);
        M.fx.buffFx && M.fx.buffFx(a, 0xffd23a);
      }
      p.invuln = Math.max(p.invuln, 1);
      M.fx.confetti && M.fx.confetti(p);
      M.fx.say && M.fx.say(p, '内定ゲット！！', 'kira', 1.8);
      M.announce('トリキが内定ゲット！ 味方みんなパワーアップ', p.team);
      return true;
    case 'donut':
      for (const a of alliesNear(M, p, 26)) {
        heal(M, a, 0.4);
        a.addMod('donut', { atk: 0.15 }, 6);
      }
      M.fx.donuts && M.fx.donuts(p);
      M.fx.say && M.fx.say(p, 'いちごのドーナツどうぞ！', 'kira', 1.6);
      return true;
    case 'dailyCall': {
      let t = p.lock && p.lock.alive && !p.lock.isGuardian ? p.lock : null;
      if (!t) {
        let best = 1e9;
        for (const e of M.punchers) {
          if (e.team === p.team || !e.alive) continue;
          const d = e.pos.distanceToSquared(p.pos);
          if (d < best) {
            best = d;
            t = e;
          }
        }
      }
      if (t) {
        M.combat.damage(p, t, 300 * A, { kind: 'special', noJust: true });
        hold(M, t, 3.2, 'call');
        M.fx.phoneRing && M.fx.phoneRing(t, 3.2);
        M.fx.say && M.fx.say(t, t.def.id === 'koudai' ? 'もしもし？…はい' : '通話中…', 'call', 1.8);
      }
      M.fx.say && M.fx.say(p, 'ねえ、なんで返事くれないの？', 'call', 1.8);
      M.sfx('call', p);
      return true;
    }
    case 'rumor':
      M.fx.shock && M.fx.shock(p.pos, 0x7dffb0, 30);
      for (const t of M.punchers) {
        if (t.team === p.team || !t.alive) continue;
        M.combat.damage(p, t, 150 * A, { kind: 'special', noJust: true });
        slowDown(t, 0.3, 6);
        t.addMod('rumor', {}, 10);
        M.fx.say && M.fx.say(t, 'うわさ…', 'wind');
      }
      M.fx.say && M.fx.say(p, 'ねえ、聞いた？', 'wind', 1.6);
      return true;
    case 'kaijuBreath':
      S.active.push({ p, kind: 'beam', t: 0, dur: 1.2, next: 0 });
      M.fx.beam && M.fx.beam(p, 0xff5a1f, 26, 1.2);
      M.fx.say && M.fx.say(p, 'ガオーッ！！', 'fire', 1.4);
      M.shake(0.5, 0.5);
      return true;
  }
  return false;
}

// ===== 続く技（毎フレーム）。処理したら true =====
export function updateKit(S, a, dt) {
  const M = S.match;
  const p = a.p;
  const A = p.def.atk;
  const local = !!a.local; // 入った人の端末：動きだけ
  switch (a.kind) {
    case 'drumRoll': {
      p.vel.multiplyScalar(Math.exp(-6 * dt));
      a.next -= dt;
      if (a.next <= 0 && a.t < a.dur) {
        a.next = 0.15;
        if (!local) {
          M.fx.ring && M.fx.ring(p.pos, 0xff8a3d, 0.5, 5.5, 0.25, false, 0.8);
          for (const t of enemiesNear(M, p, 5.5)) {
            _v2.subVectors(t.pos, p.pos).normalize();
            M.combat.damage(p, t, 60 * A, { elem: true, kind: 'ks', dir: _v2.clone(), knock: 2.5 });
          }
        }
      }
      if (a.t >= a.dur) {
        if (!local) {
          M.fx.shock && M.fx.shock(p.pos, 0xff8a3d, 7);
          for (const t of enemiesNear(M, p, 6.5)) {
            _v2.subVectors(t.pos, p.pos).normalize();
            M.combat.damage(p, t, 170 * A, { elem: true, kind: 'ks', heavy: true, dir: _v2.clone(), knock: 15, stun: 0.4 });
          }
          M.fx.say && M.fx.say(p, 'ジャーン!!', 'beat');
        }
        p.state = 'hover';
        return 'done';
      }
      return true;
    }
    case 'bike':
    case 'kick':
    case 'mote': {
      const spd = a.kind === 'bike' ? 50 : a.kind === 'kick' ? 46 : 40;
      p.vel.copy(a.dir).multiplyScalar(spd);
      p.yaw = Math.atan2(a.dir.x, a.dir.z);
      if (a.kind !== 'bike') p.pitch = clamp(Math.asin(clamp(a.dir.y, -1, 1)), -MOVE.pitchLimit, MOVE.pitchLimit);
      if (!local) {
        M.fx.trail && M.fx.trail(p, a.kind === 'bike' ? 0x7dff9a : a.kind === 'kick' ? 0xff6a3a : 0xffb0e0);
        for (const t of M.combat.targetsFor(p)) {
          if (a.hit.has(t)) continue;
          if (t.pos.distanceTo(p.pos) > 2.8 + (t.radius || 0.8)) continue;
          a.hit.add(t);
          _v2.subVectors(t.pos, p.pos).normalize();
          if (a.kind === 'bike') M.combat.damage(p, t, 200 * A, { elem: true, kind: 'ks', heavy: true, dir: _v2.clone(), knock: 16, stun: 0.3 });
          else if (a.kind === 'kick') {
            if (M.combat.damage(p, t, 260 * A, { elem: true, kind: 'ks', heavy: true, dir: _v2.clone(), knock: 18, stun: 0.4 }) > 0) burn(t, p, 40 * A, 2);
            M.fx.kick && M.fx.kick(t, p);
          } else {
            M.combat.damage(p, t, 120 * A, { elem: true, kind: 'ks', dir: _v2.clone(), knock: 6 });
            hold(M, t, 1.2, 'charm');
          }
        }
      }
      if (a.t >= a.dur) {
        p.state = 'cruise';
        p.vel.multiplyScalar(0.45);
        return 'done';
      }
      return true;
    }
    case 'breath': {
      // ふいているあいだは少しおそくなる（入った人の端末でも同じように）
      if (!a.sp) p.vel.multiplyScalar(Math.exp(-3 * dt));
      if (local) return a.t >= a.dur ? 'done' : true;
      a.next -= dt;
      if (a.next <= 0) {
        a.next = 0.16;
        _v.copy(p.forward);
        for (const t of enemiesCone(M, p, _v, a.range, a.cos)) {
          _v2.subVectors(t.pos, p.pos).normalize();
          const d = M.combat.damage(p, t, t.isGuardian ? a.dmg * 1.2 : a.dmg, { elem: true, kind: a.sp ? 'special' : 'ks', dir: _v2.clone(), knock: a.knock });
          if (a.burn && d > 0) burn(t, p, a.burn[0], a.burn[1]);
        }
      }
      return a.t >= a.dur ? 'done' : true;
    }
    case 'calls': {
      if (local) return 'done';
      a.next -= dt;
      if (a.next <= 0 && a.n < 5) {
        a.next = 0.18;
        a.n++;
        const last = a.n === 5;
        const tgt = a.target && a.target.alive !== false ? a.target : M.combat.pickTarget(p);
        _v.copy(p.forward);
        if (tgt) _v.subVectors(tgt.pos, p.pos).normalize();
        _v.x += (Math.random() - 0.5) * 0.5;
        _v.y += 0.25 + Math.random() * 0.3;
        _v.normalize();
        const o = p.pos.clone().addScaledVector(p.forward, 0.9);
        o.y += 0.4;
        M.combat.spawnProjectile({
          owner: p,
          pos: o,
          vel: _v.clone().multiplyScalar(30),
          dmg: 70 * A,
          radius: 0.65,
          life: 1.4,
          kind: 'phone',
          homing: tgt,
          turn: 5,
          opts: { kind: 'ks', knock: 2, stun: last ? 0.6 : 0, elem: true },
        });
      }
      return a.n >= 5 ? 'done' : true;
    }
    case 'song':
    case 'solo': {
      if (local) return 'done';
      while (a.bi < a.beats.length && a.t >= a.beats[a.bi]) {
        const last = a.bi === a.beats.length - 1;
        a.bi++;
        const r = a.kind === 'song' ? 12 : 13;
        const col = a.kind === 'song' ? 0xff7a3a : 0xffd23a;
        M.fx.shock && M.fx.shock(p.pos, col, r);
        if (a.kind === 'song') M.fx.notes && M.fx.notes(p, 3);
        M.fx.say && M.fx.say(p, a.kind === 'song' ? (last ? 'ラ〜〜♪♪' : '♪') : last ? 'ジャーン!!' : 'ドン!', a.kind === 'song' ? 'note' : 'beat');
        M.shake(last ? 0.45 : 0.2, 0.25);
        for (const t of enemiesNear(M, p, r)) {
          _v2.subVectors(t.pos, p.pos).normalize();
          const base = a.kind === 'song' ? 200 : 230;
          M.combat.damage(p, t, (t.isGuardian ? base * 1.3 : base) * A, { elem: true, kind: 'special', heavy: last, dir: _v2.clone(), knock: last ? 22 : 12, stun: last ? (a.kind === 'song' ? 1.0 : 1.2) : 0 });
        }
        if (a.kind === 'solo' && a.bi === 1) {
          for (const al of alliesNear(M, p, 16)) {
            al.addMod('groove', { atk: 0.25 }, 6);
            M.fx.buffFx && M.fx.buffFx(al, 0xffd23a);
          }
        }
        M.sfx(a.kind === 'song' ? 'voice' : 'drum', p);
      }
      return a.bi >= a.beats.length ? 'done' : true;
    }
    case 'stink': {
      if (local) return 'done';
      a.next -= dt;
      if (a.next <= 0) {
        a.next = 0.5;
        M.fx.stink && M.fx.stink(p);
        for (const t of enemiesNear(M, p, 7, p.pos, false)) {
          M.combat.damage(p, t, 55 * A, { kind: 'dot' });
          slowDown(t, 0.35, 0.7);
          if (Math.random() < 0.3) M.fx.say && M.fx.say(t, 'くさっ', 'stink');
        }
      }
      return a.t >= a.dur || !p.alive ? 'done' : true;
    }
    case 'press': {
      // 0：上へ（0.45秒）→ 1：下へドスン → 着地（または0.7秒）で衝撃
      if (a.phase === 0) {
        p.vel.set(p.vel.x * 0.3, 15, p.vel.z * 0.3);
        if (a.t > 0.45) {
          a.phase = 1;
          a.t1 = a.t;
        }
        return true;
      }
      p.vel.set(0, -42, 0);
      if (p.ground || a.t - a.t1 > 0.7) {
        p.vel.set(0, 0, 0);
        if (!local) {
          M.fx.shock && M.fx.shock(p.pos, 0xff8a3d, 13);
          M.fx.boom && M.fx.boom(p.pos, 0xffb04a, 6);
          M.fx.say && M.fx.say(p, 'ドスン!!', 'beat', 1.3);
          M.shake(0.8, 0.5);
          for (const t of enemiesNear(M, p, 13)) {
            _v2.subVectors(t.pos, p.pos);
            _v2.y = Math.max(_v2.y, 2);
            _v2.normalize();
            M.combat.damage(p, t, (t.isGuardian ? 800 : 600) * A, { elem: true, kind: 'special', heavy: true, dir: _v2.clone(), knock: 18, stun: 1.4 });
          }
          M.sfx('boom', p);
        }
        return 'done';
      }
      return true;
    }
    case 'beam': {
      p.vel.multiplyScalar(Math.exp(-4 * dt));
      if (local) return a.t >= a.dur ? 'done' : true;
      a.next -= dt;
      if (a.next <= 0) {
        a.next = 0.2;
        _v.copy(p.forward);
        for (const t of M.combat.targetsFor(p)) {
          _v2.subVectors(t.pos, p.pos);
          const along = _v2.dot(_v);
          if (along < -1 || along > 26) continue;
          _v3.copy(p.pos).addScaledVector(_v, along);
          if (_v3.distanceTo(t.pos) > 3.5 + (t.radius || 0.8)) continue;
          _v2.normalize();
          if (M.combat.damage(p, t, (t.isGuardian ? 140 : 110) * A, { elem: true, kind: 'special', dir: _v2.clone(), knock: 6 }) > 0) burn(t, p, 40 * A, 2);
        }
      }
      return a.t >= a.dur ? 'done' : true;
    }
  }
  return false;
}

// 効き目が切れたとき（一気飲み→酔う、ブチギレ→冷める）
export function onModEnd(S, p, tag) {
  const M = S.match;
  if (tag === 'chug') {
    p.drunkT = 2.5;
    M.fx.say && M.fx.say(p, 'ヒック…', 'drunk');
  } else if (tag === 'snap') {
    slowDown(p, 0.3, 2);
    M.fx.say && M.fx.say(p, '…冷めた', 'water');
  }
}
// 激辛マッスルが終わったら、カフェオレで少し回復
export function onBigEnd(S, p) {
  if (p.def.id === 'takanobu' && p.alive) {
    p.heal(p.maxHp * 0.2);
    S.match.fx.say && S.match.fx.say(p, 'カフェオレ…ふう', 'eat');
  }
}

// ダメージを受けたあと（こうたがキレる）
export function onDamaged(S, t, src, dmg) {
  const M = S.match;
  if (!t || t.isGuardian || !t.def) return;
  if (t.def.id === 'kouta' && t.alive && dmg >= 60 && !t.hasMod('snap') && (t.temperCd || 0) <= M.time) {
    t.addMod('temper', { atk: 0.35 }, 3);
    t.temperCd = M.time + 6;
    M.fx.say && M.fx.say(t, 'イラッ', 'rage');
  }
}
// だれかが倒されたとき（しょうたは笑う）
export function onKO(S, victim, killer) {
  const M = S.match;
  if (!killer || !killer.def) return;
  for (const p of M.punchers) {
    if (p.def.id !== 'shouta' || !p.alive || p.team !== killer.team) continue;
    p.heal(p.maxHp * 0.05, true);
    M.fx.laughs && M.fx.laughs(p);
  }
}

// CPU：スキルを使うか（キャラごとのヒント ai: {r:[近,遠], heal, hpLow}）
export function aiWantsKS(M, p, target, td, hpLow) {
  const h = p.def.skill.ai || {};
  if (h.hpLow) return hpLow || p.hp < p.maxHp * 0.6;
  if (h.heal) {
    if (hpLow) return true;
    for (const a of M.punchers) if (a.team === p.team && a.alive && a.hp < a.maxHp * 0.55 && a.pos.distanceTo(p.pos) < 14) return true;
  }
  if (!target) return false;
  const r = h.r || [0, 12];
  return td >= r[0] && td <= r[1];
}
// CPU：スペシャルを使うか（ai: {n, r, lowN, front, team, allies, any}）
export function aiWantsSP(M, p, enemies, hpLow) {
  const h = p.def.special.ai || { n: 1, r: 13 };
  if (h.any) return enemies.length > 0;
  if (h.allies) {
    let hurt = 0;
    for (const a of M.punchers) if (a.team === p.team && a.alive && a.hp < a.maxHp * 0.6) hurt++;
    return hurt >= 2 || (hpLow && hurt >= 1);
  }
  let n = 0;
  for (const e of enemies) {
    _v.subVectors(e.pos, p.pos);
    const d = _v.length();
    if (d > (h.r || 13)) continue;
    if (h.front && d > 2 && _v.dot(p.forward) / d < 0.6) continue;
    n++;
  }
  if (h.team) return n >= 1;
  return n >= (h.n || 1) || (hpLow && h.lowN != null && n >= h.lowN);
}
