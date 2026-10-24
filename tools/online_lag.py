# 通信がおくれる・ゆれる・欠けるときのオンライン対戦（なめらかさと、当たり・復活）
# 使い方：node tools/api/devserver.js --port 8813 を動かしてから python3 tools/online_lag.py [ms] [jitter] [loss]
import asyncio, json, sys, statistics
from playwright.async_api import async_playwright

U = 'http://127.0.0.1:8813/'
MS = float(sys.argv[1]) if len(sys.argv) > 1 else 70
JIT = float(sys.argv[2]) if len(sys.argv) > 2 else 40
LOSS = float(sys.argv[3]) if len(sys.argv) > 3 else 0.05
results = []


def check(name, ok, info=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + ('  ' + str(info) if info != '' else ''), flush=True)


async def dev(b, name, char, extra=''):
    ctx = await b.new_context(viewport={'width': 393, 'height': 852}, is_mobile=True, has_touch=True)
    save = {'name': name, 'tutorial': True, 'seenRules': {'scramble': 1, 'flag': 1, 'ball': 1}, 'char': char, 'mode': 'scramble', 'diff': 'easy', 'stage': 'sakura'}
    lag = {'ms': MS, 'jitter': JIT, 'loss': LOSS}
    await ctx.add_init_script("localStorage.setItem('rpf_save_v1', JSON.stringify(%s)); window.__rpfLag = %s;" % (json.dumps(save, ensure_ascii=False), json.dumps(lag)))
    pg = await ctx.new_page()
    pg.errs = []
    pg.on('pageerror', lambda e: pg.errs.append(str(e)))
    await pg.goto(U + '?norender=1' + extra)
    await pg.wait_for_selector('#boot', state='detached', timeout=30000)
    await pg.wait_for_selector('.screen.title', timeout=30000)
    await pg.mouse.click(196, 600)
    return ctx, pg

SAMPLE = """(id) => new Promise((res) => {
  const m = window.__app.match; const p = m.punchers[id]; const out = [];
  const t0 = performance.now();
  const f = () => { out.push([p.pos.x, p.pos.y, p.pos.z, performance.now() - t0]); if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(out); };
  requestAnimationFrame(f);
})"""


