// 浪人パンチフライト：アカウント・ランキングのサーバー（/api/rpf）
// ・Vercel の Node 関数（CommonJS）。npm のパッケージは使わない（fetch と crypto だけ）
// ・データベースは Upstash Redis の REST API。ほかのアプリと共用なので、キーは必ず "rpf:" で始める
//   （KEYS・SCAN・FLUSHDB のような、データベース全体にさわる命令は使わない）
// ・クライアントは src/net.js。返す形はそちらに合わせる
'use strict';

const crypto = require('crypto');

// ===== 決まりごと =====
const NAME_MAX = 10; // 名前の長さ（コードポイントで数える）
const SAVE_MAX = 20000; // 預けるセーブデータの文字数
const BODY_MAX = 64 * 1024; // リクエストの大きさ
const CHARS = ['tora', 'even', 'aomachi', 'tetsundo', 'naot', 'toriki', 'koudai', 'mana', 'shouta', 'ayana', 'hayata', 'takanobu', 'kouta', 'masashi', 'kousei', 'chijiwa', 'minori', 'yuka']; // キャラ（v1.5 で18人）
// NGワード（クライアントと同じ。大文字小文字と空白は無視して、ふくまれていたらだめ）
const NG = ['死ね', 'しね', '殺す', 'ころす', 'ちんこ', 'まんこ', 'うんこ', 'セックス', 'fuck', 'shit', 'bitch', 'nigger', 'admin', '運営'];
const NG_N = NG.map((w) => w.normalize('NFKC').toLowerCase());
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 見まちがえにくい32文字（I・O・0・1 なし）
const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';
const TOP = 50; // ランキングに出す人数
const FRIEND_MAX = 100;
const RP_STEP = 60; // ランクポイント：1回の同期で増やせる量
const WPT_STEP = 2500; // 週のポイント：1回の同期・1試合で増やせる量
const NUM_MAX = 1e9; // これより大きい数はおかしいので、はねる
const DAY = 86400 * 1000;
const WEEK = 7 * DAY;
const WEEK_TTL = 45 * 86400; // 週のランキングは45日で消える
const CODE_TTL = 30 * 86400; // 引き継ぎコードは30日で使えなくなる
const REPORT_KEEP = 300; // 不具合の報告は新しい300件だけ残す
const REPORT_TEXT = 500; // 報告の本文の文字数
const REPORT_INFO = 4000; // 端末の情報（JSON）の文字数
const REPORT_SALT = ':rpf-report-v1'; // 報告に残す IP ハッシュ用
const DB_TIMEOUT = 6000;
const PING_TIMEOUT = 2500;
const PING_CACHE = 20 * 1000; // つながった結果は20秒おぼえておく
// 回数制限：[回数, 秒]
const LIMIT = {
  ip: [120, 60], // ぜんぶの操作：IPごとに1分120回（試した回数）
  regH: [30, 3600], // 登録：IPごとに1時間30回（学校のWi-Fiなど、同じIPから何人も登録することがある）
  regD: [100, 86400], // 登録：IPごとに1日100回（登録できた回数）
  restore: [12, 900], // 引き継ぎコードを試す：IPごとに15分12回（試した回数）
  sync: [40, 600], // 同期：uid ごとに10分40回（受けつけた回数）
  report: [5, 3600], // 不具合の報告：IPごとに1時間5回
  rmk: [20, 3600], // 部屋をつくる：IPごとに1時間20回
  rmj: [60, 3600], // 部屋に入る：IPごとに1時間60回
  rmio: [400, 60], // 部屋の手紙の送り受け：IPごとに1分400回（同じWi-Fiに何人もいるとき用。ふつうの制限とは別）
};
const UID_RE = /^[0-9a-z]{6,20}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;
const FC_RE = /^[A-HJ-NP-Z2-9]{8}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const WK_RE = /^\d{4}-\d{2}-\d{2}$/;

// ===== キー（すべて rpf: で始まる）=====
const K = {
  user: (uid) => 'rpf:u:' + uid, // ハッシュ：その人の情報（トークンはハッシュだけ）
  pub: 'rpf:pub', // ハッシュ：uid → {"n":名前,"c":キャラ}（ランキングに出す用）
  fc: (fc) => 'rpf:fc:' + fc, // フレンドコード → uid
  fr: (uid) => 'rpf:fr:' + uid, // セット：フレンドの uid
  all: 'rpf:lb:a', // ランキング（ランクポイント）
  week: (wk) => 'rpf:lb:w:' + wk, // 週のランキング（週のポイント）
  code: (h) => 'rpf:tc:' + h, // 引き継ぎコード（のハッシュ）→ uid
  rl: (kind, id) => 'rpf:rl:' + kind + ':' + id, // 回数制限のカウンター
  reports: 'rpf:reports', // リスト：不具合の報告（新しい順）
  room: (code) => 'rpf:rm:' + code, // オンライン対戦の部屋（JSON）
  rq: (code, pid) => 'rpf:rq:' + code + ':' + pid, // リスト：部屋の中の手紙（接続のあいさつ）
};

class ApiError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
const fail = (status, code) => {
  throw new ApiError(status, code);
};

// ===== 小さな道具 =====
const sha = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
const randStr = (alpha, n) => {
  let s = '';
  for (let i = 0; i < n; i++) s += alpha[crypto.randomInt(alpha.length)];
  return s;
};
const newToken = () => crypto.randomBytes(32).toString('base64url');
const int0 = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
// 送られてきた数（0以上の整数）
function count(v) {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > NUM_MAX) fail(400, 'bad');
  return v;
}

