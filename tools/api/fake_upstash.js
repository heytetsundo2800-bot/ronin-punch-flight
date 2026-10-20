// Upstash Redis の REST API のにせもの（テスト・ローカル確認用。データはメモリだけ）
//   node tools/api/fake_upstash.js [--port 8079] [--token dev-token] [--host 127.0.0.1]
//   const f = await require('./fake_upstash.js').createFakeUpstash({ port: 0 })
//     f.url / f.token：つなぎ先
//     f.call('GET', 'k')：テストから直接コマンドを実行（ログには残らない）
//     f.advance(ms)：時計を進める（有効期限のテスト用）
//     f.log：HTTP で受けたコマンドの記録 [{cmd, keys}]
// 対応：POST / に ["CMD", ...]、POST /pipeline、POST /multi-exec、GET|POST /cmd/arg/...
// 答えの形は本物と同じ（RESP2 → JSON：整数は数、文字列は文字列、nil は null）
'use strict';

const http = require('http');

const WRONGTYPE = 'WRONGTYPE Operation against a key holding the wrong kind of value';
const NOT_INT = 'ERR value is not an integer or out of range';
const NOT_FLOAT = 'ERR value is not a valid float';
const SYNTAX = 'ERR syntax error';
const MAX_BODY = 1024 * 1024;

class RedisError extends Error {}
const rerr = (m) => {
  throw new RedisError(m);
};

// ===== データ =====
class Store {
  constructor() {
    this.data = new Map(); // key → {type, value, exp}
    this.offset = 0;
  }
  now() {
    return Date.now() + this.offset;
  }
  advance(ms) {
    this.offset += ms;
  }
  // 期限切れなら消してから返す
  entry(key) {
    const e = this.data.get(key);
    if (!e) return null;
    if (e.exp != null && e.exp <= this.now()) {
      this.data.delete(key);
      return null;
    }
    return e;
  }
  typed(key, type) {
    const e = this.entry(key);
    if (e && e.type !== type) rerr(WRONGTYPE);
    return e;
  }
  create(key, type, value) {
    const e = { type, value, exp: null };
    this.data.set(key, e);
    return e;
  }
  // 空になったハッシュ・セット・リストは消す（Redis と同じ）
  tidy(key, e) {
    if (!e || e.type === 'string') return;
    if ((Array.isArray(e.value) ? e.value.length : e.value.size) === 0) this.data.delete(key);
  }
  keys() {
    return [...this.data.keys()].filter((k) => this.entry(k));
  }
}

function toInt(s, msg = NOT_INT) {
  if (!/^-?\d+$/.test(s)) rerr(msg);
  const n = Number(s);
  if (!Number.isSafeInteger(n)) rerr(msg);
  return n;
}
function toScore(s) {
  const t = String(s).toLowerCase();
  if (t === 'inf' || t === '+inf') return Infinity;
  if (t === '-inf') return -Infinity;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/.test(t)) rerr(NOT_FLOAT);
  return Number(t);
}
// 点数の書き方（整数ならそのまま。本物は小数を17けたで書く）
const fmtScore = (n) => (n === Infinity ? 'inf' : n === -Infinity ? '-inf' : String(n));
function scoreBound(s) {
  const t = String(s);
  if (t.startsWith('(')) return { v: toScore(t.slice(1)), ex: true };
  return { v: toScore(t), ex: false };
}
const inRange = (v, lo, hi) => (lo.ex ? v > lo.v : v >= lo.v) && (hi.ex ? v < hi.v : v <= hi.v);
function globRe(p) {
  let re = '';
  for (const ch of p) re += ch === '*' ? '.*' : ch === '?' ? '.' : ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp('^' + re + '$', 's');
}
// ソート済みセットの並び：点の小さい順、同じ点なら名前のバイト順
function zsorted(e, rev) {
  if (!e) return [];
  const arr = [...e.value.entries()];
  arr.sort((a, b) => (a[1] !== b[1] ? (a[1] < b[1] ? -1 : 1) : Buffer.compare(Buffer.from(a[0]), Buffer.from(b[0]))));
  return rev ? arr.reverse() : arr;
}
function zrangeIdx(e, start, stop, rev, ws) {
  const arr = zsorted(e, rev);
  const n = arr.length;
  let a = start < 0 ? n + start : start;
  let b = stop < 0 ? n + stop : stop;
  if (a < 0) a = 0;
  if (b >= n) b = n - 1;
  const out = [];
  for (let i = a; i <= b; i++) {
    out.push(arr[i][0]);
    if (ws) out.push(fmtScore(arr[i][1]));
  }
  return out;
}

