import asyncio, base64, os
from playwright.async_api import async_playwright
OUT = '/home/claude/rpf/web'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        pg = await b.new_page()
        pg.on('pageerror', lambda e: print('PAGEERROR', e))
        await pg.goto('http://localhost:8814/index.html')
        await pg.wait_for_function('window.__assets', timeout=60000)
        A = await pg.evaluate('window.__assets')
        for k, v in A.items():
            data = base64.b64decode(v.split(',')[1])
            fn = os.path.join(OUT, ('og' if k == 'og' else k) + '.png')
            open(fn, 'wb').write(data)
            print(fn, len(data))
        await b.close()
asyncio.run(main())