// 日本時間の月曜0時で切りかわる週（クライアントの save.js と同じ計算）
function weekId(now = Date.now()) {
  const jst = new Date(now + 9 * 3600 * 1000);
  const day = (jst.getUTCDay() + 6) % 7; // 月=0
  const mon = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() - day));
  return mon.toISOString().slice(0, 10);
}

// 名前のチェック（だめなら 400）
const BAD_CHARS = /[\p{Cc}\p{Co}\p{Zl}\p{Zp}]|(?!\u200d)\p{Cf}/u; // 制御文字・書式文字（絵文字をつなぐ ZWJ はOK）
const BLANKS = /[\s\u115f\u1160\u3164\uffa0\u2800\u200d\ufe0e\ufe0f]/gu; // 見えない文字
const LONE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g; // 半分に切れた絵文字
function checkName(v) {
  if (typeof v !== 'string' || v.length > 200) fail(400, 'name');
  const name = v.replace(LONE, '').trim();
  const len = [...name].length;
  if (len < 1 || len > NAME_MAX) fail(400, 'name');
  if (BAD_CHARS.test(name)) fail(400, 'name');
  if (!name.replace(BLANKS, '')) fail(400, 'name'); // 見えない文字だけ
  const s = name.normalize('NFKC').toLowerCase().replace(/\s/g, '');
  if (NG_N.some((w) => s.includes(w))) fail(400, 'ng');
  return name;
}
function checkSave(v, dflt) {
  if (v == null) return dflt;
  if (typeof v !== 'string') fail(400, 'bad');
  if (v.length > SAVE_MAX) fail(400, 'save');
  return v;
}
const pubVal = (n, c) => JSON.stringify({ n, c });
function parsePub(v) {
  if (typeof v !== 'string') return null;
  try {
    const o = JSON.parse(v);
    if (!o || typeof o.n !== 'string') return null;
    return { n: o.n, c: CHARS.includes(o.c) ? o.c : 'tora' };
  } catch (e) {
    return null;
  }
}

// ===== データベース（Upstash の REST API）=====
// 環境変数：KV_REST_API_URL/TOKEN、UPSTASH_REDIS_REST_URL/TOKEN、または頭に何かついたもの（例：STORAGE_KV_REST_API_URL）
function dbConf(env = process.env) {
  const pick = (u, t) => {
    const url = env[u], token = env[t];
    if (typeof url !== 'string' || typeof token !== 'string') return null;
    if (!/^https?:\/\/\S+$/i.test(url.trim()) || !token.trim()) return null;
    return { url: url.trim().replace(/\/+$/, ''), token: token.trim() };
  };
  const c = pick('KV_REST_API_URL', 'KV_REST_API_TOKEN') || pick('UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN');
  if (c) return c;
  const suf = [
    ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
    ['REDIS_REST_URL', 'REDIS_REST_TOKEN'],
  ];
  for (const k of Object.keys(env).sort()) {
    for (const [su, st] of suf) {
      if (!k.endsWith(su)) continue;
      const r = pick(k, k.slice(0, -su.length) + st);
      if (r) return r;
    }
  }
  return null;
}

// コマンドをまとめて送る（/pipeline）か、まとめて一度に実行する（/multi-exec）
async function dbReq(conf, path, cmds, timeout) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout || DB_TIMEOUT);
  try {
    const r = await fetch(conf.url + path, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + conf.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmds.map((c) => c.map(String))),
      signal: ctrl.signal,
    });
    const j = await r.json().catch(() => null);
    if (!Array.isArray(j) || j.length !== cmds.length) throw new Error('db http ' + r.status + (j && j.error ? ' ' + j.error : ''));
    return j.map((x, i) => {
      if (!x || typeof x !== 'object' || x.error) throw new Error('db ' + cmds[i][0] + ': ' + (x && x.error));
      return x.result === undefined ? null : x.result;
    });
  } finally {
    clearTimeout(timer);
  }
}
function makeDb(conf) {
  return {
    pipe: (cmds, timeout) => (cmds.length ? dbReq(conf, '/pipeline', cmds, timeout) : Promise.resolve([])),
    tx: (cmds) => (cmds.length ? dbReq(conf, '/multi-exec', cmds) : Promise.resolve([])),
  };
}

// データベースが使えるか（環境変数があって、PING が通る）
let pingOk = { url: '', at: 0 };
async function ready() {
  const conf = dbConf();
  if (!conf) return false;
  if (pingOk.url === conf.url && Date.now() - pingOk.at < PING_CACHE) return true;
  try {
    const [r] = await makeDb(conf).pipe([['PING']], PING_TIMEOUT);
    if (r === 'PONG') {
      pingOk = { url: conf.url, at: Date.now() };
      return true;
    }
  } catch (e) {
    console.error('[rpf] ping: ' + (e && e.message));
  }
  return false;
}

// ===== リクエストまわり =====
// 相手の IP（x-forwarded-for の最初 → x-real-ip → 接続元）。Vercel はこのヘッダーを上書きするので、なりすませない
function clientIp(req) {
  const h = req.headers || {};
  let ip = '';
  if (typeof h['x-forwarded-for'] === 'string' && h['x-forwarded-for'].trim()) ip = h['x-forwarded-for'].split(',')[0].trim();
  else if (typeof h['x-real-ip'] === 'string' && h['x-real-ip'].trim()) ip = h['x-real-ip'].trim();
  else ip = (req.socket && req.socket.remoteAddress) || '';
  ip = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (ip.startsWith('::ffff:') && ip.includes('.')) ip = ip.slice(7);
  return ip.slice(0, 64);
}
// 回数制限に使うキー（IP はそのまま保存しない。IPv6 は /64 でまとめる）
const ipKey = (ip) => sha('rpf-ip:' + (ip.includes(':') ? v6net(ip) : ip)).slice(0, 20);
// 報告に残す IP のハッシュ（IP ＋ 決まった塩 の SHA-256 の先頭16文字）
const reportIpHash = (ip) => sha(ip + REPORT_SALT).slice(0, 16);
// 長すぎる文字列を切る（絵文字を半分に切らない）
const cut = (s, n) => (s.length <= n ? s : s.slice(0, n).replace(/[\ud800-\udbff]$/, ''));
function v6net(ip) {
  const [head, tail] = ip.split('%')[0].split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const full = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return full.slice(0, 4).map((x) => (parseInt(x, 16) || 0).toString(16)).join(':') + '::/64';
}

