# v1.8：ディスクの画面（セット中は右・持っているディスクは大きく、そこだけスクロール・画面はゆれない）と、名前の変更の点検
# 使い方：public を 8812 で配信してから python3 tools/v18_disc_test.py
import asyncio, json, sys
from playwright.async_api import async_playwright

URL = 'http://localhost:8812/?norender=1'
IDS = ['akahon', 'tangocho', 'pencil', 'cookie', 'drink', 'eyemask', 'eki', 'mameta', 'ramen', 'hachimaki', 'coffee', 'shield', 'keshigomu', 'marksheet', 'tani', 'warp', 'homewarp', 'jet', 'fuwa', 'screw', 'book']
NAMES = {'hachimaki': '原監督', 'akahon': '松永エリック', 'tangocho': 'カリガン', 'drink': 'アイビーショップのお姉さん', 'eyemask': 'グリック', 'eki': 'まほこ', 'shield': '輪島', 'marksheet': 'アルドー', 'tani': '梨本', 'screw': '伊藤真紀子'}
results = []


def check(name, ok, info=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + ('  ' + str(info) if info != '' else ''), flush=True)


async def run(b, w, h, tag):
    ctx = await b.new_context(viewport={'width': w, 'height': h}, is_mobile=True, has_touch=True)
    own = '{' + ','.join(f'{i}:1' for i in IDS) + '}'
    await ctx.add_init_script("localStorage.setItem('rpf_noacct', '1'); localStorage.setItem('rpf_a2hs_shown','true'); localStorage.setItem('rpf_sound', JSON.stringify({sfx:0,bgm:0})); localStorage.setItem('rpf_save_v1', JSON.stringify({name:'テスト', tutorial:true, seenRules:{scramble:1,flag:1,ball:1}, char:'even', mode:'scramble', diff:'normal', stage:'sakura', rp: 100, om:" + own + "}));")
    pg = await ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    await pg.goto(URL)
    await pg.wait_for_selector('.screen.title', timeout=40000)
    await pg.wait_for_timeout(800)
    await pg.mouse.click(w // 2, int(h * 0.7))
    await pg.wait_for_selector('.screen.home', timeout=15000)
    await pg.click('.tabs button[data-t="om"]')
    await pg.wait_for_selector('.discsel .omgrid .omcard', timeout=15000)
    await pg.wait_for_timeout(600)
    L = await pg.evaluate("""() => { const q = (s) => document.querySelector(s).getBoundingClientRect();
      const st = q('.discstage'), dc = q('.deckcol'), lc = q('.listcard'), g = document.querySelector('.omgrid'), bar = q('.tabs.navbar');
      return { deckRight: dc.left >= st.left + st.width * 0.6, deckTop: dc.top < lc.top, slots: document.querySelectorAll('.deck4 .omcard').length,
               listH: Math.round(lc.height), vh: innerHeight, gridScrolls: g.scrollHeight > g.clientHeight + 4, listAboveBar: lc.bottom <= bar.top + 0.5,
               screenScroll: document.querySelector('.screen.discsel').scrollHeight <= document.querySelector('.screen.discsel').clientHeight + 1 }; }""")
    check(f'[{tag}] 4 セット中 slots on the right of the big preview', L['deckRight'] and L['deckTop'] and L['slots'] == 4, L)
    check(f'[{tag}] owned list is big (≥ 40% of the screen) and ends above the tab bar', L['listH'] >= 0.4 * L['vh'] and L['listAboveBar'], L)
    check(f'[{tag}] only the owned list scrolls (the screen itself does not)', L['gridScrolls'] and L['screenScroll'], L)
    # リストをなぞってスクロール → 上の部分は動かない
    top0 = await pg.evaluate("() => document.querySelector('.dstop').getBoundingClientRect().top")
    box = await pg.evaluate("() => { const r = document.querySelector('.omgrid').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height * 0.7, r.top + r.height * 0.2]; }")
    cdp = await ctx.new_cdp_session(pg)

    async def touch(t, pts):
        await cdp.send('Input.dispatchTouchEvent', {'type': t, 'touchPoints': [{'x': x, 'y': y, 'id': 1} for (x, y) in pts]})

    await touch('touchStart', [(box[0], box[1])])
    for i in range(1, 9):
        await touch('touchMove', [(box[0], box[1] + (box[2] - box[1]) * i / 8)])
        await pg.wait_for_timeout(16)
    await touch('touchEnd', [])
    await pg.wait_for_timeout(700)
    st = await pg.evaluate("() => [document.querySelector('.omgrid').scrollTop, document.querySelector('.dstop').getBoundingClientRect().top, document.querySelector('.screen.discsel').scrollTop, window.scrollY]")
    check(f'[{tag}] dragging the list scrolls it', st[0] > 20, st)
    check(f'[{tag}] top part stays put (no shaking)', abs(st[1] - top0) < 0.5 and st[2] == 0 and st[3] == 0, (top0, st))
    # 上の大きい絵の部分をなぞっても、画面は動かない
    sb = await pg.evaluate("() => { const r = document.querySelector('.discstage').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height * 0.4]; }")
    await touch('touchStart', [(sb[0], sb[1])])
    for i in range(1, 9):
        await touch('touchMove', [(sb[0], sb[1] + i * 14)])
        await pg.wait_for_timeout(16)
    await touch('touchEnd', [])
    await pg.wait_for_timeout(500)
    st2 = await pg.evaluate("() => [document.querySelector('.dstop').getBoundingClientRect().top, document.querySelector('.screen.discsel').scrollTop, window.scrollY, document.documentElement.scrollTop]")
    check(f'[{tag}] dragging the top does not move the screen', abs(st2[0] - top0) < 0.5 and st2[1] == 0 and st2[2] == 0 and st2[3] == 0, st2)
    # 入れかえ：持っているディスク → セット中の枠
    await pg.evaluate("() => { document.querySelector('.omgrid').scrollTop = 0; }")
    deck0 = await pg.evaluate("() => [...document.querySelectorAll('.deck4 .omcard')].map(c => c.dataset.id)")
    cand = await pg.evaluate("(d) => [...document.querySelectorAll('.omgrid .omcard')].map(c => c.dataset.id).find(id => !d.includes(id))", deck0)
    await pg.click(f'.omgrid .omcard[data-id="{cand}"]')
    await pg.wait_for_timeout(200)
    help1 = await pg.inner_text('.omhelp')
    await pg.click('.deck4 .omcard >> nth=1')
    await pg.wait_for_timeout(300)
    deck1 = await pg.evaluate("() => [...document.querySelectorAll('.deck4 .omcard')].map(c => c.dataset.id)")
    check(f'[{tag}] tap a disc, then a セット中 slot → swapped', deck1[1] == cand and deck1[0] == deck0[0], (help1, deck0, deck1))
    # 名前の変更
    names = {}
    for k in NAMES:
        await pg.click(f'.omgrid .omcard[data-id="{k}"]')
        await pg.wait_for_timeout(60)
        names[k] = await pg.inner_text('.dsinfo .mn')
        await pg.click(f'.omgrid .omcard[data-id="{k}"]')  # 選んだのを外す
        await pg.wait_for_timeout(40)
    bad = {k: v for k, v in names.items() if not v or NAMES[k] not in v}
    check(f'[{tag}] disc names use the new names', not bad, bad or '10 names ok')
    await pg.click('.omgrid .omcard[data-id="drink"]')
    await pg.wait_for_timeout(200)
    info = await pg.inner_text('.dsinfo')
    check(f'[{tag}] long name fits (アイビーショップのお姉さん)', 'アイビーショップのお姉さん' in info and await pg.evaluate("() => { const e = document.querySelector('.dsinfo .mn'); return e.scrollWidth <= e.clientWidth + 2 || getComputedStyle(e).whiteSpace !== 'nowrap'; }"), info.replace('\n', ' | ')[:80])
    await pg.screenshot(path=f'/tmp/claude-0/-home-claude/cb87e6ba-4022-5281-bc59-7be863cc9efb/scratchpad/v18/disc18_{tag}.png')
    check(f'[{tag}] no page errors', not errs, errs[:3])
    await ctx.close()


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        await run(b, 393, 852, 'pro')
        await run(b, 375, 667, 'se')
        print(f'v18 disc: {sum(results)}/{len(results)} passed')
        await b.close()

asyncio.run(main())
