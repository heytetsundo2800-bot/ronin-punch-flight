# アイコンの案を撮る：リポジトリのフォルダを 8814 で配信してから python3 tools/assets/icons17_run.py 出力先
import asyncio, base64, os, sys, json
from playwright.async_api import async_playwright
OUT = sys.argv[1]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        pg = await b.new_page()
        pg.on('pageerror', lambda e: print('PAGEERROR', e))
        pg.on('console', lambda m: print('CONSOLE', m.text) if m.type in ('error','warning') else None)
        await pg.goto('http://localhost:8814/tools/assets/icons17.html')
        await pg.wait_for_function('window.__icons || window.__iconsErr', timeout=600000)
        err = await pg.evaluate('window.__iconsErr || null')
        if err: print('ERR', err)
        A = await pg.evaluate('window.__icons || []')
        meta = []
        for i, it in enumerate(A):
            fn = os.path.join(OUT, f'icon_{i+1:02d}.png')
            open(fn, 'wb').write(base64.b64decode(it['url'].split(',')[1]))
            meta.append({'n': i + 1, 'title': it['title'], 'file': fn})
        json.dump(meta, open(os.path.join(OUT, 'meta.json'), 'w'), ensure_ascii=False)
        print('saved', len(A))
        await b.close()
asyncio.run(main())
