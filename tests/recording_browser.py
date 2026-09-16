#!/usr/bin/env python3
"""Real encoder + real film tests; ffmpeg verifies pictures AND soundtrack.
--inline supports restricted local environments (compatibility renderer only).
Native WebGPU tests navigate an actual localhost origin; no renderer is stubbed.
"""
from __future__ import annotations
import argparse, asyncio, base64, functools, json, math, platform, shutil, struct, subprocess, threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.async_api import async_playwright

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        if self.path.startswith('/__capture_probe__'):
            b=b'<!doctype html><title>Capture environment probe</title>'
            self.send_response(200); self.send_header('Content-Type','text/html'); self.end_headers(); self.wfile.write(b)
        else: super().do_GET()

def inspect_video(path: Path):
    info=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-show_streams','-show_format','-of','json',str(path)]))
    video=next((s for s in info['streams'] if s['codec_type']=='video'),None)
    audio=next((s for s in info['streams'] if s['codec_type']=='audio'),None)
    assert video and audio,info
    assert video['width']%2==0 and video['height']%2==0,video
    assert int(video.get('nb_read_frames',0))>=2,video
    samples=subprocess.check_output(['ffmpeg','-v','error','-i',str(path),'-map','0:a:0','-ac','1','-ar','8000','-t','5','-f','f32le','-'])
    values=[x[0] for x in struct.iter_unpack('<f',samples)]
    rms=math.sqrt(sum(v*v for v in values)/max(1,len(values)))
    assert rms>0.00001,('No audible samples in encoded video',rms)
    pixels=subprocess.check_output(['ffmpeg','-v','error','-i',str(path),'-map','0:v:0','-vf','fps=4,scale=160:90','-frames:v','12','-f','rawvideo','-pix_fmt','rgb24','-'])
    stride=160*90*3;frames=[pixels[i:i+stride] for i in range(0,len(pixels)-stride+1,stride)]
    assert frames and max(max(f) for f in frames)>15,'Video contains only black frames'
    change=max((sum(abs(a-b) for a,b in zip(frames[0],f))/stride for f in frames[1:]),default=0)
    return {'videoCodec':video['codec_name'],'audioCodec':audio['codec_name'],
        'width':video['width'],'height':video['height'],'decodedFrames':int(video['nb_read_frames']),
        'audioRMS':rms,'maximumPixelChange':change,'bytes':path.stat().st_size}

