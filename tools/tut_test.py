# チュートリアルを最後まで進められるか（操作を直接送ってためす）
import asyncio, json
from playwright.async_api import async_playwright
OUT = '/tmp/claude-0/-home-claude/cb87e6ba-4022-5281-bc59-7be863cc9efb/scratchpad/shots'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        ctx = await b.new_context(viewport={'width': 393, 'height': 852}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.add_init_script("localStorage.setItem('rpf_save_v1', JSON.stringify({name:'テスト', tutorial:false, char:'even', mode:'scramble', diff:'easy'}))")
        await pg.goto('http://localhost:8812/?norender=1')
        await pg.wait_for_timeout(1500)
        await pg.mouse.click(196, 600)
        await pg.wait_for_timeout(800)
        # 設定 → チュートリアル
        await pg.click('.tabs button[data-t=set]')
        await pg.wait_for_timeout(500)
        await pg.click('.tutbtn')
        await pg.wait_for_function('window.__app.match && window.__app.match.phase === "play"', timeout=30000)
        await pg.wait_for_timeout(500)
        await pg.screenshot(path=f'{OUT}/tut_01.png')
        async def step():
            return await pg.evaluate('() => { const m = window.__app.match; return m ? {step: m.step, count: m.count, done: !!m.done, msg: m.box.innerText.replace(/\\n/g," ")} : null; }')
        async def ev(e):
            await pg.evaluate('(e) => window.__app.match.player.intent.events.push(e)', e)
        async def put(x, y, z):
            await pg.evaluate('([x,y,z]) => { const p = window.__app.match.player; p.pos.set(x,y,z); p.vel.set(0,0,0); p.state="hover"; p.boost=6; p.stunT=0; p.hurtT=0; }', [x, y, z])
        log = []
        # 1 dash x3
        for i in range(3):
            await put(0, 50, -40); await pg.wait_for_timeout(100)
            await ev({'type': 'tap'}); await pg.wait_for_timeout(500)
        log.append(await step())
        await pg.wait_for_timeout(900)
        # 2 fly 60m (hold)
        await put(0, 50, -60)
        await pg.evaluate('() => { const I = window.__app.input; I._s = I.sample; I.sample = function(){ this._s(); this.hold = true; }; }')
        await pg.wait_for_timeout(5000)
        await pg.evaluate('() => { const I = window.__app.input; I.sample = I._s; }')
        log.append(await step())
        await pg.wait_for_timeout(900)
        # 3 look 180 deg (stick without hold)
        await put(0, 50, -40)
        await pg.evaluate('() => { const I = window.__app.input; I._s = I.sample; I.sample = function(){ this._s(); this.hold = false; this.stickX = 1; }; }')
        await pg.wait_for_timeout(2200)
        await pg.evaluate('() => { const I = window.__app.input; I.sample = I._s; }')
        log.append(await step())
        await pg.wait_for_timeout(900)
        # 4 brake x2 (dash then down flick)
        for i in range(2):
            await put(0, 50, -40); await ev({'type': 'tap'}); await pg.wait_for_timeout(400)
            await ev({'type': 'flick', 'dir': {'x': 0, 'y': 1}}); await pg.wait_for_timeout(500)
        log.append(await step())
        await pg.wait_for_timeout(900)
        # 5 step x2
        for i in range(2):
            await put(0, 50, -40); await pg.wait_for_timeout(100)
            await ev({'type': 'flick', 'dir': {'x': 1, 'y': 0}}); await pg.wait_for_timeout(500)
        log.append(await step())
        await pg.wait_for_timeout(900)
        # 6 uturn
        await put(0, 50, -40); await ev({'type': 'uturn'}); await pg.wait_for_timeout(600)
        log.append(await step())
        await pg.wait_for_timeout(900)
        await pg.screenshot(path=f'{OUT}/tut_02.png')
        # 7 collect 6 : teleport to sakura
        for i in range(8):
            await pg.evaluate('(i) => { const m = window.__app.match, p = m.player; const it = m.mode.field.items.filter(x => x.state === "field")[0]; if (it) { p.pos.copy(it.pos); p.vel.set(0,0,0); } }', i)
            await pg.wait_for_timeout(300)
        log.append(await step())
        print('after collect:', log[-1])
        await pg.wait_for_timeout(900)
        # 8 deposit 4
        await pg.evaluate('() => { const m = window.__app.match, p = m.player; const g = m.guardians[p.team]; p.pos.copy(g.pos).add({x:0,y:0,z:7}); p.vel.set(0,0,0); }')
        await pg.wait_for_timeout(600)
        await pg.screenshot(path=f'{OUT}/tut_03.png')
        dep = await pg.query_selector('.depbtn:not(.hidden)')
        if dep:
            bb = await dep.bounding_box()
            cdp = await ctx.new_cdp_session(pg)
            await cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': bb['x'] + 30, 'y': bb['y'] + 30, 'id': 0}]})
            await pg.wait_for_timeout(1200)
            await cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        log.append(await step())
        print('after deposit:', log[-1])
        await pg.wait_for_timeout(1500)
        # 9 attack 4 hits
        await pg.screenshot(path=f'{OUT}/tut_04.png')
        await pg.evaluate('() => { const m = window.__app.match, p = m.player, e = m.enemy; p.pos.copy(e.pos).add({x:0,y:0,z:-2.5}); p.vel.set(0,0,0); p.yaw = 0; p.lock = e; }')
        await pg.wait_for_timeout(2500)
        log.append(await step())
        await pg.wait_for_timeout(900)
        # 10 omamori, 11 ks, 12 sp
        await ev({'type': 'skill', 'slot': 0}); await pg.wait_for_timeout(1800)
        log.append(await step())
        await pg.wait_for_timeout(900)
        await ev({'type': 'skill', 'slot': 2}); await pg.wait_for_timeout(1200)
        log.append(await step())
        await pg.wait_for_timeout(900)
        await pg.screenshot(path=f'{OUT}/tut_05.png')
        await ev({'type': 'special'}); await pg.wait_for_timeout(1500)
        log.append(await step())
        await pg.wait_for_timeout(2500)
        await pg.screenshot(path=f'{OUT}/tut_06.png')
        for l in log: print(json.dumps(l, ensure_ascii=False))
        modal = await pg.query_selector('.modal')
        print('completion modal:', bool(modal))
        print('errors:', errs[:5])
        await b.close()
asyncio.run(main())
