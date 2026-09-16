import {sampleFilm,ease,clamp,DURATION} from './director.js';

// Prefer the lower-complexity WebM encoder for real-time Chrome capture. A support
// hint is not a guarantee: construction/start failures must try the next encoder.
export const RECORDING_TYPES=Object.freeze([
 'video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus',
 'video/mp4;codecs=avc1.42001E,mp4a.40.2','video/mp4','video/webm',''
]);
export function recordingSize(width,height){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<2||height<2)throw new Error('The renderer has no recordable frame.');
 const portrait=height>width,scale=Math.min(1,(portrait?1080:1920)/width,(portrait?1920:1080)/height);
 return {width:Math.max(2,Math.floor(width*scale/2)*2),height:Math.max(2,Math.floor(height*scale/2)*2)};
}
export function createVideoRecorder(stream,{Recorder=globalThis.MediaRecorder,onCandidate=()=>{}}={}){
 if(!Recorder)throw new Error('This browser does not provide MediaRecorder.');
 const errors=[];
 for(const mimeType of RECORDING_TYPES){
  if(mimeType&&!Recorder.isTypeSupported(mimeType))continue;
  let candidate;
  try{
   const options=mimeType?{mimeType,videoBitsPerSecond:8_000_000,audioBitsPerSecond:192_000}:{};
   candidate=new Recorder(stream,options);onCandidate(candidate);candidate.start(500);return candidate;
  }catch(error){
   errors.push(`${mimeType||'default'}: ${error.message}`);
   if(candidate){candidate.ondataavailable=candidate.onstop=candidate.onerror=candidate.onstart=null;
    try{if(candidate.state!=='inactive')candidate.stop();}catch{}}
  }
 }
 throw new Error('No video encoder could start. '+errors.join(' | '));
}

