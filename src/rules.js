// 試合のルールの説明（v1.7）：どんなルールか・勝ち方・気をつけること・コツ・図
// 数字はゲームの中身（modes.js・config.js）と同じにしてある。ルールを変えたら、ここも直す

export const RULE_TEXT = {
  scramble: {
    name: 'スクランブル',
    short: 'スクランブル',
    tag: 'サクラ集め',
    goal: 'サクラを拾って、自分のダルマへ！3分後に多いほうが勝ち',
    what: '空にうかぶサクラ（全50個）を集めて、自分のチームのダルマに預けるルール。3分たったとき、サクラが多いチームの勝ち。',
    how: [
      'サクラの近くを飛ぶと、自動で拾える',
      '自分のチームのダルマ（青チームなら青）に近づくと、自動で預けられる',
      '「預けたサクラ＋みんなが持っているサクラ」がチームの点',
      '3分たったときに点が多いチームの勝ち（同じなら引き分け）',
    ],
    care: [
      '持ったまま倒されると、持っていたサクラは元の場所にもどる。こまめに預けよう',
      'たくさん持つほど遅くなる',
      '敵のダルマを攻撃すると、預けてあるサクラがこぼれて元の場所にもどる（相手の点がへる）',
      'サクラを預けているダルマは、近くに来た敵を撃ってくる',
    ],
    tips: ['10個くらい拾ったら、いったん預けに帰る', 'サクラをたくさん持っている敵をたおすと、相手の点がへる'],
  },
  flag: {
    name: 'フラッグフライト',
    short: 'フラッグ',
    tag: '旗運び',
    goal: '敵陣の旗を、自分のゴールへ！先に3本で勝ち',
    what: '自分のチームの旗を、自分のチームのゴールまで運ぶルール。先に3本運んだチームの勝ち。',
    how: [
      '自分のチームの旗は、敵の陣地の奥に出る（ミニマップにも出る）',
      '旗にさわると持てる（運べるのは1人だけ。持つと遅くなる）',
      '自分のチームのゴール（光る輪）まで運ぶと1本',
      '先に3本運んだら、その場で勝ち（ノックアウト勝利）',
    ],
    care: [
      '運んでいる人が倒されたり、強く止められたりすると旗を落とす',
      '敵に自分の旗を8秒持たれると、旗は元の場所にもどされる',
      '3分たったら本数が多いほうの勝ち。同じなら、旗をゴールに近づけたほうの勝ち',
    ],
    tips: ['味方が旗を持ったら、まわりの敵をたおして守る', '敵の運び屋をねらって、旗を落とさせる'],
  },
  ball: {
    name: 'ラピッドボール',
    short: 'ボール',
    tag: 'ボール入れ',
    goal: '敵のダルマをたおして、開いたリングをくぐれ！',
    what: 'ボールを集めて、敵のゴールリングをくぐるルール。3分たったとき、点が多いチームの勝ち。',
    how: [
      'フィールドのボールにさわると持てる（6個まで。持つほど遅くなる）',
      '敵のゴールリングは、ダルマのバリアで閉じている',
      '敵のダルマを攻撃してたおすと、15秒だけリングが開く',
      '開いたリングをくぐると、持っているボールの数だけ点が入る',
    ],
    care: [
      '残り1分で、10点の「ラピッドボール」（虹色）が出る',
      'ダルマは近くの敵を撃ってくる。攻撃をやめると少しずつ回復する',
      '時間がきたとき、負けているチームが相手のゴールを開けていたら延長（最大25秒）',
    ],
    tips: ['ダルマをたたく人と、ボールを持って待つ人に分かれる', 'リングが開いたら、ボールを持っている人が一気にくぐる'],
  },
};