def smooth(samples):
    steps = []
    for a, b in zip(samples, samples[1:]):
        dt = (b[3] - a[3]) / 1000
        if dt <= 0:
            continue
        d = ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 + (b[2] - a[2]) ** 2) ** 0.5
        steps.append(d / dt)
    if not steps:
        return None
    med = statistics.median(steps)
    stalls = sum(1 for s in steps if s < med * 0.2)
    spikes = sum(1 for s in steps if s > med * 3)
    return {'median_speed': round(med, 1), 'stalls': stalls, 'spikes': spikes, 'n': len(steps)}


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebRtcHideLocalIpsWithMdns'])
        ctxA, A = await dev(b, 'ホスト', 'tora')
        await A.wait_for_selector('.onlinebtn', timeout=15000)
        await A.click('.onlinebtn')
        await A.click('.make')
        await A.wait_for_selector('.room .code', timeout=15000)
        code = (await A.inner_text('.room .code')).strip()
        ctxB, B = await dev(b, 'ゲスト', 'even', '&room=' + code)
        await B.wait_for_selector('.room .code', timeout=60000)
        check('joined with lag %dms±%d loss %.0f%%' % (MS, JIT, LOSS * 100), True)
        await A.wait_for_timeout(1500)
        await A.click('.start')
        for pg in (A, B):
            await pg.wait_for_function("() => window.__app.match && window.__app.match.phase === 'play'", timeout=40000)
        hid = await A.evaluate("() => window.__app.match.player.netId")
        gid = await B.evaluate("() => window.__app.match.player.netId")
        # ホストがまっすぐ飛ぶ → ゲストの画面でなめらかか
        await A.evaluate("() => { const P = window.__app.match.player; P.pos.set(-30, 50, -40); P.vel.set(0,0,0); P.yaw = 0; P.pitch = 0; P.state='hover'; const I = window.__app.input; I._s = I.sample; I.sample = function(){ this._s(); this.hold = true; this.stickX = 0.15; this.stickY = 0; }; }")
        await B.wait_for_timeout(800)
        sm = await B.evaluate(SAMPLE, hid)
        r = smooth(sm)
        check('host replica moves smoothly on guest (few stalls/spikes)', r and r['median_speed'] > 5 and r['stalls'] <= r['n'] * 0.15 and r['spikes'] <= r['n'] * 0.05, r)
        await A.evaluate("() => { const I = window.__app.input; I.sample = I._s; }")
        # ゲストが飛ぶ → ホストの画面でなめらかか
        await B.evaluate("() => { const P = window.__app.match.player; P.pos.set(30, 50, 40); P.vel.set(0,0,0); P.yaw = Math.PI; P.pitch = 0; P.state='hover'; const I = window.__app.input; I._s = I.sample; I.sample = function(){ this._s(); this.hold = true; this.stickX = -0.15; this.stickY = 0; }; }")
        await A.wait_for_timeout(800)
        sm2 = await A.evaluate(SAMPLE, gid)
        r2 = smooth(sm2)
        check('guest moves smoothly on host', r2 and r2['median_speed'] > 5 and r2['stalls'] <= r2['n'] * 0.15 and r2['spikes'] <= r2['n'] * 0.05, r2)
        # 位置のずれ（ゲスト本人の位置と、ホストに見えている位置）
        g = await B.evaluate("() => { const P = window.__app.match.player; return [P.pos.x, P.pos.y, P.pos.z, P.vel.length()]; }")
        h = await A.evaluate("(gid) => { const p = window.__app.match.punchers[gid]; return [p.pos.x, p.pos.y, p.pos.z]; }", gid)
        err = ((g[0] - h[0]) ** 2 + (g[1] - h[1]) ** 2 + (g[2] - h[2]) ** 2) ** 0.5
        check('host copy close to guest (within lag x speed)', err < max(4, g[3] * (MS + JIT) / 1000 * 3), (round(err, 2), round(g[3], 1)))
        await B.evaluate("() => { const I = window.__app.input; I.sample = I._s; }")
        # ゲストのパンチがとどく
        hit = await B.evaluate("() => { const m = window.__app.match; const P = m.player; return m.punchers.find(p => p.team !== P.team && p.cpu && p.alive).netId; }")
        await A.evaluate("(id) => { const e = window.__app.match.punchers[id]; e.brain = null; e.vel.set(0,0,0); e.invuln = 0; window.__hp0 = e.hp; }", hit)
        for i in range(12):
            await A.evaluate("(id) => { const e = window.__app.match.punchers[id]; e.vel.set(0,0,0); e.intent.events.length = 0; e.intent.hold = false; e.intent.stickX = 0; }", hit)
            await B.evaluate("(id) => { const m = window.__app.match; const P = m.player; const e = m.punchers[id]; P.pos.copy(e.pos).add({x:0,y:0,z:-2.4}); P.vel.set(0,0,0); P.lock = e; P.stunT = 0; P.hurtT = 0; }", hit)
            await B.wait_for_timeout(250)
        hp = await A.evaluate("(id) => [window.__hp0, window.__app.match.punchers[id].hp]", hit)
        check('guest punches land under lag', hp[1] < hp[0], hp)
        # KO → 復活
        await A.evaluate("(gid) => { const m = window.__app.match; const v = m.punchers[gid]; v.invuln = 0; v.hp = 1; const k = m.punchers.find(p => p.team !== v.team); m.combat.damage(k, v, 500, {kind: 'normal'}); }", gid)
        await B.wait_for_function("() => !window.__app.match.player.alive", timeout=10000)
        await B.wait_for_function("() => window.__app.match.player.alive", timeout=30000)
        await A.wait_for_function("(gid) => { const p = window.__app.match.punchers[gid]; return p.alive && p.netIn && p.netIn.life === p.life; }", arg=gid, timeout=15000)
        check('KO and respawn work under lag', True)
        await A.evaluate("() => { window.__app.match.timeLeft = 0.2; }")
        for pg in (A, B):
            await pg.wait_for_selector('.screen.result', timeout=30000)
        check('result reached under lag', True)
        errs = A.errs + B.errs
        check('no page errors', not errs, errs[:5])
        print(f'online lag: {sum(results)}/{len(results)} passed')
        await b.close()

asyncio.run(main())
