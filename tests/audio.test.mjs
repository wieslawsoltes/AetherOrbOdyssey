import test from 'node:test';
import assert from 'node:assert/strict';
import {Soundtrack} from '../src/audio.js';

// Deterministic platform-policy doubles; these are not physical-iPhone tests.
function platform({state='suspended',mode='ok',session=true}={}){
 const saved=new Map();
 function replace(key,value){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}
 const calls=[];
 class Context extends EventTarget{
  constructor(){super();this.state=state;this.currentTime=10;this.sampleRate=44100;this.destination={};calls.push('context');}
  resume(){calls.push('resume');if(mode==='reject')return Promise.reject(new Error('Denied'));if(mode==='hang')return new Promise(()=>{});if(mode!=='stuck')this.state='running';return Promise.resolve();}
  createBuffer(channels,length,sampleRate){return {duration:length/sampleRate,sampleRate,getChannelData:()=>new Float32Array(length).fill(.1)};}
  createGain(){return {gain:{value:1,cancelScheduledValues(){},setTargetAtTime(value){this.value=value;}},connect(){}};}
  createMediaStreamDestination(){return {stream:{getAudioTracks:()=>[{}]}};}
  createBufferSource(){const context=this;return {connect(){},disconnect(){},start(...args){calls.push(['start',...args]);},stop(){calls.push('stop');}};}
  async decodeAudioData(){calls.push('decode');return this.createBuffer(1,44100*90,44100);}
  async close(){this.state='closed';}
 }
 let type='auto';const nav=session?{audioSession:{get type(){return type;},set type(v){calls.push(`session:${v}`);type=v;}}}:{};
 replace('navigator',nav);replace('AudioContext',Context);replace('caches',undefined);
 return {calls,Context,replace,restore(){for(const[k,v]of saved)v?Object.defineProperty(globalThis,k,v):delete globalThis[k];}};
}

async function withPlayer(options,fn){const p=platform(options);const s=new Soundtrack({resumeTimeout:20});try{await fn(s,p);}finally{await s.dispose();p.restore();}}