// Authorization: Bearer <uid>.<token>
function parseAuth(req) {
  const h = req.headers && req.headers.authorization;
  if (typeof h !== 'string' || !h) return null;
  const m = /^Bearer\s+([^.\s]+)\.(\S+)$/.exec(h.trim());
  if (!m || !UID_RE.test(m[1]) || !TOKEN_RE.test(m[2])) return { bad: true };
  return { uid: m[1], token: m[2] };
}
// 保存してあるハッシュと、送られたトークンのハッシュをくらべる（時間で中身がばれない比べ方）
function tokenOk(stored, token) {
  if (typeof stored !== 'string' || !HASH_RE.test(stored)) return false;
  const a = Buffer.from(stored, 'hex');
  const b = crypto.createHash('sha256').update(token, 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

// 本文を読む（Vercel では req.body に入っている。ふつうの Node ではストリームから読む）
function drain(req, keep) {
  return new Promise((resolve, reject) => {
    if (req.readableEnded || typeof req.on !== 'function') return resolve('');
    const chunks = [];
    let size = 0, done = false;
    const end = (err, v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(v);
    };
    const timer = setTimeout(() => end(new ApiError(400, 'bad')), 8000);
    req.on('data', (c) => {
      size += c.length;
      if (keep && size <= BODY_MAX) chunks.push(c);
    });
    req.on('end', () => (size > BODY_MAX ? end(new ApiError(413, 'big')) : end(null, Buffer.concat(chunks).toString('utf8'))));
    req.on('error', () => end(new ApiError(400, 'bad')));
  });
}
async function readBody(req) {
  if (Number((req.headers || {})['content-length'] || 0) > BODY_MAX) {
    await drain(req, false).catch(() => {});
    fail(413, 'big');
  }
  let b;
  try {
    b = req.body; // Vercel では、こわれた JSON だとここで例外になる
  } catch (e) {
    fail(400, 'bad');
  }
  if (b === undefined || b === null) b = await drain(req, true);
  if (Buffer.isBuffer(b)) b = b.toString('utf8');
  if (typeof b === 'string') {
    if (b.length > BODY_MAX) fail(413, 'big');
    try {
      b = b.trim() ? JSON.parse(b) : {};
    } catch (e) {
      fail(400, 'bad');
    }
  } else if (b && typeof b === 'object' && JSON.stringify(b).length > BODY_MAX) fail(413, 'big');
  if (!b || typeof b !== 'object' || Array.isArray(b)) fail(400, 'bad');
  return b;
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(obj === undefined ? undefined : JSON.stringify(obj));
}

// 回数を1ふやす（最初の1回だけ有効期限をつける）
const bump = (key, sec) => [
  ['INCR', key],
  ['EXPIRE', key, sec, 'NX'],
];

// 1回目の通信：回数制限・本人確認・読みたいものを、まとめて送る
//   auth: 'need'（必要）/ 'opt'（あれば使う）/ 'none'（見ない）
//   limits: [[key, 回数, 秒]] … ここで数える（試した回数で数える）。IPごとの制限はいつも入る
//   peek(uid): [[key, 回数]] … 読むだけ。うまくいったときに呼び出し側で bump する
//   extra(uid): いっしょに送る読みとりのコマンド（uid はまだ確かめる前のもの）
//   noIp: true … ふつうの IP ごとの制限を使わない（部屋の手紙は回数が多いので、別の制限を limits で入れる）
async function begin(ctx, { auth = 'need', fields = [], limits = [], peek = null, extra = null, noIp = false } = {}) {
  const a = auth !== 'none' && ctx.auth && !ctx.auth.bad ? ctx.auth : null;
  if (auth === 'need' && !a) fail(401, 'auth');
  const lims = noIp ? limits.slice() : [[K.rl('ip', ctx.ip), ...LIMIT.ip], ...limits];
  const cmds = [];
  for (const [key, , sec] of lims) cmds.push(...bump(key, sec));
  const pk = peek ? peek(a ? a.uid : null) : [];
  const pi = cmds.length;
  for (const [key] of pk) cmds.push(['GET', key]);
  const ui = cmds.length;
  if (a) cmds.push(['HMGET', K.user(a.uid), 'th', ...fields]);
  const xi = cmds.length;
  if (extra) cmds.push(...extra(a ? a.uid : null));
  const r = await ctx.db.pipe(cmds);
  lims.forEach(([, max], i) => {
    if (int0(r[i * 2]) > max) fail(429, 'rl');
  });
  let me = null;
  if (a) {
    const v = Array.isArray(r[ui]) ? r[ui] : [];
    if (tokenOk(v[0], a.token)) {
      me = { uid: a.uid };
      fields.forEach((f, i) => (me[f] = v[i + 1]));
    }
  }
  if (auth === 'need' && !me) fail(401, 'auth');
  pk.forEach(([, max], i) => {
    if (int0(r[pi + i]) >= max) fail(429, 'rl');
  });
  return { me, x: r.slice(xi) };
}

// ===== 操作 =====
const ACTIONS = Object.create(null);

// 登録：{name, c, save} → {uid, token, fc}（トークンを返すのはこの1回だけ。保存するのはハッシュ）
ACTIONS.register = async (ctx, b) => {
  const name = checkName(b.name);
  const c = b.c == null ? 'tora' : b.c;
  if (!CHARS.includes(c)) fail(400, 'char');
  const save = checkSave(b.save, '');
  // 登録の回数制限は「登録できた回数」で数える（ことわられた分は数えない）
  const rh = K.rl('rh', ctx.ip), rd = K.rl('rd', ctx.ip);
  await begin(ctx, {
    auth: 'none',
    peek: () => [
      [rh, LIMIT.regH[0]],
      [rd, LIMIT.regD[0]],
    ],
  });
  const token = newToken();
  const th = sha(token);
  // uid とフレンドコードを決める（かぶったら引き直す）
  let uid = null, fc = null;
  for (let i = 0; i < 8 && !fc; i++) {
    const u = uid || randStr(B36, 10);
    const f = randStr(ALPHA, 8);
    const cmds = uid ? [] : [['HSETNX', K.user(u), 'th', th]];
    cmds.push(['SET', K.fc(f), u, 'NX']);
    const r = await ctx.db.pipe(cmds);
    const gotU = uid ? true : r[0] === 1;
    const gotF = r[r.length - 1] === 'OK';
    if (gotU) uid = u;
    if (gotU && gotF) fc = f;
    else if (gotF) await ctx.db.pipe([['DEL', K.fc(f)]]); // uid がかぶった：つけたコードを外す
  }
  if (!fc) {
    if (uid) await ctx.db.pipe([['DEL', K.user(uid)]]);
    fail(500, 'server');
  }
  const now = ctx.now;
  await ctx.db.tx([
    ['HSET', K.user(uid), 'name', name, 'fc', fc, 'c', c, 'rp', 0, 'pl', 0, 'sus', 0, 'ct', now, 'ut', now, 'save', save],
    ['HSET', K.pub, uid, pubVal(name, c)],
    ...bump(rh, LIMIT.regH[1]),
    ...bump(rd, LIMIT.regD[1]),
  ]);
  return { ok: true, uid, token, fc };
};

// 自分の情報
ACTIONS.me = async (ctx) => {
  const { me } = await begin(ctx, { fields: ['name', 'fc', 'rp', 'c'] });
  return { ok: true, name: me.name || '', fc: me.fc || '', rp: int0(me.rp), c: CHARS.includes(me.c) ? me.c : 'tora' };
};

// 名前を変える（ランキングに出る名前も）
ACTIONS.rename = async (ctx, b) => {
  const name = checkName(b.name);
  const { me } = await begin(ctx, { fields: ['c'] });
  await ctx.db.tx([
    ['HSET', K.user(me.uid), 'name', name, 'ut', ctx.now],
    ['HSET', K.pub, me.uid, pubVal(name, CHARS.includes(me.c) ? me.c : 'tora')],
  ]);
  return { ok: true, name };
};

// 記録を預ける：{rp, wk, wpt, c, plays, save}
// かんたんなチート対策：
//  ・ランクポイントは1回の同期で +60 まで、さらに「プレイ回数×60+60」まで（へるのはそのまま）
//  ・週のポイントは1回の同期で +2500 まで、さらに「今週サーバーが見たプレイ回数×2500」まで（同じ週の中ではへらさない）
//  ・こえたぶんは切りつめて受けとり、sus（あやしい回数）を1ふやす
ACTIONS.sync = async (ctx, b) => {
  const rp = count(b.rp), wpt = count(b.wpt), plays = count(b.plays);
  if (typeof b.wk !== 'string' || !WK_RE.test(b.wk)) fail(400, 'bad');
  const cur = weekId(ctx.now), prev = weekId(ctx.now - WEEK);
  if (b.wk !== cur && b.wk !== prev) fail(400, 'wk');
  const wk = b.wk;
  if (b.c != null && typeof b.c !== 'string') fail(400, 'bad');
  const save = checkSave(b.save, null); // null = 変えない
  const { me } = await begin(ctx, {
    fields: ['name', 'c', 'rp', 'pl', 'wk', 'wpt', 'wpl', 'pwk', 'pwpt', 'pwpl'],
    peek: (uid) => [[K.rl('s', uid), LIMIT.sync[0]]],
  });
  const uid = me.uid;
  let sus = false;
  // プレイ回数（へらさない）。前回からふえたぶん = n
  const pl0 = int0(me.pl);
  const pl = Math.max(pl0, plays);
  const n = Math.max(0, plays - pl0);
  // ランクポイント
  const rp0 = int0(me.rp);
  const rpCap = Math.min(rp0 + RP_STEP, pl * RP_STEP + RP_STEP);
  let rpNew = rp;
  if (rpNew > rpCap) {
    rpNew = rpCap;
    sus = true;
  }
  // 週のポイント（今の週と前の週の2つだけ覚える）
  let slot, w0 = 0, wl = 0;
  if (me.wk === wk) {
    slot = 'cur';
    w0 = int0(me.wpt);
    wl = int0(me.wpl);
  } else if (me.pwk === wk) {
    slot = 'prev';
    w0 = int0(me.pwpt);
    wl = int0(me.pwpl);
  } else slot = !me.wk || wk > me.wk ? 'new' : 'old';
  wl += n; // 今週のプレイ回数
  const wCap = Math.min(w0 + WPT_STEP, wl * WPT_STEP);
  let wptNew = wpt;
  if (wptNew > wCap) {
    wptNew = wCap;
    sus = true;
  }
  wptNew = Math.max(w0, wptNew);
  const wf =
    slot === 'cur'
      ? ['wpt', wptNew, 'wpl', wl]
      : slot === 'prev'
        ? ['pwpt', wptNew, 'pwpl', wl]
        : slot === 'new'
          ? ['pwk', me.wk || '', 'pwpt', int0(me.wpt), 'pwpl', int0(me.wpl), 'wk', wk, 'wpt', wptNew, 'wpl', wl]
          : ['pwk', wk, 'pwpt', wptNew, 'pwpl', wl]; // 前の週の記録があとから来た
  const ch = CHARS.includes(b.c) ? b.c : CHARS.includes(me.c) ? me.c : 'tora'; // 知らないキャラは無視
  const cmds = [
    ['HSET', K.user(uid), 'rp', rpNew, 'pl', pl, 'c', ch, 'ut', ctx.now, ...wf, ...(save != null ? ['save', save] : [])],
    ['HSET', K.pub, uid, pubVal(me.name || '', ch)],
    ['ZADD', K.all, rpNew, uid],
    ...bump(K.rl('s', uid), LIMIT.sync[1]),
  ];
  if (wptNew > 0) cmds.push(['ZADD', K.week(wk), wptNew, uid], ['EXPIRE', K.week(wk), WEEK_TTL]);
  if (sus) cmds.push(['HINCRBY', K.user(uid), 'sus', 1]);
  await ctx.db.tx(cmds);
  if (sus) console.warn(`[rpf] clamp uid=${uid} rp ${rp}->${rpNew} wpt ${wpt}->${wptNew} plays ${plays}`);
  return { ok: true, rp: rpNew, wpt: wptNew };
};

// ランキング：{t:'w'|'a'|'f', wk}
ACTIONS.rank = async (ctx, b) => {
  if (b.t === 'f') return rankFriends(ctx);
  if (b.t !== 'w' && b.t !== 'a') fail(400, 'bad');
  const cur = weekId(ctx.now), prev = weekId(ctx.now - WEEK);
  const wk = b.wk === prev ? prev : cur; // 今週か先週。それ以外は今週
  const key = b.t === 'w' ? K.week(wk) : K.all;
  const { me, x } = await begin(ctx, {
    auth: 'opt',
    extra: (uid) => [['ZREVRANGE', key, 0, TOP - 1, 'WITHSCORES'], ...(uid ? [['ZSCORE', key, uid]] : [])],
  });
  const rows = pairs(x[0]);
  const mine = me && x[1] != null ? num(x[1]) : null;
  const cmds = [];
  if (rows.length) cmds.push(['HMGET', K.pub, ...rows.map((r) => r[0])]);
  if (mine != null) cmds.push(['ZCOUNT', key, '(' + mine, '+inf']); // 自分より上の人数
  const r = await ctx.db.pipe(cmds);
  const list = listOf(rows, rows.length ? r[0] : [], me && me.uid, false);
  return { ok: true, list, me: mine == null ? null : { rank: int0(r[r.length - 1]) + 1, s: mine } };
};

// フレンドのランキング（自分＋フレンド、ランクポイント順）。フレンドがいなければ空
async function rankFriends(ctx) {
  const { me, x } = await begin(ctx, { extra: (uid) => (uid ? [['SMEMBERS', K.fr(uid)]] : []) });
  const ids = (Array.isArray(x[0]) ? x[0] : []).filter((u) => typeof u === 'string' && UID_RE.test(u) && u !== me.uid);
  if (!ids.length) return { ok: true, list: [], me: null };
  const all = [me.uid, ...ids];
  const [sc, pubs] = await ctx.db.pipe([
    ['ZMSCORE', K.all, ...all],
    ['HMGET', K.pub, ...all],
  ]);
  const rows = [], gone = [];
  all.forEach((u, i) => {
    if (u !== me.uid && !parsePub(pubs[i])) gone.push(u);
    else rows.push([u, num(sc[i]), pubs[i]]);
  });
  if (gone.length) await ctx.db.pipe([['SREM', K.fr(me.uid), ...gone]]); // 消えた人を片づける
  if (rows.length < 2) return { ok: true, list: [], me: null };
  rows.sort((p, q) => q[1] - p[1] || (p[0] < q[0] ? -1 : 1));
  const s = rows.find((r) => r[0] === me.uid)[1];
  const list = listOf(
    rows.map((r) => [r[0], r[1]]),
    rows.map((r) => r[2]),
    me.uid,
    true
  );
  return { ok: true, list, me: { rank: rows.filter((r) => r[1] > s).length + 1, s } };
}

// ZREVRANGE ... WITHSCORES の答え → [[uid, 点], ...]
function pairs(v) {
  if (!Array.isArray(v)) return [];
  if (v.length && Array.isArray(v[0])) return v.map((p) => [String(p[0]), num(p[1])]);
  const out = [];
  for (let i = 0; i + 1 < v.length; i += 2) out.push([String(v[i]), num(v[i + 1])]);
  return out;
}
// 表示用の一覧。同じ点なら同じ順位
function listOf(rows, pubs, myUid, withUid) {
  const list = [];
  let rank = 0, last = null;
  rows.forEach(([uid, s], i) => {
    if (s !== last) {
      rank = i + 1;
      last = s;
    }
    const p = parsePub(pubs[i]);
    if (!p) return; // 消えた人
    const e = { n: p.n, c: p.c, s, rank };
    if (uid === myUid) e.me = true;
    else if (withUid) e.u = uid; // フレンドの一覧だけ（fdel 用）
    list.push(e);
  });
  return list;
}

// 引き継ぎコードを出す（前のコードは使えなくなる）
ACTIONS.code = async (ctx) => {
  const { me } = await begin(ctx, { fields: ['tc'] });
  const code = randStr(ALPHA, 12);
  const h = sha(code);
  const cmds = [];
  if (HASH_RE.test(me.tc || '')) cmds.push(['DEL', K.code(me.tc)]);
  cmds.push(['SET', K.code(h), me.uid, 'EX', CODE_TTL], ['HSET', K.user(me.uid), 'tc', h]);
  await ctx.db.tx(cmds);
  return { ok: true, code: code.slice(0, 4) + '-' + code.slice(4, 8) + '-' + code.slice(8) };
};

// 引き継ぎコードで戻す（コードは1回だけ。前の端末のトークンは使えなくなる）
ACTIONS.restore = async (ctx, b) => {
  if (typeof b.code !== 'string') fail(400, 'bad');
  await begin(ctx, { auth: 'none', limits: [[K.rl('rs', ctx.ip), ...LIMIT.restore]] });
  const code = b.code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 12) fail(400, 'bad');
  const h = sha(code);
  const [uid] = await ctx.db.pipe([['GETDEL', K.code(h)]]);
  if (typeof uid !== 'string' || !UID_RE.test(uid)) fail(404, 'nf');
  const [v] = await ctx.db.pipe([['HMGET', K.user(uid), 'fc', 'name', 'save', 'tc']]);
  if (!Array.isArray(v) || !v[0] || v[3] !== h) fail(404, 'nf'); // 消えた人・新しいコードが出ている
  const token = newToken();
  await ctx.db.tx([
    ['HSET', K.user(uid), 'th', sha(token), 'ut', ctx.now],
    ['HDEL', K.user(uid), 'tc'],
  ]);
  return { ok: true, uid, token, fc: v[0], save: v[2] || '', name: v[1] || '' };
};

// フレンドになる（両方向）：{fc}
ACTIONS.fadd = async (ctx, b) => {
  if (typeof b.fc !== 'string') fail(400, 'bad');
  const fc = b.fc.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const valid = FC_RE.test(fc);
  const { me, x } = await begin(ctx, {
    fields: ['fc'],
    extra: (uid) => (uid && valid ? [['GET', K.fc(fc)], ['SCARD', K.fr(uid)]] : []),
  });
  if (fc === me.fc) fail(400, 'self');
  if (!valid) fail(404, 'nf');
  const other = x[0];
  if (typeof other !== 'string' || !UID_RE.test(other)) fail(404, 'nf');
  if (other === me.uid) fail(400, 'self');
  const [isF, cnt, pub] = await ctx.db.pipe([
    ['SISMEMBER', K.fr(me.uid), other],
    ['SCARD', K.fr(other)],
    ['HGET', K.pub, other],
  ]);
  const p = parsePub(pub);
  if (!p) fail(404, 'nf');
  if (isF !== 1 && (int0(x[1]) >= FRIEND_MAX || int0(cnt) >= FRIEND_MAX)) fail(409, 'full');
  await ctx.db.tx([
    ['SADD', K.fr(me.uid), other],
    ['SADD', K.fr(other), me.uid],
  ]);
  return { ok: true, name: p.n };
};

// フレンドをやめる（両方向）：{uid}
ACTIONS.fdel = async (ctx, b) => {
  if (typeof b.uid !== 'string' || !UID_RE.test(b.uid)) fail(400, 'bad');
  const { me } = await begin(ctx);
  if (b.uid === me.uid) fail(400, 'self');
  await ctx.db.tx([
    ['SREM', K.fr(me.uid), b.uid],
    ['SREM', K.fr(b.uid), me.uid],
  ]);
  return { ok: true };
};

// 不具合の報告：{text, info}（ログインしていなくてもOK）
//   rpf:reports に {t, uid, ipHash, text, info} の JSON を入れる（info は JSON にして4000文字まで）
ACTIONS.report = async (ctx, b) => {
  if (b.text != null && typeof b.text !== 'string') fail(400, 'bad');
  if (b.info != null && (typeof b.info !== 'object' || Array.isArray(b.info))) fail(400, 'bad');
  const text = cut(b.text || '', REPORT_TEXT);
  const info = b.info == null ? null : cut(JSON.stringify(b.info), REPORT_INFO);
  const { me } = await begin(ctx, { auth: 'opt', limits: [[K.rl('rep', ctx.ip), ...LIMIT.report]] });
  const rec = { t: ctx.now, uid: me ? me.uid : null, ipHash: reportIpHash(ctx.ipRaw), text, info };
  const cmds = [
    ['LPUSH', K.reports, JSON.stringify(rec)],
    ['LTRIM', K.reports, 0, REPORT_KEEP - 1],
  ];
  if (me) cmds.push(['HINCRBY', K.user(me.uid), 'rep', 1]); // アカウントを消すときに uid を外すため
  await ctx.db.tx(cmds);
  return { ok: true };
};

// アカウントを消す：本人の情報・名前・ランキング・フレンド・フレンドコード・引き継ぎコード
//（送った不具合の報告は残すが、uid は外す）
ACTIONS.del = async (ctx) => {
  const { me, x } = await begin(ctx, { fields: ['fc', 'tc', 'rep'], extra: (uid) => (uid ? [['SMEMBERS', K.fr(uid)]] : []) });
  const uid = me.uid;
  const friends = (Array.isArray(x[0]) ? x[0] : []).filter((u) => typeof u === 'string' && UID_RE.test(u));
  const cmds = [
    ['DEL', K.user(uid)],
    ['DEL', K.fr(uid)],
    ['DEL', K.rl('s', uid)],
    ['HDEL', K.pub, uid],
    ['ZREM', K.all, uid],
  ];
  // 週のランキング：今週・先週と、まだ消えていない古い週（45日 → 7週ぶん）
  for (let i = 0; i < 7; i++) cmds.push(['ZREM', K.week(weekId(ctx.now - i * WEEK)), uid]);
  for (const f of friends) cmds.push(['SREM', K.fr(f), uid]);
  if (FC_RE.test(me.fc || '')) cmds.push(['DEL', K.fc(me.fc)]);
  if (HASH_RE.test(me.tc || '')) cmds.push(['DEL', K.code(me.tc)]);
  if (int0(me.rep) > 0) {
    // 報告の中の uid を null にする（値で場所を決めるので、そのあいだに報告がふえてもずれない）
    const [list] = await ctx.db.pipe([['LRANGE', K.reports, 0, -1]]);
    for (const v of Array.isArray(list) ? list : []) {
      let o = null;
      try {
        o = JSON.parse(v);
      } catch (e) {}
      if (!o || o.uid !== uid) continue;
      cmds.push(['LINSERT', K.reports, 'BEFORE', v, JSON.stringify({ ...o, uid: null })], ['LREM', K.reports, 1, v]);
    }
  }
  await ctx.db.tx(cmds);
  return { ok: true };
};

// ===== オンライン対戦の部屋 =====
// サーバーがするのは「つなぐためのあいさつ（WebRTC の SDP）」の受けわたしだけ。試合のデータは端末どうしで直接やりとりする
const ROOM_RE = /^\d{5}$/;
const PID_RE = /^[0-9a-z]{8}$/;
const ROOM_TTL = 3 * 3600; // 部屋は3時間で消える
const RQ_TTL = 300; // 手紙は5分で消える
const RQ_KEEP = 24; // 1人あての手紙は新しい24通まで
const SIG_MAX = 16000; // 手紙1通の大きさ
const DEFAULT_ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, { urls: ['stun:stun.cloudflare.com:3478'] }];

