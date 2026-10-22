import sys, asyncio, json, time
from playwright.async_api import async_playwright
OUT = '/tmp/claude-0/-home-claude/cb87e6ba-4022-5281-bc59-7be863cc9efb/scratchpad/shots'
import os; os.makedirs(OUT, exist_ok=True)
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8812/'
SCEN = sys.argv[2] if len(sys.argv) > 2 else 'battle'

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
        ctx = await b.new_context(viewport={'width': 393, 'height': 852}, device_scale_factor=2, is_mobile=True, has_touch=True, user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')
        pg = await ctx.new_page()
        logs = []
        pg.on('console', lambda m: logs.append(m.type + ': ' + m.text) if m.type in ('error','warning') else None)
        pg.on('pageerror', lambda e: logs.append('PAGEERROR: ' + str(e)))
        await pg.goto(URL)
        await pg.wait_for_timeout(2500)
        await pg.screenshot(path=f'{OUT}/01_title.png')
        await pg.mouse.click(196, 600)
        await pg.wait_for_timeout(800)
        await pg.screenshot(path=f'{OUT}/02_name.png')
        inp = await pg.query_selector('input')
        if inp:
            await inp.fill('テツンド')
            await pg.click('.ok')
            await pg.wait_for_timeout(600)
            no = await pg.query_selector('.modal .no')
            if no:
                await pg.screenshot(path=f'{OUT}/03_tutask.png')
                if SCEN == 'tutorial':
                    await pg.click('.modal .ok')
                else:
                    await no.click()
        await pg.wait_for_timeout(1200)
        await pg.screenshot(path=f'{OUT}/04_home.png')
        if SCEN == 'battle':
            await pg.click('.battlebtn', force=True)
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path=f'{OUT}/05_intro.png')
        await pg.wait_for_timeout(3500)
        await pg.screenshot(path=f'{OUT}/06_go.png')
        # 長押しで飛ぶ（タッチをシミュレート）
        cdp = await ctx.new_cdp_session(pg)
        async def touch(t, pts):
            await cdp.send('Input.dispatchTouchEvent', {'type': t, 'touchPoints': [{'x': x, 'y': y, 'id': i} for i, (x, y) in enumerate(pts)]})
        # 両手の操作：左の親指で長押し（画面の左半分）
        await touch('touchStart', [(110, 520)])
        for i in range(30):
            await pg.wait_for_timeout(60)
            await touch('touchMove', [(110 + min(i, 15) * 2, 520)])
        await pg.screenshot(path=f'{OUT}/07_fly.png')
        await touch('touchEnd', [])
        # タップでブースト
        await touch('touchStart', [(200, 520)])
        await pg.wait_for_timeout(50)
        await touch('touchEnd', [])
        await pg.wait_for_timeout(250)
        await pg.screenshot(path=f'{OUT}/08_dash.png')
        await pg.wait_for_timeout(2500)
        await pg.screenshot(path=f'{OUT}/09_later.png')
        st = await pg.evaluate('''() => { const m = window.__app && window.__app.match; if (!m) return null; const p = m.player; return {phase: m.phase, t: m.time, left: m.timeLeft, state: p.state, pos: [p.pos.x, p.pos.y, p.pos.z].map(v=>+v.toFixed(1)), hp: p.hp, boost: +p.boost.toFixed(2), score: [m.mode.score(0), m.mode.score(1)], alive: m.punchers.map(q=>q.alive).join(','), cpu: m.punchers.map(q=>q.state+':'+(q.brain&&q.brain.goal?q.brain.goal.kind:'-')).join(' ')}; }''')
        print('STATE', json.dumps(st, ensure_ascii=False))
        # しばらく放置して CPU 同士の戦いを見る
        for k in range(4):
            await pg.wait_for_timeout(4000)
            await pg.screenshot(path=f'{OUT}/1{k}_auto.png')
        st = await pg.evaluate('''() => { const m = window.__app && window.__app.match; if (!m) return null; const p = m.player; return {phase: m.phase, t: +m.time.toFixed(1), score: [m.mode.score(0), m.mode.score(1)], kos: m.punchers.map(q=>q.stats.ko).join(','), picks: m.punchers.map(q=>q.stats.pick).join(','), cpu: m.punchers.map(q=>q.state+':'+(q.brain&&q.brain.goal?q.brain.goal.kind:'-')).join(' ')}; }''')
        print('STATE2', json.dumps(st, ensure_ascii=False))
        fps = await pg.evaluate('''() => new Promise(r => { let n=0; const t0=performance.now(); function f(){ n++; if (performance.now()-t0 < 2000) requestAnimationFrame(f); else r(n/2); } requestAnimationFrame(f); })''')
        print('FPS(swiftshader)', fps)
        for l in logs[:40]: print(l)
        await b.close()
asyncio.run(main())
