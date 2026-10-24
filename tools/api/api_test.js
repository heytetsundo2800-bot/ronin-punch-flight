// /api/rpf のテスト
//   node tools/api/api_test.js
// にせ Upstash（メモリ）をこのプロセスで立てて、devserver.js を子プロセスで起動し、HTTP でたしかめる。
// 本物のデータベースには絶対につながない（子プロセスの DB 環境変数は消してから起動する）
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const crypto = require('crypto');
const netMod = require('net');
const { pathToFileURL } = require('url');
const { createFakeUpstash } = require('./fake_upstash.js');
const rpf = require('../../api/rpf.js');

const ROOT = path.resolve(__dirname, '..', '..');
const DEV = path.join(__dirname, 'devserver.js');
const SRC = path.join(ROOT, 'src');
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400 * 1000;
const NOW = Date.now();
const WK = rpf.weekId(NOW);
const PWK = rpf.weekId(NOW - 7 * DAY);
const OLDWK = rpf.weekId(NOW - 14 * DAY);
const NEXTWK = rpf.weekId(NOW + 7 * DAY);
const CODE_RE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
const FC_RE = /^[A-HJ-NP-Z2-9]{8}$/;

// src/ の ESM を読むときの Node の注意書き（package.json に type がない）は出さない
const warnListeners = process.listeners('warning');
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.code !== 'MODULE_TYPELESS_PACKAGE_JSON') warnListeners.forEach((l) => l(w));
});

// ===== 小さなテストの道具 =====
let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ok    ' + name);
  } catch (e) {
    failed++;
    failures.push(name);
    console.log('  FAIL  ' + name + '\n        ' + String((e && e.stack) || e).split('\n').slice(0, 5).join('\n        '));
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error((msg ? msg + ': ' : '') + 'expected ' + b + '\n        got      ' + a);
}
function err(r, status, code, msg) {
  if (r.status !== status || r.ok !== false || r.err !== code) throw new Error((msg ? msg + ': ' : '') + `expected ${status} ${code}, got ${r.status} ${JSON.stringify(r)}`);
}
function ok(r, msg) {
  if (r.status !== 200 || r.ok !== true) throw new Error((msg ? msg + ': ' : '') + 'expected ok, got ' + r.status + ' ' + JSON.stringify(r));
  return r;
}

