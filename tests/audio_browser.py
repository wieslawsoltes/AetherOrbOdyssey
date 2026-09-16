#!/usr/bin/env python3
"""Decode and measure real audio in browser engines; no physical speaker claim.
Use --fixture only for local synthetic-fixture testing. CI uses the real staged score.
"""
from __future__ import annotations
import argparse
import asyncio
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import threading
from playwright.async_api import async_playwright

HARNESS = b'''<!doctype html><meta name="viewport" content="width=device-width">
<button id="play">Play orchestra</button><button id="pause">Pause</button>
<button id="resume">Resume</button><button id="mute">Mute</button><button id="unmute">Unmute</button>
<button id="native">Test native player</button><audio id="media" src="./assets/zarathustra.mp3"></audio>
<script type="module">
import {Soundtrack} from './src/audio.js';
const s=window.track=new Soundtrack();window.failure=null;
const run=fn=>async()=>{try{await fn();}catch(e){window.failure=e.message;}};
document.querySelector('#play').onclick=run(async()=>{
 await s.unlock();await s.load();
 let index=0;for(let i=1;i<Math.min(s.energy.length-30,60*s.energyHz);i++)if(s.energy[i]>s.energy[index])index=i;
 window.position=Math.max(0,index/s.energyHz-.1);
 const a=window.meter=s.context.createAnalyser();a.fftSize=1024;
 const sink=s.context.createGain();sink.gain.value=0;s.gain.connect(a);a.connect(sink);sink.connect(s.context.destination);
 window.rms=()=>{const v=new Float32Array(a.fftSize);a.getFloatTimeDomainData(v);return Math.sqrt(v.reduce((sum,x)=>sum+x*x,0)/v.length);};
 await s.play(window.position);
});
document.querySelector('#pause').onclick=()=>s.pause();
document.querySelector('#resume').onclick=run(()=>s.play(s.offset));
document.querySelector('#mute').onclick=()=>s.setMuted(true);
document.querySelector('#unmute').onclick=run(async()=>{const p=s.unlock();s.setMuted(false);await p;});
document.querySelector('#native').onclick=run(()=>{s.pause();return document.querySelector('#media').play();});
</script>'''

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split('?')[0]=='/audio-check.html':
            self.send_response(200);self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write(HARNESS)
        else:super().do_GET()
    def log_message(self,*args):pass

