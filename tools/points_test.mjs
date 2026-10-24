// CPUの強さで点が変わるか（node tools/points_test.mjs）
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
const { applyResult, defaultSave } = await import('../src/save.js');
const r = (win, diff, online = false) => ({ win, mvp: [null, null], me: { team: 0, stats: { ko: 0, score: 200 } }, char: 'tora', online, diff });
const out = {};
for (const d of ['zero', 'weak', 'easy', 'normal', 'hard', 'oni']) {
  const s = defaultSave();
  s.rp = 100;
  const w = applyResult(s, r(1, d));
  const s2 = defaultSave();
  s2.rp = 100;
  const l = applyResult(s2, r(-1, d));
  out[d] = { win: w.gain, lose: l.gain, week: w.weekPt };
}
const so = defaultSave();
so.rp = 100;
out.online = applyResult(so, r(1, 'zero', true)).gain;
// いちばん点が多い試合（鬼・MVP・5KO・高いスコア）でも、サーバーの上限（+60・+2500）をこえない
const big = { win: 1, mvp: [null, null], me: { team: 0, stats: { ko: 5, score: 4000 } }, char: 'tora', online: false, diff: 'oni' };
big.mvp[0] = big.me;
const sb = defaultSave();
const bres = applyResult(sb, big);
out.cap = { gain: bres.gain, week: bres.weekPt };
console.log(JSON.stringify(out));
const ok = out.zero.win < out.easy.win && out.easy.win < out.normal.win && out.normal.win < out.oni.win && out.zero.lose === 0 && out.weak.lose === 0 && out.normal.lose === -10 && out.online === 30 && out.zero.week < out.normal.week && out.cap.gain === 60 && out.cap.week === 2500;
console.log(ok ? 'points: PASS' : 'points: FAIL');
process.exit(ok ? 0 : 1);
