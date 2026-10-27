# v1.8.1：ホームのフレンドの欄（オンライン・部屋にいる・対戦中・オフライン）の確認
# 使い方：node tools/api/devserver.js --port 8813 を動かしてから python3 tools/home_friends_test.py [出力フォルダ]
import asyncio, json, os, sys
from playwright.async_api import async_playwright

U = 'http://127.0.0.1:8813/'
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/claude-0/-home-claude/cb87e6ba-4022-5281-bc59-7be863cc9efb/scratchpad/v181'
os.makedirs(OUT, exist_ok=True)
results = []


def check(name, ok, info=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + ('  ' + str(info) if info != '' else ''), flush=True)


async def dev(b, name, char, vw=393, vh=852, noacct=False):
    ctx = await b.new_context(viewport={'width': vw, 'height': vh}, is_mobile=True, has_touch=True, device_scale_factor=2)
    save = {'name': name, 'tutorial': True, 'seenRules': {'scramble': 1, 'flag': 1, 'ball': 1}, 'char': char, 'mode': 'scramble', 'diff': 'easy', 'stage': 'sakura'}
    extra = "localStorage.setItem('rpf_noacct', 'true');" if noacct else ''
    await ctx.add_init_script("localStorage.setItem('rpf_save_v1', JSON.stringify(%s)); localStorage.setItem('rpf_sound', JSON.stringify({sfx:0,bgm:0})); localStorage.setItem('rpf_a2hs_shown','true');%s" % (json.dumps(save, ensure_ascii=False), extra))
    pg = await ctx.new_page()
    pg.errs = []
    pg.on('pageerror', lambda e: pg.errs.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and pg.errs.append('console: ' + m.text))
    await pg.goto(U + '?norender=1')
    await pg.wait_for_selector('#boot', state='detached', timeout=60000)
    await pg.wait_for_selector('.screen.title', timeout=60000)
    await pg.mouse.click(vw // 2, int(vh * 0.66))
    await pg.wait_for_selector('.screen.home', timeout=30000)
    if not noacct:
        await pg.wait_for_function("() => { try { const a = JSON.parse(localStorage.getItem('rpf_acct_v1')); return a && a.fc; } catch (e) { return false; } }", timeout=30000)
    return ctx, pg


async def poke(*pgs):
    for pg in pgs:
        await pg.evaluate("() => window.__app.net.pokePresence()")


async def rows(pg, sel='.home .homefr .frow'):
    return await pg.evaluate("(sel) => [...document.querySelectorAll(sel)].map(r => [r.querySelector('.nm').childNodes[0].textContent, r.querySelector('.fst').textContent, r.className.replace('frow ', '')])", sel)


async def home_fresh(pg, want, tries=8):
    # ホームを開きなおして、フレンドのようすが want になるまで待つ
    await pg.evaluate("() => { window.__app.net.friendsCache = null; window.__app.showHome(); }")
    got = None
    for _ in range(tries):
        await poke(pg)
        await pg.wait_for_timeout(1200)
        got = await rows(pg)
        if got == want:
            break
    return got


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebRtcHideLocalIpsWithMdns'])
        ctxA, A = await dev(b, 'アキラ', 'tora')
        fcA = await A.evaluate("() => JSON.parse(localStorage.getItem('rpf_acct_v1')).fc")
        # フレンドがまだいないとき
        await A.evaluate("() => { window.__app.net.friendsCache = null; window.__app.showHome(); }")
        await A.wait_for_selector('.home .homefr:not([hidden]) .none', timeout=20000)
        t = await A.inner_text('.home .homefr')
        check('no friends yet: panel says まだいません with an add button', 'まだいません' in t and 'フレンドを追加' in t, t.replace('\n', ' | '))
        await A.screenshot(path=f'{OUT}/hf_empty.png')
        await A.click('.home .homefr .addf')
        await A.wait_for_selector('.fcard', timeout=20000)
        check('add button opens the friend tab (code / add)', True)
        # 3人がフレンドになる
        ctxB, B = await dev(b, 'ベニ', 'even')
        ctxC, C = await dev(b, 'チカ', 'yuka')
        ctxD, D = await dev(b, 'ダイ', 'naot')
        for X in (B, C, D):
            r = await X.evaluate("(c) => window.__app.net.addFriend(c)", fcA)
            check('friend added', r and r.get('ok'), r)
        # チカはアプリを閉じる（しばらくするとオフライン）
        await ctxC.close()
        # 全員オンライン（チカはまだ消えていない）→ ホームの欄
        await poke(B, D)
        got = await home_fresh(A, [['ダイ', 'オンライン', 'menu'], ['ベニ', 'オンライン', 'menu'], ['チカ', 'オンライン', 'menu']])
        print('rows now', got)
        hd = await A.inner_text('.home .homefr .hd')
        check('header shows how many are online', 'フレンド' in hd and '3人' in hd, hd)
        # ダイは部屋をつくる、ベニは訓練場（対戦中）
        await D.click('.onlinebtn')
        await D.click('.make')
        await D.wait_for_selector('.room .code', timeout=30000)
        await B.evaluate("() => { window.__app.showHome(); window.__app.startTraining(); }")
        await B.wait_for_function("() => window.__app.match && window.__app.match.isTraining", timeout=30000)
        # チカがオフラインになるまで待つ（「いるよ」が40秒で消える）
        print('waiting for チカ to go offline…', flush=True)
        await A.wait_for_timeout(36000)
        await poke(B, D)
        await B.wait_for_timeout(1500)
        want = [['ダイ', '部屋にいる', 'room'], ['ベニ', '対戦中', 'match'], ['チカ', 'オフライン', 'off']]
        got = await home_fresh(A, want, tries=12)
        check('home panel: 部屋にいる → 対戦中 → オフライン, in that order', got == want, got)
        hd = await A.inner_text('.home .homefr .hd')
        check('header counts only online friends (2)', '2人' in hd, hd)
        op = await A.evaluate("() => getComputedStyle(document.querySelector('.home .homefr .frow.off')).opacity")
        check('offline friend row is dimmed', float(op) < 0.8, op)
        # まわりとかさならない
        lay = await A.evaluate("""() => { const r = (s) => { const e = document.querySelector(s); const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
          return { fr: r('.home .homefr'), mc: r('.home .modecard'), plate: r('.home .plate'), vw: innerWidth }; }""")
        fr, mc, pl = lay['fr'], lay['mc'], lay['plate']
        check('panel does not overlap the mode card or the name plate', fr[2] <= mc[0] - 4 and fr[1] >= pl[3] + 2 and fr[0] >= 0, lay)
        await A.screenshot(path=f'{OUT}/hf_home_393x852.png')
        # 押すと全員の一覧
        await A.click('.home .homefr')
        await A.wait_for_selector('.modal.frlist .frow', timeout=15000)
        ml = await rows(A, '.modal.frlist .frow')
        check('tapping the panel opens the full list', ml == want, ml)
        await A.screenshot(path=f'{OUT}/hf_list.png')
        await A.click('.modal.frlist .close')
        # 小さい画面（iPhone SE）
        await A.set_viewport_size({'width': 375, 'height': 667})
        await A.evaluate("() => window.__app.showHome()")
        await A.wait_for_timeout(1500)
        lay = await A.evaluate("""() => { const r = (s) => { const e = document.querySelector(s); const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
          return { fr: r('.home .homefr'), mc: r('.home .modecard'), n: document.querySelectorAll('.home .homefr .frow').length }; }""")
        check('small screen: panel fits beside the mode card', lay['fr'][2] <= lay['mc'][0] - 4 and lay['n'] >= 3, lay)
        await A.screenshot(path=f'{OUT}/hf_home_375x667.png')
        await A.set_viewport_size({'width': 393, 'height': 852})
        # たくさんいるとき：「ほか N人」
        n = await A.evaluate("""() => { const app = window.__app; app.friendList = app.friendList.concat([1,2,3,4,5].map(i => ({ n: 'テスト' + i, c: 'mana', u: 'zz' + i })));
          app._homeFrSig = null; app.renderHomeFriends(); return [document.querySelectorAll('.home .homefr .frow').length, (document.querySelector('.home .homefr .more') || {}).textContent]; }""")
        check('many friends: shows a few and "ほか N人"', n[0] == 4 and n[1] and 'ほか 4人' in n[1], n)
        await A.screenshot(path=f'{OUT}/hf_many.png')
        # アカウントのない人には出さない
        ctxE, E = await dev(b, 'エイ', 'mana', noacct=True)
        await E.wait_for_timeout(2500)
        hid = await E.evaluate("() => { const e = document.querySelector('.home .homefr'); return !e || e.hidden; }")
        check('no account: panel is hidden', hid)
        errs = [e for e in A.errs + B.errs + D.errs + E.errs if '429' not in e and '403' not in e and '400' not in e]
        check('no page errors', not errs, errs[:4])
        print(f'home friends test: {sum(results)}/{len(results)} passed')
        await b.close()

asyncio.run(main())