// つなぐときに使うサーバー（STUN／TURN）
//   RPF_ICE：JSON の配列（例 [{"urls":"turn:example.com:3478","username":"u","credential":"p"}]）
//   METERED_DOMAIN ＋ METERED_API_KEY：Metered（Open Relay）の TURN（無料で登録できる）
//   CF_TURN_KEY_ID ＋ CF_TURN_KEY_TOKEN：Cloudflare の TURN（その場で期限つきのパスワードをもらう）
let iceCache = { at: 0, v: null };
async function iceServers(env = process.env) {
  if (iceCache.v && Date.now() - iceCache.at < 3600 * 1000) return iceCache.v;
  let list = DEFAULT_ICE;
  try {
    if (typeof env.RPF_ICE === 'string' && env.RPF_ICE.trim()) {
      const v = JSON.parse(env.RPF_ICE);
      if (Array.isArray(v) && v.length && v.every((x) => x && (typeof x.urls === 'string' || Array.isArray(x.urls)))) list = v.concat(DEFAULT_ICE);
    } else if (env.METERED_API_KEY && env.METERED_DOMAIN && /^[a-z0-9-]+(\.metered\.live)?$/i.test(env.METERED_DOMAIN)) {
      // Metered（Open Relay）の TURN：無料で登録して API キーをもらう
      const host = env.METERED_DOMAIN.includes('.') ? env.METERED_DOMAIN : env.METERED_DOMAIN + '.metered.live';
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      try {
        const r = await fetch('https://' + host + '/api/v1/turn/credentials?apiKey=' + encodeURIComponent(env.METERED_API_KEY), { signal: ctrl.signal });
        const v = await r.json();
        if (Array.isArray(v) && v.length) list = v.concat(DEFAULT_ICE);
      } finally {
        clearTimeout(timer);
      }
    } else if (env.CF_TURN_KEY_ID && env.CF_TURN_KEY_TOKEN) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      try {
        const r = await fetch('https://rtc.live.cloudflare.com/v1/turn/keys/' + encodeURIComponent(env.CF_TURN_KEY_ID) + '/credentials/generate', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + env.CF_TURN_KEY_TOKEN, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ttl: 6 * 3600 }),
          signal: ctrl.signal,
        });
        const j = await r.json();
        const v = j && j.iceServers;
        if (v && (Array.isArray(v) ? v.length : v.urls)) list = (Array.isArray(v) ? v : [v]).concat(DEFAULT_ICE);
      } finally {
        clearTimeout(timer);
      }
    }
  } catch (e) {
    console.error('[rpf] ice: ' + (e && e.message));
  }
  iceCache = { at: Date.now(), v: list };
  return list;
}
function parseRoom(v) {
  if (typeof v !== 'string') return null;
  try {
    const o = JSON.parse(v);
    return o && typeof o.h === 'string' ? o : null;
  } catch (e) {
    return null;
  }
}
const roomCode = (v) => {
  if (typeof v !== 'string' || !ROOM_RE.test(v)) fail(400, 'bad');
  return v;
};
const peerId = (v) => {
  if (typeof v !== 'string' || !PID_RE.test(v)) fail(400, 'bad');
  return v;
};

