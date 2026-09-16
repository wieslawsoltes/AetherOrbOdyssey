import {FilmRenderer} from './renderer.js';
import {CompatibilityRenderer} from './compatibility.js';
import {Soundtrack,MUSIC} from './audio.js?v=ios-audio-2';
import {LocalFilmRecorder} from './export.js';
import {sampleFilm,SHOTS,DURATION,ease,clamp} from './director.js';

const $=s=>document.querySelector(s);
const stage=$('#stage'),world=$('#world'),params=new URLSearchParams(location.search);
const initialQuality=params.get('quality')||'balanced';
const RendererType=navigator.gpu&&!params.has('compat')?FilmRenderer:CompatibilityRenderer;
const renderer=new RendererType(world,{quality:initialQuality});
const soundtrack=new Soundtrack();
const recorder=new LocalFilmRecorder(renderer,soundtrack);
let running=false,started=false,ended=false,manualTime=0,busy=false,pendingFrame=null,lastTitle=null,hideTimer,recording=false;
let scrubWasRunning=false,creditsWasRunning=false,startRequest=0;
const format=t=>`${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`;
const timeNow=()=>running?Math.min(soundtrack.time,DURATION):manualTime;

function revealControls(){document.body.classList.remove('idle');clearTimeout(hideTimer);if(running)hideTimer=setTimeout(()=>{if($('#credits').open||!$('#chapters').hidden)return;document.body.classList.add('idle');},2600);}
function transport(t){
 $('#scrub').value=t;$('#scrub').style.setProperty('--progress',`${100*t/DURATION}%`);
 $('#timecode').innerHTML=`${format(t)} <i>/</i> 01:26`;
 $('#playPause').textContent=running?'Ⅱ':'▶';$('#playPause').setAttribute('aria-label',running?'Pause':'Play');
}
function titleFrame(f){
 const t=f.title;$('#filmType').hidden=!started||!t;
 if(!started||!t){lastTitle=null;return;}
 const el=$('#filmType');el.dataset.align=t.align;el.dataset.size=t.size;
 if(t!==lastTitle){
  $('#kicker').textContent=t.kicker;$('#subtitle').textContent=t.sub;$('#projectLink').hidden=!t.cta;
  $('#titleLines').replaceChildren(...t.lines.map(line=>{const outer=document.createElement('span');outer.className='line';const inner=document.createElement('span');inner.textContent=line;outer.append(inner);return outer;}));lastTitle=t;
 }
 el.style.opacity=f.titleOpacity;
 const lines=$('#titleLines').children;
 for(let i=0;i<lines.length;i++){
  const p=ease(clamp(f.titleProgress-i*.07));const span=lines[i].firstChild;
  span.style.transform=`translateY(${(1-p)*105}%)`;span.style.opacity=p;
 }
 $('#kicker').style.opacity=ease(f.titleProgress*1.6);
 $('#subtitle').style.opacity=ease(clamp(f.titleProgress*1.8-.6));
}
async function paint(time,{force=false,poster=false}={}){
 if(!renderer.ready)return;
 if(busy&&!force){pendingFrame={time,poster};return;}
 if(busy&&force){await renderer.device.queue.onSubmittedWorkDone();}
 busy=true;
 try {
  const rect=world.getBoundingClientRect();const f=sampleFilm(time,rect.width/rect.height);
  await renderer.render(f,{audioEnergy:soundtrack.energyAt(time),wait:true});
  titleFrame(f);
  const slug=`${String(SHOTS.indexOf(f.shot)+1).padStart(2,'0')} / ${f.shot.name.toUpperCase()}`;
  $('#chapterSlug').textContent=started?slug:'';
  $('#assembly-labels').style.opacity=started&&f.shot.name==='Architecture'?ease((time-59)/1.5)*ease((68.4-time)/.8)*.8:0;
  if(!poster)transport(ended?DURATION:time);
  if(recording)recorder.frame(time);
 } finally{busy=false;}
 if(pendingFrame&&!force){const next=pendingFrame;pendingFrame=null;queueMicrotask(()=>paint(next.time,{poster:next.poster}));}
}
function fatal(error){running=false;soundtrack.pause();document.body.classList.remove('playing');$('#fatal').hidden=false;$('#fatalText').textContent=error?.message||String(error);$('#loadStatus').textContent='Renderer unavailable';console.error(error);}
function updateSoundControl(){
 const available=!!soundtrack.buffer&&!soundtrack.silent;
 const blocked=soundtrack.context&&soundtrack.context.state!=='running';
 const enabled=available&&!soundtrack.muted&&!blocked;
 $('#soundLabel').textContent=soundtrack.silent?'Enable sound':soundtrack.muted?'Muted':blocked?'Resume sound':available?'Sound on':'Enable sound';
 $('#sound').setAttribute('aria-pressed',String(enabled));
 $('#sound').title=enabled?'Mute (M)':'Enable or resume sound (M)';
 document.body.classList.toggle('muted',!enabled);
}
function audioError(error){
 if(error?.name==='AbortError')return;
 pause();$('#audioErrorText').textContent=error.message||String(error);$('#audioError').hidden=false;
 $('#start').disabled=false;$('#startLabel').textContent='Watch the film';
 updateSoundControl();revealControls();
}
async function start({silent=false,from=0,skipLoad=false}={}){
 if(!renderer.ready)return;
 const request=++startRequest;
 // unlock runs synchronously in the tap handler before the first await.
 const activation=silent?Promise.resolve():soundtrack.unlock();
 pause();$('#start').disabled=true;$('#audioError').hidden=true;
 try{
  await activation;
  if(!silent&&!skipLoad)await soundtrack.load();
  if(request!==startRequest||document.hidden)return;
  soundtrack.silent=silent;
  manualTime=clamp(from,0,DURATION);
  const playing=await soundtrack.play(manualTime);
  if(request!==startRequest||document.hidden){soundtrack.pause();return;}
  if(!playing)return;
  started=true;ended=false;running=true;
  $('#gate').hidden=true;$('#filmType').hidden=false;
  document.body.classList.add('playing');revealControls();updateSoundControl();
  $('#loadStatus').textContent=silent?'Silent preview':'Orchestra ready';
 }catch(error){if(request===startRequest)audioError(error);}
 finally{if(request===startRequest){$('#start').disabled=false;$('#startLabel').textContent='Watch the film';}}
}
function pause(){
 if(running)manualTime=clamp(soundtrack.time,0,DURATION);
 soundtrack.pause();running=false;
 document.body.classList.remove('playing','idle');transport(manualTime);
}
async function toggle(){
 if(running){++startRequest;pause();return;}
 if(!started||ended){await start({silent:soundtrack.silent,from:0});return;}
 if(!soundtrack.buffer&&!soundtrack.silent){await start({from:manualTime});return;}
 try{
  if(await soundtrack.play(manualTime)){running=true;document.body.classList.add('playing');revealControls();}
 }catch(error){audioError(error);}
}
async function seek(time,{resume=false}={}){
 // Preserve the trusted gesture even when painting the seek frame is asynchronous.
 const activation=resume&&!soundtrack.silent?soundtrack.unlock():Promise.resolve();
 pause();started=true;ended=false;$('#gate').hidden=true;manualTime=clamp(time,0,DURATION);soundtrack.offset=manualTime;
 try{
  await activation;await paint(manualTime,{force:true});
  if(resume&&!soundtrack.buffer&&!soundtrack.silent){await start({from:manualTime});return;}
  if(resume&&await soundtrack.play(manualTime)){running=true;document.body.classList.add('playing');revealControls();}
 }catch(error){audioError(error);}
}
async function enableSound(){
 if(!soundtrack.buffer||soundtrack.silent||soundtrack.context?.state!=='running'){
  soundtrack.setMuted(false);await start({from:ended?0:timeNow()});return;
 }
 try{
  const activation=soundtrack.muted?soundtrack.unlock():Promise.resolve();
  soundtrack.setMuted(!soundtrack.muted);await activation;updateSoundControl();
 }catch(error){audioError(error);}
}
async function tick(){
 try {
  if(running&&!busy){
   const t=timeNow();await paint(t);
   if(t>=DURATION){
    pause();manualTime=DURATION;ended=true;
    if(recording){recording=false;document.body.classList.remove('recording');await recorder.stop();$('#recordStatus').textContent='Recording saved.';}
    await paint(84.7);transport(DURATION);
   }
  }
 }catch(e){fatal(e);}
 requestAnimationFrame(tick);
}
async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await stage.requestFullscreen();}catch(e){$('#loadStatus').textContent=e.message;}}
function updateDiagnostics(){
 $('#diagnostics').textContent=JSON.stringify({renderer:renderer.backend||'Native WebGPU / WGSL',resolution:`${renderer.width} × ${renderer.height}`,quality:renderer.quality,completedFrames:renderer.frames,submissionAndCompletionMs:Math.round(renderer.gpuMs*10)/10,shaderErrors:renderer.errors,adapter:renderer.adapterInfo,music:soundtrack.buffer?`${soundtrack.buffer.duration.toFixed(2)} s / ${soundtrack.buffer.sampleRate} Hz`:'Not yet loaded',audio:soundtrack.diagnostics,recording:recording},null,2);
}
$('#start').addEventListener('click',()=>start());$('#playPause').addEventListener('click',toggle);
$('#restart').addEventListener('click',()=>start({silent:soundtrack.silent}));
$('#sound').addEventListener('click',enableSound);
$('#fullscreen').addEventListener('click',fullscreen);
$('#quality').value=renderer.quality;
$('#quality').addEventListener('change',async()=>{if(recording)return;await renderer.device.queue.onSubmittedWorkDone();renderer.setQuality($('#quality').value);await paint(started?(ended?84.7:timeNow()):82.0,{force:true,poster:!started});});
$('#chaptersButton').addEventListener('click',()=>{$('#chapters').hidden=!$('#chapters').hidden;$('#chaptersButton').setAttribute('aria-expanded',String(!$('#chapters').hidden));revealControls();});
SHOTS.forEach((shot,i)=>{
 const b=document.createElement('button');b.innerHTML=`<span>${String(i+1).padStart(2,'0')}</span>${shot.name}<i>${format(shot.start)}</i>`;
 b.addEventListener('click',async()=>{$('#chapters').hidden=true;$('#chaptersButton').setAttribute('aria-expanded','false');await seek(shot.start+.60);});$('#chapters').append(b);
 if(i>0){const mark=document.createElement('i');mark.style.left=`${shot.start/DURATION*100}%`;$('#chapterMarks').append(mark);}
});
$('#scrub').addEventListener('pointerdown',()=>{scrubWasRunning=running;pause();});
$('#scrub').addEventListener('input',()=>{started=true;$('#gate').hidden=true;ended=false;manualTime=Number($('#scrub').value);soundtrack.offset=manualTime;paint(manualTime);});
$('#scrub').addEventListener('change',()=>{const resume=scrubWasRunning;scrubWasRunning=false;seek(Number($('#scrub').value),{resume});});
$('#creditsButton').addEventListener('click',()=>{creditsWasRunning=running;pause();updateDiagnostics();$('#credits').showModal();});
$('#credits').addEventListener('close',()=>{if(creditsWasRunning&&!recording){creditsWasRunning=false;toggle();}});
$('#retryAudio').addEventListener('click',()=>{soundtrack.setMuted(false);start({from:ended?0:timeNow()});});
$('#silent').addEventListener('click',()=>start({silent:true,from:ended?0:timeNow()}));
$('#audioFile').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;try{await soundtrack.importFile(file);await start({skipLoad:true});}catch(error){audioError(error);}});
$('#recordFilm').addEventListener('click',async()=>{
 if(recording)return;
 try {
  await soundtrack.unlock();await soundtrack.load();pause();creditsWasRunning=false;$('#credits').close();
  await seek(0);const result=recorder.start();result.catch(error=>{recording=false;document.body.classList.remove('recording');$('#recordStatus').textContent=error.message;});
  recording=true;document.body.classList.add('recording');$('#recordStatus').textContent='Recording…';await start();
 }catch(e){$('#recordStatus').textContent=e.message;}
});
soundtrack.addEventListener('status',e=>$('#loadStatus').textContent=e.detail);
soundtrack.addEventListener('change',updateSoundControl);
soundtrack.addEventListener('interruption',()=>audioError(new Error('Audio was interrupted by iOS or another app. Tap “Enable sound” to continue from this scene.')));
soundtrack.addEventListener('ended',()=>{pause();if(manualTime<DURATION-.25)audioError(new Error('The selected recording has ended. Replay or choose a longer recording.'));});
$('#testSound').addEventListener('play',()=>{pause();});
$('#credits').addEventListener('close',()=>$('#testSound').pause());
renderer.addEventListener('lost',e=>fatal(e.detail));renderer.addEventListener('error',e=>fatal(e.detail));
window.addEventListener('pointermove',revealControls,{passive:true});window.addEventListener('pointerdown',revealControls,{passive:true});
window.addEventListener('keydown',async e=>{
 if(e.target.matches('input,select,textarea')||$('#credits').open)return;
 if(['Space','ArrowLeft','ArrowRight','KeyR','KeyM','KeyF','KeyC'].includes(e.code))e.preventDefault();
 switch(e.code){case'Space':await toggle();break;case'ArrowLeft':await seek(timeNow()-5,{resume:running});break;case'ArrowRight':await seek(timeNow()+5,{resume:running});break;case'KeyR':await start({silent:soundtrack.silent});break;case'KeyM':$('#sound').click();break;case'KeyF':await fullscreen();break;case'KeyC':$('#creditsButton').click();break;}
 revealControls();
});
document.addEventListener('visibilitychange',()=>{if(document.hidden){++startRequest;pause();$('#start').disabled=false;}updateSoundControl();});
let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(async()=>{if(!renderer.ready||recording)return;await renderer.device.queue.onSubmittedWorkDone();renderer.resize();if(!running)await paint(started?(ended?84.7:manualTime):82,{poster:!started});},120);});