// ルールの図（左が自分のチーム・右が敵）
const BLUE = '#3aa0ff', RED = '#ff3f5e', PINK = '#ff8fc0', Y = '#ffd400', CY = '#3be6ff';
function daruma(x, y, c, label) {
  return `<g transform="translate(${x},${y})"><ellipse cx="0" cy="4" rx="17" ry="19" fill="${c}"/><ellipse cx="0" cy="-3" rx="10" ry="8" fill="#fff"/><circle cx="-4" cy="-4" r="2" fill="#111"/><circle cx="4" cy="-4" r="2" fill="#111"/><text x="0" y="38" fill="#cfe0ff" font-size="11" text-anchor="middle" font-weight="800">${label}</text></g>`;
}
function arrow(x1, y1, x2, y2, c, label, ly = -8) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  return `<path d="M${x1} ${y1} Q ${mx} ${my - 26} ${x2} ${y2}" stroke="${c}" stroke-width="3" fill="none" stroke-dasharray="6 5" marker-end="url(#ah${c.slice(1)})"/>${label ? `<text x="${mx}" y="${my - 18 + ly}" fill="${c}" font-size="12" text-anchor="middle" font-weight="900">${label}</text>` : ''}`;
}
function defs(cols) {
  return `<defs>${cols.map((c) => `<marker id="ah${c.slice(1)}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="${c}"/></marker>`).join('')}</defs>`;
}
function me(x, y) {
  return `<g transform="translate(${x},${y})"><circle r="9" fill="#f2c4a0" stroke="#111" stroke-width="2"/><circle cx="-6" cy="9" r="5" fill="${BLUE}"/><circle cx="6" cy="9" r="5" fill="${BLUE}"/></g>`;
}
export function ruleSvg(k) {
  const W = 320, H = 132;
  let g = '';
  if (k === 'scramble') {
    for (const [x, y] of [[112, 104], [140, 94], [178, 36], [196, 84], [214, 54], [168, 110], [236, 96], [92, 96]]) g += `<path d="M${x} ${y - 7} l5 7 -5 7 -5 -7z" fill="${PINK}" stroke="#fff" stroke-width="1"/>`;
    g += daruma(44, 62, BLUE, '自分のダルマ') + daruma(278, 62, RED, '敵のダルマ');
    g += me(160, 58);
    g += arrow(150, 66, 66, 60, Y, '近づくと預ける');
    g += arrow(200, 30, 258, 46, RED, '攻撃するとこぼれる', -4);
  } else if (k === 'flag') {
    g += `<g transform="translate(50,66)"><ellipse rx="26" ry="9" fill="none" stroke="${BLUE}" stroke-width="4"/><ellipse rx="26" ry="9" fill="${BLUE}" opacity="0.18"/><text x="0" y="34" fill="#cfe0ff" font-size="11" text-anchor="middle" font-weight="800">自分のゴール</text></g>`;
    g += `<g transform="translate(250,48)"><path d="M0 0 v34" stroke="#eee" stroke-width="3"/><path d="M2 2 h22 l-5 7 5 7 h-22z" fill="${BLUE}"/><text x="6" y="54" fill="#cfe0ff" font-size="11" text-anchor="middle" font-weight="800">自分の旗（敵陣の奥）</text></g>`;
    g += `<rect x="208" y="16" width="104" height="100" fill="${RED}" opacity="0.08"/><text x="292" y="30" fill="${RED}" font-size="10" text-anchor="end" font-weight="800">敵の陣地</text>`;
    g += me(196, 58);
    g += arrow(232, 60, 84, 64, Y, '持って運ぶ → 1本');
  } else {
    // ボールは下のほう（矢印や文字と重ならないように）
    for (const [x, y] of [[74, 106], [100, 116], [126, 102], [152, 114]]) g += `<circle cx="${x}" cy="${y}" r="7" fill="#fff6d8" stroke="#ff8a3d" stroke-width="2"/>`;
    g += `<circle cx="180" cy="106" r="9" fill="url(#rb)"/><defs><linearGradient id="rb"><stop offset="0" stop-color="#ff4d4d"/><stop offset="0.5" stop-color="#ffe94d"/><stop offset="1" stop-color="#4dc3ff"/></linearGradient></defs>`;
    g += daruma(234, 72, RED, '敵のダルマ');
    g += `<g transform="translate(294,68)"><ellipse rx="10" ry="26" fill="none" stroke="${RED}" stroke-width="4"/><ellipse rx="10" ry="26" fill="${CY}" opacity="0.25"/></g>`;
    g += me(36, 68);
    g += arrow(48, 62, 212, 66, RED, '① ダルマをたおす', -6);
    g += arrow(238, 38, 286, 50, Y, '② リングをくぐる', -4);
  }
  return `<svg class="rulesvg" viewBox="0 0 ${W} ${H}" role="img" aria-label="ルールの図">${defs([Y, RED])}<rect x="0" y="0" width="${W}" height="${H}" rx="0" fill="rgba(2,6,16,0.55)"/>${g}</svg>`;
}

// 説明の中身（モーダルに入れる HTML）
export function ruleHtml(k, esc = (s) => s) {
  const R = RULE_TEXT[k] || RULE_TEXT.scramble;
  return `<div class="rulebody">
    <div class="rtop"><b>${esc(R.name)}</b><span class="rtag">${esc(R.tag)}</span></div>
    <p class="rwhat">${esc(R.what)}</p>
    ${ruleSvg(k)}
    <h4>勝ち方</h4><ol class="rhow">${R.how.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
    <h4>気をつけること</h4><ul class="rcare">${R.care.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <h4>コツ</h4><ul class="rtips">${R.tips.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
  </div>`;
}
