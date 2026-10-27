# v1.8：下のタブ（画面のいちばん下にくっつく・押したまま横にすべらせて移れる）の点検
# 使い方：public を 8812 で配信してから python3 tools/tabbar_test.py
import asyncio, json, sys
from playwright.async_api import async_playwright

URL = 'http://localhost:8812/?norender=1'
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/claude-0/-home-claude/cb87e6ba-4022-5281-bc59-7be863cc9efb/scratchpad/v18'
results = []


def check(name, ok, info=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + ('  ' + str(info) if info != '' else ''), flush=True)


SAVE = "localStorage.setItem('rpf_noacct','true'); localStorage.setItem('rpf_sound', JSON.stringify({sfx:0,bgm:0})); localStorage.setItem('rpf_a2hs_shown','true'); localStorage.setItem('rpf_save_v1', JSON.stringify(%s));"
BAR = """() => { const b = document.querySelector('.tabs.navbar'); if (!b || b.classList.contains('hidden')) return null; const r = b.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, h: r.height, vh: innerHeight, on: [...b.querySelectorAll('button.on')].map(x => x.dataset.t), tx: getComputedStyle(b).getPropertyValue('--tx').trim(), hov: [...b.querySelectorAll('button.hov')].map(x => x.dataset.t) }; }"""


def screen_of(pg):
    return pg.evaluate("() => { const s = document.querySelector('#screens .screen'); return s ? s.className : ''; }")


async def tab_xy(pg, t):
    r = await pg.evaluate("(t) => { const r = document.querySelector('.tabs.navbar button[data-t=\"' + t + '\"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }", t)
    return r