// 部屋をつくる：{n:名前} → {code, pid, hk, ice}（hk は部屋をしめるときの合いことば。保存するのはハッシュ）
ACTIONS.rmk = async (ctx, b) => {
  const name = b.n == null ? '' : checkName(b.n);
  await begin(ctx, { auth: 'opt', limits: [[K.rl('rmk', ctx.ip), ...LIMIT.rmk]] });
  const pid = randStr(B36, 8);
  const hk = newToken();
  const val = JSON.stringify({ h: pid, k: sha(hk), n: name, t: ctx.now, o: 1 });
  for (let i = 0; i < 6; i++) {
    const code = String(crypto.randomInt(10000, 100000));
    const [r] = await ctx.db.pipe([['SET', K.room(code), val, 'NX', 'EX', ROOM_TTL]]);
    if (r === 'OK') return { ok: true, code, pid, hk, ice: await iceServers() };
  }
  fail(503, 'busy');
};

// 部屋に入る：{code} → {pid, host, n, ice}
ACTIONS.rmj = async (ctx, b) => {
  const code = roomCode(b.code);
  const { x } = await begin(ctx, { auth: 'opt', limits: [[K.rl('rmj', ctx.ip), ...LIMIT.rmj]], extra: () => [['GET', K.room(code)]] });
  const room = parseRoom(x[0]);
  if (!room) fail(404, 'nf');
  if (!room.o) fail(409, 'closed');
  return { ok: true, pid: randStr(B36, 8), host: room.h, n: room.n || '', ice: await iceServers() };
};

