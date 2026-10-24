# 3つのルールを早送りで最後までやって、ちゃんと終わるか・エラーがないかを見る
import sys, asyncio, json
from playwright.async_api import async_playwright
OUT = '/tmp/claude-0/-home-claude/cb87e6ba-4022-5281-bc59-7be863cc9efb/scratchpad/shots'
STAGE = sys.argv[1] if len(sys.argv) > 1 else 'sakura'
async def run(b, mode, char, diff):
    ctx = await b.new_context(viewport={'width': 393, 'height': 852}, device_scale_factor=1, is_mobile=True, has_touch=True)
    pg = await ctx.new_page()
    logs = []
    pg.on('pageerror', lambda e: logs.append('PAGEERROR: ' + str(e)))
    pg.on('console', lambda m: logs.append(m.type + ': ' + m.text) if m.type == 'error' and '404' not in m.text else None)
    await pg.add_init_script("localStorage.setItem('rpf_save_v1', JSON.stringify({name:'テスト', tutorial:true, seenRules:{scramble:1,flag:1,ball:1}, char:'%s', mode:'%s', diff:'%s', stage:'%s'}))" % (char, mode, diff, STAGE))
    await pg.goto('http://localhost:8812/?norender=1')
    await pg.wait_for_timeout(1200)
    await pg.mouse.click(196, 600)
    await pg.wait_for_timeout(600)
    await pg.click('.battlebtn', force=True)
    await pg.wait_for_function('window.__app.match && window.__app.match.phase === "play"', timeout=20000)
    # プレイヤーもCPUにまかせる
    await pg.evaluate('''() => { const m = window.__app.match; const {Brain} = window; }''')
    await pg.evaluate('''() => { const app = window.__app; const m = app.match; const P = m.player; const B = m.punchers.find(q => q.brain).brain.constructor; P.brain = new B(P, m, 'collector'); app.input.enabled = false; app.simSpeed = 6; }''')
    t0 = asyncio.get_event_loop().time()
    snaps = []
    while True:
        await pg.wait_for_timeout(2000)
        st = await pg.evaluate('''() => { const m = window.__app.match; if (!m) return {done: true}; return {phase: m.phase, left: +m.timeLeft.toFixed(0), score: [m.mode.score(0), m.mode.score(1)], ko: m.punchers.reduce((a,q)=>a+q.stats.ko,0), alive: m.punchers.filter(q=>q.alive).length, goals: m.punchers.map(q => q.brain && q.brain.goal ? q.brain.goal.kind : '-').join(','), proj: m.combat.projectiles.length}; }''')
        snaps.append(st)
        if st.get('phase') == 'result' or st.get('done') or asyncio.get_event_loop().time() - t0 > 150:
            break
    res = await pg.evaluate('''() => { const s = document.querySelector('.result'); return s ? s.innerText.slice(0, 200).replace(/\\n+/g,' | ') : null; }''')
    await pg.screenshot(path=f'{OUT}/mode_{mode}_result.png')
    print(STAGE, mode, char, diff, '->', json.dumps(snaps[-2] if len(snaps) > 1 else snaps[-1], ensure_ascii=False))
    print('  mid:', json.dumps(snaps[len(snaps)//2], ensure_ascii=False))
    print('  result:', res)
    for l in logs[:10]: print('  ', l)
    await ctx.close()
    return res is not None and not logs
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        ok = []
        for mode, char, diff in [('scramble', 'even', 'normal'), ('flag', 'aomachi', 'hard'), ('ball', 'tora', 'easy')]:
            ok.append(await run(b, mode, char, diff))
        print('modes ok:', ok, STAGE)
        await b.close()
asyncio.run(main())
