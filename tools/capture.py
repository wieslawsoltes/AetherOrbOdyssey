#!/usr/bin/env python3
"""Deterministic browser-frame capture, including the live film typography.
Requires: pip install playwright; playwright install chromium
The resulting frame sequence is independent of how long each frame takes to render.
No benchmark or real-time frame-rate claim is implied by an offline capture.
"""
from __future__ import annotations
import argparse
import asyncio
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
import shutil
import subprocess
import threading
from serve import Handler, ROOT

async def capture(args: argparse.Namespace) -> None:
    from playwright.async_api import async_playwright
    args.output.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    failures: list[str] = []
    try:
        async with async_playwright() as p:
            launch = {'headless': not args.visible, 'args': ['--enable-unsafe-webgpu']}
            if args.browser:
                launch['executable_path'] = args.browser
            browser = await p.chromium.launch(**launch)
            try:
                page = await browser.new_page(viewport={'width':args.width,'height':args.height},device_scale_factor=1)
                page.on('pageerror', lambda e: failures.append(str(e)))
                url=f'http://localhost:{server.server_port}/?capture=1&quality={args.quality}'
                if args.compat:
                    url += '&compat=1'
                await page.goto(url, wait_until='networkidle')
                await page.wait_for_function('window.__film !== undefined')
                if not await page.evaluate('window.__film.ready'):
                    raise RuntimeError(await page.locator('#fatalText').inner_text())
                end=min(args.end,86.06)
                if end <= args.start:
                    raise ValueError('The end time must be later than the start time.')
                frames=round((end-args.start)*args.fps)
                for index in range(frames):
                    t=args.start+index/args.fps
                    result=await page.evaluate('(a)=>window.__film.frame(a.time,{width:a.width,height:a.height,quality:null})',
                        {'time':t,'width':args.width,'height':args.height})
                    if result['errors'] or failures:
                        raise RuntimeError('\n'.join(result['errors']+failures))
                    await page.screenshot(path=str(args.output/f'{index:06d}.png'))
                    if index%args.fps==0:
                        print(f'{index+1}/{frames}: {t:.3f}s',flush=True)
                print(f'Captured {frames} frames using '+await page.evaluate("window.__film.renderer.backend||'Native WebGPU'"))
            finally:
                await browser.close()
    finally:
        server.shutdown()
        server.server_close()
    if args.mp4:
        if not shutil.which('ffmpeg'):
            raise RuntimeError('Frames captured; ffmpeg was not found for MP4 encoding.')
        command=['ffmpeg','-y','-framerate',str(args.fps),'-i',str(args.output/'%06d.png')]
        score=ROOT/'assets'/'zarathustra.ogg'
        if score.exists():
            command+=['-ss',str(args.start),'-i',str(score),'-map','0:v:0','-map','1:a:0','-c:a','aac','-b:a','192k','-af','volume=0.75']
        else:
            print('Score is absent: MP4 will be silent. Run tools/fetch_music.py to include music.')
        command+=['-t',str(end-args.start),'-c:v','libx264','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',str(args.mp4)]
        subprocess.run(command,check=True)
        credit=ROOT/'NOTICE.md'
        shutil.copyfile(credit,args.mp4.with_suffix('.credits.md'))
        print('Saved MP4 and accompanying music credits.')

def main() -> None:
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--width',type=int,default=1920);p.add_argument('--height',type=int,default=1080)
    p.add_argument('--fps',type=int,default=30);p.add_argument('--start',type=float,default=0);p.add_argument('--end',type=float,default=86.06)
    p.add_argument('--quality',choices=['preview','balanced','cinema','ultra'],default='cinema')
    p.add_argument('--output',type=Path,default=ROOT/'capture'/'frames');p.add_argument('--mp4',type=Path)
    p.add_argument('--browser',help='Optional absolute Chromium executable path')
    p.add_argument('--visible',action='store_true');p.add_argument('--compat',action='store_true',help='Use the explicitly labelled WebGL2 backend')
    a=p.parse_args()
    if a.width<2 or a.height<2 or not 1<=a.fps<=120 or a.start<0:
        p.error('Use positive dimensions, 1–120 fps and a nonnegative start time.')
    asyncio.run(capture(a))
if __name__=='__main__':
    main()
