// 遊びごこちの数字（ここを変えると操作感がかわる）
export const VERSION = '1.2.0';
export const BUILD = '2026-10-21';

export const MATCH_TIME = 180; // 3分
export const RESPAWN_TIME = 5; // 復活までの秒数
export const RESPAWN_INVULN = 2.0;

export const MOVE = {
  flySpeed: 14.5, // 長押しで飛ぶ速さ (m/s)
  accel: 7.5, // 速さに近づく強さ
  brake: 5.0, // 指を離したときの止まりかた
  hardBrake: 14, // 下フリックの急ブレーキ
  dashSpeed: 36, // タップのブーストダッシュ
  dashTime: 0.32, // ダッシュの長さ
  dashCost: 1, // 1回でブーストゲージ1マス
  boostMax: 3,
  boostRegenAir: 0.33, // 空中は約3秒で1マス回復（キックフライトと同じ）
  boostRegenFly: 0.33,
  boostRegenGround: 2.0, // 地面に立つと約0.5秒で1マス
  yawRate: 2.9, // 最大の旋回の速さ (rad/s)
  pitchRate: 2.2,
  pitchLimit: 1.35, // 上下の向きの限界 (rad) ≒ 77°
  stickRadius: 58, // 仮想スティックの半径 (px)
  stickDead: 7,
  dodgeSpeed: 24,
  dodgeTime: 0.26,
  dodgeInvuln: 0.3,
  dodgeCooldown: 0.42,
  justWindow: 0.16, // ジャスト回避の受付
  quickTurnTime: 0.22, // 横フリックの素早い方向転換
  uturnTime: 0.3,
  carrySlowPer: 0.011, // 1個持つごとに遅くなる割合
  carrySlowMax: 0.42,
  radius: 0.75, // キャラの当たりの大きさ
  arena: { x: 118, zMin: -150, zMax: 150, yMin: 0.8, yMax: 96 },
};

export const COMBAT = {
  autoRange: 3.4, // 近接の自動攻撃が始まる距離
  autoCone: 0.62, // 前方のどれくらいの角度で自動攻撃するか（cos）
  lockRange: 46, // ロックオンが外れる距離
  lockCandidates: 3, // 右に出す敵アイコンの数
  candidateRange: 40,
  hitStop: 0.055,
  knockback: 17,
  stunHeavy: 0.45,
  elemAdv: 1.2,
  elemDis: 0.8,
  specialPerDamage: 1 / 5200, // 与えたダメージでたまるスペシャル
  specialPerSec: 1 / 95,
  specialPerPickup: 0.012,
  skillInvuln: 0.25, // スキルを出した瞬間の無敵
  dashAttackBonus: 1.6,
};

// 属性：赤（火）＞緑（風）＞青（水）＞赤（火）
export const ELEM = {
  fire: { name: '火', color: '#ff4d4d', hex: 0xff4d4d, beats: 'wind' },
  wind: { name: '風', color: '#38d16a', hex: 0x38d16a, beats: 'water' },
  water: { name: '水', color: '#3aa0ff', hex: 0x3aa0ff, beats: 'fire' },
};
export function elemMul(atk, def) {
  if (!atk || !def) return 1;
  if (ELEM[atk].beats === def) return COMBAT.elemAdv;
  if (ELEM[def].beats === atk) return COMBAT.elemDis;
  return 1;
}

export const TEAM = {
  0: { key: 'blue', name: '青チーム', color: '#2f8cff', hex: 0x2f8cff, light: 0x9fd0ff, dark: 0x1b4f9c },
  1: { key: 'red', name: '赤チーム', color: '#ff3f5e', hex: 0xff3f5e, light: 0xffb3c0, dark: 0x9c1b33 },
};

export const MODES = {
  scramble: {
    key: 'scramble',
    name: 'スクランブル',
    sub: 'サクラを集めて3分後に多いチームの勝ち',
    howto: [
      'フィールドのサクラ（全50個）を、近くを通って集めよう',
      '自分のチームのダルマに近づくと、持っているサクラを預けられる',
      '倒されると、持っていたサクラは元の場所にもどる',
      'ダルマが攻撃されると、預けたサクラがこぼれる',
      '持つほど遅くなる。3分たったときに多いチームの勝ち！',
    ],
  },
  flag: {
    key: 'flag',
    name: 'フラッグフライト',
    sub: '敵陣の旗を自分のゴールへ。先に3本運んだら勝ち',
    howto: [
      '敵の陣地の奥に、自分のチームの旗が1本ずつ出る',
      '旗にふれると運べる（運べるのは1人だけ）',
      '自分のチームのゴールまで運ぶと1本。先に3本で勝ち',
      '運んでいる人が倒されると旗を落とす',
      '時間切れのときは、本数→ゴールまでの近さで決まる',
    ],
  },
  ball: {
    key: 'ball',
    name: 'ラピッドボール',
    sub: 'ボールを運んで敵のゴールリングをくぐれ',
    howto: [
      'フィールドのボールにふれると持てる（6個まで。持つほど遅くなる）',
      '敵のゴールリングはダルマのバリアで閉じている',
      '敵のダルマを攻撃するとリングが開く！',
      '開いたリングをくぐると、持っているボールの数だけ点',
      '残り1分で、10点のラピッドボールが出る！',
    ],
  },
};

// ステージ（random は試合のたびにどちらか）
export const STAGES = {
  sakura: { key: 'sakura', name: 'サクラ浮島', short: 'サクラ浮島', icon: '🌸', sub: '合格祈願の神社がうかぶ昼の空' },
  campus: { key: 'campus', name: 'あこがれキャンパス', short: 'キャンパス', icon: '🍂', sub: '夕焼けの大学。時計台と渡り廊下' },
};
export const STAGE_KEYS = Object.keys(STAGES);
export const STAGE_CHOICES = ['random', ...STAGE_KEYS];
export function stageLabel(k) {
  return STAGES[k] ? STAGES[k].icon + ' ' + STAGES[k].short : '🎲 おまかせ';
}
export function resolveStage(k) {
  return STAGES[k] ? k : STAGE_KEYS[Math.floor(Math.random() * STAGE_KEYS.length)];
}

export const DIFFICULTY = {
  easy: { name: 'やさしい', aim: 0.55, react: 0.75, dodge: 0.08, skill: 0.4, dmg: 0.8 },
  normal: { name: 'ふつう', aim: 0.8, react: 0.42, dodge: 0.22, skill: 0.7, dmg: 1.0 },
  hard: { name: 'つよい', aim: 0.95, react: 0.22, dodge: 0.42, skill: 1.0, dmg: 1.12 },
};

// ランク（C→B→A→S→S+）
export const RANKS = [
  { key: 'C', min: 0 },
  { key: 'B', min: 100 },
  { key: 'A', min: 260 },
  { key: 'S', min: 520 },
  { key: 'S+', min: 1000 },
];
export function rankOf(rp) {
  let r = RANKS[0];
  for (const x of RANKS) if (rp >= x.min) r = x;
  const i = RANKS.indexOf(r);
  const next = RANKS[i + 1];
  return { key: r.key, min: r.min, next: next ? next.min : null, idx: i };
}