// 手紙を送る：{code, to, from, d}
ACTIONS.rms = async (ctx, b) => {
  const code = roomCode(b.code);
  const to = peerId(b.to), from = peerId(b.from);
  if (typeof b.d !== 'string' || !b.d || b.d.length > SIG_MAX) fail(400, 'bad');
  const { x } = await begin(ctx, { auth: 'none', noIp: true, limits: [[K.rl('rio', ctx.ip), ...LIMIT.rmio]], extra: () => [['GET', K.room(code)]] });
  if (!parseRoom(x[0])) fail(404, 'nf');
  const q = K.rq(code, to);
  await ctx.db.pipe([
    ['RPUSH', q, JSON.stringify({ f: from, d: b.d })],
    ['LTRIM', q, -RQ_KEEP, -1],
    ['EXPIRE', q, RQ_TTL],
  ]);
  return { ok: true };
};

// 手紙を受けとる：{code, me} → {m:[{f, d}], gone}
ACTIONS.rmp = async (ctx, b) => {
  const code = roomCode(b.code);
  const me = peerId(b.me);
  const { x } = await begin(ctx, { auth: 'none', noIp: true, limits: [[K.rl('rio', ctx.ip), ...LIMIT.rmio]], extra: () => [['EXISTS', K.room(code)]] });
  const q = K.rq(code, me);
  const [list] = await ctx.db.tx([
    ['LRANGE', q, 0, -1],
    ['DEL', q],
  ]);
  const m = [];
  for (const v of Array.isArray(list) ? list : []) {
    try {
      const o = JSON.parse(v);
      if (o && typeof o.f === 'string' && typeof o.d === 'string') m.push(o);
    } catch (e) {}
  }
  return { ok: true, m, gone: int0(x[0]) === 0 };
};

