/** The licensed recording is the clock. Playback is explicitly user-initiated. */
export const MUSIC = Object.freeze({
 title:'Also Sprach Zarathustra — Einleitung',
 composer:'Richard Strauss',performer:'Kevin MacLeod',license:'CC BY 3.0',
 url:'https://upload.wikimedia.org/wikipedia/commons/0/0b/Also_Sprach_Zarathustra_-_Einleitung.ogg',
 source:'https://commons.wikimedia.org/wiki/File:Also_Sprach_Zarathustra_-_Einleitung.ogg',
 licenseUrl:'https://creativecommons.org/licenses/by/3.0/',
 sha1:'ab5a1863b4fead3069445bdbcfd0f62ecfd09481'
});

function audioDeadline(promise, milliseconds, message) {
 let timer;
 return Promise.race([promise,new Promise((_,reject)=>{
  timer=setTimeout(()=>reject(new Error(message)),milliseconds);
 })]).finally(()=>clearTimeout(timer));
}

export class Soundtrack extends EventTarget {
 constructor({resumeTimeout=5000}={}){
  super();this.offset=0;this.startedAt=0;this.playing=false;this.volume=.75;
  this.muted=false;this.silent=false;this.energy=[];this.energyHz=30;
  this.resumeTimeout=resumeTimeout;this.playRequest=0;this.lastError=null;
  this.source=null;this.loadedUrl=null;this.loadErrors=[];this.disposed=false;
 }
 status(message){this.dispatchEvent(new CustomEvent('status',{detail:message}));}
 async unlock() {
  if(this.disposed)throw new Error('The audio player has been disposed. Reload the page.');
  // Do this BEFORE constructing/resuming the context, in the original click stack.
  // AudioContext's default session is ambient, which iOS may silence with the ringer.
  try{if(globalThis.navigator?.audioSession)navigator.audioSession.type='playback';}catch{}
  if(!this.context||this.context.state==='closed'){
   const Context=globalThis.AudioContext||globalThis.webkitAudioContext;
   if(!Context)throw new Error('This browser has no Web Audio support. Open the film in Safari.');
   this.context=new Context({latencyHint:'playback'});
   this.gain=this.context.createGain();this.gain.gain.value=this.muted?0:this.volume;
   this.gain.connect(this.context.destination);
   this.destination=this.context.createMediaStreamDestination();this.gain.connect(this.destination);
   this.context.addEventListener('statechange',()=>{
    if(this.playing&&!this.silent&&this.context.state!=='running'){
     this.pause();this.dispatchEvent(new CustomEvent('interruption',{detail:this.context.state}));
    }
    this.dispatchEvent(new Event('change'));
   });
  }
  const context=this.context;
  if(context.state!=='running'){
   // resume() AND source.start() must execute before any await/network/animation work.
   // Handle WebKit's "interrupted" state as well as the standard "suspended" state.
   const resumed=context.resume();
   const prime=context.createBufferSource();prime.buffer=context.createBuffer(1,1,context.sampleRate);
   prime.connect(context.destination);prime.onended=()=>prime.disconnect();prime.start(0);
   try{
    await audioDeadline(resumed,this.resumeTimeout,'Audio is paused by the browser. Tap “Enable sound” to resume.');
   }catch(error){this.lastError=error.message;throw error;}
  }
  if(context.state!=='running'){
   this.lastError=`Audio is ${context.state}. Tap “Enable sound” after returning to the film.`;
   throw new Error(this.lastError);
  }
  this.lastError=null;this.dispatchEvent(new Event('change'));
 }
 async load() {
  if(this.buffer)return;
  if(this.loading)return this.loading;
  this.loading=this._load().finally(()=>this.loading=null);return this.loading;
 }
 async _load() {
  await this.unlock();this.loadErrors=[];
  // MP3 is built from the same verified recording. Do not require Ogg on older iOS.
  const urls=['./assets/zarathustra.mp3','./assets/zarathustra.ogg',MUSIC.url];
  for(const url of urls){
   const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),25000);
   try{
    this.status(`Loading orchestra (${url.endsWith('.mp3')?'MP3':'Ogg'})…`);
    let response;
    if(globalThis.caches){try{response=await caches.match(url);}catch{}}
    if(!response){response=await fetch(url,{signal:controller.signal,mode:'cors'});}
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const raw=await response.arrayBuffer();
    if(raw.byteLength<10000)throw new Error('The audio response is incomplete.');
    const buffer=await this.context.decodeAudioData(raw);
    if(!Number.isFinite(buffer.duration)||buffer.duration<=0)throw new Error('The recording has no playable audio.');
    this.buffer=buffer;this.loadedUrl=url;this.buildEnvelope();this.lastError=null;
    this.status('Strauss · Kevin MacLeod · recording ready');this.dispatchEvent(new Event('change'));return;
   }catch(error){this.loadErrors.push(`${url}: ${error.message}`);}
   finally{clearTimeout(timer);}
  }
  this.lastError='The orchestra could not be decoded or downloaded. Tap “Enable sound” to retry, or choose an audio file. '+this.loadErrors.join(' | ');
  throw new Error(this.lastError);
 }
 async importFile(file){
  await this.unlock();this.pause();const data=await file.arrayBuffer();
  const buffer=await this.context.decodeAudioData(data);
  this.buffer=buffer;this.silent=false;this.offset=0;this.imported=true;this.importedName=file.name;
  this.loadedUrl='Local file';this.lastError=null;this.buildEnvelope();
  this.status(`Local audio: ${file.name}`);this.dispatchEvent(new Event('change'));
 }
 buildEnvelope(){
  const b=this.buffer;if(!b)return;const data=b.getChannelData(0);const stride=Math.max(1,Math.floor(b.sampleRate/this.energyHz));this.energy=new Float32Array(Math.ceil(data.length/stride));let peak=0;
  for(let n=0;n<this.energy.length;n++){let sum=0,count=0;for(let i=n*stride;i<Math.min(data.length,(n+1)*stride);i+=4){sum+=data[i]*data[i];count++;}this.energy[n]=Math.sqrt(sum/Math.max(1,count));peak=Math.max(peak,this.energy[n]);}
  if(peak>0)for(let i=0;i<this.energy.length;i++)this.energy[i]/=peak;
 }
 energyAt(t){return this.energy[Math.max(0,Math.min(this.energy.length-1,Math.floor(t*this.energyHz)))]||0;}
 get clock(){return this.silent?performance.now()/1000:(this.context?.currentTime||0);}
 get time(){return this.playing?this.offset+Math.max(0,this.clock-this.startedAt):this.offset;}
 async play(offset=this.offset){
  if(!Number.isFinite(offset))throw new TypeError('Playback offset must be finite.');
  this.pause();const request=++this.playRequest;
  if(!this.silent){
   if(!this.buffer)throw new Error('The orchestra is not loaded. Tap “Enable sound”.');
   await this.unlock();
  }
  if(request!==this.playRequest)return false; // Pause/visibility change won the race.
  this.offset=Math.max(0,offset);this.startedAt=this.clock;
  if(!this.silent){
   if(this.offset>=this.buffer.duration)throw new Error('This recording has ended. Replay or choose a longer recording.');
   const source=this.context.createBufferSource();source.buffer=this.buffer;source.connect(this.gain);
   source.onended=()=>{
    if(this.source!==source)return;
    this.offset=this.buffer.duration;this.playing=false;source.disconnect();this.source=null;
    this.dispatchEvent(new Event('ended'));this.dispatchEvent(new Event('change'));
   };
   source.start(this.startedAt,this.offset);this.source=source;
  }
  this.playing=true;this.lastError=null;this.dispatchEvent(new Event('change'));return true;
 }
 pause(){this.offset=this.time;this.playing=false;++this.playRequest;this.stopSource();this.dispatchEvent(new Event('change'));}
 stopSource(){if(this.source){const source=this.source;this.source=null;source.onended=null;try{source.stop();}catch{}source.disconnect();}}
 async seek(t){const playing=this.playing;this.pause();this.offset=Math.max(0,t);if(playing)return this.play(this.offset);}
 setMuted(muted){this.muted=Boolean(muted);if(this.gain){this.gain.gain.cancelScheduledValues(this.context.currentTime);this.gain.gain.setTargetAtTime(this.muted?0:this.volume,this.context.currentTime,.02);}this.dispatchEvent(new Event('change'));}
 get diagnostics(){return {contextState:this.context?.state||'not created',sessionType:globalThis.navigator?.audioSession?.type||'unsupported',source:this.loadedUrl,playing:this.playing,muted:this.muted,silent:this.silent,lastError:this.lastError,loadErrors:this.loadErrors};}
 dispose(){this.pause();this.disposed=true;return this.context?.close();}
}