// ===== 子プロセス（devserver）=====
const children = [];
function startDev(args) {
  return new Promise((resolve, reject) => {
    const env = {};
    for (const [k, v] of Object.entries(process.env)) if (!/KV_|REDIS|UPSTASH/i.test(k)) env[k] = v;
    const p = spawn(process.execPath, [DEV, '--port', '0', ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(p);
    p.output = '';
    const timer = setTimeout(() => reject(new Error('devserver did not start: ' + p.output)), 10000);
    const onData = (d) => {
      p.output += d;
      const m = /devserver: (http:\/\/[^/\s]+)\//.exec(p.output);
      if (m && !p.url) {
        p.url = m[1];
        clearTimeout(timer);
        resolve(p);
      }
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('exit', (code) => {
      if (!p.url) {
        clearTimeout(timer);
        reject(new Error('devserver exited ' + code + ': ' + p.output));
      }
    });
  });
}
function freePort() {
  return new Promise((resolve) => {
    const s = netMod.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

// ===== 端末のまね =====
const issued = { tokens: [], codes: [] }; // ログに出ていないか最後にたしかめる
let ipN = 0;
const newIp = () => {
  ipN++;
  return `10.${(ipN >> 8) & 255}.${ipN & 255}.7`;
};
class Dev {
  constructor(base, ip) {
    this.base = base;
    this.ip = ip || newIp();
    this.acct = null;
  }
  async raw(body, { headers = {}, method = 'POST', rawBody, query = '' } = {}) {
    const h = { 'x-forwarded-for': this.ip, ...headers };
    if (method === 'POST' && !Object.keys(h).some((k) => k.toLowerCase() === 'content-type')) h['Content-Type'] = 'application/json';
    const r = await fetch(this.base + '/api/rpf' + query, {
      method,
      headers: h,
      body: method === 'POST' ? (rawBody !== undefined ? rawBody : JSON.stringify(body)) : undefined,
    });
    const text = await r.text();
    let j = null;
    try {
      j = JSON.parse(text);
    } catch (e) {}
    return { status: r.status, j, text, headers: r.headers };
  }
  async call(a, body = {}, { anon = false, auth } = {}) {
    const headers = {};
    const A = auth !== undefined ? auth : !anon && this.acct ? `Bearer ${this.acct.uid}.${this.acct.token}` : null;
    if (A) headers.Authorization = A;
    const r = await this.raw({ a, ...body }, { headers });
    return { ...(r.j || {}), status: r.status };
  }
  async register(name, c, save) {
    const body = { name };
    if (c !== undefined) body.c = c;
    if (save !== undefined) body.save = save;
    const r = await this.call('register', body, { anon: true });
    if (r.ok) {
      this.acct = { uid: r.uid, token: r.token, fc: r.fc };
      issued.tokens.push(r.token);
    }
    return r;
  }
  sync(o = {}) {
    return this.call('sync', { rp: 0, wk: WK, wpt: 0, c: 'tora', plays: 0, save: '{}', ...o });
  }
  rank(t, wk = WK, opt) {
    return this.call('rank', { t, wk }, opt);
  }
  async issueCode() {
    const r = await this.call('code');
    if (r.ok) issued.codes.push(r.code);
    return r;
  }
  async restore(code) {
    const r = await this.call('restore', { code }, { anon: true });
    if (r.ok) {
      this.acct = { uid: r.uid, token: r.token, fc: r.fc };
      issued.tokens.push(r.token);
    }
    return r;
  }
}

async function main() {
  const fake = await createFakeUpstash({ port: 0 });
  const F = (...cmd) => fake.call(...cmd); // にせ DB を直接さわる（ログに残らない）
  const users = (name) => F('HGETALL', 'rpf:u:' + name);
  const hget = (uid, f) => F('HGET', 'rpf:u:' + uid, f);
  // 別のアプリのキー（さわってはいけない）
  F('SET', 'kr:test', 'keep');
  F('HSET', 'kr:h', 'a', '1', 'b', '2');
  F('ZADD', 'kr:z', '5', 'm', '7', 'n');
  F('SADD', 'kr:s', 'x', 'y');
  F('SET', 'kr:ttl', 'v', 'EX', String(400 * 86400));
  F('RPUSH', 'kr:l', 'one', 'two');
  F('SET', 'rpfx:lookalike', 'keep'); // rpf: ではない
  const dump = (k, t) =>
    t === 'string' ? F('GET', k) : t === 'hash' ? F('HGETALL', k) : t === 'zset' ? F('ZRANGE', k, '0', '-1', 'WITHSCORES') : t === 'list' ? F('LRANGE', k, '0', '-1') : F('SMEMBERS', k).sort();
  const other = () =>
    F('KEYS', '*')
      .filter((k) => !k.startsWith('rpf:'))
      .sort()
      .map((k) => [k, F('TYPE', k), dump(k, F('TYPE', k))]);
  const otherBefore = other();
  // rpf: のデータを全部消す（テストの区切り用）
  const resetRpf = () => F('KEYS', 'rpf:*').forEach((k) => F('DEL', k));
  // uid を指しているものを全部さがす（キー名・値・フィールド・メンバー）
  const refsTo = (needle) => {
    const out = [];
    for (const k of F('KEYS', 'rpf:*')) {
      if (k.includes(needle)) {
        out.push(k);
        continue;
      }
      const t = F('TYPE', k);
      if (t === 'string' && F('GET', k).includes(needle)) out.push(k);
      if (t === 'hash') {
        const h = F('HGETALL', k);
        for (let i = 0; i < h.length; i += 2) if (h[i].includes(needle) || h[i + 1].includes(needle)) out.push(k + '#' + h[i]);
      }
      if (t === 'set' && F('SMEMBERS', k).some((m) => m.includes(needle))) out.push(k);
      if (t === 'zset' && F('ZRANGE', k, '0', '-1').some((m) => m.includes(needle))) out.push(k);
      if (t === 'list' && F('LRANGE', k, '0', '-1').some((m) => m.includes(needle))) out.push(k);
    }
    return out;
  };

  const dead = await freePort();
  const [srv, nodb, deaddb, badtok] = await Promise.all([
    startDev(['--upstash-url', fake.url, '--upstash-token', fake.token]),
    startDev(['--no-db']),
    startDev(['--upstash-url', 'http://127.0.0.1:' + dead, '--upstash-token', 'x']),
    startDev(['--upstash-url', fake.url, '--upstash-token', 'wrong-db-token']),
  ]);
  const B = srv.url;
  const dev = (ip) => new Dev(B, ip);

  try {
    // ---------------------------------------------------------------
    console.log('\n[helpers]');
    await test('weekId: JST Monday 00:00 boundary', async () => {
      eq(rpf.weekId(Date.UTC(2026, 9, 18, 15, 0, 0)), '2026-10-19', 'Mon 00:00 JST');
      eq(rpf.weekId(Date.UTC(2026, 9, 18, 14, 59, 59)), '2026-10-12', 'Sun 23:59 JST');
      eq(rpf.weekId(Date.UTC(2026, 9, 25, 14, 59, 59)), '2026-10-19', 'next Sun 23:59 JST');
      eq(rpf.weekId(Date.UTC(2027, 0, 3, 15, 0, 0)), '2027-01-04', 'year boundary');
    });
    await test('weekId matches the client (src/save.js) on 2000 random times', async () => {
      const save = await import(pathToFileURL(path.join(SRC, 'save.js')).href);
      for (let i = 0; i < 2000; i++) {
        const t = Date.UTC(2024, 0, 1) + Math.floor(Math.random() * 4 * 365 * DAY);
        eq(rpf.weekId(t), save.weekId(t), 'at ' + new Date(t).toISOString());
      }
    });
    await test('dbConf: env var names and prefixes', async () => {
      const c = rpf.dbConf;
      eq(c({}), null, 'empty');
      eq(c({ KV_REST_API_URL: 'https://a.upstash.io/', KV_REST_API_TOKEN: 't1' }), { url: 'https://a.upstash.io', token: 't1' }, 'KV_');
      eq(c({ UPSTASH_REDIS_REST_URL: 'https://b.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't2' }), { url: 'https://b.upstash.io', token: 't2' }, 'UPSTASH_');
      eq(c({ STORAGE_KV_REST_API_URL: 'https://c.io', STORAGE_KV_REST_API_TOKEN: 't3' }), { url: 'https://c.io', token: 't3' }, 'prefixed KV');
      eq(c({ MYDB_REDIS_REST_URL: 'https://d.io', MYDB_REDIS_REST_TOKEN: 't4' }), { url: 'https://d.io', token: 't4' }, 'prefixed REDIS');
      eq(c({ KV_REST_API_URL: 'https://e.io', KV_REST_API_READ_ONLY_TOKEN: 'ro' }), null, 'read-only token must not be used');
      eq(c({ KV_REST_API_URL: 'https://e.io', KV_REST_API_TOKEN: '' }), null, 'empty token');
      eq(c({ A_KV_REST_API_URL: 'https://f.io', B_KV_REST_API_TOKEN: 't' }), null, 'prefixes must match');
      eq(c({ KV_URL: 'rediss://x', REDIS_URL: 'rediss://y' }), null, 'non-REST urls ignored');
      eq(c({ KV_REST_API_URL: 'https://k.io', KV_REST_API_TOKEN: 'k', UPSTASH_REDIS_REST_URL: 'https://u.io', UPSTASH_REDIS_REST_TOKEN: 'u' }).url, 'https://k.io', 'KV_ wins');
    });

    // ---------------------------------------------------------------
    console.log('\n[ping / setup / protocol]');
    await test('ping without DB env → ready:false (200, json, no-store)', async () => {
      const r = await new Dev(nodb.url).raw(null, { method: 'GET', query: '?a=ping' });
      eq(r.status, 200);
      eq(r.j, { ok: true, ready: false });
      eq(r.headers.get('content-type'), 'application/json; charset=utf-8');
      eq(r.headers.get('cache-control'), 'no-store');
    });
    await test('actions without DB env → 503 setup', async () => {
      const d = new Dev(nodb.url);
      err(await d.register('テスト'), 503, 'setup');
      err(await d.call('rank', { t: 'a' }), 503, 'setup');
    });
    await test('ping with DB env but unreachable DB → ready:false', async () => {
      const r = await new Dev(deaddb.url).raw(null, { method: 'GET', query: '?a=ping' });
      eq(r.j, { ok: true, ready: false });
    });
    await test('wrong DB token → ready:false, actions → 500 server', async () => {
      const r = await new Dev(badtok.url).raw(null, { method: 'GET', query: '?a=ping' });
      eq(r.j, { ok: true, ready: false });
      const d = new Dev(badtok.url);
      err(await d.register('テスト'), 500, 'server');
      err(await d.call('rank', { t: 'a' }), 500, 'server');
      assert(/\[rpf\] register: db http 401/.test(badtok.output), 'logged: ' + badtok.output.slice(-300));
      assert(!badtok.output.includes('wrong-db-token'), 'DB token not logged');
    });
    await test('ping with DB env → ready:true (GET and POST)', async () => {
      const d = dev();
      const r = await d.raw(null, { method: 'GET', query: '?a=ping' });
      eq(r.status, 200);
      eq(r.j, { ok: true, ready: true });
      eq(r.headers.get('cache-control'), 'no-store');
      eq((await d.call('ping')).ready, true);
    });
    await test('OPTIONS → 204, PUT → 405, GET other action → 400', async () => {
      const d = dev();
      const o = await d.raw(null, { method: 'OPTIONS' });
      eq(o.status, 204);
      eq(o.text, '');
      eq(o.headers.get('cache-control'), 'no-store');
      const p = await d.raw(null, { method: 'PUT' });
      eq([p.status, p.j && p.j.err], [405, 'method']);
      const g = await d.raw(null, { method: 'GET', query: '?a=rank' });
      eq([g.status, g.j && g.j.err], [400, 'bad']);
    });
    await test('bad bodies: invalid JSON, array, unknown/prototype actions → 400', async () => {
      const d = dev();
      for (const raw of ['{bad json', '[1,2]', '"str"', '{"a":"nope"}', '{"a":"__proto__"}', '{"a":"constructor"}', '{"a":"toString"}', '{"x":1}', '{"a":["me"]}']) {
        const r = await d.raw(null, { rawBody: raw });
        eq([r.status, r.j && r.j.err], [400, 'bad'], raw);
      }
    });
    await test('body over 64 KB → 413 big', async () => {
      const r = await dev().raw({ a: 'register', name: 'x', save: 'x'.repeat(70 * 1024) });
      eq([r.status, r.j && r.j.err], [413, 'big']);
    });
    await test('text/plain body is still parsed', async () => {
      const r = await dev().raw(null, { rawBody: '{"a":"ping"}', headers: { 'Content-Type': 'text/plain' } });
      eq(r.j, { ok: true, ready: true });
    });

    // ---------------------------------------------------------------
    console.log('\n[register]');
    await test('register validation: name', async () => {
      const d = dev();
      const bad = ['', '   ', '\u3000\u3000', 'あいうえおかきくけこさ', 'abcdefghijk', '\u3164', '\u3164\u3164', 'a\u0000b', 'ab\u202ecd', 'a\nb', 'a\tb', 'x\u200bx', 'x\u2028x'];
      for (const n of bad) err(await d.register(n), 400, 'name', JSON.stringify(n));
      err(await d.call('register', { c: 'tora' }, { anon: true }), 400, 'name', 'missing');
      err(await d.call('register', { name: 123 }, { anon: true }), 400, 'name', 'number');
      err(await d.call('register', { name: ['a'] }, { anon: true }), 400, 'name', 'array');
    });
    await test('register validation: NG words (case-insensitive, spaces ignored, width-folded)', async () => {
      const d = dev();
      const ng = ['fuck', 'FuCk', 'f u c k', 'ｆｕｃｋ', 'iamADMIN', 'Ad Min', '運営です', '死ね', 'しね', 'ころす', 'セックス', 'ｾｯｸｽ', 'BITCH', 'shit!!', 'うんこ', 'ちん\u3000こ'];
      for (const n of ng) err(await d.register(n), 400, 'ng', n);
    });
    await test('register validation: character id, save', async () => {
      const d = dev();
      err(await d.register('トラ', 'ninja'), 400, 'char');
      err(await d.register('トラ', 5), 400, 'char');
      err(await d.register('トラ', 'tora', 'x'.repeat(20001)), 400, 'save');
      err(await d.register('トラ', 'tora', { a: 1 }), 400, 'bad');
    });
    let R1;
    await test('register ok: shape of uid/token/fc, defaults, trimming', async () => {
      R1 = dev();
      const r = ok(await R1.register('  トラ太郎  ', undefined, '{"rp":0}'));
      assert(/^[0-9a-z]{10}$/.test(r.uid), 'uid base36 x10: ' + r.uid);
      assert(/^[A-Za-z0-9_-]{43}$/.test(r.token), 'token 32 bytes base64url: ' + r.token);
      assert(FC_RE.test(r.fc), 'fc: ' + r.fc);
      eq(Object.keys(r).sort(), ['fc', 'ok', 'status', 'token', 'uid']);
      const me = ok(await R1.call('me'));
      eq([me.name, me.fc, me.rp, me.c], ['トラ太郎', r.fc, 0, 'tora']);
    });
    await test('register stores only the token hash (never the token)', async () => {
      eq(hget(R1.acct.uid, 'th'), sha(R1.acct.token));
      eq(refsTo(R1.acct.token), [], 'raw token stored somewhere');
      eq(F('GET', 'rpf:fc:' + R1.acct.fc), R1.acct.uid, 'fc mapping');
      eq(JSON.parse(F('HGET', 'rpf:pub', R1.acct.uid)), { n: 'トラ太郎', c: 'tora' }, 'public name');
      eq(hget(R1.acct.uid, 'save'), '{"rp":0}');
    });
    await test('register ok: 10 code points with emoji, char ids, lone surrogate from client slice', async () => {
      const d = dev();
      ok(await d.register('🐯🐯🐯🐯🐯あいうえお', 'even'));
      eq((await d.call('me')).name, '🐯🐯🐯🐯🐯あいうえお');
      const e = dev();
      ok(await e.register('👨\u200d👩\u200d👧', 'aomachi'));
      eq((await e.call('me')).c, 'aomachi');
      const f = dev();
      ok(await f.register('あいうえおかきくけ\ud83d')); // 'あいうえおかきくけ😀'.slice(0, 10)
      eq((await f.call('me')).name, 'あいうえおかきくけ');
    });
    await test('register: uids and friend codes are unique', async () => {
      const u = new Set(), f = new Set();
      for (let i = 0; i < 12; i++) {
        const d = dev();
        const r = ok(await d.register('ユーザー' + i));
        u.add(r.uid);
        f.add(r.fc);
      }
      eq([u.size, f.size], [12, 12]);
    });

    // ---------------------------------------------------------------
    console.log('\n[me / auth / rename]');
    await test('me requires a valid token → 401 auth otherwise', async () => {
      const d = dev();
      ok(await d.register('ミー'));
      const { uid, token } = d.acct;
      err(await d.call('me', {}, { anon: true }), 401, 'auth', 'no header');
      err(await d.call('me', {}, { auth: `Bearer ${uid}.${'A'.repeat(43)}` }), 401, 'auth', 'wrong token');
      err(await d.call('me', {}, { auth: `Bearer ${uid}.${token.slice(0, -1)}x` }), 401, 'auth', 'one char off');
      err(await d.call('me', {}, { auth: `Bearer ${R1.acct.uid}.${token}` }), 401, 'auth', 'other uid');
      err(await d.call('me', {}, { auth: 'Bearer garbage' }), 401, 'auth', 'malformed');
      err(await d.call('me', {}, { auth: `Basic ${uid}.${token}` }), 401, 'auth', 'scheme');
      err(await d.call('me', {}, { auth: `Bearer zzzzzzzzzz.${token}` }), 401, 'auth', 'unknown uid');
      ok(await d.call('me'));
    });
    await test('rename updates the name and the public name; NG → 400', async () => {
      const d = dev();
      ok(await d.register('まえの名前', 'even'));
      const r = ok(await d.call('rename', { name: '  あたらしい名前 ' }));
      eq(r.name, 'あたらしい名前');
      eq((await d.call('me')).name, 'あたらしい名前');
      eq(JSON.parse(F('HGET', 'rpf:pub', d.acct.uid)), { n: 'あたらしい名前', c: 'even' });
      err(await d.call('rename', { name: 'うんこマン' }), 400, 'ng');
      err(await d.call('rename', { name: '' }), 400, 'name');
      err(await d.call('rename', { name: 'x' }, { anon: true }), 401, 'auth');
      eq((await d.call('me')).name, 'あたらしい名前');
    });

    // ---------------------------------------------------------------
    console.log('\n[sync]');
    let S1;
    await test('sync ok: stores rp / week points / char / save', async () => {
      S1 = dev();
      ok(await S1.register('シンク'));
      const r = ok(await S1.sync({ plays: 1, rp: 44, wpt: 700, c: 'even', save: '{"rp":44}' }));
      eq([r.rp, r.wpt], [44, 700]);
      const me = await S1.call('me');
      eq([me.rp, me.c], [44, 'even']);
      eq(hget(S1.acct.uid, 'save'), '{"rp":44}');
      eq(F('ZSCORE', 'rpf:lb:a', S1.acct.uid), '44');
      eq(F('ZSCORE', 'rpf:lb:w:' + WK, S1.acct.uid), '700');
      eq(JSON.parse(F('HGET', 'rpf:pub', S1.acct.uid)).c, 'even');
      eq(hget(S1.acct.uid, 'sus'), '0');
      const t = F('TTL', 'rpf:lb:w:' + WK);
      assert(t > 44 * 86400 && t <= 45 * 86400, 'weekly board ttl ' + t);
    });
    await test('sync clamps absurd rp (+60 per sync) and counts sus', async () => {
      const r = ok(await S1.sync({ plays: 2, rp: 5000, wpt: 1400, c: 'even' }));
      eq([r.rp, r.wpt], [104, 1400]);
      eq(hget(S1.acct.uid, 'sus'), '1');
      eq((await S1.call('me')).rp, 104);
    });
    await test('sync clamps absurd week points (+2500 per sync)', async () => {
      const r = ok(await S1.sync({ plays: 3, rp: 104, wpt: 999999 }));
      eq([r.rp, r.wpt], [104, 3900]);
      eq(hget(S1.acct.uid, 'sus'), '2');
    });
    await test('sync: rp never above plays*60+60; decreases accepted', async () => {
      const d = dev();
      ok(await d.register('ランク'));
      eq((await d.sync({ plays: 0, rp: 60 })).rp, 60);
      eq((await d.sync({ plays: 0, rp: 120 })).rp, 60, 'capped by plays*60+60');
      eq(hget(d.acct.uid, 'sus'), '1');
      eq((await d.sync({ plays: 1, rp: 120 })).rp, 120);
      eq((await d.sync({ plays: 2, rp: 110 })).rp, 110, 'loss accepted');
      eq((await d.sync({ plays: 1, rp: 110 })).rp, 110);
      eq(hget(d.acct.uid, 'pl'), '2', 'plays never decrease');
      eq(hget(d.acct.uid, 'sus'), '1');
    });
    await test('sync: week points never above plays_this_week*2500; never decrease in a week', async () => {
      const d = dev();
      ok(await d.register('ウィーク'));
      eq((await d.sync({ plays: 1, wpt: 2500 })).wpt, 2500);
      eq((await d.sync({ plays: 1, wpt: 3000 })).wpt, 2500, 'no new play → no more points');
      eq((await d.sync({ plays: 3, wpt: 10000 })).wpt, 5000, '+2500 per sync');
      eq((await d.sync({ plays: 3, wpt: 4000 })).wpt, 5000, 'lower value ignored');
      eq((await d.sync({ plays: 4, wpt: 7400 })).wpt, 7400);
      eq(hget(d.acct.uid, 'wpl'), '4');
      eq(hget(d.acct.uid, 'sus'), '2');
      eq(F('ZSCORE', 'rpf:lb:w:' + WK, d.acct.uid), '7400');
    });
    await test('sync: previous week accepted (late sync), separate weekly board', async () => {
      const r = ok(await S1.sync({ plays: 4, rp: 104, wk: PWK, wpt: 300 }));
      eq(r.wpt, 300);
      eq(F('ZSCORE', 'rpf:lb:w:' + PWK, S1.acct.uid), '300');
      eq(F('ZSCORE', 'rpf:lb:w:' + WK, S1.acct.uid), '3900', 'this week untouched');
      eq(ok(await S1.sync({ plays: 4, rp: 104, wpt: 3900 })).wpt, 3900);
      eq(ok(await S1.sync({ plays: 5, rp: 104, wk: PWK, wpt: 500 })).wpt, 500, 'prev week slot kept');
      eq([hget(S1.acct.uid, 'wk'), hget(S1.acct.uid, 'pwk')], [WK, PWK]);
    });
    await test('sync rejects bad week ids', async () => {
      err(await S1.sync({ plays: 5, wk: 'abc' }), 400, 'bad');
      err(await S1.sync({ plays: 5, wk: 20261019 }), 400, 'bad');
      err(await S1.sync({ plays: 5, wk: OLDWK }), 400, 'wk', 'two weeks ago');
      err(await S1.sync({ plays: 5, wk: NEXTWK }), 400, 'wk', 'next week');
      err(await S1.sync({ plays: 5, wk: '2026-13-45' }), 400, 'wk', 'not a week');
    });
    await test('sync rejects bad numbers / types', async () => {
      const cases = [{ rp: -1 }, { rp: 1.5 }, { rp: '44' }, { rp: null }, { plays: undefined }, { wpt: 2e9 }, { plays: 1e10 }, { wpt: true }, { c: 5 }, { save: 5 }];
      for (const c of cases) err(await S1.sync({ plays: 5, rp: 104, ...c }), 400, 'bad', JSON.stringify(c));
      err(await S1.sync({ plays: 5, save: 'x'.repeat(20001) }), 400, 'save');
      err(await S1.call('sync', { rp: 1, wk: WK, wpt: 1, plays: 1 }, { anon: true }), 401, 'auth');
    });
    await test('sync: unknown char ignored, missing save keeps the old save', async () => {
      ok(await S1.sync({ plays: 5, rp: 104, wpt: 3900, c: 'aomachi', save: '{"keep":1}' }));
      ok(await S1.call('sync', { rp: 104, wk: WK, wpt: 3900, plays: 5, c: 'ninja' }));
      eq((await S1.call('me')).c, 'aomachi');
      eq(hget(S1.acct.uid, 'save'), '{"keep":1}');
    });
    await test('sync rate limit: 40 per 10 minutes per uid → 429 rl', async () => {
      const d = dev();
      ok(await d.register('レート'));
      for (let i = 0; i < 40; i++) ok(await d.sync({ plays: i, rp: 0 }), 'sync ' + i);
      err(await d.sync({ plays: 41 }), 429, 'rl');
      const t = F('TTL', 'rpf:rl:s:' + d.acct.uid);
      assert(t > 590 && t <= 600, 'ttl ' + t);
      fake.advance(601 * 1000);
      ok(await d.sync({ plays: 41 }), 'after the window');
    });

    // ---------------------------------------------------------------
    console.log('\n[rankings]');
    resetRpf();
    const A = dev(), Bu = dev(), C = dev(), D = dev(), E = dev();
    await test('rankings setup', async () => {
      ok(await A.register('エー', 'even'));
      ok(await Bu.register('ビー', 'aomachi'));
      ok(await C.register('シー'));
      ok(await D.register('ディー'));
      ok(await E.register('イー'));
      ok(await A.sync({ plays: 1, rp: 60, wpt: 500, c: 'even' }));
      eq(ok(await A.sync({ plays: 2, rp: 120, wpt: 500, c: 'even' })).rp, 120);
      ok(await Bu.sync({ plays: 1, rp: 60, wpt: 2000, c: 'aomachi' }));
      ok(await C.sync({ plays: 1, rp: 60, wpt: 0 }));
      ok(await D.sync({ plays: 1, rp: 0, wpt: 1200 }));
    });
    const brief = (l) => l.map((x) => [x.n, x.s, x.rank, !!x.me]);
    await test("rank 'a': order by rp, ties share a rank, me marked", async () => {
      const r = ok(await A.rank('a'));
      eq(r.list.length, 4);
      eq(brief([r.list[0]]), [['エー', 120, 1, true]]);
      eq(r.list.slice(1, 3).map((x) => [x.s, x.rank]), [[60, 2], [60, 2]]);
      eq(r.list.slice(1, 3).map((x) => x.n).sort(), ['シー', 'ビー']);
      eq(brief([r.list[3]]), [['ディー', 0, 4, false]]);
      eq(r.me, { rank: 1, s: 120 });
      for (const x of r.list) eq(Object.keys(x).filter((k) => k !== 'me').sort(), ['c', 'n', 'rank', 's'], 'no uid in public lists');
      eq(r.list[0].c, 'even');
    });
    await test("rank 'a' as a tied user / unranked user / anonymous / bad token", async () => {
      const c = ok(await C.rank('a'));
      eq(c.me, { rank: 2, s: 60 });
      eq(c.list.filter((x) => x.me).map((x) => x.n), ['シー']);
      const e = ok(await E.rank('a'));
      eq([e.me, e.list.some((x) => x.me)], [null, false]);
      const an = ok(await new Dev(B).rank('a'));
      eq([an.me, an.list.some((x) => x.me), an.list.length], [null, false, 4]);
      const bt = ok(await A.rank('a', WK, { auth: `Bearer ${A.acct.uid}.${'B'.repeat(43)}` }));
      eq([bt.me, bt.list.some((x) => x.me)], [null, false]);
    });
    await test("rank 'w': this week's points, players without points not listed", async () => {
      const r = ok(await D.rank('w'));
      eq(brief(r.list), [['ビー', 2000, 1, false], ['ディー', 1200, 2, true], ['エー', 500, 3, false]]);
      eq(r.me, { rank: 2, s: 1200 });
      eq((await C.rank('w')).me, null);
      eq(ok(await D.rank('w', PWK)).list, [], 'previous week board');
      eq(brief(ok(await D.rank('w', OLDWK)).list).length, 3, 'unknown week → this week');
      eq(brief(ok(await D.call('rank', { t: 'w' })).list).length, 3, 'missing wk → this week');
      err(await D.call('rank', { t: 'x' }), 400, 'bad');
    });
    await test('rename shows up in rankings', async () => {
      ok(await A.call('rename', { name: 'エース' }));
      eq(ok(await Bu.rank('a')).list[0].n, 'エース');
      eq(ok(await Bu.rank('w')).list[2].n, 'エース');
    });
    await test("rank 'a': top 50 only, me rank outside the list", async () => {
      const cmds = [];
      for (let i = 0; i < 60; i++) {
        const uid = 'seed' + String(i).padStart(6, '0');
        F('ZADD', 'rpf:lb:a', String(1000 + i), uid);
        F('HSET', 'rpf:pub', uid, JSON.stringify({ n: 'seed' + i, c: 'tora' }));
        cmds.push(uid);
      }
      const r = ok(await Bu.rank('a'));
      eq(r.list.length, 50);
      eq([r.list[0].s, r.list[0].rank, r.list[49].s, r.list[49].rank], [1059, 1, 1010, 50]);
      eq(r.me, { rank: 62, s: 60 });
      assert(!r.list.some((x) => x.me));
      for (const uid of cmds) {
        F('ZREM', 'rpf:lb:a', uid);
        F('HDEL', 'rpf:pub', uid);
      }
    });

    // ---------------------------------------------------------------
    console.log('\n[friends]');
    const F1 = dev(), F2 = dev(), F3 = dev();
    await test('friends setup + empty friend ranking', async () => {
      ok(await F1.register('フレンド1'));
      ok(await F2.register('フレンド2', 'even'));
      ok(await F3.register('フレンド3'));
      ok(await F1.sync({ plays: 1, rp: 60 }));
      ok(await F2.sync({ plays: 1, rp: 60, c: 'even' }));
      eq(ok(await F2.sync({ plays: 2, rp: 120, c: 'even' })).rp, 120);
      const r = ok(await F1.rank('f'));
      eq([r.list, r.me], [[], null], 'no friends → empty list (client shows "まだフレンドがいません")');
      err(await F1.call('rank', { t: 'f' }, { anon: true }), 401, 'auth');
    });
    await test('fadd adds both ways and returns the name', async () => {
      const r = ok(await F1.call('fadd', { fc: F2.acct.fc }));
      eq(r.name, 'フレンド2');
      eq([F('SISMEMBER', 'rpf:fr:' + F1.acct.uid, F2.acct.uid), F('SISMEMBER', 'rpf:fr:' + F2.acct.uid, F1.acct.uid)], [1, 1]);
    });
    await test("rank 'f': me + friends by rp, uid only for friends", async () => {
      const r = ok(await F1.rank('f'));
      eq(brief(r.list), [['フレンド2', 120, 1, false], ['フレンド1', 60, 2, true]]);
      eq(r.list[0].u, F2.acct.uid);
      eq(r.list[1].u, undefined);
      eq(r.list[0].c, 'even');
      eq(r.me, { rank: 2, s: 60 });
      const r2 = ok(await F2.rank('f'));
      eq(brief(r2.list), [['フレンド2', 120, 1, true], ['フレンド1', 60, 2, false]]);
    });
    await test('fadd: normalization, idempotent, self, not found, bad input', async () => {
      const lc = F1.acct.fc.toLowerCase();
      eq(ok(await F3.call('fadd', { fc: lc.slice(0, 4) + '-' + lc.slice(4) })).name, 'フレンド1');
      eq(ok(await F3.call('fadd', { fc: F1.acct.fc })).name, 'フレンド1', 'again');
      err(await F1.call('fadd', { fc: F1.acct.fc }), 400, 'self');
      err(await F1.call('fadd', { fc: F1.acct.fc.toLowerCase() }), 400, 'self');
      err(await F1.call('fadd', { fc: 'ZZZZ2222' }), 404, 'nf');
      err(await F1.call('fadd', { fc: 'abc' }), 404, 'nf');
      err(await F1.call('fadd', { fc: 12345678 }), 400, 'bad');
      err(await F1.call('fadd', { fc: F2.acct.fc }, { anon: true }), 401, 'auth');
      eq(F('SCARD', 'rpf:fr:' + F1.acct.uid), 2);
    });
    await test('fdel removes both ways', async () => {
      ok(await F1.call('fdel', { uid: F2.acct.uid }));
      eq([F('SISMEMBER', 'rpf:fr:' + F1.acct.uid, F2.acct.uid), F('SISMEMBER', 'rpf:fr:' + F2.acct.uid, F1.acct.uid)], [0, 0]);
      eq(brief(ok(await F1.rank('f')).list).map((x) => x[0]), ['フレンド1', 'フレンド3']);
      eq(ok(await F2.rank('f')).list, []);
      err(await F1.call('fdel', { uid: 'NOT VALID' }), 400, 'bad');
      err(await F1.call('fdel', { uid: F1.acct.uid }), 400, 'self');
    });
    await test('friend limit (100) → 409 full, both sides', async () => {
      for (let i = 0; i < 100; i++) F('SADD', 'rpf:fr:' + F3.acct.uid, 'fill' + String(i).padStart(6, '0'));
      err(await F3.call('fadd', { fc: F2.acct.fc }), 409, 'full', 'my list full');
      err(await F2.call('fadd', { fc: F3.acct.fc }), 409, 'full', 'their list full');
      eq(ok(await F3.call('fadd', { fc: F1.acct.fc })).name, 'フレンド1', 'already friends still ok');
      for (let i = 0; i < 100; i++) F('SREM', 'rpf:fr:' + F3.acct.uid, 'fill' + String(i).padStart(6, '0'));
    });
    await test("rank 'f' drops friends whose account is gone", async () => {
      F('SADD', 'rpf:fr:' + F1.acct.uid, 'ghost00001');
      const r = ok(await F1.rank('f'));
      eq(r.list.map((x) => x.n).sort(), ['フレンド1', 'フレンド3']);
      eq(F('SISMEMBER', 'rpf:fr:' + F1.acct.uid, 'ghost00001'), 0, 'cleaned up');
    });

    // ---------------------------------------------------------------
    console.log('\n[transfer code]');
    const T1 = dev();
    let code1;
    await test('code: format XXXX-XXXX-XXXX, only the hash is stored (30 days)', async () => {
      ok(await T1.register('ひきつぎ', 'aomachi', '{"rp":0}'));
      ok(await T1.sync({ plays: 1, rp: 44, wpt: 700, c: 'aomachi', save: '{"rp":44,"plays":1}' }));
      const r = ok(await T1.issueCode());
      assert(CODE_RE.test(r.code), 'format: ' + r.code);
      code1 = r.code;
      const plain = code1.replace(/-/g, '');
      eq(F('GET', 'rpf:tc:' + sha(plain)), T1.acct.uid);
      eq(hget(T1.acct.uid, 'tc'), sha(plain));
      const t = F('TTL', 'rpf:tc:' + sha(plain));
      assert(t > 30 * 86400 - 5 && t <= 30 * 86400, 'ttl ' + t);
      eq(refsTo(plain), [], 'raw code stored');
      err(await T1.call('code', {}, { anon: true }), 401, 'auth');
    });
    const T2 = dev();
    let oldTok;
    await test('restore on a new device: same account, new token, save returned', async () => {
      oldTok = T1.acct.token;
      const r = ok(await T2.restore(code1));
      eq([r.uid, r.fc, r.name, r.save], [T1.acct.uid, T1.acct.fc, 'ひきつぎ', '{"rp":44,"plays":1}']);
      assert(r.token !== oldTok && /^[A-Za-z0-9_-]{43}$/.test(r.token), 'new token');
      eq(hget(r.uid, 'th'), sha(r.token));
      eq(hget(r.uid, 'tc'), null, 'code field cleared');
      eq(F('EXISTS', 'rpf:tc:' + sha(code1.replace(/-/g, ''))), 0, 'code deleted');
    });
    await test('old device gets 401 auth; new device works', async () => {
      err(await T1.call('me'), 401, 'auth');
      err(await T1.sync({ plays: 2, rp: 50 }), 401, 'auth');
      const me = ok(await T2.call('me'));
      eq([me.name, me.rp, me.c], ['ひきつぎ', 44, 'aomachi']);
      ok(await T2.sync({ plays: 2, rp: 74, c: 'aomachi' }));
    });
    await test('a code works only once', async () => {
      err(await dev().restore(code1), 404, 'nf');
    });
    await test('issuing a new code invalidates the previous one; input is normalized', async () => {
      const c1 = ok(await T2.issueCode()).code;
      const c2 = ok(await T2.issueCode()).code;
      assert(c1 !== c2);
      const k1 = 'rpf:tc:' + sha(c1.replace(/-/g, ''));
      eq(F('EXISTS', k1), 0, 'old code key deleted');
      // 2つ同時に出したときのように古いキーが残っていても、本人の最新のコードでなければ使えない
      F('SET', k1, T2.acct.uid, 'EX', '600');
      err(await dev().restore(c1), 404, 'nf');
      const T3 = dev();
      const r = ok(await T3.restore(' ' + c2.toLowerCase().replace(/-/g, ' ') + ' '));
      eq(r.uid, T2.acct.uid);
      err(await T2.call('me'), 401, 'auth');
      ok(await T3.call('me'));
      T2.acct = T3.acct;
    });
    await test('restore: malformed / wrong-type codes', async () => {
      const d = dev();
      err(await d.restore('ABC'), 400, 'bad');
      err(await d.restore('ABCD-EFGH-JKLM-NPQR'), 400, 'bad');
      err(await d.call('restore', { code: 123456789012 }, { anon: true }), 400, 'bad');
      err(await d.restore('ABCD-EFGH-JKLM'), 404, 'nf');
    });
    await test('codes expire after 30 days', async () => {
      const c = ok(await T2.issueCode()).code;
      fake.advance(31 * DAY);
      err(await dev().restore(c), 404, 'nf');
      ok(await T2.call('me'), 'account itself is fine');
    });
    await test('restore rate limit: 12 tries / 15 min per IP', async () => {
      const z = dev();
      for (let i = 0; i < 12; i++) err(await z.restore('AAAA-AAAA-AAAA'), 404, 'nf', 'try ' + (i + 1));
      const valid = ok(await T2.issueCode()).code;
      err(await z.restore(valid), 429, 'rl', 'even a valid code');
      err(await z.restore('AAAA'), 429, 'rl', 'malformed also counted');
      const t = F('KEYS', 'rpf:rl:rs:*').map((k) => F('TTL', k));
      assert(t.length >= 1 && t.every((x) => x > 0 && x <= 900), 'restore limit ttl ' + t);
      const w = dev();
      eq(ok(await w.restore(valid)).uid, T2.acct.uid, 'other IP still works');
      T2.acct = w.acct;
      fake.advance(16 * 60 * 1000);
      err(await z.restore('AAAA-AAAA-AAAA'), 404, 'nf', 'after 15 minutes');
    });

    // ---------------------------------------------------------------
    console.log('\n[report]');
    const repAt = (i) => JSON.parse(F('LINDEX', 'rpf:reports', String(i)));
    await test('report (anonymous): stored newest-first as {t, uid:null, ipHash, text, info}', async () => {
      const d = dev();
      const info = { ua: 'Mozilla/5.0 (iPhone)', w: 393, h: 852, dpr: 3, gl: 'Apple GPU', standalone: false, inApp: true, errors: ['TypeError: x is undefined'], ver: '1.0.0' };
      const t0 = Date.now();
      const r = ok(await d.call('report', { text: 'ボタンがおせない', info }));
      eq(Object.keys(r).sort(), ['ok', 'status']);
      const rec = repAt(0);
      eq(Object.keys(rec), ['t', 'uid', 'ipHash', 'text', 'info']);
      assert(rec.t >= t0 && rec.t <= Date.now(), 't = Date.now()');
      eq([rec.uid, rec.text, rec.info], [null, 'ボタンがおせない', JSON.stringify(info)]);
      eq(rec.ipHash, rpf.reportIpHash(d.ip));
      eq(rec.ipHash, sha(d.ip + ':rpf-report-v1').slice(0, 16), 'sha256(ip + salt), 16 hex');
      assert(!F('LINDEX', 'rpf:reports', '0').includes(d.ip), 'raw IP not stored');
      ok(await dev().call('report', { text: 'べつのIP' }));
      assert(repAt(0).ipHash !== rec.ipHash, 'different IP → different hash');
    });
    await test('report (signed in): uid recorded; bad token → anonymous', async () => {
      const d = dev();
      ok(await d.register('ほうこく'));
      ok(await d.call('report', { text: 'ログインちゅう', info: { v: 1 } }));
      eq(repAt(0).uid, d.acct.uid);
      eq(hget(d.acct.uid, 'rep'), '1');
      ok(await d.call('report', { text: 'へんなトークン' }, { auth: `Bearer ${d.acct.uid}.${'C'.repeat(43)}` }));
      eq([repAt(0).uid, repAt(0).text, repAt(0).info], [null, 'へんなトークン', null]);
    });
    await test('report: empty text OK, long text capped at 500, bad types → 400', async () => {
      const d = dev();
      ok(await d.call('report', {}));
      eq([repAt(0).text, repAt(0).info], ['', null]);
      ok(await d.call('report', { text: 'あ'.repeat(600) }));
      eq(repAt(0).text, 'あ'.repeat(500));
      ok(await d.call('report', { text: 'a'.repeat(499) + '😀' }));
      eq(repAt(0).text, 'a'.repeat(499), 'emoji not split');
      for (const bad of [{ text: 5 }, { text: ['x'] }, { info: 'str' }, { info: [1, 2] }, { info: 7 }, { info: true }]) err(await dev().call('report', bad), 400, 'bad', JSON.stringify(bad));
    });
    await test('report: oversized info is truncated to 4000 chars', async () => {
      const info = { ua: 'U'.repeat(3000), errors: Array.from({ length: 50 }, (_, i) => 'Error ' + i + ': ' + 'x'.repeat(80)), ver: '1.0.0' };
      const full = JSON.stringify(info);
      assert(full.length > 4000, 'test info is big');
      ok(await dev().call('report', { text: 'おおきい', info }));
      eq(repAt(0).info.length, 4000);
      eq(repAt(0).info, full.slice(0, 4000));
      eq(repAt(0).text, 'おおきい');
    });
    await test('report: 5 per hour per IP → 429 rl', async () => {
      const d = dev();
      for (let i = 0; i < 5; i++) ok(await d.call('report', { text: 'r' + i }));
      err(await d.call('report', { text: 'r5' }), 429, 'rl');
      eq(repAt(0).text, 'r4', 'rejected report not stored');
      ok(await dev().call('report', { text: 'other ip' }));
      fake.advance(61 * 60 * 1000);
      ok(await d.call('report', { text: 'next hour' }));
    });
    await test('report: only the newest 300 are kept (LTRIM)', async () => {
      F('DEL', 'rpf:reports');
      for (let i = 0; i < 299; i++) F('RPUSH', 'rpf:reports', JSON.stringify({ t: i, uid: null, ipHash: 'seed', text: 'seed' + i, info: null }));
      for (let i = 0; i < 3; i++) ok(await dev().call('report', { text: 'new' + i }));
      eq(F('LLEN', 'rpf:reports'), 300);
      eq([repAt(0).text, repAt(1).text, repAt(2).text], ['new2', 'new1', 'new0']);
      eq(JSON.parse(F('LINDEX', 'rpf:reports', '-1')).text, 'seed296');
    });
    await test('report without DB env → 503 setup', async () => {
      err(await new Dev(nodb.url).call('report', { text: 'x' }), 503, 'setup');
    });

    // ---------------------------------------------------------------
    console.log('\n[delete account]');
    const X = dev(), Y = dev();
    let xCode;
    await test('del setup: rankings (this + last week), friend, code, sync counter, report', async () => {
      ok(await X.register('けすひと', 'even'));
      ok(await Y.register('のこるひと'));
      ok(await X.sync({ plays: 1, rp: 50, wpt: 900, c: 'even' }));
      ok(await X.sync({ plays: 2, rp: 50, wk: PWK, wpt: 400, c: 'even' }));
      ok(await Y.sync({ plays: 1, rp: 30, wpt: 100 }));
      ok(await Y.call('fadd', { fc: X.acct.fc }));
      ok(await X.call('report', { text: 'けすまえの報告', info: { v: 1 } }));
      ok(await Y.call('report', { text: 'のこる報告' }));
      xCode = ok(await X.issueCode()).code;
      F('SET', 'kr:u:' + X.acct.uid, 'other-app');
      F('HSET', 'kr:pub', X.acct.uid, 'other-app');
      assert(refsTo(X.acct.uid).length >= 8, 'setup made references: ' + refsTo(X.acct.uid));
      eq(ok(await Y.rank('f')).list.length, 2);
    });
    await test('del removes every rpf: trace of the user', async () => {
      const fc = X.acct.fc;
      ok(await X.call('del'));
      eq(refsTo(X.acct.uid), [], 'remaining references');
      eq(F('EXISTS', 'rpf:fc:' + fc), 0, 'friend code');
      eq(F('EXISTS', 'rpf:tc:' + sha(xCode.replace(/-/g, ''))), 0, 'transfer code');
      eq(F('KEYS', 'rpf:*' + X.acct.uid + '*'), []);
      const reps = F('LRANGE', 'rpf:reports', '0', '-1').map((v) => JSON.parse(v));
      const xr = reps.filter((o) => o.text === 'けすまえの報告');
      eq(xr.map((o) => [o.uid, o.info]), [[null, '{"v":1}']], 'report kept, uid removed');
      eq(reps.filter((o) => o.text === 'のこる報告').map((o) => o.uid), [Y.acct.uid], 'other users untouched');
      eq(reps.length, 300, 'list length unchanged');
    });
    await test('after del: token rejected, code dead, friends/rankings updated', async () => {
      err(await X.call('me'), 401, 'auth');
      err(await X.call('del'), 401, 'auth');
      err(await dev().restore(xCode), 404, 'nf');
      eq(ok(await Y.rank('f')).list, []);
      assert(!ok(await Y.rank('a')).list.some((x) => x.n === 'けすひと'));
      assert(!ok(await Y.rank('w')).list.some((x) => x.n === 'けすひと'));
      assert(!ok(await Y.rank('w', PWK)).list.some((x) => x.n === 'けすひと'));
      err(await Y.call('fadd', { fc: X.acct.fc }), 404, 'nf');
    });
    await test('del does not touch other prefixes', async () => {
      eq(F('GET', 'kr:u:' + X.acct.uid), 'other-app');
      eq(F('HGET', 'kr:pub', X.acct.uid), 'other-app');
      eq(F('GET', 'kr:test'), 'keep');
    });

    // ---------------------------------------------------------------
    console.log('\n[rate limits]');
    await test('register: 30 per hour per IP → 429 rl', async () => {
      const ip = newIp();
      for (let i = 0; i < 30; i++) ok(await new Dev(B, ip).register('れんぞく' + i), 'register ' + (i + 1));
      err(await new Dev(B, ip).register('れんぞく31'), 429, 'rl');
      ok(await dev().register('べつのIP'), 'other IP not limited');
      const t = F('KEYS', 'rpf:rl:rh:*').map((k) => F('TTL', k));
      assert(t.every((x) => x > 0 && x <= 3600), 'ttl ' + t);
    });
    await test('register: 100 per day per IP (hourly windows reset)', async () => {
      const ip = newIp();
      let n = 0;
      for (const batch of [30, 30, 30, 10]) {
        for (let i = 0; i < batch; i++) ok(await new Dev(B, ip).register('まいにち' + n++), 'register #' + n);
        if (n < 100) {
          err(await new Dev(B, ip).register('まいにちX'), 429, 'rl', 'hourly limit after ' + n);
          fake.advance(61 * 60 * 1000);
        }
      }
      err(await new Dev(B, ip).register('101ばんめ'), 429, 'rl', 'daily limit');
      fake.advance(61 * 60 * 1000);
      err(await new Dev(B, ip).register('102ばんめ'), 429, 'rl', 'daily limit, next hour');
    });
    await test('validation errors do not use up the register limit', async () => {
      const ip = newIp();
      for (let i = 0; i < 10; i++) err(await new Dev(B, ip).register('fuck'), 400, 'ng');
      ok(await new Dev(B, ip).register('だいじょうぶ'));
    });
    await test('general limit: 120 requests per minute per IP → 429 rl', async () => {
      const d = dev();
      for (let i = 0; i < 120; i++) ok(await d.rank('a'), 'req ' + (i + 1));
      err(await d.rank('a'), 429, 'rl');
      err(await d.register('おそい'), 429, 'rl');
      ok(await dev().rank('a'), 'other IP fine');
      fake.advance(61 * 1000);
      ok(await d.rank('a'), 'next minute');
    });
    await test('x-forwarded-for: first entry is the client; IPv6 grouped by /64', async () => {
      const d1 = new Dev(B, '203.0.113.9, 10.0.0.1');
      const d2 = new Dev(B, '203.0.113.9');
      for (let i = 0; i < 60; i++) ok(await d1.rank('a'));
      for (let i = 0; i < 60; i++) ok(await d2.rank('a'));
      err(await d2.rank('a'), 429, 'rl', 'same client IP');
      const v6a = new Dev(B, '2001:db8:1:2::1'), v6b = new Dev(B, '2001:db8:1:2:ffff::99');
      for (let i = 0; i < 120; i++) ok(await (i % 2 ? v6a : v6b).rank('a'));
      err(await v6a.rank('a'), 429, 'rl', 'same /64');
      ok(await new Dev(B, '2001:db8:1:3::1').rank('a'), 'other /64');
    });

    // ---------------------------------------------------------------
    console.log('\n[client contract: src/net.js against the server]');
    resetRpf();
    await clientContract(B, F, refsTo);

    // ---------------------------------------------------------------
    console.log('\n[safety]');
    await test('server only used rpf: keys and never KEYS/SCAN/FLUSH*', async () => {
      const banned = ['KEYS', 'SCAN', 'FLUSHDB', 'FLUSHALL', 'RANDOMKEY', 'DBSIZE', 'EVAL', 'EVALSHA'];
      eq(fake.log.filter((x) => banned.includes(x.cmd)), [], 'banned commands');
      const outside = fake.log.filter((x) => x.keys.some((k) => !k.startsWith('rpf:')));
      eq(outside.slice(0, 5), [], 'keys outside rpf:');
      assert(fake.log.length > 500, 'log has ' + fake.log.length + ' commands');
      const used = [...new Set(fake.log.map((x) => x.cmd))].sort();
      console.log('        commands used: ' + used.join(' '));
    });
    await test('other apps’ keys are unchanged', async () => {
      const now = other().filter(([k]) => !k.startsWith('kr:u:') && k !== 'kr:pub');
      eq(now, otherBefore);
      assert(F('TTL', 'kr:ttl') > 0, 'kr:ttl still has its ttl');
    });
    await test('no token or transfer code in the server logs', async () => {
      const outAll = srv.output + nodb.output + deaddb.output + badtok.output;
      assert(issued.tokens.length > 50, 'tokens issued ' + issued.tokens.length);
      const leaked = issued.tokens.filter((t) => outAll.includes(t)).concat(issued.codes.filter((c) => outAll.includes(c) || outAll.includes(c.replace(/-/g, ''))));
      eq(leaked, []);
    });
  } finally {
    for (const p of children) p.kill();
    await fake.close();
  }
  console.log(`\napi tests: ${passed} passed, ${failed} failed`);
  if (failed) console.log('failed: ' + failures.join(' | '));
  process.exit(failed ? 1 : 0);
}

// 本物のクライアント（src/net.js）をそのまま動かして、サーバーと話が合うかたしかめる
async function clientContract(base, F, refsTo) {
  const realFetch = globalThis.fetch;
  let curIp = '10.250.0.1';
  // ブラウザのかわり：相対 URL を devserver に向けて、端末ごとの IP をつける
  globalThis.fetch = (u, o = {}) => realFetch(new URL(String(u), base), { ...o, headers: { ...(o.headers || {}), 'x-forwarded-for': curIp } });
  globalThis.location = new URL(base + '/');
  // ブラウザのかわり：この端末に保存できる（localStorage がある）ことにする。
  // ないと net.js は「保存できない端末（プライベートブラウズなど）」とみなして、自動でアカウントを作らない
  if (typeof globalThis.window === 'undefined') {
    const d = {};
    globalThis.window = { localStorage: { getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); }, removeItem: (k) => { delete d[k]; } }, addEventListener: () => {} };
  }
  const url = (f) => pathToFileURL(path.join(SRC, f)).href;
  const util = await import(url('util.js'));
  const saveMod = await import(url('save.js'));
  let devN = 0;
  // 端末を1台つくる（net.js を別のモジュールとして読みこむ）
  async function device(name) {
    util.store.del('rpf_acct_v1');
    const net = (await import(url('net.js') + '?device=' + ++devN)).net;
    const toasts = [];
    const S = saveMod.defaultSave();
    S.name = name;
    const app = { save: S, toast: (m) => toasts.push(m), confirm: async () => true, root: null };
    const ip = `10.250.${devN}.1`;
    const use = () => (curIp = ip);
    return { net, app, S, toasts, use };
  }
  const waitFor = async (fn, what) => {
    const end = Date.now() + 4000;
    while (Date.now() < end) {
      if (fn()) return;
      await sleep(15);
    }
    throw new Error('timeout waiting for ' + what);
  };
  // 試合の結果（勝ち・MVP・2KO・400点）
  const win = (S) => {
    const me = { team: 0, stats: { ko: 2, score: 400 } };
    return saveMod.applyResult(S, { win: 1, mvp: { 0: me, 1: null }, me, char: S.char });
  };
  let A, Bd, C;
  try {
    await test('client: ping → auto register when a name is set', async () => {
      A = await device('クライアントA');
      A.use();
      A.net.app = A.app;
      eq(await A.net.ping(), true);
      await waitFor(() => A.net.acct, 'register');
      assert(/^[0-9a-z]{10}$/.test(A.net.acct.uid) && FC_RE.test(A.net.acct.fc) && A.net.acct.token.length === 43, JSON.stringify(A.net.acct));
      issued.tokens.push(A.net.acct.token);
      eq(util.store.get('rpf_acct_v1').uid, A.net.acct.uid, 'saved to storage');
    });
    await test('client: a match result syncs (rp, week points, save)', async () => {
      const rw = win(A.S);
      eq([rw.gain, A.S.rp, A.S.week.pt, A.S.plays], [44, 44, 700, 1]);
      await A.net.sync(A.S, null);
      eq(F('ZSCORE', 'rpf:lb:a', A.net.acct.uid), '44');
      eq(F('ZSCORE', 'rpf:lb:w:' + WK, A.net.acct.uid), '700');
      eq(JSON.parse(F('HGET', 'rpf:u:' + A.net.acct.uid, 'save')).rp, 44);
    });
    await test('client: ranking tabs have the fields main.js renders', async () => {
      const w = await A.net.ranking('w');
      eq(w.list, [{ n: 'クライアントA', c: 'tora', s: 700, rank: 1, me: true }]);
      eq(w.me, { rank: 1, s: 700 });
      const a = await A.net.ranking('a');
      eq(a.list, [{ n: 'クライアントA', c: 'tora', s: 44, rank: 1, me: true }]);
      const f = await A.net.ranking('f');
      eq(f.list.length, 0, 'main.js shows "まだフレンドがいません" only for an empty list');
    });
    await test('client: addFriend toasts (ok / self / not found)', async () => {
      Bd = await device('クライアントB');
      Bd.use();
      Bd.net.app = Bd.app;
      await Bd.net.ping();
      await waitFor(() => Bd.net.acct, 'register B');
      issued.tokens.push(Bd.net.acct.token);
      await Bd.net.addFriend(A.net.acct.fc);
      await Bd.net.addFriend(Bd.net.acct.fc);
      await Bd.net.addFriend('ZZZZ2222');
      eq(Bd.toasts, ['クライアントA さんとフレンドになりました！', '自分のコードです', 'フレンドコードが見つかりません']);
      A.use();
      const f = await A.net.ranking('f');
      eq(f.list.map((x) => [x.n, !!x.me]), [['クライアントA', true], ['クライアントB', false]]);
    });
    await test('client: invite link (?f=CODE) adds the friend after auto register', async () => {
      const D = await device('しょうたいされた');
      globalThis.location = new URL(base + '/?f=' + A.net.acct.fc.toLowerCase().slice(0, 4) + '-' + A.net.acct.fc.slice(4));
      D.use();
      D.net.init(D.app);
      await waitFor(() => D.toasts.length, 'invite toast');
      eq(D.toasts, ['クライアントA さんとフレンドになりました！']);
      issued.tokens.push(D.net.acct.token);
      globalThis.location = new URL(base + '/');
      eq((await D.net.ranking('f')).list.length, 2);
      await D.net.deleteAccount();
    });
    await test('client: rename reaches the rankings; client NG list ⊆ server NG list', async () => {
      A.use();
      await A.net.rename('エース');
      eq((await A.net.ranking('a')).list[0].n, 'エース');
      for (const n of ['fuck', 'F U C K', 'Admin', '運営', 'しね', 'セックス']) {
        assert(A.net.badName(n), 'client rejects ' + n);
        let code = null;
        try {
          rpf.checkName(n);
        } catch (e) {
          code = e.code;
        }
        eq(code, 'ng', 'server rejects ' + n);
      }
      for (const n of ['トラ', 'Tetsu', 'まなぶ', '🐯ラン', 'Kei 2']) {
        assert(!A.net.badName(n), 'client accepts ' + n);
        eq(rpf.checkName(n), n, 'server accepts ' + n);
      }
    });
    await test('client: transfer code → restore on a new device → old device logged out', async () => {
      A.use();
      const code = await A.net.issueCode();
      assert(CODE_RE.test(code), code);
      issued.codes.push(code);
      C = await device('');
      C.use();
      C.net.app = C.app;
      await C.net.ping();
      eq(C.net.acct, null, 'no name → no auto register');
      const r = await C.net.restore(code.toLowerCase());
      eq([r.ok, r.uid, r.name, C.net.acct.uid], [true, A.net.acct.uid, 'エース', A.net.acct.uid]);
      issued.tokens.push(C.net.acct.token);
      eq(JSON.parse(r.save).rp, 44, 'save comes back');
      eq((await C.net.restore(code)).err, 'nf', 'second use');
      A.use();
      await A.net.me();
      eq(A.net.acct, null, 'old device logged out');
      eq(A.toasts.slice(-1), ['このデータはほかの端末に引き継がれました']);
      C.use();
      const merged = { ...C.S, ...JSON.parse(r.save) };
      win(merged);
      await C.net.sync(merged, null);
      eq(F('ZSCORE', 'rpf:lb:a', C.net.acct.uid), '88');
    });
    await test('client: deleteAccount', async () => {
      C.use();
      const uid = C.net.acct.uid;
      const r = await C.net.deleteAccount();
      eq([r.ok, C.net.acct], [true, null]);
      eq(refsTo(uid), []);
      Bd.use();
      eq((await Bd.net.ranking('f')).list, []);
    });
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.location;
  }
}

main().catch((e) => {
  console.error(e);
  for (const p of children) p.kill();
  process.exit(1);
});
