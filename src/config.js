// 遊びごこちの数字（ここを変えると操作感がかわる）
export const VERSION = '1.8.0';
export const BUILD = '2026-10-27';

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
  // v1.8：ロックオンを本物のキックフライトに近づけて弱く（前は 約53m まで外れず、向きは吸いつき、ダッシュ攻撃は必ず当たった）
  lockRange: 40, // ロックオンが外れる距離（前は 46×1.15≒53m）
  lockCandidates: 3, // 右に出す敵アイコンの数
  candidateRange: 36, // 右に敵アイコンが出る距離・敵をタップしてロックできる距離（外れる距離より少し短く）
  lockOutTime: 1.0, // 敵が視界の外にこれだけ出ていたら外れる（秒）
  lockGrace: 1.2, // ロックした直後は、ふり向くあいだ少し長く待つ（秒）
  lockTurn: 3.5, // ロック中に敵のほうへ向く強さ（前は 7）
  lockTurnSteer: 1.25, // 自分で向きを変えているときの強さ（前は 2.5）
  lockTurnMax: 4.0, // 向く速さの上限（rad/秒）
  dashAtkRange: 12, // ロック中のタップがダッシュ攻撃になる距離（前は 18m）
  dashAtkTurn: 2.4, // ダッシュ攻撃が相手を追って曲がれる速さ（rad/秒。前は 無限＝必ず当たる）
  dashAtkHit: 1.6, // ダッシュ攻撃が当たる近さ（＋相手の大きさ。前は 2.6）
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
      '自分のチームのダルマに近づくと、持っているサクラを自動で預ける',
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
  sakura: { key: 'sakura', name: 'サクラ浮島', short: 'サクラ浮島', sub: '合格祈願の神社がうかぶ昼の空' },
  campus: { key: 'campus', name: 'あこがれキャンパス', short: 'キャンパス', sub: '夕焼けの大学。時計台と渡り廊下' },
};
export const STAGE_KEYS = Object.keys(STAGES);
export const STAGE_CHOICES = ['random', ...STAGE_KEYS];
export function stageLabel(k) {
  return STAGES[k] ? STAGES[k].short : 'おまかせ';
}
export function resolveStage(k) {
  return STAGES[k] ? k : STAGE_KEYS[Math.floor(Math.random() * STAGE_KEYS.length)];
}

// CPUの強さ（v1.7 で6段階。弱いほうから）
//   atk：攻撃するか　atkRate：攻撃の間の長さ（倍）　dmg：与えるダメージ（倍）　skill：技を使う割合　sp：スペシャルを使うか
//   disc：ディスク（none＝使わない／safe＝攻撃しないものだけ／all）　aim：ねらいの正確さ　react：考え直す間（秒）
//   dodge：よける割合　speed：飛ぶ速さ（倍）　chase：敵を追いかける割合　guard：ダルマの弾（倍。0＝撃たない）
//   omLv：ディスクのレベル　pts：勝ったときのランクの点・今週の点（倍。弱いCPUに勝っても点は少なめ）
//   前の「やさしい／ふつう／つよい」より全体に弱くした（前の「ふつう」≒今の「つよい」、前の「つよい」＝今の「鬼」）
export const DIFFICULTY = {
  zero: { lv: 1, name: 'おさんぽ', desc: '攻撃してこない。のんびり飛んでサクラを拾うだけ', atk: false, atkRate: 0, dmg: 0, skill: 0, sp: false, disc: 'none', aim: 0.3, react: 1.4, dodge: 0, speed: 0.72, chase: 0, guard: 0, omLv: 1, pts: 0.2 },
  weak: { lv: 2, name: 'よわよわ', desc: 'たまに攻撃してくるけど、ダメージはとても小さい。技は使わない', atk: true, atkRate: 3.2, dmg: 0.25, skill: 0, sp: false, disc: 'safe', aim: 0.4, react: 1.1, dodge: 0, speed: 0.84, chase: 0.25, guard: 0.3, omLv: 1, pts: 0.4 },
  easy: { lv: 3, name: 'やさしい', desc: '攻撃してくる。ダメージは小さめで、技はときどき', atk: true, atkRate: 1.8, dmg: 0.55, skill: 0.25, sp: true, disc: 'all', aim: 0.5, react: 0.85, dodge: 0.04, speed: 0.92, chase: 0.55, guard: 0.6, omLv: 1, pts: 0.7 },
  normal: { lv: 4, name: 'ふつう', desc: 'ふつうに戦う。技も使う', atk: true, atkRate: 1.25, dmg: 0.8, skill: 0.5, sp: true, disc: 'all', aim: 0.66, react: 0.6, dodge: 0.1, speed: 0.97, chase: 0.85, guard: 0.85, omLv: 2, pts: 1 },
  hard: { lv: 5, name: 'つよい', desc: 'よけたり、技をどんどん使ったりする', atk: true, atkRate: 1.0, dmg: 1.0, skill: 0.75, sp: true, disc: 'all', aim: 0.82, react: 0.42, dodge: 0.24, speed: 1, chase: 1, guard: 1, omLv: 2, pts: 1.25 },
  oni: { lv: 6, name: '鬼', desc: 'ほぼ全力。うまい人むけ', atk: true, atkRate: 0.95, dmg: 1.12, skill: 1, sp: true, disc: 'all', aim: 0.95, react: 0.22, dodge: 0.42, speed: 1.03, chase: 1, guard: 1, omLv: 3, pts: 1.5 },
};
export const DIFF_KEYS = Object.keys(DIFFICULTY);
// 知らない名前のときは「やさしい」（前の版の「つよい」→「鬼」の読みかえは save.js）
export function diffKey(k) {
  return DIFFICULTY[k] ? k : 'easy';
}
// 一人で遊ぶとき、味方のCPUの強さ（弱い段階でも味方は少しだけ手伝う）
export function allyDiffKey(k) {
  const lv = (DIFFICULTY[k] || DIFFICULTY.easy).lv;
  if (lv <= 2) return 'easy';
  if (lv <= 4) return 'normal';
  return k;
}

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
