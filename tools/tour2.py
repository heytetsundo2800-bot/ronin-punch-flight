import sys, asyncio, json, os
from playwright.async_api import async_playwright
OUT = '/tmp/claude-0/-home-claude/cb87e6ba-4022-5281-bc59-7be863cc9efb/scratchpad/shots/tour2'
os.makedirs(OUT, exist_ok=True)
async def shot_mode(b, mode, char):
    ctx = await b.new_context(viewport={'width': 393, 'height': 852}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = await ctx.new_page()
    pg.on('pageerror', lambda e: print('PAGEERROR', e))
    await pg.add_init_script("localStorage.setItem('rpf_save_v1', JSON.stringify({name:'テツンド', tutorial:true, char:'%s', mode:'%s', diff:'normal', stage:'sakura'}))" % (char, mode))
    await pg.goto('http://localhost:8812/')
    await pg.wait_for_timeout(1500)
    await pg.mouse.click(196, 600)
    await pg.wait_for_timeout(800)
    await pg.click('.battlebtn', force=True)
    await pg.wait_for_function('window.__app.match && window.__app.match.phase === "play"', timeout=60000)
    if mode == 'flag':
        await pg.evaluate('''() => { const m = window.__app.match, p = m.player; const f = m.mode.flags[p.team]; p.pos.copy(f.pos).add({x:0,y:3,z:-8}); p.yaw = 0; p.pitch = -0.15; p.vel.set(0,0,0); p.state='hover'; }''')
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path=f'{OUT}/{mode}_1.png')
        await pg.evaluate('''() => { const m = window.__app.match, p = m.player; const f = m.mode.flags[p.team]; p.pos.copy(f.pos); }''')
        await pg.wait_for_timeout(1200)
        await pg.evaluate('''() => { const m = window.__app.match, p = m.player; p.yaw = Math.PI; p.intent.events.push({type:'tap'}); }''')
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path=f'{OUT}/{mode}_2.png')
    elif mode == 'ball':
        await pg.evaluate('''() => { const m = window.__app.match, p = m.player; const g = m.guardians[1 - p.team]; p.pos.copy(g.pos).add({x:0,y:4,z:-22}); p.yaw = 0; p.pitch = 0.1; p.vel.set(0,0,0); p.state='hover'; }''')
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path=f'{OUT}/{mode}_1.png')
        await pg.evaluate('''() => { const m = window.__app.match; m.mode.gstate[1 - m.player.team].hp = 1; m.mode.guardianHit(m.guardians[1 - m.player.team], m.player, 5); m.timeLeft = 59; }''')
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path=f'{OUT}/{mode}_2.png')
    else:
        await pg.evaluate('''() => { const m = window.__app.match, p = m.player; p.pos.set(0, 30, -60); p.yaw = 0; p.pitch = 0; p.vel.set(0,0,0); p.state='hover'; for (let i=0;i<9;i++) { const it = m.mode.field.items[i]; m.mode.pickup(p, it); } }''')
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path=f'{OUT}/{mode}_1.png')
        await pg.evaluate('''() => { const m = window.__app.match, p = m.player; const g = m.guardians[p.team]; p.pos.copy(g.pos).add({x:3,y:2,z:8}); p.yaw = Math.PI; p.depositHeld = true; }''')
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path=f'{OUT}/{mode}_2.png')
    # 結果画面
    await pg.evaluate('() => { window.__app.simSpeed = 1; const m = window.__app.match; m.timeLeft = 0.2; m.overtime = false; m.mode.timeUp = () => true; }')
    await pg.wait_for_function('document.querySelector(".result")', timeout=90000)
    await pg.wait_for_timeout(2500)
    await pg.screenshot(path=f'{OUT}/{mode}_3result.png')
    await ctx.close()
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        for mode, char in [('scramble', 'even'), ('flag', 'aomachi'), ('ball', 'tora')]:
            await shot_mode(b, mode, char)
        await b.close()
asyncio.run(main())