// ===== コマンド =====
function cmdSet(s, a) {
  const [k, v, ...opt] = a;
  let exp = null, nx = false, xx = false, keep = false, get = false;
  for (let i = 0; i < opt.length; i++) {
    const o = opt[i].toUpperCase();
    if (o === 'NX') nx = true;
    else if (o === 'XX') xx = true;
    else if (o === 'KEEPTTL') keep = true;
    else if (o === 'GET') get = true;
    else if (['EX', 'PX', 'EXAT', 'PXAT'].includes(o) && i + 1 < opt.length && exp == null) {
      const n = toInt(opt[++i]);
      if (n <= 0) rerr("ERR invalid expire time in 'set' command");
      exp = o === 'EX' ? s.now() + n * 1000 : o === 'PX' ? s.now() + n : o === 'EXAT' ? n * 1000 : n;
    } else rerr(SYNTAX);
  }
  if ((nx && xx) || (keep && exp != null)) rerr(SYNTAX);
  const cur = s.entry(k);
  if (get && cur && cur.type !== 'string') rerr(WRONGTYPE);
  const old = cur && cur.type === 'string' ? cur.value : null;
  if ((nx && cur) || (xx && !cur)) return get ? old : null;
  const e = s.create(k, 'string', v);
  e.exp = keep && cur ? cur.exp : exp;
  return get ? old : 'OK';
}
function incrBy(s, k, by) {
  const e = s.typed(k, 'string');
  const n = (e ? toInt(e.value) : 0) + by;
  if (!Number.isSafeInteger(n)) rerr('ERR increment or decrement would overflow');
  if (e) e.value = String(n);
  else s.create(k, 'string', String(n));
  return n;
}
function expire(s, k, ms, flag) {
  const f = flag ? flag.toUpperCase() : '';
  if (f && !['NX', 'XX', 'GT', 'LT'].includes(f)) rerr('ERR Unsupported option ' + flag);
  const e = s.entry(k);
  if (!e) return 0;
  const at = s.now() + ms;
  if (f === 'NX' && e.exp != null) return 0;
  if (f === 'XX' && e.exp == null) return 0;
  if (f === 'GT' && (e.exp == null || at <= e.exp)) return 0;
  if (f === 'LT' && e.exp != null && at >= e.exp) return 0;
  if (ms <= 0) s.data.delete(k);
  else e.exp = at;
  return 1;
}
function ttl(s, k, unit) {
  const e = s.entry(k);
  if (!e) return -2;
  if (e.exp == null) return -1;
  const ms = e.exp - s.now();
  return unit === 'ms' ? ms : Math.round(ms / 1000);
}
function hash(s, k, create) {
  const e = s.typed(k, 'hash');
  if (e || !create) return e;
  return s.create(k, 'hash', new Map());
}
function set(s, k, create) {
  const e = s.typed(k, 'set');
  if (e || !create) return e;
  return s.create(k, 'set', new Set());
}
function list(s, k, create) {
  const e = s.typed(k, 'list');
  if (e || !create) return e;
  return s.create(k, 'list', []);
}
// リストの番号の範囲（マイナスは後ろから）
function span(n, a, b) {
  if (a < 0) a += n;
  if (b < 0) b += n;
  if (a < 0) a = 0;
  if (b >= n) b = n - 1;
  return [a, b];
}
function lrem(s, [k, c, v]) {
  const n = toInt(c);
  const e = list(s, k);
  if (!e) return 0;
  const arr = e.value;
  const lim = n === 0 ? Infinity : Math.abs(n);
  let removed = 0;
  if (n >= 0) {
    for (let i = 0; i < arr.length && removed < lim; ) {
      if (arr[i] === v) (arr.splice(i, 1), removed++);
      else i++;
    }
  } else {
    for (let i = arr.length - 1; i >= 0 && removed < lim; i--) if (arr[i] === v) (arr.splice(i, 1), removed++);
  }
  s.tidy(k, e);
  return removed;
}
function zadd(s, a) {
  const k = a[0];
  const fl = new Set();
  let i = 1;
  while (i < a.length && ['NX', 'XX', 'GT', 'LT', 'CH', 'INCR'].includes(a[i].toUpperCase())) fl.add(a[i++].toUpperCase());
  const rest = a.slice(i);
  if (!rest.length || rest.length % 2) rerr(SYNTAX);
  if (fl.has('NX') && fl.has('XX')) rerr('ERR XX and NX options at the same time are not compatible');
  if ((fl.has('GT') && fl.has('LT')) || (fl.has('NX') && (fl.has('GT') || fl.has('LT')))) rerr('ERR GT, LT, and/or NX options at the same time are not compatible');
  if (fl.has('INCR') && rest.length !== 2) rerr('ERR INCR option supports a single increment-element pair');
  const items = [];
  for (let j = 0; j < rest.length; j += 2) items.push([toScore(rest[j]), rest[j + 1]]);
  let e = s.typed(k, 'zset');
  let added = 0, changed = 0, last = null;
  for (const [sc, m] of items) {
    const has = !!(e && e.value.has(m));
    const old = has ? e.value.get(m) : null;
    if ((fl.has('NX') && has) || (fl.has('XX') && !has)) continue;
    const v = fl.has('INCR') ? (old || 0) + sc : sc;
    if (has && fl.has('GT') && !(v > old)) continue;
    if (has && fl.has('LT') && !(v < old)) continue;
    if (!e) e = s.create(k, 'zset', new Map());
    e.value.set(m, v);
    if (!has) added++;
    else if (old !== v) changed++;
    last = v;
  }
  if (fl.has('INCR')) return last == null ? null : fmtScore(last);
  return fl.has('CH') ? added + changed : added;
}