const ready=(async()=>{
 try {
  await renderer.init();await document.fonts.ready;
  $('#backend').textContent=renderer.backend?'WEBGL2 COMPATIBILITY':'NATIVE WEBGPU';
  if(params.has('capture'))document.body.classList.add('capture-mode');
  if(params.has('time')){started=true;$('#gate').hidden=true;manualTime=clamp(Number(params.get('time')),0,DURATION);await paint(manualTime,{force:true});}
  else await paint(82.0,{force:true,poster:true});
  $('#start').disabled=false;$('#startLabel').textContent='Watch the film';$('#loadStatus').textContent='Headphones recommended. Sound starts with playback.';
  requestAnimationFrame(tick);return true;
 }catch(e){fatal(e);return false;}
})();
updateSoundControl();
// Public deterministic capture interface. It deliberately does not auto-play sound.
window.__film={
 ready,renderer,soundtrack,get state(){return {running,started,ended,time:timeNow(),errors:renderer.errors};},
 async frame(time,{width=0,height=0,quality=null,clean=true}={}){
  if(!await ready)throw new Error('Renderer initialization failed.');pause();pendingFrame=null;started=true;ended=false;manualTime=clamp(time,0,DURATION);$('#gate').hidden=true;
  if(clean)document.body.classList.add('capture-mode');else document.body.classList.remove('capture-mode');
  if(quality)renderer.setQuality(quality);if(width&&height)renderer.resize(true,width,height);
  await paint(manualTime,{force:true});return {time:manualTime,width:renderer.width,height:renderer.height,errors:renderer.errors};
 },play:()=>start(),playSilent:()=>start({silent:true}),pause,seek,
 async png(time,opts={}){await this.frame(time,opts);return world.toDataURL('image/png');},
 music:MUSIC,duration:DURATION,shots:SHOTS
};