async def run(b, w, h, tag):
    ctx = await b.new_context(viewport={'width': w, 'height': h}, is_mobile=True, has_touch=True, device_scale_factor=2)
    save = {'name': 'テスト', 'tutorial': True, 'seenRules': {'scramble': 1, 'flag': 1, 'ball': 1}, 'char': 'tora', 'mode': 'scramble', 'diff': 'easy', 'diffV': 2, 'stage': 'sakura', 'plays': 3}
    await ctx.add_init_script(SAVE % json.dumps(save, ensure_ascii=False))
    pg = await ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    await pg.goto(URL)
    await pg.wait_for_selector('#boot', state='detached', timeout=30000)
    await pg.wait_for_selector('.screen.title', timeout=30000)
    await pg.wait_for_timeout(500)
    await pg.mouse.click(w // 2, int(h * 0.7))
    await pg.wait_for_selector('.screen.home', timeout=15000)
    await pg.wait_for_timeout(600)
    bar = await pg.evaluate(BAR)
    check(f'[{tag}] home: tab bar flush with the bottom', bar and abs(bar['bottom'] - bar['vh']) < 0.5 and bar['on'] == ['home'], bar)
    over = await pg.evaluate("""(top) => ['.battlebtn', '.subbtns', '.homechar', '.modecard'].map(s => { const e = document.querySelector(s); return [s, e ? Math.round(e.getBoundingClientRect().bottom) : null]; }).filter(x => x[1] == null || x[1] > top + 0.5)""", bar['top'])
    check(f'[{tag}] home: nothing hidden under the tab bar', not over, over)
    await pg.screenshot(path=f'{OUT}/tab_{tag}_home.png')
    # タップで移る（テストの書き方 .tabs button[data-t=...] はそのまま）
    await pg.click('.tabs button[data-t="om"]')
    await pg.wait_for_selector('.screen.discsel', timeout=8000)
    await pg.wait_for_timeout(500)
    bar = await pg.evaluate(BAR)
    check(f'[{tag}] tap ディスク: disc screen, bar stays, mark on ディスク', bar and bar['on'] == ['om'] and bar['tx'] == '1', bar)
    lc = await pg.evaluate("(top) => { const e = document.querySelector('.listcard'); return Math.round(e.getBoundingClientRect().bottom) <= top + 0.5; }", bar['top'])
    check(f'[{tag}] disc list ends above the tab bar', lc)
    await pg.screenshot(path=f'{OUT}/tab_{tag}_disc.png')
    # 押したまま横にすべらせる：パンチャー → ホーム
    cdp = await ctx.new_cdp_session(pg)

    async def touch(t, pts):
        await cdp.send('Input.dispatchTouchEvent', {'type': t, 'touchPoints': [{'x': x, 'y': y, 'id': 1} for (x, y) in pts]})

    await pg.click('.tabs button[data-t="char"]')
    await pg.wait_for_selector('.screen.charsel', timeout=8000)
    await pg.wait_for_timeout(400)
    x0, y0 = await tab_xy(pg, 'char')
    x2, _ = await tab_xy(pg, 'home')
    await touch('touchStart', [(x0, y0)])
    mid = None
    for i in range(1, 11):
        await touch('touchMove', [(x0 + (x2 - x0) * i / 10, y0)])
        await pg.wait_for_timeout(25)
        if i == 6:
            mid = await pg.evaluate(BAR)
    await pg.wait_for_timeout(80)
    pre = await pg.evaluate(BAR)
    await touch('touchEnd', [])
    await pg.wait_for_timeout(500)
    sc = await screen_of(pg)
    bar = await pg.evaluate(BAR)
    check(f'[{tag}] slide: mark follows the finger (between tabs)', mid and 0.9 < float(mid['tx']) < 1.6 and mid['hov'] in (['om'], ['home']), mid)
    check(f'[{tag}] slide: the tab under the finger lights up', pre and pre['hov'] == ['home'], pre)
    check(f'[{tag}] slide パンチャー→ホーム, release → home', 'home' in sc and bar['on'] == ['home'] and bar['tx'] == '2', (sc, bar))
    # すべらせて上へ指を逃がすと取り消し
    x4, _ = await tab_xy(pg, 'set')
    xs, ys = await tab_xy(pg, 'home')
    await touch('touchStart', [(xs, ys)])
    for i in range(1, 8):
        await touch('touchMove', [(xs + (x4 - xs) * i / 7, ys - (i * 18 if i > 3 else 0))])
        await pg.wait_for_timeout(25)
    await touch('touchEnd', [])
    await pg.wait_for_timeout(400)
    sc = await screen_of(pg)
    bar = await pg.evaluate(BAR)
    check(f'[{tag}] slide then lift the finger upward → cancelled (stay home)', 'home' in sc and bar['on'] == ['home'], (sc, bar))
    # 押してそのままはなす（タップ）＝そのタブへ
    xr, yr = await tab_xy(pg, 'rank')
    await touch('touchStart', [(xr, yr)])
    await touch('touchEnd', [])
    await pg.wait_for_timeout(700)
    sc = await screen_of(pg)
    bar = await pg.evaluate(BAR)
    check(f'[{tag}] tap ランキング with a finger → ranking (once)', 'panel' in sc and bar['on'] == ['rank'], (sc, bar))
    await pg.screenshot(path=f'{OUT}/tab_{tag}_rank.png')
    # せってい（スクロール）：いちばん下まで見える
    await pg.click('.tabs button[data-t="set"]')
    await pg.wait_for_timeout(500)
    r = await pg.evaluate("""(top) => { const s = document.querySelector('#screens .screen'); s.scrollTop = s.scrollHeight; const kids = [...s.children]; const last = kids[kids.length - 1]; return [Math.round(last.getBoundingClientRect().bottom), Math.round(top)]; }""", bar['top'])
    await pg.wait_for_timeout(200)
    r = await pg.evaluate("""() => { const s = document.querySelector('#screens .screen'); const top = document.querySelector('.tabs.navbar').getBoundingClientRect().top; const kids = [...s.children]; const last = kids[kids.length - 1]; return [Math.round(last.getBoundingClientRect().bottom), Math.round(top)]; }""")
    check(f'[{tag}] settings: last card can scroll above the tab bar', r[0] <= r[1], r)
    await pg.screenshot(path=f'{OUT}/tab_{tag}_set.png')
    # パンチャー：「このキャラで戦う」がタブの上
    await pg.click('.tabs button[data-t="char"]')
    await pg.wait_for_selector('.screen.charsel .pick', timeout=8000)
    await pg.wait_for_timeout(500)
    r = await pg.evaluate("""() => { const top = document.querySelector('.tabs.navbar').getBoundingClientRect().top; return [Math.round(document.querySelector('.charsel .pick').getBoundingClientRect().bottom), Math.round(top)]; }""")
    check(f'[{tag}] パンチャー: fight button above the tab bar', r[0] <= r[1], r)
    await pg.screenshot(path=f'{OUT}/tab_{tag}_char.png')
    # 試合ではタブを出さない → ホームにもどると出る
    await pg.click('.tabs button[data-t="home"]')
    await pg.wait_for_selector('.screen.home', timeout=8000)
    await pg.evaluate("() => window.__app.startMatch()")
    await pg.wait_for_timeout(800)
    bar = await pg.evaluate(BAR)
    check(f'[{tag}] no tab bar during a match', bar is None, bar)
    await pg.evaluate("() => { window.__app.endMatch(); window.__app.showHome(); }")
    await pg.wait_for_timeout(400)
    bar = await pg.evaluate(BAR)
    check(f'[{tag}] tab bar back on home', bar is not None and bar['on'] == ['home'], bar)
    # オンライン・タイトル画面ではタブを出さない
    await pg.evaluate("() => window.__app.showOnline()")
    await pg.wait_for_timeout(300)
    bar = await pg.evaluate(BAR)
    check(f'[{tag}] no tab bar on the online screen', bar is None, bar)
    check(f'[{tag}] no page errors', not errs, errs[:3])
    await ctx.close()


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        await run(b, 393, 852, 'pro')
        await run(b, 375, 667, 'se')
        print(f'tab bar: {sum(results)}/{len(results)} passed')
        await b.close()

asyncio.run(main())