const one = (a) => [a[0]];
const all = (a) => a;
const none = () => [];
const evenKeys = (a) => a.filter((_, i) => i % 2 === 0);
// 名前 → [最小の引数, 最大の引数(-1=いくつでも), キーの場所, 実行]
const CMDS = new Map(
  Object.entries({
    PING: [0, 1, none, (s, a) => (a.length ? a[0] : 'PONG')],
    ECHO: [1, 1, none, (s, a) => a[0]],
    TIME: [0, 0, none, (s) => [String(Math.floor(s.now() / 1000)), String((s.now() % 1000) * 1000)]],
    // 文字列
    GET: [1, 1, one, (s, [k]) => {
      const e = s.typed(k, 'string');
      return e ? e.value : null;
    }],
    SET: [2, -1, one, cmdSet],
    GETDEL: [1, 1, one, (s, [k]) => {
      const e = s.typed(k, 'string');
      if (!e) return null;
      s.data.delete(k);
      return e.value;
    }],
    MGET: [1, -1, all, (s, ks) => ks.map((k) => {
      const e = s.entry(k);
      return e && e.type === 'string' ? e.value : null;
    })],
    MSET: [2, -1, evenKeys, (s, a) => {
      if (a.length % 2) rerr("ERR wrong number of arguments for 'mset' command");
      for (let i = 0; i < a.length; i += 2) s.create(a[i], 'string', a[i + 1]);
      return 'OK';
    }],
    INCR: [1, 1, one, (s, [k]) => incrBy(s, k, 1)],
    DECR: [1, 1, one, (s, [k]) => incrBy(s, k, -1)],
    INCRBY: [2, 2, one, (s, [k, n]) => incrBy(s, k, toInt(n))],
    DECRBY: [2, 2, one, (s, [k, n]) => incrBy(s, k, -toInt(n))],
    // キー全般
    DEL: [1, -1, all, (s, ks) => ks.reduce((n, k) => n + (s.entry(k) ? (s.data.delete(k), 1) : 0), 0)],
    UNLINK: [1, -1, all, (s, ks) => ks.reduce((n, k) => n + (s.entry(k) ? (s.data.delete(k), 1) : 0), 0)],
    EXISTS: [1, -1, all, (s, ks) => ks.reduce((n, k) => n + (s.entry(k) ? 1 : 0), 0)],
    EXPIRE: [2, 3, one, (s, a) => expire(s, a[0], toInt(a[1]) * 1000, a[2])],
    PEXPIRE: [2, 3, one, (s, a) => expire(s, a[0], toInt(a[1]), a[2])],
    TTL: [1, 1, one, (s, [k]) => ttl(s, k, 's')],
    PTTL: [1, 1, one, (s, [k]) => ttl(s, k, 'ms')],
    PERSIST: [1, 1, one, (s, [k]) => {
      const e = s.entry(k);
      if (!e || e.exp == null) return 0;
      e.exp = null;
      return 1;
    }],
    TYPE: [1, 1, one, (s, [k]) => {
      const e = s.entry(k);
      return e ? e.type : 'none';
    }],
    KEYS: [1, 1, none, (s, [p]) => {
      const re = globRe(p);
      return s.keys().filter((k) => re.test(k));
    }],
    DBSIZE: [0, 0, none, (s) => s.keys().length],
    FLUSHALL: [0, 1, none, (s) => (s.data.clear(), 'OK')],
    FLUSHDB: [0, 1, none, (s) => (s.data.clear(), 'OK')],
    // ハッシュ
    HSET: [3, -1, one, (s, [k, ...fv]) => {
      if (fv.length % 2) rerr("ERR wrong number of arguments for 'hset' command");
      const e = hash(s, k, true);
      let n = 0;
      for (let i = 0; i < fv.length; i += 2) {
        if (!e.value.has(fv[i])) n++;
        e.value.set(fv[i], fv[i + 1]);
      }
      return n;
    }],
    HSETNX: [3, 3, one, (s, [k, f, v]) => {
      const e = hash(s, k, true);
      if (e.value.has(f)) return 0;
      e.value.set(f, v);
      return 1;
    }],
    HGET: [2, 2, one, (s, [k, f]) => {
      const e = hash(s, k);
      return e && e.value.has(f) ? e.value.get(f) : null;
    }],
    HMGET: [2, -1, one, (s, [k, ...fs]) => {
      const e = hash(s, k);
      return fs.map((f) => (e && e.value.has(f) ? e.value.get(f) : null));
    }],
    HGETALL: [1, 1, one, (s, [k]) => {
      const e = hash(s, k);
      return e ? [...e.value.entries()].flat() : [];
    }],
    HKEYS: [1, 1, one, (s, [k]) => {
      const e = hash(s, k);
      return e ? [...e.value.keys()] : [];
    }],
    HLEN: [1, 1, one, (s, [k]) => {
      const e = hash(s, k);
      return e ? e.value.size : 0;
    }],
    HEXISTS: [2, 2, one, (s, [k, f]) => {
      const e = hash(s, k);
      return e && e.value.has(f) ? 1 : 0;
    }],
    HDEL: [2, -1, one, (s, [k, ...fs]) => {
      const e = hash(s, k);
      if (!e) return 0;
      let n = 0;
      for (const f of fs) if (e.value.delete(f)) n++;
      s.tidy(k, e);
      return n;
    }],
    HINCRBY: [3, 3, one, (s, [k, f, by]) => {
      const d = toInt(by);
      const e = hash(s, k, true);
      const n = (e.value.has(f) ? toInt(e.value.get(f), 'ERR hash value is not an integer') : 0) + d;
      e.value.set(f, String(n));
      return n;
    }],
    // セット
    SADD: [2, -1, one, (s, [k, ...ms]) => {
      const e = set(s, k, true);
      let n = 0;
      for (const m of ms) if (!e.value.has(m)) (e.value.add(m), n++);
      return n;
    }],
    SREM: [2, -1, one, (s, [k, ...ms]) => {
      const e = set(s, k);
      if (!e) return 0;
      let n = 0;
      for (const m of ms) if (e.value.delete(m)) n++;
      s.tidy(k, e);
      return n;
    }],
    SMEMBERS: [1, 1, one, (s, [k]) => {
      const e = set(s, k);
      return e ? [...e.value] : [];
    }],
    SCARD: [1, 1, one, (s, [k]) => {
      const e = set(s, k);
      return e ? e.value.size : 0;
    }],
    SISMEMBER: [2, 2, one, (s, [k, m]) => {
      const e = set(s, k);
      return e && e.value.has(m) ? 1 : 0;
    }],
    SMISMEMBER: [2, -1, one, (s, [k, ...ms]) => {
      const e = set(s, k);
      return ms.map((m) => (e && e.value.has(m) ? 1 : 0));
    }],
    // リスト
    LPUSH: [2, -1, one, (s, [k, ...vs]) => {
      const e = list(s, k, true);
      for (const v of vs) e.value.unshift(v);
      return e.value.length;
    }],
    RPUSH: [2, -1, one, (s, [k, ...vs]) => {
      const e = list(s, k, true);
      e.value.push(...vs);
      return e.value.length;
    }],
    LLEN: [1, 1, one, (s, [k]) => {
      const e = list(s, k);
      return e ? e.value.length : 0;
    }],
    LRANGE: [3, 3, one, (s, [k, a, b]) => {
      const e = list(s, k);
      if (!e) return [];
      const [x, y] = span(e.value.length, toInt(a), toInt(b));
      return e.value.slice(x, y + 1);
    }],
    LINDEX: [2, 2, one, (s, [k, i]) => {
      const e = list(s, k);
      if (!e) return null;
      let n = toInt(i);
      if (n < 0) n += e.value.length;
      return n >= 0 && n < e.value.length ? e.value[n] : null;
    }],
    LTRIM: [3, 3, one, (s, [k, a, b]) => {
      const e = list(s, k);
      if (!e) return 'OK';
      const [x, y] = span(e.value.length, toInt(a), toInt(b));
      e.value = x > y ? [] : e.value.slice(x, y + 1);
      s.tidy(k, e);
      return 'OK';
    }],
    LINSERT: [4, 4, one, (s, [k, where, pivot, v]) => {
      const w = where.toUpperCase();
      if (w !== 'BEFORE' && w !== 'AFTER') rerr(SYNTAX);
      const e = list(s, k);
      if (!e) return 0;
      const i = e.value.indexOf(pivot);
      if (i < 0) return -1;
      e.value.splice(w === 'BEFORE' ? i : i + 1, 0, v);
      return e.value.length;
    }],
    LREM: [3, 3, one, lrem],
    // ソート済みセット
    ZADD: [3, -1, one, zadd],
    ZREM: [2, -1, one, (s, [k, ...ms]) => {
      const e = s.typed(k, 'zset');
      if (!e) return 0;
      let n = 0;
      for (const m of ms) if (e.value.delete(m)) n++;
      s.tidy(k, e);
      return n;
    }],
    ZSCORE: [2, 2, one, (s, [k, m]) => {
      const e = s.typed(k, 'zset');
      return e && e.value.has(m) ? fmtScore(e.value.get(m)) : null;
    }],
    ZMSCORE: [2, -1, one, (s, [k, ...ms]) => {
      const e = s.typed(k, 'zset');
      return ms.map((m) => (e && e.value.has(m) ? fmtScore(e.value.get(m)) : null));
    }],
    ZINCRBY: [3, 3, one, (s, [k, by, m]) => zadd(s, [k, 'INCR', by, m])],
    ZCARD: [1, 1, one, (s, [k]) => {
      const e = s.typed(k, 'zset');
      return e ? e.value.size : 0;
    }],
    ZCOUNT: [3, 3, one, (s, [k, lo, hi]) => {
      const e = s.typed(k, 'zset');
      const a = scoreBound(lo), b = scoreBound(hi);
      return e ? [...e.value.values()].filter((v) => inRange(v, a, b)).length : 0;
    }],
    ZRANK: [2, 2, one, (s, [k, m]) => {
      const i = zsorted(s.typed(k, 'zset'), false).findIndex((x) => x[0] === m);
      return i < 0 ? null : i;
    }],
    ZREVRANK: [2, 2, one, (s, [k, m]) => {
      const i = zsorted(s.typed(k, 'zset'), true).findIndex((x) => x[0] === m);
      return i < 0 ? null : i;
    }],
    ZREVRANGE: [3, 4, one, (s, [k, a, b, w]) => {
      if (w !== undefined && w.toUpperCase() !== 'WITHSCORES') rerr(SYNTAX);
      return zrangeIdx(s.typed(k, 'zset'), toInt(a), toInt(b), true, w !== undefined);
    }],
    // ZRANGE は番号の範囲だけ（BYSCORE・BYLEX・LIMIT はなし）
    ZRANGE: [3, 5, one, (s, [k, a, b, ...opt]) => {
      let rev = false, ws = false;
      for (const o of opt.map((x) => x.toUpperCase())) {
        if (o === 'REV') rev = true;
        else if (o === 'WITHSCORES') ws = true;
        else rerr(SYNTAX + ' (fake: only index ranges)');
      }
      return zrangeIdx(s.typed(k, 'zset'), toInt(a), toInt(b), rev, ws);
    }],
  })
);

