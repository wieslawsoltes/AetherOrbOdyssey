#!/usr/bin/env python3
"""Actual renderer tests, deterministic stills, bounded resource checks and optional A/B.
No physical-device/performance claim is inferred from a hosted runner result.
"""
from __future__ import annotations
import argparse,asyncio,functools,json,platform,statistics,threading
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
from playwright.async_api import async_playwright
class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass

def serve(root):
    s=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(root)))
    threading.Thread(target=s.serve_forever,daemon=True).start()
    return s,f'http://127.0.0.1:{s.server_port}'

async def benchmark(page):
    return await page.evaluate('''async()=>{
      const {sampleFilm}=await import('./src/director.js');const r=__film.renderer;
      __film.pause();r.resize(true,960,540);const rows=[];
      for(const t of [6,20,29,40,51,62,74,82]){
        const times=[];for(let i=0;i<15;i++){
          const a=performance.now();await r.render(sampleFilm(t+i/60,16/9),{wait:true,adaptive:false});
          if(i>=5)times.push(performance.now()-a);
        }
        times.sort((a,b)=>a-b);rows.push({time:t,medianCompletionMs:times[5],p90CompletionMs:times[8]});
      }
      return {rows,diagnostics:r.diagnostics||{output:[r.width,r.height],internal:[r.width,r.height],quality:r.quality}};
    }''')

