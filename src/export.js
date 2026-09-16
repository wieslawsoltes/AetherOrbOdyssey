import {sampleFilm,ease,clamp,DURATION} from './director.js';

/** Captures actual live WebGPU frames; no recording of browser chrome or external services. */
export class LocalFilmRecorder {
 constructor(renderer,sound){this.renderer=renderer;this.sound=sound;this.active=false;}
 start(){
  if(!window.MediaRecorder||!HTMLCanvasElement.prototype.captureStream)throw new Error('This browser does not support local canvas recording. Use the deterministic capture script instead.');
  this.canvas=document.createElement('canvas');this.canvas.width=this.renderer.width;this.canvas.height=this.renderer.height;
  this.ctx=this.canvas.getContext('2d',{alpha:false});
  this.stream=this.canvas.captureStream(30);
  for(const track of this.sound.destination.stream.getAudioTracks())this.stream.addTrack(track.clone());
  const mime=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/mp4','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));
  if(!mime)throw new Error('No supported video encoder.');
  this.chunks=[];this.mime=mime;
  this.recorder=new MediaRecorder(this.stream,{mimeType:mime,videoBitsPerSecond:14_000_000,audioBitsPerSecond:192_000});
  this.recorder.ondataavailable=e=>{if(e.data.size)this.chunks.push(e.data);};
  this.done=new Promise((resolve,reject)=>{this.recorder.onstop=()=>{
   const blob=new Blob(this.chunks,{type:mime});this.stream.getTracks().forEach(t=>t.stop());
   const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`Aether-Orb-Odyssey.${mime.includes('mp4')?'mp4':'webm'}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),30_000);resolve(blob);
  };this.recorder.onerror=e=>{this.active=false;reject(e.error||new Error('Recording failed.'));};});
  this.active=true;this.recorder.start(1000);return this.done;
 }
 frame(time){
  if(!this.active)return;const {ctx,canvas}=this;const w=canvas.width,h=canvas.height;const f=sampleFilm(time,w/h);
  ctx.globalAlpha=1;ctx.fillStyle='#04060b';ctx.fillRect(0,0,w,h);ctx.drawImage(this.renderer.canvas,0,0,w,h);
  const title=f.title;if(!title)return;
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
  if(time>79){ctx.textAlign='center';ctx.fillStyle='#a5afc1';ctx.font=`400 ${Math.max(9,w*.006)}px Arial`;ctx.fillText(this.sound.imported?'Concept film · User-supplied audio: '+this.sound.importedName:'Music: Richard Strauss / Kevin MacLeod · incompetech.com · creativecommons.org/licenses/by/3.0/',w*.5,h*.951);}
  ctx.globalAlpha=1;
 }
 stop(){if(this.active){this.active=false;this.recorder.stop();}return this.done;}
}