// 形だけ確かめる（multi-exec は1つでもだめなら全部やめる）
function check(cmd) {
  if (!Array.isArray(cmd) || !cmd.length) return 'ERR empty command';
  if (cmd.some((x) => typeof x !== 'string' && typeof x !== 'number')) return 'ERR invalid argument type';
  const name = String(cmd[0]).toUpperCase();
  const spec = CMDS.get(name);
  if (!spec) return `ERR unknown command '${String(cmd[0])}'`;
  const n = cmd.length - 1;
  if (n < spec[0] || (spec[1] >= 0 && n > spec[1])) return `ERR wrong number of arguments for '${name.toLowerCase()}' command`;
  return null;
}
function exec(store, cmd) {
  const bad = check(cmd);
  if (bad) rerr(bad);
  const args = cmd.map(String);
  const spec = CMDS.get(args[0].toUpperCase());
  return spec[3](store, args.slice(1));
}
function keysOf(cmd) {
  const spec = CMDS.get(String(cmd[0]).toUpperCase());
  return spec ? spec[2](cmd.slice(1).map(String)) : [];
}

// ===== HTTP =====
function createFakeUpstash({ port = 0, host = '127.0.0.1', token = 'fake-upstash-token' } = {}) {
  const store = new Store();
  const log = [];
  const run = (cmd) => {
    if (Array.isArray(cmd) && cmd.length) log.push({ cmd: String(cmd[0]).toUpperCase(), keys: keysOf(cmd) });
    return exec(store, cmd);
  };
  const result = (cmd) => {
    try {
      return { result: run(cmd) };
    } catch (e) {
      if (e instanceof RedisError) return { error: e.message };
      throw e;
    }
  };
  const reply = (res, status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  const server = http.createServer((req, res) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size <= MAX_BODY) chunks.push(c);
    });
    req.on('end', () => {
      try {
        if (req.headers.authorization !== 'Bearer ' + token) return reply(res, 401, { error: 'Unauthorized' });
        if (size > MAX_BODY) return reply(res, 400, { error: 'ERR max request size exceeded' });
        const path = new URL(req.url, 'http://x').pathname.replace(/\/+$/, '');
        const raw = Buffer.concat(chunks).toString('utf8');
        let body = null;
        if (req.method === 'POST' && raw.trim()) {
          try {
            body = JSON.parse(raw);
          } catch (e) {
            return reply(res, 400, { error: 'ERR failed to parse request body' });
          }
        }
        if (path === '/pipeline' || path === '/multi-exec') {
          if (req.method !== 'POST' || !Array.isArray(body) || !body.length || !body.every(Array.isArray)) return reply(res, 400, { error: 'ERR invalid request body' });
          if (path === '/multi-exec') {
            for (const c of body) {
              const bad = check(c);
              if (bad) return reply(res, 400, { error: bad });
            }
          }
          return reply(res, 200, body.map(result));
        }
        // コマンド1つ：POST / に ["GET","k"]、または /get/k
        let cmd = body;
        if (path) cmd = path.slice(1).split('/').map(decodeURIComponent);
        if (!Array.isArray(cmd)) return reply(res, 400, { error: 'ERR invalid request body' });
        const out = result(cmd);
        return reply(res, out.error ? 400 : 200, out);
      } catch (e) {
        return reply(res, 500, { error: 'ERR fake internal: ' + e.message });
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const url = `http://${host}:${server.address().port}`;
      resolve({
        url,
        token,
        store,
        log,
        server,
        call: (...cmd) => exec(store, cmd),
        advance: (ms) => store.advance(ms),
        close: () =>
          new Promise((r) => {
            if (server.closeAllConnections) server.closeAllConnections();
            server.close(() => r());
          }),
      });
    });
  });
}

module.exports = { createFakeUpstash, Store, exec, RedisError };

if (require.main === module) {
  const a = process.argv.slice(2);
  const opt = (name, d) => {
    const i = a.indexOf('--' + name);
    return i >= 0 && a[i + 1] ? a[i + 1] : d;
  };
  createFakeUpstash({ port: Number(opt('port', 8079)), host: opt('host', '127.0.0.1'), token: opt('token', 'dev-token') }).then((f) => {
    console.log(`fake upstash: ${f.url}`);
    console.log(`  KV_REST_API_URL=${f.url} KV_REST_API_TOKEN=${f.token}`);
  });
}