/** Owns capture tracks, not the original soundtrack track. No screen/mic permissions. */
export class LocalFilmRecorder extends EventTarget {
 constructor(renderer,sound,{startupTimeout=8000,stopTimeout=10000}={}){
  super();this.renderer=renderer;this.sound=sound;this.state='idle';this.active=false;
  this.startupTimeout=startupTimeout;this.stopTimeout=stopTimeout;this.frames=0;
  this.bytes=0;this.result=null;this.lastError=null;this.lastFrameTime=-Infinity;
 }
 changed(){this.dispatchEvent(new Event('change'));}
 get diagnostics(){return {state:this.state,mime:this.mime||null,frames:this.frames,bytes:this.bytes,
  width:this.canvas?.width||0,height:this.canvas?.height||0,lastError:this.lastError,
  capture:this.renderer.requiresReadback?'WebGPU same-submission readback':'preserved canvas'};}
 start(){
  if(this.active||this.state==='stopping')throw new Error('A recording is already in progress.');
  if(!globalThis.MediaRecorder||!globalThis.HTMLCanvasElement?.prototype.captureStream)throw new Error('Canvas recording is unavailable in this browser.');
  const audio=this.sound.destination?.stream.getAudioTracks().filter(t=>t.readyState==='live')||[];
  if(!audio.length||!this.sound.buffer||this.sound.silent)throw new Error('Load and enable the orchestra before recording.');
  this.clearResult();this.chunks=[];this.frames=0;this.bytes=0;this.lastFrameTime=-Infinity;
  this.lastError=null;this._settled=false;this._started=false;this.state='starting';
  this.canvas=document.createElement('canvas');Object.assign(this.canvas,recordingSize(this.renderer.width,this.renderer.height));
  this.ctx=this.canvas.getContext('2d',{alpha:false});
  if(!this.ctx)throw new Error('Cannot create the recording compositor.');
  this.ctx.fillStyle='#04060b';this.ctx.fillRect(0,0,this.canvas.width,this.canvas.height);
  this.done=new Promise((resolve,reject)=>{this._resolve=resolve;this._reject=reject;});
  this.ready=new Promise((resolve,reject)=>{this._ready=resolve;this._notReady=reject;});
  // Consumers may await either promise first; keep failures observable without
  // creating a transient unhandled rejection on the other promise.
  this.done.catch(()=>{});this.ready.catch(()=>{});
  try{
   const manual=typeof globalThis.CanvasCaptureMediaStreamTrack?.prototype.requestFrame==='function';
   this.stream=this.canvas.captureStream(manual?0:30);
   this.videoTrack=this.stream.getVideoTracks()[0];
   if(!this.videoTrack)throw new Error('Canvas capture returned no video track.');
   for(const track of audio)this.stream.addTrack(track.clone());
   this.recorder=createVideoRecorder(this.stream,{onCandidate:r=>{
    r.onstart=()=>{if(this._settled)return;this._started=true;this.state='recording';
     this.mime=r.mimeType;clearTimeout(this._startTimer);this._ready();this.changed();};
    r.ondataavailable=e=>{if(!this._settled&&e.data?.size){this.chunks.push(e.data);this.bytes+=e.data.size;this.changed();}};
    r.onstop=()=>this._complete();
    r.onerror=e=>this.fail(e.error||new Error('The video encoder failed. Try Preview quality and record again.'));
   }});
   this.mime=this.recorder.mimeType;this.active=true;
   this._startTimer=setTimeout(()=>this.fail(new Error('The video encoder did not start. Try Preview quality.')),this.startupTimeout);
   this.changed();return this.done;
  }catch(error){this.fail(error);return this.done;}
 }
 needsFrame(time){return this.active&&this.state!=='paused'&&this.state!=='stopping'&&(time-this.lastFrameTime>=1/30-.001||time<this.lastFrameTime);}
 frame(time,image=null){
  if(!this.active||this.state==='paused'||this.state==='stopping')return;
  const {ctx,canvas}=this,w=canvas.width,h=canvas.height;
  ctx.globalAlpha=1;
  if(this.renderer.requiresReadback){
   if(!image)throw new Error('WebGPU did not return a captured frame.');
   if(!this.readbackCanvas)this.readbackCanvas=document.createElement('canvas');
   const c=this.readbackCanvas;
   if(c.width!==image.width)c.width=image.width;
   if(c.height!==image.height)c.height=image.height;
   c.getContext('2d').putImageData(image,0,0);ctx.drawImage(c,0,0,w,h);
  }else{ctx.drawImage(this.renderer.canvas,0,0,w,h);}
  this.drawTitles(time,sampleFilm(time,w/h));
  this.videoTrack?.requestFrame?.(); // After the complete frame, even without titles.
  this.frames++;this.lastFrameTime=time;
  this.changed();
 }
 drawTitles(time,f){
  const {ctx,canvas}=this,w=canvas.width,h=canvas.height;
  const title=f.title;if(title){
  const center=title.align.startsWith('center');const x=center?w*.5:w*.08;const y=title.align==='center-top'?h*.07:title.align==='center'?h*.36:(w/h<1.25?h*.12:h*.29);
  const base=title.align==='center-top'?w*.058:title.size==='hero'?w*.08:title.size==='medium'?w*.044:title.size==='quiet'?w*.044:w*.052;
  const fs=w/h<1.25?(title.size==='hero'?w*.14:w*.09):base;
  ctx.textAlign=center?'center':'left';ctx.textBaseline='top';ctx.globalAlpha=f.titleOpacity;
  ctx.fillStyle='#bdc4d4';ctx.font=`500 ${Math.max(9,w*.0055)}px Arial`;ctx.fillText(title.kicker,x,y);
  ctx.fillStyle='#eeeff3';ctx.font=`${title.size==='hero'?'200':'300'} ${fs}px "Helvetica Neue", Arial`;
  for(let i=0;i<title.lines.length;i++){
   const p=ease(clamp(f.titleProgress-i*.07));ctx.globalAlpha=f.titleOpacity*p;
   ctx.fillText(title.lines[i],x,y+h*.043+i*fs*1.06+(1-p)*fs*.45);
  }
  ctx.globalAlpha=f.titleOpacity;ctx.fillStyle='#a9b5cb';ctx.font=`300 ${title.size==='hero'?w*.015:Math.max(9,w*.009)}px Arial`;
  let sy=y+h*.043+title.lines.length*fs*1.06+h*.027;
  ctx.fillText(title.sub,x,sy);
  if(title.cta){ctx.font=`400 ${Math.max(11,w*.009)}px Arial`;ctx.fillStyle='#dce5f5';ctx.fillText('Explore CrystalBall  ↗',x,sy+h*.065);}
  }
  if(time>79){ctx.textAlign='center';ctx.fillStyle='#a5afc1';ctx.font=`400 ${Math.max(9,w*.006)}px Arial`;ctx.fillText(this.sound.imported?'Concept film · User-supplied audio: '+this.sound.importedName:'Music: Richard Strauss / Kevin MacLeod · incompetech.com · creativecommons.org/licenses/by/3.0/',w*.5,h*.951);}
  ctx.globalAlpha=1; }
 pause(){if(this.active&&this.recorder?.state==='recording'){this.recorder.pause();this.state='paused';this.changed();}}
 resume(){if(this.active&&this.recorder?.state==='paused'){this.recorder.resume();this.state='recording';this.changed();}}
 stop(){
  if(this.state==='stopping'||this._settled)return this.done||Promise.resolve(this.result?.blob);
  if(!this.recorder)return Promise.resolve(null);
  this.active=false;this.state='stopping';clearTimeout(this._startTimer);this.changed();
  // The final dataavailable event precedes stop. Do not assemble/revoke early.
  this._stopTimer=setTimeout(()=>this.fail(new Error('The encoder could not finalize the video. Please retry.')),this.stopTimeout);
  try{if(this.recorder.state!=='inactive')this.recorder.stop();else this._complete();}catch(error){this.fail(error);}
  return this.done;
 }
 _complete(){
  if(this._settled)return;
  const mime=this.chunks.find(b=>b.type)?.type||this.mime||'video/webm';
  const blob=new Blob(this.chunks,{type:mime});
  if(!this.frames||blob.size<128){this.fail(new Error('The encoder returned no playable frames. No empty file was saved.'));return;}
  this._settled=true;this.active=false;this.state='ready';this.mime=mime;
  this._ready();this.cleanup();
  this.result={blob,url:URL.createObjectURL(blob),filename:`Aether-Orb-Odyssey.${mime.includes('mp4')?'mp4':'webm'}`,
   frames:this.frames,bytes:blob.size,width:this.canvas.width,height:this.canvas.height};
  this.chunks=[];this._resolve(blob);this.changed();
 }
 fail(error){
  if(this._settled)return;
  this._settled=true;this.active=false;this.state='error';this.lastError=error?.message||String(error);
  this._notReady?.(error);this._reject?.(error);this.cleanup();this.chunks=[];this.changed();
 }
 cleanup(){
  clearTimeout(this._startTimer);clearTimeout(this._stopTimer);
  const r=this.recorder;
  if(r){r.ondataavailable=r.onstop=r.onerror=r.onstart=null;try{if(r.state!=='inactive')r.stop();}catch{}}
  this.stream?.getTracks().forEach(t=>t.stop());this.videoTrack=null;
 }
 download(){
  if(!this.result)throw new Error('There is no completed recording to download.');
  const a=document.createElement('a');a.href=this.result.url;a.download=this.result.filename;
  a.hidden=true;document.body.append(a);a.click();a.remove();
  // URL remains valid for an explicit second click if the automatic download
  // was blocked. It is released only on a new recording or disposal.
 }
 clearResult(){if(this.result){URL.revokeObjectURL(this.result.url);this.result=null;}}
 dispose(){if(this.active||this.state==='stopping')this.fail(new Error('Recording disposed.'));this.cleanup();this.clearResult();}
}
