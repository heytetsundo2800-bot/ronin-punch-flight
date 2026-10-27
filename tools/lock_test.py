# v1.8：ロックオンの下方修正（本物のキックフライトに近づける）の点検
#   ①敵が視界の外に1秒ほど出たら外れる ②向く速さは前の半分ぐらい ③40mで外れる ④ダッシュ攻撃は横によけられる
# 使い方：public を 8812 で配信してから python3 tools/lock_test.py
import asyncio, json
from playwright.async_api import async_playwright

URL = 'http://localhost:8812/?norender=1'
results = []


def check(name, ok, info=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + ('  ' + str(info) if info != '' else ''), flush=True)


SAVE = "localStorage.setItem('rpf_noacct','true'); localStorage.setItem('rpf_sound', JSON.stringify({sfx:0,bgm:0})); localStorage.setItem('rpf_a2hs_shown','true'); localStorage.setItem('rpf_save_v1', JSON.stringify(%s));"
WAITPLAY = "async () => { const M = window.__app.match; await new Promise(r => { const f = () => (M.phase === 'play' ? r() : setTimeout(f, 80)); f(); }); return true; }"

# 試合を止めて、1/60秒ずつ自分で進める（毎回同じ結果になるように）
SETUP = """() => {
  const app = window.__app, M = app.match, P = M.player;
  app.paused = true;
  const E = M.punchers.find(q => q.team !== P.team);
  M.punchers.forEach((q, i) => { if (q !== P && q !== E) { q.brain = null; q.pos.set(-100 + i * 12, 90, 120); q.vel.set(0, 0, 0); q.state = 'hover'; } });
  E.brain = null;
  window.__T = {
    M, P, E,
    reset(ex, ey, ez) {
      P.pos.set(0, 50, 0); P.vel.set(0, 0, 0); P.yaw = 0; P.pitch = 0; P.state = 'hover'; P.dash = null; P.charge = null; P.stunT = 0; P.hurtT = 0; P.lock = null; P.updateAxes();
      P.intent.events.length = 0; P.boost = 3;
      E.pos.set(ex, ey, ez); E.vel.set(0, 0, 0); E.state = 'hover'; E.stunT = 0; E.hurtT = 0; E.invuln = 0; E.hp = E.maxHp; E.alive = true;
      M.update(1 / 60);
    },
    step(n, f) { for (let i = 0; i < n; i++) { if (f) f(i); M.update(1 / 60); } },
    vis() { const v = E.pos.clone().project(M.camera); return v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1; },
  };
  return [P.def.id, E.def.id, P.def.attack.kind];
}"""


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        save = {'name': 'テスト', 'tutorial': True, 'seenRules': {'scramble': 1, 'flag': 1, 'ball': 1}, 'char': 'tora', 'mode': 'scramble', 'diff': 'normal', 'diffV': 2, 'stage': 'sakura'}
        ctx = await b.new_context(viewport={'width': 393, 'height': 852}, is_mobile=True, has_touch=True)
        await ctx.add_init_script(SAVE % json.dumps(save, ensure_ascii=False))
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL)
        await pg.wait_for_selector('#boot', state='detached', timeout=30000)
        await pg.wait_for_selector('.screen.title', timeout=30000)
        await pg.wait_for_timeout(500)
        await pg.mouse.click(196, 600)
        await pg.wait_for_selector('.screen.home', timeout=15000)
        await pg.evaluate("() => window.__app.startMatch()")
        await pg.wait_for_function("() => window.__app.match && window.__app.match.phase === 'play'", timeout=60000)
        info = await pg.evaluate(SETUP)
        print('player/enemy', info)

        # ① 前にいる敵：ずっとロックしたまま
        r = await pg.evaluate("""() => { const T = window.__T; T.reset(0, 50, 15); T.P.setLock(T.E); T.step(120, () => { T.E.pos.set(0, 50, 15); T.E.vel.set(0,0,0); }); return [T.P.lock === T.E, T.vis()]; }""")
        check('lock stays while the enemy is in view', r[0] and r[1], r)
        # ① 横（視界の外）に居つづける敵：1秒ほどで外れる（すぐには外れない）
        r = await pg.evaluate("""() => { const T = window.__T, P = T.P, E = T.E; let n = 0;
          for (; n < 240 && P.lock; n++) T.step(1, () => { E.pos.set(P.pos.x + Math.cos(P.yaw) * 15, 50, P.pos.z - Math.sin(P.yaw) * 15); E.vel.set(0,0,0); });
          return n; }""")
        check('lock breaks after about 1 s out of view', 50 <= r <= 80, '%d frames (%.2f s)' % (r, r / 60))
        # ① ロックした直後、うしろの敵へふり向くあいだは外れない
        r = await pg.evaluate("""() => { const T = window.__T; T.reset(0, 50, -15); T.P.setLock(T.E); T.step(120, () => { T.E.pos.set(0, 50, -15); T.E.vel.set(0,0,0); }); return [T.P.lock === T.E, T.vis(), +T.P.yaw.toFixed(2)]; }""")
        check('locking an enemy behind: turns around without losing it', r[0] and r[1], r)
        # ② 向く速さ：真横の敵へ 0.25秒で 1ラジアンまで（前は 約1.3）
        r = await pg.evaluate("""() => { const T = window.__T; T.reset(15, 50, 0); const y0 = T.P.yaw; T.P.setLock(T.E); T.step(15, () => { T.E.pos.set(15, 50, 0); T.E.vel.set(0,0,0); }); return Math.abs(T.P.yaw - y0); }""")
        check('auto-facing is slower (0.25 s toward a side enemy)', 0.45 < r <= 1.02, '%.2f rad (before: about 1.30)' % r)
        # ③ 40mで外れる（30mならそのまま）
        r = await pg.evaluate("""() => { const T = window.__T; T.reset(0, 50, 30); T.P.setLock(T.E); T.step(30, () => { T.E.pos.set(0, 50, 30); T.E.vel.set(0,0,0); T.P.pos.set(0, 50, 0); T.P.vel.set(0,0,0); }); const a = T.P.lock === T.E;
          T.step(3, () => { T.E.pos.set(0, 50, 41); T.E.vel.set(0,0,0); T.P.pos.set(0, 50, 0); T.P.vel.set(0,0,0); }); return [a, T.P.lock === null]; }""")
        check('lock kept at 30 m, released past 40 m', r[0] and r[1], r)
        # 右の敵アイコン・敵タップのロックは 36m まで
        r = await pg.evaluate("""() => { const T = window.__T; T.reset(0, 50, 35); const a = T.M.lockCandidates(T.P).includes(T.E); T.reset(0, 50, 38); const b = T.M.lockCandidates(T.P).includes(T.E); return [a, b]; }""")
        check('enemy icons appear within 36 m', r[0] and not r[1], r)
        # ④ ダッシュ攻撃：止まっている敵（9m）には当たる
        hook = """const T = window.__T; if (!T.log) { T.log = []; const C = T.M.combat, o = C.damage.bind(C); C.damage = (a, t, d, op) => { if (t === T.E) T.log.push(op && op.kind); return o(a, t, d, op); }; } T.log.length = 0;"""
        r = await pg.evaluate("() => { " + hook + """ T.reset(0, 50, 9); T.P.lock = T.E; T.P.intent.events.push({ type: 'tap' }); let hit = false; T.step(50, () => { if (!T.log.includes('dash')) { T.E.pos.set(0, 50, 9); T.E.vel.set(0,0,0); } }); return [T.log.includes('dash'), T.E.hp < T.E.maxHp, T.P.boost]; }""")
        check('dash attack still hits a hovering enemy at 9 m', r[0] and r[1], r)
        # ④ ダッシュ攻撃：少しおくれて横にステップでよけた敵には当たらない（前は追いかけて必ず当たった）
        r = await pg.evaluate("() => { " + hook + """ T.reset(0, 50, 9); T.P.lock = T.E; T.P.intent.events.push({ type: 'tap' }); T.step(50, (i) => { const t = i / 60; const vx = t >= 0.15 && t < 0.41 ? 24 : 4; T.E.pos.x += vx / 60; T.E.vel.set(vx, 0, 0); }); return [T.log.includes('dash'), T.log.slice(0, 4)]; }""")
        check('a sidestep can dodge the dash attack', not r[0], r)
        # ④ 12mより遠いと、ロック中のタップはふつうのブースト（ダッシュ攻撃にならない）
        r = await pg.evaluate("""() => { const T = window.__T; T.reset(0, 50, 14); T.P.lock = T.E; T.P.intent.events.push({ type: 'tap' }); T.step(2); return [T.P.state, !!(T.P.dash && T.P.dash.attack), T.P.boost]; }""")
        check('tap at 14 m is a normal boost (not a dash attack)', r[0] == 'dash' and not r[1], r)
        # ロックが外れたときの音（自分だけ）
        r = await pg.evaluate("""() => { const T = window.__T, P = T.P, E = T.E; const got = []; const o = T.M.sfx.bind(T.M); T.M.sfx = (n, s, ...a) => { got.push(n); return o(n, s, ...a); };
          T.reset(0, 50, 15); P.setLock(E); T.step(30, () => { E.pos.set(0, 50, 15); });
          for (let n = 0; n < 200 && P.lock; n++) T.step(1, () => { E.pos.set(P.pos.x + Math.cos(P.yaw) * 15, 50, P.pos.z - Math.sin(P.yaw) * 15); });
          T.M.sfx = o; return got.includes('unlock'); }""")
        check('unlock sound when the lock is lost', r)
        await pg.evaluate("() => { window.__app.paused = false; }")
        check('no page errors', not errs, errs[:3])
        print(f'lock test: {sum(results)}/{len(results)} passed')
        await b.close()

asyncio.run(main())
