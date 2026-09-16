#!/usr/bin/env python3
"""In-memory browser regression test. Uses an explicitly labelled WebGL2 path.
No browser navigation or external network is needed. WebGPU must be tested on a
secure localhost origin separately; this test does not report native validation.
A low-amplitude synthetic PCM fixture is used ONLY to test transport/recording.
It is not the soundtrack, is never included in the app, and is not exported.
"""
import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'previews'

async def main():
    OUT.mkdir(exist_ok=True)
    report={'backend':'WebGL2 compatibility / Chromium SwiftShader','nativeWebGPUValidated':False,'errors':[],'checks':[]}
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=[
            '--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader',
            '--disable-gpu-sandbox','--disable-dev-shm-usage'])
        try:
            page=await browser.new_page(viewport={'width':1280,'height':720})
            page.on('pageerror',lambda e:report['errors'].append(str(e)))
            await page.set_content((ROOT/'Aether-Orb-Odyssey.html').read_text(),wait_until='domcontentloaded')
            await page.wait_for_function('window.__film !== undefined')
            assert await page.evaluate('window.__film.ready')
            assert not await page.evaluate('window.__film.state.running')
            assert await page.locator('#backend').inner_text()=='WEBGL2 COMPATIBILITY'
            print('CHECKPOINT',len(report['checks']),flush=True);report['checks'].append('Ready state; no autoplay; accurate backend label')
            await page.screenshot(path=str(OUT/'00-gate-landscape.png'))
            for i,t in enumerate([7.5,19.5,29,39.5,53,63.5,73,82.5],1):
                result=await page.evaluate('(t)=>window.__film.frame(t,{quality:"balanced"})',t)
                assert not result['errors'],result
                await page.screenshot(path=str(OUT/f'{i:02d}-{str(t).replace(".","-")}.png'))
            print('CHECKPOINT',len(report['checks']),flush=True);report['checks'].append('Eight distinct rendered shots; zero shader/GL errors')
            await page.evaluate('window.__film.frame(39.5,{clean:false})')
            await page.locator('#quality').select_option('preview')
            assert await page.evaluate('window.__film.renderer.quality')=='preview'
            await page.locator('#chaptersButton').click()
            await page.locator('#chapters button').nth(5).click()
            assert abs((await page.evaluate('window.__film.state.time'))-57.6)<.001
            assert await page.locator('#chapters').is_hidden()
            await page.locator('#creditsButton').click()
            assert await page.evaluate('document.querySelector("#credits").open')
            await page.locator('.dialog-close').click()
            print('CHECKPOINT',len(report['checks']),flush=True);report['checks'].append('Quality selector, chapter seeking and credits dialog')
            # Explicit click activation; test transport using a generated fixture, not the score.
            await page.evaluate('''()=>{
                const b=document.createElement('button');b.id='testFixture';b.textContent='Test audio';b.style='position:fixed;z-index:100;top:0;left:0';
                b.onclick=async()=>{const s=window.__film.soundtrack;await s.unlock();s.buffer=s.context.createBuffer(1,s.context.sampleRate*87,s.context.sampleRate);const a=s.buffer.getChannelData(0);for(let i=0;i<a.length;i++)a[i]=Math.sin(i*.04)*.001;s.buildEnvelope();b.remove();};document.body.append(b);
            }''')
            await page.locator('#testFixture').click()
            await page.wait_for_function('window.__film.soundtrack.buffer !== undefined')
            await page.evaluate('window.__film.frame(20,{clean:false,quality:"preview"})')
            await page.locator('#playPause').click()
            await page.wait_for_timeout(400)
            assert await page.evaluate('window.__film.state.running')
            t0=await page.evaluate('window.__film.state.time')
            assert t0>20
            await page.locator('#playPause').click()
            t1=await page.evaluate('window.__film.state.time')
            await page.wait_for_timeout(180)
            assert abs((await page.evaluate('window.__film.state.time'))-t1)<.005
            await page.locator('#sound').click()
            assert await page.evaluate('window.__film.soundtrack.muted')
            print('CHECKPOINT',len(report['checks']),flush=True);report['checks'].append('Play/pause, audio-clock advancement, pause stability and mute using synthetic test fixture only')
            # A short real MediaRecorder run; the fixture is discarded rather than distributed.
            await page.locator('#creditsButton').click()
            async with page.expect_download(timeout=30000) as download_info:
                await page.locator('#recordFilm').click()
                await page.wait_for_timeout(500)
                await page.evaluate('window.__film.seek(85.95,{resume:true})')
            download=await download_info.value
            path=await download.path()
            report['captureBytes']=Path(path).stat().st_size
            assert report['captureBytes']>1000
            await download.delete()
            print('CHECKPOINT',len(report['checks']),flush=True);report['checks'].append('Browser MediaRecorder produced a nonempty video/audio container; test fixture recording discarded')
            await page.set_viewport_size({'width':450,'height':800})
            await page.evaluate('window.__film.renderer.resize()')
            await page.evaluate('window.__film.frame(82.5,{quality:"balanced"})')
            await page.screenshot(path=str(OUT/'09-portrait.png'))
            assert await page.evaluate('document.body.scrollWidth <= innerWidth')
            print('CHECKPOINT',len(report['checks']),flush=True);report['checks'].append('Portrait camera/type layout and no horizontal page overflow')
            report['errors']+=await page.evaluate('window.__film.state.errors')
            assert not report['errors'],report['errors']
            report['adapter']=await page.evaluate('window.__film.renderer.adapterInfo')
        finally:
            await browser.close()
    (ROOT/'tests'/'browser-results.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__=='__main__':
    asyncio.run(asyncio.wait_for(main(),timeout=110))
