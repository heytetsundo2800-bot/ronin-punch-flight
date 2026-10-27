# v1.8：フレンドコードのコピーと、コード（貼りつけた文）での追加の確認
# 使い方：node tools/api/devserver.js --port 8813 を動かしてから python3 tools/friend_code_test.py
import asyncio, json, sys
from playwright.async_api import async_playwright

U = 'http://127.0.0.1:8813/'
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/claude-0/-home-claude/cb87e6ba-4022-5281-bc59-7be863cc9efb/scratchpad/v18'
results = []


def check(name, ok, info=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + ('  ' + str(info) if info != '' else ''), flush=True)


async def dev(b, name, char):
    ctx = await b.new_context(viewport={'width': 393, 'height': 852}, is_mobile=True, has_touch=True, device_scale_factor=2)
    await ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=U.rstrip('/'))
    save = {'name': name, 'tutorial': True, 'seenRules': {'scramble': 1, 'flag': 1, 'ball': 1}, 'char': char}
    await ctx.add_init_script("localStorage.setItem('rpf_save_v1', JSON.stringify(%s)); localStorage.setItem('rpf_sound', JSON.stringify({sfx:0,bgm:0}));" % json.dumps(save, ensure_ascii=False))
    pg = await ctx.new_page()
    pg.errs = []
    pg.on('pageerror', lambda e: pg.errs.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and pg.errs.append('console: ' + m.text))
    await pg.goto(U + '?norender=1')
    await pg.wait_for_selector('#boot', state='detached', timeout=30000)
    await pg.wait_for_selector('.screen.title', timeout=30000)
    await pg.mouse.click(196, 600)
    await pg.wait_for_selector('.screen.home', timeout=20000)
    # アカウントができるまで待つ
    await pg.wait_for_function("() => { try { const a = JSON.parse(localStorage.getItem('rpf_acct_v1')); return a && a.fc; } catch (e) { return false; } }", timeout=20000)
    return ctx, pg


async def open_friend_tab(pg):
    await pg.evaluate("() => window.__app.showRanking('f')")
    await pg.wait_for_selector('.fcard .fcbar', timeout=10000)
    await pg.wait_for_timeout(600)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        ctxA, A = await dev(b, 'アキラ', 'tora')
        ctxB, B = await dev(b, 'ベニ', 'even')
        fcA = await A.evaluate("() => JSON.parse(localStorage.getItem('rpf_acct_v1')).fc")
        # せってい→アカウント：コードとコピー
        await A.evaluate("() => window.__app.showSettings()")
        await A.wait_for_selector('.acct .fcbar', timeout=15000)
        await A.wait_for_timeout(500)
        shown = (await A.inner_text('.acct .fcbar .fcv b')).strip()
        check('settings shows my friend code', shown == fcA, (shown, fcA))
        await A.locator('.acct').scroll_into_view_if_needed()
        await A.screenshot(path=f'{OUT}/fc_settings.png')
        await A.click('.acct .fccopy')
        await A.wait_for_timeout(400)
        clip = await A.evaluate("() => navigator.clipboard.readText()")
        check('copy button copies the code', clip == fcA, clip)
        lbl = (await A.inner_text('.acct .fccopy')).strip()
        toast = await A.evaluate("() => [...document.querySelectorAll('.toast')].map(t => t.innerText).join(' | ')")
        check('copy feedback (button + toast)', lbl == 'コピーした！' and fcA in toast, (lbl, toast[:80]))
        await A.screenshot(path=f'{OUT}/fc_copied.png')
        # タップでもコピー（コードそのもの）
        await A.evaluate("() => navigator.clipboard.writeText('')")
        await A.click('.acct .fcv')
        await A.wait_for_timeout(300)
        clip2 = await A.evaluate("() => navigator.clipboard.readText()")
        check('tapping the code also copies', clip2 == fcA, clip2)
        # ランキングのフレンド：上にコードと追加ボタン
        await open_friend_tab(A)
        shown2 = (await A.inner_text('.fcard .fcv b')).strip()
        check('friend tab shows my code', shown2 == fcA)
        empty = await A.inner_text('.list')
        check('empty friend list explains copy/add', 'コピー' in empty, empty[:60])
        await A.screenshot(path=f'{OUT}/fc_rank_empty.png')
        # B：LINEでもらった文をそのまま貼りつけて追加
        await open_friend_tab(B)
        await B.click('.fcard .addf')
        await B.wait_for_selector('.modal.fcadd .fcin', timeout=5000)
        okdis = await B.evaluate("() => document.querySelector('.modal.fcadd .ok').disabled")
        check('add button disabled while empty', okdis)
        await B.fill('.modal.fcadd .fcin', 'ちがう文')
        bad = await B.inner_text('.modal.fcadd .fcprev')
        check('explains when no code found', '見つかりません' in bad, bad)
        msg = '浪人パンチフライトでフレンドになろう！フレンドコード %s %s?f=%s&openExternalBrowser=1' % (fcA, U, fcA)
        await B.evaluate("(t) => navigator.clipboard.writeText(t)", msg)
        await B.fill('.modal.fcadd .fcin', '')
        await B.click('.modal.fcadd .paste')
        await B.wait_for_timeout(300)
        prev = await B.inner_text('.modal.fcadd .fcprev')
        check('paste button pulls the code out of a LINE message', fcA in prev, prev)
        await B.screenshot(path=f'{OUT}/fc_add_modal.png')
        await B.click('.modal.fcadd .ok')
        try:
            await B.wait_for_selector('.modal.fcadd', state='detached', timeout=10000)
            closed = True
        except Exception:
            closed = False
        toastB = await B.evaluate("() => [...document.querySelectorAll('.toast')].map(t => t.innerText).join(' | ')")
        check('friend added', closed and 'フレンドになりました' in toastB, toastB[:80])
        await B.wait_for_timeout(1500)
        names = await B.evaluate("() => [...document.querySelectorAll('.list .rkrow')].map(r => r.dataset.n)")
        check('friend list refreshed with the new friend', 'アキラ' in names, names)
        await B.screenshot(path=f'{OUT}/fc_rank_after.png')
        # 小さい画面
        await B.set_viewport_size({'width': 375, 'height': 667})
        await open_friend_tab(B)
        await B.screenshot(path=f'{OUT}/fc_rank_se.png')
        ov = await B.evaluate("() => { const r = document.querySelector('.fcard').getBoundingClientRect(); const c = document.querySelector('.fcard .fccopy').getBoundingClientRect(); return [r.right <= innerWidth + 0.5, c.right <= r.right + 0.5, document.documentElement.scrollWidth <= innerWidth]; }")
        check('fits small screen', all(ov), ov)
        errs = A.errs + B.errs
        check('no page errors', not errs, errs[:4])
        print(f'friend code: {sum(results)}/{len(results)} passed')
        await b.close()

asyncio.run(main())
