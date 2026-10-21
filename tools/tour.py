# 見た目の確認：いろいろな場面のスクショを撮る
import sys, asyncio, json
from playwright.async_api import async_playwright
OUT = '/tmp/claude-0/-home-claude/cb87e6ba-4022-5281-bc59-7be863cc9efb/scratchpad/shots/tour'
import os; os.makedirs(OUT, exist_ok=True)
W, H = int(os.environ.get('W', 393)), int(os.environ.get('H', 852))
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width': W, 'height': H}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg = await ctx.new_page()
        logs = []
        pg.on('pageerror', lambda e: logs.append('PAGEERROR: ' + str(e)))
        pg.on('console', lambda m: logs.append(m.type + ': ' + m.text) if m.type == 'error' else None)
        mode = sys.argv[1] if len(sys.argv) > 1 else 'scramble'
        await pg.add_init_script("localStorage.setItem('rpf_save_v1', JSON.stringify({name:'テツンド', tutorial:true, char:'%s', mode:'%s', diff:'normal', stage:'sakura'}))" % (sys.argv[2] if len(sys.argv) > 2 else 'tora', mode))
        await pg.goto('http://localhost:8812/')
        await pg.wait_for_timeout(2000)
        await pg.screenshot(path=f'{OUT}/a_title.png')
        await pg.mouse.click(196, 600)
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path=f'{OUT}/b_home.png')
        await pg.click('.tabs button[data-t=char]')
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path=f'{OUT}/c_chars.png')
        await pg.click('.back')
        await pg.wait_for_timeout(500)
        await pg.click('.tabs button[data-t=om]')
        await pg.wait_for_timeout(800)
        await pg.screenshot(path=f'{OUT}/d_omamori.png')
        await pg.click('.back')
        await pg.wait_for_timeout(500)
        await pg.click('.battlebtn', force=True)
        await pg.wait_for_timeout(1200)
        await pg.screenshot(path=f'{OUT}/e_intro.png')
        await pg.wait_for_function('window.__app.match && window.__app.match.phase === "play"', timeout=30000)
        await pg.wait_for_timeout(300)
        await pg.screenshot(path=f'{OUT}/f_start.png')
        # ダッシュ中
        await pg.evaluate('''() => { const p = window.__app.match.player; p.intent.events.push({type:'tap'}); }''')
        await pg.wait_for_timeout(700)
        await pg.screenshot(path=f'{OUT}/g_dash.png')
        # 戦い：敵を目の前に置いてロックオン
        await pg.evaluate('''() => { const m = window.__app.match, p = m.player; const e = m.punchers.find(q => q.team !== p.team); p.pos.set(10, 40, -20); p.vel.set(0,0,0); p.state='hover'; p.yaw = 0.3; p.pitch = 0; e.pos.set(11.2, 40.4, -17.5); e.vel.set(0,0,0); e.state='hover'; p.lock = e; window.__e = e; }''')
        await pg.wait_for_timeout(1200)
        await pg.screenshot(path=f'{OUT}/h_fight.png')
        # スペシャルのカットイン
        await pg.evaluate('''() => { const p = window.__app.match.player; p.sp = 1; p.stunT = 0; p.hurtT = 0; p.intent.events.push({type:'special'}); }''')
        await pg.wait_for_timeout(450)
        await pg.screenshot(path=f'{OUT}/i_cutin.png')
        await pg.wait_for_timeout(1400)
        await pg.screenshot(path=f'{OUT}/j_after_sp.png')
        # 高いところから見下ろす
        await pg.evaluate('''() => { const p = window.__app.match.player; p.pos.set(0, 70, -70); p.yaw = 0; p.pitch = -0.5; p.vel.set(0,0,0); p.state='hover'; p.lock = null; }''')
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path=f'{OUT}/k_view.png')
        # 倒される
        await pg.evaluate('''() => { const m = window.__app.match, p = m.player; m.ko(p, window.__e); }''')
        await pg.wait_for_timeout(900)
        await pg.screenshot(path=f'{OUT}/l_dead.png')
        await pg.wait_for_timeout(5000)
        # 時間を進めて結果へ
        await pg.evaluate('() => { const m = window.__app.match; m.timeLeft = 1.5; }')
        await pg.wait_for_timeout(6000)
        await pg.screenshot(path=f'{OUT}/m_result.png')
        for l in logs[:20]: print(l)
        await b.close()
asyncio.run(main())