async def run(args):
    root=args.root.resolve();out=args.output.resolve();out.mkdir(parents=True,exist_ok=True)
    report={'os':platform.platform(),'physicalMacTest':False,'nativeWebGPUValidated':False,'errors':[],'checks':[],'videos':[]}
    server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(root)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    origin=f'http://127.0.0.1:{server.server_port}'
    try:
      async with async_playwright() as p:
        launch={'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage']}
        if platform.system()=='Linux':
            launch['args']+=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-unsafe-webgpu','--use-webgpu-adapter=swiftshader']
        if args.executable:launch['executable_path']=args.executable
        elif args.chrome:launch['channel']='chrome'
        else:launch['channel']='chrome' if shutil.which('google-chrome') else 'chromium' # Full browser, not headless_shell.
        browser=await p.chromium.launch(**launch);report['browser']=browser.version
        report['browserProduct']='Google Chrome' if launch.get('channel')=='chrome' else 'Chromium'
        page=await browser.new_page(viewport={'width':960,'height':540},accept_downloads=True)
        page.on('pageerror',lambda e:report['errors'].append(str(e)))
        report['console']=[]
        page.on('console',lambda m:report['console'].append(m.type+': '+m.text) if m.type in ('warning','error') else None)
        try:
          native=False
          if not args.inline:
            if args.backend=='auto':
              await page.goto(origin+'/__capture_probe__')
              native=await page.evaluate('async()=>!!(await navigator.gpu?.requestAdapter())')
            else:native=args.backend=='webgpu'
            use_native=native and args.backend!='compat'
            await page.goto(origin+'/?quality=preview'+('' if use_native else '&compat=1'))
          else:
            use_native=False
            await page.set_content((root/'Aether-Orb-Odyssey.html').read_text(),wait_until='domcontentloaded')
          await page.wait_for_function('window.__film',timeout=60000)
          assert await page.evaluate('window.__film.ready'),await page.locator('#fatalText').inner_text()
          report['backend']=await page.locator('#backend').inner_text()
          if args.backend=='webgpu':assert report['backend']=='NATIVE WEBGPU','Native WebGPU is required; compatibility fallback is not a pass'
          if args.backend=='compat':assert report['backend']=='WEBGL2 COMPATIBILITY','Explicit compatibility capture was not selected'
          report['adapter']=await page.evaluate('window.__film.renderer.adapterInfo')
          assert not await page.evaluate('window.__film.state.running')
          if args.inline:
            encoded=base64.b64encode((root/'assets/zarathustra.mp3').read_bytes()).decode()
            await page.evaluate('''b64=>{const b=document.createElement('button');b.id='loadTestAudio';b.textContent='Load exact score';b.style='position:fixed;z-index:100;top:0';b.onclick=async()=>{const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));await window.__film.soundtrack.importFile(new File([bytes],'zarathustra.mp3',{type:'audio/mpeg'}));b.remove();};document.body.append(b);}''',encoded)
            await page.locator('#loadTestAudio').click();await page.wait_for_function('!!window.__film.soundtrack.buffer')
          await page.locator('#creditsButton').click();await page.locator('#recordFilm').click()
          await page.wait_for_function('window.__film.state.running && window.__film.recorder.frames>=3 && !window.__film.state.recordPreparing',timeout=60000)
          assert await page.locator('#recordStop').is_visible()
          assert await page.locator('#scrub').is_disabled()
          await page.locator('#playPause').click()
          assert await page.evaluate('window.__film.recorder.state')=='paused'
          clock=await page.evaluate('window.__film.state.time');await page.wait_for_timeout(180)
          assert abs((await page.evaluate('window.__film.state.time'))-clock)<0.01
          await page.locator('#playPause').click();await page.wait_for_timeout(3200)
          async with page.expect_download(timeout=25000) as dl:
            await page.locator('#recordStop').click()
          download=await dl.value;path=out/download.suggested_filename;await download.save_as(path)
          report['videos'].append(inspect_video(path));report['checks'].append('Real Record film UI; pause/resume; Stop & save; decoded video+audio')
          assert await page.locator('#recordDownload').is_visible()
          async with page.expect_download(timeout=15000) as dl:
            await page.locator('#recordDownload').click()
          await (await dl.value).save_as(out/'retry-download.webm')
          assert (out/'retry-download.webm').read_bytes()==path.read_bytes()
          report['checks'].append('Persistent explicit download is byte-identical and retryable')
          # The same production recording controller can capture a bounded scene.
          await page.evaluate('window.__film.record({from:19.5,to:22.7})')
          await page.wait_for_function('window.__film.recorder.state==="ready" || window.__film.recorder.state==="error"',timeout=45000)
          assert await page.evaluate('window.__film.recorder.state')=='ready',await page.locator('#recordProgress').inner_text()
          # Subsequent automatic downloads may need another gesture in Chrome.
          # Exercise the actual persistent download control, not browser bypass flags.
          async with page.expect_download(timeout=15000) as dl:
            await page.locator('#recordDownload').click()
          download=await dl.value;path=out/('glass-'+download.suggested_filename);await download.save_as(path)
          analysis=inspect_video(path);assert analysis['maximumPixelChange']>0.05,analysis
          report['videos'].append(analysis);report['checks'].append('Second capture: actual glass shot has changing nonblack pixels and nonzero encoded music')
          if use_native:report['nativeWebGPUValidated']=True
          # Exercise the natural full-film end, including audio-ended/rAF ordering.
          await page.evaluate('window.__film.record({from:84.0})')
          await page.wait_for_function('window.__film.recorder.state==="ready" || window.__film.recorder.state==="error"',timeout=30000)
          assert await page.evaluate('window.__film.recorder.state')=='ready',await page.locator('#recordProgress').inner_text()
          async with page.expect_download(timeout=15000) as dl:
            await page.locator('#recordDownload').click()
          download=await dl.value;await download.save_as(out/('ending-'+download.suggested_filename))
          assert await page.evaluate('window.__film.recorder.state')=='ready'
          assert not await page.evaluate('window.__film.state.recording')
          report['checks'].append('Natural film end finalizes the recording and releases controls')
          await page.evaluate('window.__film.record({from:39,to:44})')
          await page.wait_for_function('window.__film.recorder.frames>=2 && window.__film.recorder.state==="recording"')
          await page.evaluate('window.__film.recorder.recorder.dispatchEvent(new ErrorEvent("error",{error:new Error("Injected encoder failure")}))')
          await page.wait_for_function('window.__film.recorder.state==="error" && !window.__film.state.recording')
          assert 'Injected encoder failure' in await page.locator('#recordProgress').inner_text()
          assert not await page.locator('#recordFilm').is_disabled()
          report['checks'].append('Injected asynchronous encoder error is visible and releases recording controls')
          assert not report['errors'],report['errors']
          report['shaderErrors']=await page.evaluate('window.__film.renderer.errors');assert not report['shaderErrors']
          report['status']='passed'
        except BaseException:
          try:
            report['failureState']=await page.evaluate('({film:window.__film?.state,recorder:window.__film?.recorder?.diagnostics,audio:window.__film?.soundtrack?.diagnostics,progress:document.querySelector("#recordProgress")?.textContent,fatal:document.querySelector("#fatalText")?.textContent})')
            await page.screenshot(path=str(out/'failure.png'),timeout=5000)
          except Exception:pass
          raise
        finally:await browser.close()
    except Exception as error:
        report['status']='failed';report['failure']=str(error);raise
    finally:
        server.shutdown();(out/'recording-results.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--root',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True);parser.add_argument('--backend',choices=['auto','webgpu','compat'],default='auto')
    parser.add_argument('--inline',action='store_true');parser.add_argument('--chrome',action='store_true');parser.add_argument('--executable')
    asyncio.run(run(parser.parse_args()))
