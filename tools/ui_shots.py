# 画面の写真をまとめて撮る（見た目の確認用）
# 使い方：node tools/api/devserver.js --port 8813 を動かしてから python3 tools/ui_shots.py [出力フォルダ] [画面...]
import asyncio, json, sys, os
from playwright.async_api import async_playwright

U = 'http://127.0.0.1:8813/'
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/claude-0/-home-claude/cb87e6ba-4022-5281-bc59-7be863cc9efb/scratchpad/ui'
WANT = set(sys.argv[2:]) or {'title', 'home', 'chars', 'om', 'rank', 'set', 'hud', 'result', 'online', 'howto'}
os.makedirs(OUT, exist_ok=True)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        ctx = await b.new_context(viewport={'width': 402, 'height': 874}, device_scale_factor=1, is_mobile=True, has_touch=True)
        await ctx.add_init_script("localStorage.setItem('rpf_noacct', '1'); localStorage.setItem('rpf_save_v1', JSON.stringify({name:'てつんど', tutorial:true, char:'aomachi', mode:'scramble', diff:'normal', stage:'campus', rp: 140}));")
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(U)
        await pg.wait_for_selector('#boot', state='detached', timeout=30000)
        await pg.wait_for_selector('.screen.title', timeout=30000)
        await pg.wait_for_timeout(1200)
        if 'title' in WANT:
            await pg.screenshot(path=f'{OUT}/title.png')
        await pg.mouse.click(201, 640)
        await pg.wait_for_selector('.screen.home', timeout=15000)
        await pg.wait_for_timeout(900)
        if 'home' in WANT:
            await pg.screenshot(path=f'{OUT}/home.png')
        for tab, name in [('char', 'chars'), ('om', 'om'), ('rank', 'rank'), ('set', 'set')]:
            if name not in WANT:
                continue
            await pg.click(f'.tabs button[data-t="{tab}"]')
            await pg.wait_for_timeout(900)
            await pg.screenshot(path=f'{OUT}/{name}.png')
            await pg.click('.back')
            await pg.wait_for_selector('.screen.home', timeout=15000)
            await pg.wait_for_timeout(400)
        if 'howto' in WANT:
            await pg.click('.iconbtn.help')
            await pg.wait_for_timeout(700)
            await pg.screenshot(path=f'{OUT}/howto.png')
            await pg.evaluate("() => document.querySelectorAll('.modal').forEach(m => m.remove())")
        if 'online' in WANT:
            await pg.click('.onlinebtn')
            await pg.wait_for_timeout(900)
            await pg.screenshot(path=f'{OUT}/online.png')
            await pg.click('.back')
            await pg.wait_for_selector('.screen.home', timeout=15000)
        if 'hud' in WANT or 'result' in WANT:
            await pg.click('.battlebtn', force=True)
            await pg.wait_for_function('window.__app.match && window.__app.match.phase === "play"', timeout=40000)
            await pg.wait_for_timeout(1500)
            await pg.screenshot(path=f'{OUT}/hud.png')
            # 試合の中ほど：ロックオン・ダメージ・スキル
            await pg.evaluate("""() => { const m = window.__app.match, P = m.player; const e = m.punchers.find(q => q.team !== P.team); P.pos.set(0, 40, -40); e.pos.set(1.5, 40.5, -33); e.vel.set(0,0,0); e.brain = null; P.lock = e; P.sp = 1; P.omCd[1] = 6; window.__app.input.enabled = false; }""")
            await pg.wait_for_timeout(1500)
            await pg.screenshot(path=f'{OUT}/hud2.png')
            if 'result' in WANT:
                await pg.evaluate("() => { window.__app.match.timeLeft = 0.1; }")
                await pg.wait_for_selector('.screen.result', timeout=30000)
                await pg.wait_for_timeout(2500)
                await pg.screenshot(path=f'{OUT}/result.png')
        print('errors', errs[:5])
        await b.close()

asyncio.run(main())
