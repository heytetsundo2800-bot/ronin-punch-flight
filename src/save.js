// セーブデータ（端末に保存。アカウントがあればサーバーにも預ける）
import { store } from './util.js';
import { PUNCHERS, OMAMORI, OMAMORI_IDS } from './characters.js';
import { rankOf } from './config.js';

const KEY = 'rpf_save_v1';

export function defaultSave() {
  const decks = {};
  for (const id of Object.keys(PUNCHERS)) decks[id] = PUNCHERS[id].omamori.slice();
  const om = {};
  for (const id of Object.keys(PUNCHERS)) for (const o of PUNCHERS[id].omamori) om[o] = { lv: 1, n: 1 };
  return {
    v: 1,
    name: '',
    char: 'tora',
    mode: 'scramble',
    stage: 'random',
    diff: 'normal',
    decks,
    om,
    rp: 0,
    best: 0,
    wins: 0,
    loses: 0,
    draws: 0,
    plays: 0,
    kos: 0,
    mvp: 0,
    bags: 0,
    tutorial: false,
    week: { id: '', pt: 0 },
    created: Date.now(),
    updated: Date.now(),
    charStats: {},
  };
}

export function loadSave() {
  const s = store.get(KEY, null);
  const d = defaultSave();
  if (!s || typeof s !== 'object') return d;
  // 足りない項目をおぎなう
  const out = { ...d, ...s };
  out.decks = { ...d.decks, ...(s.decks || {}) };
  out.om = { ...d.om, ...(s.om || {}) };
  for (const id of Object.keys(out.decks)) {
    const deck = out.decks[id];
    if (!Array.isArray(deck) || deck.length !== 4 || deck.some((o) => !OMAMORI[o])) out.decks[id] = d.decks[id];
  }
  out.week = s.week || d.week;
  return out;
}

export function saveSave(s) {
  s.updated = Date.now();
  store.set(KEY, s);
}

// 日本時間の月曜0時で切りかわる週
export function weekId(now = Date.now()) {
  const jst = new Date(now + 9 * 3600 * 1000);
  const day = (jst.getUTCDay() + 6) % 7; // 月=0
  const mon = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() - day));
  return mon.toISOString().slice(0, 10);
}

// 試合の結果を記録して、もらえる物を返す
export function applyResult(s, r) {
  s.plays++;
  const myWin = r.win;
  let gain = myWin > 0 ? 30 : myWin === 0 ? 8 : -10;
  const mvp = r.mvp && r.mvp[r.me.team] === r.me;
  if (mvp) gain += 10;
  gain += Math.min(10, r.me.stats.ko * 2);
  if (myWin < 0) gain = Math.max(-10, gain - 0);
  const before = s.rp;
  s.rp = Math.max(0, s.rp + gain);
  s.best = Math.max(s.best, s.rp);
  if (myWin > 0) s.wins++;
  else if (myWin < 0) s.loses++;
  else s.draws++;
  s.kos += r.me.stats.ko;
  if (mvp) s.mvp++;
  const wk = weekId();
  if (s.week.id !== wk) s.week = { id: wk, pt: 0 };
  const pt = Math.max(0, r.me.stats.score + (myWin > 0 ? 300 : myWin === 0 ? 120 : 60));
  s.week.pt += pt;
  const cs = s.charStats[r.char] || { plays: 0, wins: 0 };
  cs.plays++;
  if (myWin > 0) cs.wins++;
  s.charStats[r.char] = cs;
  // ディスクパック：勝ち・MVPでもらえる
  let bags = myWin > 0 ? 1 : 0;
  if (mvp) bags++;
  if (s.plays === 1) bags = Math.max(bags, 1);
  const prizes = [];
  for (let i = 0; i < bags; i++) prizes.push(openBag(s));
  saveSave(s);
  return { gain, before, after: s.rp, rankBefore: rankOf(before), rankAfter: rankOf(s.rp), weekPt: pt, prizes, mvp };
}

const RARE_W = { N: 50, R: 34, SR: 13, UR: 3 };
export function openBag(s) {
  const pool = [];
  for (const id of OMAMORI_IDS) {
    const o = OMAMORI[id];
    pool.push([id, RARE_W[o.rare] || 10]);
  }
  let total = pool.reduce((a, b) => a + b[1], 0);
  let r = Math.random() * total;
  let pickId = pool[0][0];
  for (const [id, w] of pool) {
    r -= w;
    if (r <= 0) {
      pickId = id;
      break;
    }
  }
  const cur = s.om[pickId];
  let isNew = false, lvUp = false;
  if (!cur) {
    s.om[pickId] = { lv: 1, n: 1 };
    isNew = true;
  } else {
    cur.n++;
    const need = [0, 2, 3, 4, 5, 99][cur.lv];
    if (cur.lv < 5 && cur.n >= need) {
      cur.lv++;
      cur.n = 0;
      lvUp = true;
    }
  }
  return { id: pickId, isNew, lvUp, lv: s.om[pickId].lv };
}

export function omLevel(s, id) {
  return (s.om[id] && s.om[id].lv) || 1;
}
