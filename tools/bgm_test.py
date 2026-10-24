# 使い方：public を 8812 で配信してから python3 tools/bgm_test.py
# BGM の動きの点検：鳴らす曲だけ展開する／音量0で止まる・上げると戻る／読めないときは間をあけてためす
import asyncio
import sys
from playwright.async_api import async_playwright

results = []


def check(name, ok, info=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name, info)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        ctx = await b.new_context(viewport={'width': 402, 'height': 874}, is_mobile=True, has_touch=True)
        await ctx.add_init_script("localStorage.setItem('rpf_noacct', '1'); localStorage.setItem('rpf_save_v1', JSON.stringify({name:'テスト', tutorial:true, seenRules:{scramble:1,flag:1,ball:1}, char:'even', mode:'scramble', diff:'normal', stage:'sakura', rp: 100}));")
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:8812/?norender=1')
        await pg.wait_for_selector('.screen.title', timeout=40000)
        await pg.wait_for_timeout(800)
        await pg.mouse.click(201, 640)
        await pg.wait_for_selector('.screen.home', timeout=15000)

        async def wait_cur(name, sec=15):
            for _ in range(int(sec * 10)):
                c = await pg.evaluate("() => window.__sound.cur ? window.__sound.cur.name : ''")
                if c == name:
                    return True
                await pg.wait_for_timeout(100)
            return False

        check('menu: lobby song plays', await wait_cur('lobby'))
        st = await pg.evaluate("() => { const s = window.__sound; return { dec: s.dec && s.dec.name, raw: Object.keys(s.raw || {}).sort() }; }")
        check('only the playing song is expanded', st['dec'] == 'lobby', st)
        await pg.wait_for_timeout(1500)
        st = await pg.evaluate("() => Object.keys(window.__sound.raw || {}).sort()")
        check('the other song is kept compressed (prefetch)', any(k.startswith('battle.') for k in st), st)
        # 音量0 → 止まって、展開した曲も手放す
        await pg.evaluate("() => window.__sound.setVolume('bgm', 0)")
        await pg.wait_for_timeout(300)
        st = await pg.evaluate("() => ({ cur: !!window.__sound.cur, dec: !!window.__sound.dec })")
        check('volume 0: song stops and memory is freed', not st['cur'] and not st['dec'], st)
        await pg.evaluate("() => window.__sound.playBgm('menu')")
        await pg.wait_for_timeout(800)
        st = await pg.evaluate("() => ({ cur: !!window.__sound.cur, dec: !!window.__sound.dec })")
        check('volume 0: changing screens does not load the song', not st['cur'] and not st['dec'], st)
        await pg.evaluate("() => window.__sound.setVolume('bgm', 0.55)")
        check('volume up: the song comes back', await wait_cur('lobby'))
        # 試合 → バトルの曲。ロビーの曲は展開をやめる
        await pg.click('.battlebtn', force=True)
        await pg.wait_for_function('window.__app.match', timeout=60000)
        check('battle: battle song plays', await wait_cur('battle', 30))
        st = await pg.evaluate("() => ({ dec: window.__sound.dec && window.__sound.dec.name })")
        check('battle: only the battle song is expanded', st['dec'] == 'battle', st)
        # 読めないとき：すぐに何度もためさない
        n = await pg.evaluate("""async () => { const s = window.__sound; s.dec = null; s.raw = {}; s.bgmFail = {};
            const f0 = window.fetch; let calls = 0; window.fetch = (u, o) => { if (String(u).includes('bgm_')) { calls++; return Promise.reject(new Error('offline')); } return f0(u, o); };
            const a = await s.loadBgm('lobby'); const c1 = calls; const b = await s.loadBgm('lobby'); const c2 = calls;
            window.fetch = f0; return { a, b, c1, c2, n: s.bgmFail.lobby && s.bgmFail.lobby.n, wait: s.bgmFail.lobby ? Math.round((s.bgmFail.lobby.until - Date.now()) / 1000) : -1 }; }""")
        check('failed load: tries both formats once', n['a'] is None and n['c1'] == 2, n)
        check('failed load: waits before trying again', n['b'] is None and n['c2'] == 2 and n['n'] == 1 and 3 <= n['wait'] <= 5, n)
        check('no page errors', not errs, errs[:3])
        await b.close()
    bad = [n for n, ok in results if not ok]
    print(f'bgm test: {len(results) - len(bad)}/{len(results)} passed')
    sys.exit(1 if bad else 0)


asyncio.run(main())
