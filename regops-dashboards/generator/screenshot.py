import json, asyncio, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CHROME = os.environ.get('CHROME_PATH')  # optional: path to a Chrome binary
from playwright.async_api import async_playwright
ids=['overview','emir','mifir','sftrcftc','exceptions','rejections','completeness','pipeline','dq','controls']
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=CHROME) if CHROME else await p.chromium.launch()
        pg=await b.new_page(viewport={'width':1440,'height':900})
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto('file://' + os.path.join(ROOT, 'prototype', 'index.html')); await pg.wait_for_timeout(800)
        H={}
        for i in ids:
            await pg.evaluate(f"location.hash='{i}'"); await pg.wait_for_timeout(250)
            h=await pg.evaluate(f"document.getElementById('s-{i}').scrollHeight")
            H[i]=int(h)
            await pg.screenshot(path=os.path.join(ROOT, 'screenshots', f'{i}.png'),full_page=True)
        json.dump(H,open(os.path.join(HERE, 'heights.json'),'w'))
        print(H, errs)
        await b.close()
asyncio.run(main())
