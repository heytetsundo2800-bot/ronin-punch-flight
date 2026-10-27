# v1.8：「アプリにする方法」（ホーム画面に追加）の点検：iPhone・Android・LINEの中のブラウザ
# 使い方：public を 8812 で配信してから python3 tools/a2hs_test.py
import asyncio, json, sys
from playwright.async_api import async_playwright

URL = 'http://localhost:8812/?norender=1'
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/claude-0/-home-claude/cb87e6ba-4022-5281-bc59-7be863cc9efb/scratchpad/v18'
UA = {
    'ios': 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
    'android': 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
    'line': 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/15.16.0',
}
results = []


def check(name, ok, info=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + ('  ' + str(info) if info != '' else ''), flush=True)


async def run(b, kind, w, h, fresh):
    ctx = await b.new_context(viewport={'width': w, 'height': h}, is_mobile=True, has_touch=True, device_scale_factor=2, user_agent=UA[kind])
    init = "localStorage.setItem('rpf_noacct','true'); localStorage.setItem('rpf_sound', JSON.stringify({sfx:0,bgm:0}));"
    if not fresh:
        save = {'name': 'テスト', 'tutorial': True, 'seenRules': {'scramble': 1, 'flag': 1, 'ball': 1}, 'char': 'tora', 'plays': 2}
        init += "localStorage.setItem('rpf_save_v1', JSON.stringify(%s));" % json.dumps(save, ensure_ascii=False)
    await ctx.add_init_script(init)
    pg = await ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    await pg.goto(URL)
    await pg.wait_for_selector('#boot', state='detached', timeout=30000)
    await pg.wait_for_selector('.screen.title', timeout=30000)
    await pg.wait_for_timeout(700)
    tag = f'{kind}_{w}x{h}'
    btn = await pg.query_selector('.title .a2btn')
    check(f'[{tag}] title shows the app button', btn is not None)
    # TAP TO START にかぶらない
    ov = await pg.evaluate("() => { const a = document.querySelector('.title .a2btn').getBoundingClientRect(), t = document.querySelector('.tapwrap').getBoundingClientRect(), v = document.querySelector('.title .ver').getBoundingClientRect(); return [a.top >= t.bottom - 0.5, a.bottom <= innerHeight, Math.round(a.top), Math.round(t.bottom)]; }")
    check(f'[{tag}] app button does not cover TAP TO START', ov[0] and ov[1], ov)
    await pg.screenshot(path=f'{OUT}/a2_{tag}_title.png')
    await pg.click('.title .a2btn')
    await pg.wait_for_selector('.modal.a2hsm', timeout=5000)
    await pg.wait_for_timeout(300)
    on = await pg.evaluate("() => [...document.querySelectorAll('.a2os button.on')].map(b => b.dataset.o)")
    want = 'android' if kind == 'android' else 'ios'
    check(f'[{tag}] guide opens on the right phone tab', on == [want], on)
    steps = await pg.evaluate("() => [...document.querySelectorAll('.a2list li')].map(l => l.innerText.replace(/\\n/g, ' '))")
    if want == 'ios':
        check(f'[{tag}] iPhone steps: … → 共有 → その他/ホーム画面に追加 → 追加', len(steps) == 5 and '「…」' in steps[0] and '共有' in steps[1] and 'ホーム画面に追加' in steps[2] and '追加' in steps[3], steps)
    else:
        check(f'[{tag}] Android steps: ⋮ → ホーム画面に追加 → インストール', len(steps) == 4 and '⋮' in steps[0] and 'ホーム画面に追加' in steps[1] and 'インストール' in steps[2], steps)
    line = await pg.query_selector('.a2line')
    if kind == 'line':
        href = await pg.evaluate("() => document.querySelector('.a2line a').getAttribute('href')")
        check(f'[{tag}] LINE: first open in Safari/Chrome (openExternalBrowser=1)', line is not None and 'openExternalBrowser=1' in href, href)
    else:
        check(f'[{tag}] no LINE box outside LINE', line is None)
    fits = await pg.evaluate("() => { const b = document.querySelector('.modal.a2hsm .box').getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight + 0.5; }")
    check(f'[{tag}] guide box fits on screen (scrolls inside)', fits)
    await pg.screenshot(path=f'{OUT}/a2_{tag}_guide.png')
    # 切りかえ
    await pg.click('.a2os button[data-o="%s"]' % ('ios' if want == 'android' else 'android'))
    await pg.wait_for_timeout(200)
    n2 = await pg.evaluate("() => document.querySelectorAll('.a2list li').length")
    check(f'[{tag}] switch phone tab', n2 == (5 if want == 'android' else 4), n2)
    await pg.click('.modal.a2hsm .close')
    await pg.wait_for_timeout(200)
    gone = await pg.query_selector('.modal.a2hsm')
    sc = await pg.evaluate("() => document.querySelector('#screens .screen').className")
    check(f'[{tag}] closing the guide stays on the title (does not start)', gone is None and 'title' in sc, sc)
    if not fresh:
        # ホーム：右上のアイコンからも開ける。2回目以降の人には一度だけ自動で出す
        await pg.mouse.click(w // 2, int(h * 0.55))
        await pg.wait_for_selector('.screen.home', timeout=10000)
        await pg.wait_for_timeout(1200)
        auto = await pg.query_selector('.modal.a2hsm')
        check(f'[{tag}] shown once automatically on home (after playing)', auto is not None)
        if auto:
            await pg.click('.modal.a2hsm .close')
        ib = await pg.query_selector('.home .a2hs')
        check(f'[{tag}] home has the app icon button', ib is not None)
    check(f'[{tag}] no page errors', not errs, errs[:3])
    await ctx.close()


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        await run(b, 'ios', 393, 852, False)
        await run(b, 'android', 412, 915, True)
        await run(b, 'line', 375, 667, True)
        print(f'a2hs: {sum(results)}/{len(results)} passed')
        await b.close()

asyncio.run(main())