async def run(args):
    out=args.output.resolve();out.mkdir(parents=True,exist_ok=True)
    server,origin=serve(args.root.resolve());baseline_server=None
    report={'os':platform.platform(),'physicalUserDeviceTest':False,'checks':[],'errors':[],'status':'running'}
    try:
      async with async_playwright() as p:
        kwargs={'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage']}
        if args.chrome:kwargs['channel']='chrome'
        if args.executable:kwargs['executable_path']=args.executable
        b=await p.chromium.launch(**kwargs);report['browser']=b.version
        page=await b.new_page(viewport={'width':960,'height':540})
        page.on('pageerror',lambda e:report['errors'].append(str(e)))
        try:
          await page.goto(origin+'/?quality=balanced&fixed=1')
          await page.wait_for_function('window.__film',timeout=60000)
          assert await page.evaluate('__film.ready'),await page.locator('#fatalText').inner_text()
          assert await page.locator('#backend').inner_text()=='NATIVE WEBGPU'
          report['adapter']=await page.evaluate('__film.renderer.adapterInfo')
          for time in [6,20,29,40,51,62,74,82]:
            await page.evaluate('t=>__film.frame(t,{width:960,height:540,clean:true})',time)
            await page.screenshot(path=str(out/f'cinematic-{time:02}.png'))
          report['checks'].append('All eight camera shots render through actual WebGPU shaders')
          # Readback tests prove actual film pixels, not just a successful present call.
          report['looks']=await page.evaluate('''async()=>{
            const {sampleFilm}=await import('./src/director.js');const r=__film.renderer;const result=[];
            for(const look of ['clean','cinematic','odyssey']){
              r.setLook(look);const im=await r.render(sampleFilm(40,16/9),{wait:true,capture:true});
              let sum=0,lit=0;for(let i=0;i<im.data.length;i+=4){sum+=im.data[i]+im.data[i+1]+im.data[i+2];if(im.data[i]+im.data[i+1]+im.data[i+2]>20)lit++;}
              result.push({look,sum,lit,pixels:im.width*im.height,passes:r.diagnostics.passes.length});
            }r.setLook('cinematic');return result;
          }''')
          assert all(r['lit']>r['pixels']*.02 for r in report['looks'])
          assert len({r['sum'] for r in report['looks']})==3
          report['checks'].append('Clean, Cinematic and Odyssey change nonblack captured pixels')
          for look in ['clean','odyssey']:
            await page.evaluate('l=>__film.renderer.setLook(l)',look)
            await page.evaluate('__film.frame(40,{clean:true})');await page.screenshot(path=str(out/f'look-{look}.png'))
          await page.evaluate('__film.renderer.setLook("cinematic")')
          before=await page.evaluate('__film.renderer.diagnostics')
          report['upgraded']=await benchmark(page)
          after=await page.evaluate('__film.renderer.diagnostics')
          assert before['targets']['created']==after['targets']['created'],(before,after)
          assert before['rebuilds']==after['rebuilds'],(before,after)
          assert len(after['passes'])==13
          report['checks'].append('Steady-state render reuses all target textures and bind groups; 13 logical passes at Balanced')
          await page.evaluate('__film.renderer.adaptiveEnabled=true;__film.renderer.adaptive.scale=.65;__film.playSilent()')
          await page.wait_for_timeout(450);await page.evaluate('__film.pause()')
          scaled=await page.evaluate('__film.renderer.diagnostics');assert scaled['internal'][0]<after['internal'][0]
          assert scaled['output']==after['output'];assert scaled['inFlight']<=2
          report['checks'].append('Adaptive rendering lowers internal extent, preserves output extent, bounds GPU backlog to two submissions')
          await page.evaluate('__film.frame(40,{width:540,height:960,clean:true})')
          await page.set_viewport_size({'width':540,'height':960})
          await page.evaluate('__film.frame(40,{width:540,height:960,clean:true})');await page.screenshot(path=str(out/'portrait.png'))
          report['checks'].append('Portrait rendering and forced deterministic capture remain functional')
          await page.set_viewport_size({'width':960,'height':540})
          # Reproducible single-file build must compile the same modular engine.
          inline=await b.new_page(viewport={'width':640,'height':360});inline.on('pageerror',lambda e:report['errors'].append(str(e)))
          await inline.goto(origin+'/Aether-Orb-Odyssey.html?fixed=1&quality=preview')
          await inline.wait_for_function('window.__film',timeout=60000)
          assert await inline.evaluate('__film.ready'),await inline.locator('#fatalText').inner_text()
          await inline.evaluate('__film.frame(74,{clean:true})');await inline.screenshot(path=str(out/'standalone.png'));await inline.close()
          report['checks'].append('Generated standalone edition compiles and renders the same cinematic stack')
          assert not await page.evaluate('__film.renderer.errors')
          if args.baseline:
            baseline_server,base_origin=serve(args.baseline.resolve());base=await b.new_page(viewport={'width':960,'height':540})
            await base.goto(base_origin+'/?quality=balanced');await base.wait_for_function('window.__film',timeout=60000)
            assert await base.evaluate('__film.ready'),await base.locator('#fatalText').inner_text()
            report['baseline']=await benchmark(base);await base.close()
            old=statistics.mean(r['medianCompletionMs'] for r in report['baseline']['rows'])
            new=statistics.mean(r['medianCompletionMs'] for r in report['upgraded']['rows'])
            report['comparison']={'baselineMeanOfShotMediansMs':old,'upgradedMeanOfShotMediansMs':new,'ratio':new/old,
                'scope':'Sequential completion-time samples at equal 960x540 output, Balanced presets. New renderer intentionally uses reduced internal resolution and different shader/effect budgets. Not an equal-workload microbenchmark or sustained FPS guarantee.'}
          assert not report['errors'],report['errors'];report['status']='passed'
        except BaseException:
          try:report['fatal']=await page.locator('#fatalText').inner_text();await page.screenshot(path=str(out/'failure.png'))
          except Exception:pass
          raise
        finally:await b.close()
    except Exception as e:report['status']='failed';report['failure']=str(e);raise
    finally:
      server.shutdown()
      if baseline_server:baseline_server.shutdown()
      (out/'cinema-results.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2),flush=True)
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--chrome',action='store_true');parser.add_argument('--executable');parser.add_argument('--baseline',type=Path)
    asyncio.run(run(parser.parse_args()))
