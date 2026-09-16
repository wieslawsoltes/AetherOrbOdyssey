/** The licensed orchestral recording is the clock. There is no oscillator imitation. */
export const MUSIC = Object.freeze({
 title:'Also Sprach Zarathustra — Einleitung',
 composer:'Richard Strauss',performer:'Kevin MacLeod',license:'CC BY 3.0',
 url:'https://upload.wikimedia.org/wikipedia/commons/0/0b/Also_Sprach_Zarathustra_-_Einleitung.ogg',
 source:'https://commons.wikimedia.org/wiki/File:Also_Sprach_Zarathustra_-_Einleitung.ogg',
 licenseUrl:'https://creativecommons.org/licenses/by/3.0/',
 sha1:'ab5a1863b4fead3069445bdbcfd0f62ecfd09481'
});
export class Soundtrack extends EventTarget {
 constructor(){super();this.offset=0;this.startedAt=0;this.playing=false;this.volume=.75;this.muted=false;this.silent=false;this.energy=[];this.energyHz=30;}
 async unlock() {
  if(!this.context){
   this.context=new AudioContext({latencyHint:'playback'});
   this.gain=this.context.createGain();this.gain.gain.value=this.muted?0:this.volume;
   this.gain.connect(this.context.destination);
   this.destination=this.context.createMediaStreamDestination();this.gain.connect(this.destination);
  }
  if(this.context.state==='suspended')await this.context.resume();
 }
 async load() {
  if(this.buffer)return;
  if(this.loading)return this.loading;
  this.loading=this._load().finally(()=>this.loading=null);return this.loading;
 }
 async _load() {
  await this.unlock();
  const urls=['./assets/zarathustra.ogg',MUSIC.url];let last;
  for(const url of urls){
   try {
    this.dispatchEvent(new CustomEvent('status',{detail:url.startsWith('.')?'Checking local score…':'Loading Strauss orchestral recording…'}));
    let response;
    if('caches'in window){try{response=await caches.match(url);}catch{}}
    if(!response){
     response=await fetch(url,{signal:AbortSignal.timeout(url.startsWith('.')?2500:22000),mode:'cors'});
     if(!response.ok)throw new Error(`HTTP ${response.status}`);
     if('caches'in window&&url===MUSIC.url){try{const cache=await caches.open('aether-odyssey-music-v1');await cache.put(url,response.clone());}catch{}}
    }
    const raw=await response.arrayBuffer();
    if(raw.byteLength<10000)throw new Error('The audio response is incomplete.');
    this.buffer=await this.context.decodeAudioData(raw);
    this.buildEnvelope();this.dispatchEvent(new CustomEvent('status',{detail:'Strauss · Kevin MacLeod · recording ready'}));return;
   } catch(e){last=e;}
  }
  throw new Error(`The orchestral recording could not be loaded. ${last?.message||''} Use “Choose audio” to open the licensed recording locally, or explicitly choose the silent preview.`);
 }
 async importFile(file){
  await this.unlock();this.pause();this.buffer=await this.context.decodeAudioData(await file.arrayBuffer());this.silent=false;this.offset=0;this.imported=true;this.importedName=file.name;this.buildEnvelope();
  this.dispatchEvent(new CustomEvent('status',{detail:`Local audio: ${file.name}`}));
 }
 buildEnvelope(){
  const b=this.buffer;if(!b)return;const data=b.getChannelData(0);const stride=Math.max(1,Math.floor(b.sampleRate/this.energyHz));this.energy=new Float32Array(Math.ceil(data.length/stride));let peak=0;
  for(let n=0;n<this.energy.length;n++){let sum=0,count=0;for(let i=n*stride;i<Math.min(data.length,(n+1)*stride);i+=4){sum+=data[i]*data[i];count++;}this.energy[n]=Math.sqrt(sum/Math.max(1,count));peak=Math.max(peak,this.energy[n]);}
  if(peak>0)for(let i=0;i<this.energy.length;i++)this.energy[i]/=peak;
 }
 energyAt(t){return this.energy[Math.max(0,Math.min(this.energy.length-1,Math.floor(t*this.energyHz)))]||0;}
 get time(){if(!this.playing)return this.offset;return this.offset+Math.max(0,(this.context?this.context.currentTime:performance.now()/1000)-this.startedAt);}
 async play(offset=this.offset){
  await this.unlock();this.stopSource();this.offset=Math.max(0,offset);this.startedAt=this.context.currentTime;
  if(this.buffer&&!this.silent&&offset<this.buffer.duration){
   const src=this.context.createBufferSource();src.buffer=this.buffer;src.connect(this.gain);src.start(this.startedAt,offset);this.source=src;
  }
  this.playing=true;
 }
 pause(){this.offset=this.time;this.playing=false;this.stopSource();}
 stopSource(){if(this.source){try{this.source.stop();}catch{}this.source.disconnect();this.source=null;}}
 async seek(t){const playing=this.playing;this.pause();this.offset=Math.max(0,t);if(playing)await this.play(this.offset);}
 setMuted(muted){this.muted=muted;if(this.gain)this.gain.gain.setTargetAtTime(muted?0:this.volume,this.context.currentTime,.02);}
 dispose(){this.pause();this.context?.close();}
}