// 部屋をしめる・受付を止める・再開する（部屋をつくった人だけ）：{code, hk, op:'close'|'lock'|'open'}
ACTIONS.rmx = async (ctx, b) => {
  const code = roomCode(b.code);
  if (typeof b.hk !== 'string' || !TOKEN_RE.test(b.hk)) fail(400, 'bad');
  if (!['close', 'lock', 'open'].includes(b.op)) fail(400, 'bad');
  const { x } = await begin(ctx, { auth: 'none', extra: () => [['GET', K.room(code)]] });
  const room = parseRoom(x[0]);
  if (!room) return { ok: true, gone: true };
  if (room.k !== sha(b.hk)) fail(403, 'deny');
  if (b.op === 'close') await ctx.db.pipe([['DEL', K.room(code)]]);
  else await ctx.db.pipe([['SET', K.room(code), JSON.stringify({ ...room, o: b.op === 'open' ? 1 : 0 }), 'KEEPTTL']]);
  return { ok: true };
};

// ===== 入口 =====
module.exports = async function handler(req, res) {
  let action = '';
  try {
    const method = req.method || 'GET';
    if (method === 'OPTIONS') {
      res.setHeader('Allow', 'GET, POST, OPTIONS');
      return send(res, 204);
    }
    if (method === 'GET' || method === 'HEAD') {
      const q = new URL(req.url || '/', 'http://localhost').searchParams;
      if (q.get('a') === 'ping') return send(res, 200, { ok: true, ready: await ready() });
      fail(400, 'bad');
    }
    if (method !== 'POST') {
      res.setHeader('Allow', 'GET, POST, OPTIONS');
      fail(405, 'method');
    }
    const body = await readBody(req);
    action = typeof body.a === 'string' ? body.a.slice(0, 20) : '';
    if (action === 'ping') return send(res, 200, { ok: true, ready: await ready() });
    const fn = ACTIONS[action];
    if (!fn) fail(400, 'bad');
    const conf = dbConf();
    if (!conf) fail(503, 'setup');
    const ipRaw = clientIp(req);
    const ctx = { db: makeDb(conf), ip: ipKey(ipRaw), ipRaw, auth: parseAuth(req), now: Date.now() };
    return send(res, 200, await fn(ctx, body));
  } catch (e) {
    if (e instanceof ApiError) return send(res, e.status, { ok: false, err: e.code });
    // トークンや本文はログに出さない
    console.error('[rpf] ' + (action || '-') + ': ' + (e && e.message ? e.message : String(e)));
    return send(res, 500, { ok: false, err: 'server' });
  }
};

// テスト用（Vercel は関数そのものだけを使う）
module.exports.dbConf = dbConf;
module.exports.weekId = weekId;
module.exports.checkName = checkName;
module.exports.reportIpHash = reportIpHash;