test('playback category is set before context creation and resume is synchronous',()=>withPlayer({},async(s,p)=>{
 const ready=s.unlock();assert.deepEqual(p.calls.slice(0,3),['session:playback','context','resume']);assert.ok(p.calls.some(c=>Array.isArray(c)&&c[0]==='start'));await ready;assert.equal(s.context.state,'running');
}));
test('running context is reused without another resume',()=>withPlayer({},async(s,p)=>{await s.unlock();await s.unlock();assert.equal(p.calls.filter(c=>c==='context').length,1);assert.equal(p.calls.filter(c=>c==='resume').length,1);}));
test('interrupted WebKit contexts are explicitly resumed',()=>withPlayer({state:'interrupted'},async(s,p)=>{await s.unlock();assert.equal(s.context.state,'running');assert.ok(p.calls.includes('resume'));}));
test('missing optional AudioSession API does not block sound',()=>withPlayer({session:false},async s=>{await s.unlock();assert.equal(s.context.state,'running');}));
test('throwing AudioSession setter does not block sound',()=>withPlayer({},async(s,p)=>{p.replace('navigator',{get audioSession(){throw new Error('Unavailable');}});await s.unlock();assert.equal(s.context.state,'running');}));
test('closed context is replaced',()=>withPlayer({},async(s,p)=>{await s.unlock();await s.context.close();await s.unlock();assert.equal(p.calls.filter(c=>c==='context').length,2);}));
test('resume rejection is surfaced instead of pretending audio is playing',()=>withPlayer({mode:'reject'},async s=>{await assert.rejects(s.unlock(),/Denied/);assert.equal(s.playing,false);}));
test('unresolved Safari resume is bounded and recoverable',()=>withPlayer({mode:'hang'},async s=>{await assert.rejects(s.unlock(),/Enable sound/);assert.equal(s.playing,false);}));
test('resolved resume with still-interrupted context is rejected',()=>withPlayer({state:'interrupted',mode:'stuck'},async s=>{await assert.rejects(s.unlock(),/interrupted/);}));
test('silent preview does not create or resume any audio context',()=>withPlayer({},async(s,p)=>{s.silent=true;assert.equal(await s.play(12),true);assert.equal(s.time>=12,true);assert.equal(p.calls.length,0);s.pause();const t=s.time;await new Promise(r=>setTimeout(r,5));assert.equal(s.time,t);}));
test('missing decoded score cannot masquerade as audible playback',()=>withPlayer({},async s=>{await assert.rejects(s.play(),/not loaded/);assert.equal(s.playing,false);}));
test('clock, offset, pause and repeated play keep one source',()=>withPlayer({},async(s,p)=>{await s.unlock();s.buffer=s.context.createBuffer(1,44100*90,44100);await s.play(20);s.context.currentTime+=2;assert.equal(s.time,22);s.pause();assert.equal(s.time,22);assert.equal(s.source,null);await s.play();assert.equal(s.offset,22);assert.equal(s.playing,true);}));
test('pause cancels an asynchronous play request',()=>withPlayer({},async s=>{await s.unlock();s.buffer=s.context.createBuffer(1,44100*90,44100);const started=s.play(20);s.pause();assert.equal(await started,false);assert.equal(s.playing,false);assert.equal(s.source,null);}));
test('OS suspension freezes the clock and emits recoverable interruption',()=>withPlayer({},async s=>{await s.unlock();s.buffer=s.context.createBuffer(1,44100*90,44100);await s.play(10);s.context.currentTime+=2;let interruption;s.addEventListener('interruption',e=>interruption=e.detail);s.context.state='interrupted';s.context.dispatchEvent(new Event('statechange'));assert.equal(interruption,'interrupted');assert.equal(s.time,12);assert.equal(s.playing,false);await s.play(s.offset);assert.equal(s.playing,true);assert.equal(s.offset,12);}));
test('mute and unmute gain are deterministic',()=>withPlayer({},async s=>{await s.unlock();s.setMuted(true);assert.equal(s.gain.gain.value,0);s.setMuted(false);assert.equal(s.gain.gain.value,.75);}));
test('MP3 is tried first and decoded once',()=>withPlayer({},async(s,p)=>{const urls=[];p.replace('fetch',async url=>{urls.push(url);return new Response(new Uint8Array(12000));});await Promise.all([s.load(),s.load()]);assert.deepEqual(urls,['./assets/zarathustra.mp3']);assert.equal(p.calls.filter(c=>c==='decode').length,1);assert.match(s.loadedUrl,/mp3$/);}));
test('MP3 decode failure falls back to original Ogg',()=>withPlayer({},async(s,p)=>{let attempt=0;p.replace('fetch',async()=>new Response(new Uint8Array(12000)));await s.unlock();const decode=s.context.decodeAudioData.bind(s.context);s.context.decodeAudioData=()=>++attempt===1?Promise.reject(new Error('codec')):decode();await s.load();assert.equal(s.loadedUrl,'./assets/zarathustra.ogg');assert.equal(s.loadErrors.length,1);}));
test('network failures remain explicit and a later tap can retry',()=>withPlayer({},async(s,p)=>{p.replace('fetch',async()=>new Response('',{status:404}));await assert.rejects(s.load(),/could not be decoded/);assert.equal(s.buffer,undefined);assert.equal(s.loading,null);p.replace('fetch',async()=>new Response(new Uint8Array(12000)));await s.load();assert.ok(s.buffer);}));
test('nonfinite offset and offsets after the audio end are rejected',()=>withPlayer({},async s=>{await assert.rejects(s.play(NaN),/finite/);await s.unlock();s.buffer=s.context.createBuffer(1,44100,44100);await assert.rejects(s.play(2),/ended/);assert.equal(s.playing,false);}));
