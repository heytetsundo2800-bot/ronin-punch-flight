// 部屋（オンライン対戦の手紙の受けわたし）の API テスト
//   node tools/api/room_test.js
'use strict';
const { createFakeUpstash } = require('./fake_upstash.js');

let pass = 0, failN = 0;
const ok = (name, c, info) => {
  if (c) pass++;
  else failN++;
  console.log((c ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
};

async function main() {
  const f = await createFakeUpstash({ port: 0 });
  process.env.KV_REST_API_URL = f.url;
  process.env.KV_REST_API_TOKEN = f.token;
  delete process.env.RPF_ICE;
  const handler = require('../../api/rpf.js');
  const call = (body, ip = '1.2.3.4') =>
    new Promise((resolve) => {
      const req = { method: 'POST', headers: { 'x-forwarded-for': ip, 'content-type': 'application/json' }, body, url: '/api/rpf' };
      const res = {
        statusCode: 0,
        headers: {},
        setHeader(k, v) {
          this.headers[k] = v;
        },
        end(b) {
          resolve({ status: this.statusCode, j: b ? JSON.parse(b) : null });
        },
      };
      handler(req, res);
    });
  const mk = await call({ a: 'rmk', n: 'ホスト' });
  ok('make room', mk.status === 200 && /^\d{5}$/.test(mk.j.code) && /^[0-9a-z]{8}$/.test(mk.j.pid) && mk.j.hk && Array.isArray(mk.j.ice), mk.j && mk.j.code);
  const code = mk.j.code, host = mk.j.pid, hk = mk.j.hk;
  const raw = await f.call('GET', 'rpf:rm:' + code);
  ok('room stored with hashed key only', raw && !raw.includes(hk) && JSON.parse(raw).h === host);
  const ttl = await f.call('TTL', 'rpf:rm:' + code);
  ok('room has ttl', ttl > 3 * 3600 - 10 && ttl <= 3 * 3600, ttl);
  const jn = await call({ a: 'rmj', code });
  ok('join room', jn.status === 200 && jn.j.host === host && jn.j.n === 'ホスト' && /^[0-9a-z]{8}$/.test(jn.j.pid));
  const me = jn.j.pid;
  const nf = await call({ a: 'rmj', code: code === '99999' ? '99998' : '99999' });
  ok('join missing room -> 404', nf.status === 404 && nf.j.err === 'nf', nf.status);
  const bad = await call({ a: 'rmj', code: '12ab' });
  ok('bad code -> 400', bad.status === 400);
  const s1 = await call({ a: 'rms', code, to: host, from: me, d: JSON.stringify({ t: 'offer', sdp: 'v=0...' }) });
  ok('send to host', s1.status === 200 && s1.j.ok);
  const p1 = await call({ a: 'rmp', code, me: host });
  ok('host receives', p1.status === 200 && p1.j.m.length === 1 && p1.j.m[0].f === me && JSON.parse(p1.j.m[0].d).t === 'offer' && p1.j.gone === false, p1.j);
  const p2 = await call({ a: 'rmp', code, me: host });
  ok('queue emptied after read', p2.j.m.length === 0);
  const big = await call({ a: 'rms', code, to: host, from: me, d: 'x'.repeat(17000) });
  ok('too big letter -> 400', big.status === 400);
  for (let i = 0; i < 30; i++) await call({ a: 'rms', code, to: me, from: host, d: 'n' + i });
  const p3 = await call({ a: 'rmp', code, me });
  ok('queue keeps newest 24', p3.j.m.length === 24 && p3.j.m[23].d === 'n29', p3.j.m.length);
  const qt = await f.call('TTL', 'rpf:rq:' + code + ':' + me);
  ok('queue deleted after read', qt === -2, qt);
  // 受付を止める
  const lk0 = await call({ a: 'rmx', code, hk: 'x'.repeat(43), op: 'lock' });
  ok('lock with wrong key -> 403', lk0.status === 403);
  const lk = await call({ a: 'rmx', code, hk, op: 'lock' });
  ok('lock', lk.status === 200);
  const jn2 = await call({ a: 'rmj', code });
  ok('join locked room -> 409', jn2.status === 409 && jn2.j.err === 'closed');
  const ttl2 = await f.call('TTL', 'rpf:rm:' + code);
  ok('lock keeps ttl', ttl2 > 3 * 3600 - 20, ttl2);
  const op = await call({ a: 'rmx', code, hk, op: 'open' });
  const jn3 = await call({ a: 'rmj', code });
  ok('reopen', op.status === 200 && jn3.status === 200);
  const cl = await call({ a: 'rmx', code, hk, op: 'close' });
  const p4 = await call({ a: 'rmp', code, me });
  ok('close -> poll says gone', cl.status === 200 && p4.j.gone === true, p4.j);
  const s2 = await call({ a: 'rms', code, to: host, from: me, d: 'late' });
  ok('send to closed room -> 404', s2.status === 404);
  // 回数制限：同じIPからの手紙は1分400回まで（ふつうの120回とは別）
  const mk2 = await call({ a: 'rmk', n: 'B' }, '5.6.7.8');
  let last = null;
  for (let i = 0; i < 130; i++) last = await call({ a: 'rmp', code: mk2.j.code, me: mk2.j.pid }, '5.6.7.8');
  ok('130 polls from one IP are fine', last.status === 200, last.status);
  const other = await call({ a: 'rank', t: 'a' }, '5.6.7.8');
  ok('general IP limit not used by polls', other.status !== 429, other.status);
  // ICE の設定
  process.env.RPF_ICE = JSON.stringify([{ urls: 'turn:turn.example.com:3478', username: 'u', credential: 'p' }]);
  delete require.cache[require.resolve('../../api/rpf.js')];
  const h2 = require('../../api/rpf.js');
  const r = await new Promise((resolve) => {
    const req = { method: 'POST', headers: { 'x-forwarded-for': '9.9.9.9' }, body: { a: 'rmk', n: 'C' }, url: '/api/rpf' };
    const res = { statusCode: 0, setHeader() {}, end(b) { resolve({ status: this.statusCode, j: JSON.parse(b) }); } };
    h2(req, res);
  });
  ok('RPF_ICE adds TURN servers first', r.j.ice && r.j.ice[0].urls === 'turn:turn.example.com:3478' && r.j.ice.length >= 2, r.j.ice && r.j.ice.length);
  console.log(`room api: ${pass}/${pass + failN} passed`);
  await f.close();
  process.exit(failN ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