async def check(root: Path, engines: list[str], report: Path, fixture: Path | None):
    server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(root)))
    worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
    result={'physicalIPhoneTested':False,'audio':'synthetic local fixture' if fixture else 'credited published MP3','engines':[]}
    try:
        async with async_playwright() as p:
            for name in engines:
                kwargs={'headless':True}
                if name=='chromium' and not os.environ.get('CI') and Path('/usr/bin/chromium').is_file():kwargs.update(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
                browser=await getattr(p,name).launch(**kwargs)
                try:
                    context=await browser.new_context(viewport={'width':390,'height':844},has_touch=True)
                    if fixture:
                        await context.route('**/assets/zarathustra.mp3',lambda route:route.fulfill(path=str(fixture),content_type='audio/mpeg'))
                    await context.route('https://**',lambda route:route.abort())
                    page=await context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
                    await page.goto(f'http://127.0.0.1:{server.server_port}/audio-check.html')
                    await page.wait_for_function('window.track !== undefined')
                    assert await page.evaluate('!track.playing && !track.context'), 'Unexpected autoplay/audio activation'
                    await page.locator('#play').click()
                    await page.wait_for_function('window.failure || (track.playing && track.time > window.position + .15)',timeout=60000)
                    assert await page.evaluate('window.failure') is None,await page.evaluate('window.failure')
                    assert await page.evaluate('track.loadedUrl.endsWith(".mp3")')
                    await page.wait_for_function('window.rms && rms() > .00001',timeout=10000)
                    audible=await page.evaluate('rms()')
                    await page.locator('#mute').click();await page.wait_for_timeout(300)
                    muted=await page.evaluate('rms()');assert muted<audible*.01,(audible,muted)
                    await page.locator('#unmute').click();await page.wait_for_function('rms() > .00001')
                    await page.locator('#pause').click();position=await page.evaluate('track.time');await page.wait_for_timeout(150)
                    assert abs((await page.evaluate('track.time'))-position)<.001
                    await page.locator('#resume').click();await page.wait_for_function('track.playing')
                    await page.evaluate('track.context.suspend()');await page.wait_for_function('!track.playing')
                    position=await page.evaluate('track.time');await page.wait_for_timeout(150)
                    assert abs((await page.evaluate('track.time'))-position)<.001
                    await page.locator('#resume').click();await page.wait_for_function('track.playing && track.context.state === "running"')
                    await page.wait_for_function('rms() > .00001')
                    diagnostics=await page.evaluate('track.diagnostics')
                    await page.locator('#native').click()
                    await page.wait_for_function('document.querySelector("#media").currentTime > .1 || window.failure',timeout=15000)
                    assert await page.evaluate('window.failure') is None
                    assert not errors,errors
                    # Exercise the real application's audio UI without requiring a GPU.
                    # Only rendering is stubbed; transport, loading, decoding and controls are real.
                    stub="""export class FilmRenderer extends EventTarget {
                        constructor(){super();this.errors=[];this.frames=0;this.width=390;this.height=844;this.quality='preview';this.backend='audio UI test double';this.device={queue:{onSubmittedWorkDone:async()=>{}}};}
                        async init(){this.ready=true;}async render(){this.frames++;}resize(){}setQuality(q){this.quality=q;}
                    }export {FilmRenderer as CompatibilityRenderer};"""
                    await context.route('**/src/renderer.js*',lambda route:route.fulfill(body=stub,content_type='text/javascript'))
                    await context.route('**/src/compatibility.js',lambda route:route.fulfill(body=stub,content_type='text/javascript'))
                    await page.close();page=await context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
                    await page.goto(f'http://127.0.0.1:{server.server_port}/index.html')
                    await page.wait_for_function('window.__film !== undefined')
                    assert await page.evaluate('__film.ready')
                    assert await page.locator('#soundLabel').inner_text()=='Enable sound'
                    await page.locator('#start').click()
                    await page.wait_for_function('__film.state.running',timeout=60000)
                    assert await page.locator('#soundLabel').inner_text()=='Sound on'
                    await page.evaluate('__film.soundtrack.context.suspend()')
                    await page.wait_for_function('!document.querySelector("#audioError").hidden')
                    assert not await page.evaluate('__film.state.running')
                    await page.locator('#retryAudio').click();await page.wait_for_function('__film.state.running')
                    assert await page.locator('#audioError').is_hidden()
                    await page.evaluate('__film.soundtrack.context.suspend()')
                    await page.wait_for_function('!document.querySelector("#audioError").hidden')
                    await page.locator('#silent').click();await page.wait_for_function('__film.state.running && __film.soundtrack.silent')
                    assert await page.locator('#soundLabel').inner_text()=='Enable sound'
                    await page.locator('#sound').click();await page.wait_for_function('__film.state.running && !__film.soundtrack.silent')
                    assert await page.evaluate('__film.soundtrack.context.state')=='running'
                    assert not errors,errors
                    result['engines'].append({'engine':name,'diagnostics':diagnostics,'nonzeroOutputRMS':audible,'mutedOutputRMS':muted,'checks':['no autoplay','MP3 decode','nonzero Web Audio samples','mute/unmute','pause clock stability','resume after suspension','native media element playback','real app recovery UI (renderer stub)','enable music during silent preview'],'errors':errors})
                finally:await browser.close()
    finally:server.shutdown();server.server_close();worker.join()
    report.parent.mkdir(parents=True,exist_ok=True);report.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--root',type=Path,required=True)
    parser.add_argument('--engines',default='chromium,webkit');parser.add_argument('--report',type=Path,required=True)
    parser.add_argument('--fixture',type=Path);args=parser.parse_args()
    asyncio.run(check(args.root.resolve(),args.engines.split(','),args.report,args.fixture))
