import test from 'node:test';
import assert from 'node:assert/strict';
import {recordingSize,createVideoRecorder,LocalFilmRecorder} from '../src/export.js';
import {readbackLayout,unpackCapturePixels} from '../src/renderer.js';

test('Retina and odd resolutions are bounded and even, without upscaling',()=>{
 assert.deepEqual(recordingSize(3025,1965),{width:1662,height:1080});
 assert.deepEqual(recordingSize(900,1600),{width:900,height:1600});
 assert.throws(()=>recordingSize(1,1));assert.throws(()=>recordingSize(NaN,100));
});
test('GPU readback unpads every row and preserves RGBA values',()=>{
 const l=readbackLayout(3,2);assert.deepEqual(l,{bytesPerRow:256,size:512});
 const bytes=new Uint8Array(l.size);bytes.set([1,2,3,255,4,5,6,255,7,8,9,255]);bytes.set([11,12,13,255,14,15,16,255,17,18,19,255],256);
 assert.deepEqual([...unpackCapturePixels(bytes,3,2,'rgba8unorm')],[1,2,3,255,4,5,6,255,7,8,9,255,11,12,13,255,14,15,16,255,17,18,19,255]);
 assert.deepEqual([...unpackCapturePixels(bytes,3,2,'bgra8unorm')].slice(0,4),[3,2,1,255]);
 assert.throws(()=>unpackCapturePixels(new Uint8Array(1),3,2,'bgra8unorm'));
 assert.throws(()=>unpackCapturePixels(bytes,3,2,'rgba16float'));
});
test('Supported-but-unavailable encoder falls back on both constructor and start errors',()=>{
 const seen=[];
 class Encoder{
  static isTypeSupported(){return true;}
  constructor(stream,opts){this.state='inactive';seen.push(opts.mimeType);this.mimeType=opts.mimeType;if(seen.length===1)throw new Error('Encoder resources exhausted');}
  start(){if(seen.length===2)throw new Error('Start rejected');this.state='recording';}
 }
 const r=createVideoRecorder({}, {Recorder:Encoder});assert.equal(seen.length,3);assert.ok(r.mimeType.startsWith('video/mp4'));
});
test('Browser default is tried when no explicit codec is advertised',()=>{
 class Encoder{static isTypeSupported(){return false;}constructor(s,o){assert.deepEqual(o,{});}start(){}}
 assert.ok(createVideoRecorder({}, {Recorder:Encoder}));
});
function fixture({empty=false,hang=false,startError=false}={}){
 const original={readyState:'live',kind:'audio',stopped:false,stop(){this.stopped=true;},clone(){return {...this,clone:this.clone};}};
 const video={readyState:'live',kind:'video',frames:0,requestFrame(){this.frames++;},stop(){this.readyState='ended';}};
 const stream={tracks:[video],getVideoTracks(){return this.tracks.filter(x=>x.kind==='video');},getTracks(){return this.tracks;},addTrack(t){this.tracks.push(t);}};
 const ctx={globalAlpha:1,fillRect(){},fillText(){},drawImage(){},putImageData(){}};
 class Canvas{constructor(){this.width=640;this.height=360;}getContext(){return ctx;}captureStream(){return stream;}}
 class Encoder{
  static isTypeSupported(){return true;}
  constructor(s,{mimeType='video/webm'}={}){this.state='inactive';this.mimeType=mimeType;}
  start(){this.state='recording';if(startError)throw new Error('Start fail');if(!hang)queueMicrotask(()=>this.onstart?.());}
  stop(){this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob(empty?[]:['a'.repeat(1024)],{type:this.mimeType})});this.onstop?.();});}
  pause(){this.state='paused';}resume(){this.state='recording';}
 }
 globalThis.HTMLCanvasElement=Canvas;globalThis.MediaRecorder=Encoder;
 globalThis.CanvasCaptureMediaStreamTrack=class{requestFrame(){}};
 globalThis.document={createElement:()=>new Canvas(),body:{append(){}}};
 const sound={buffer:{},silent:false,destination:{stream:{getAudioTracks:()=>[original]}}};
 const r=new LocalFilmRecorder({width:640,height:360,canvas:new Canvas()},sound,{startupTimeout:20,stopTimeout:20});
 return {r,original,stream,video,sound};
}
test('Final data arrives before stop, duplicate stop is safe, original audio survives',async()=>{
 const {r,original,stream}=fixture();const done=r.start();await r.ready;r.frame(0);r.pause();assert.equal(r.state,'paused');r.resume();
 assert.equal(r.stop(),done);assert.equal(r.stop(),done);const blob=await done;
 assert.equal(blob.size,1024);assert.equal(r.state,'ready');assert.equal(original.stopped,false);
 assert.equal(stream.tracks.find(t=>t.kind==='audio').stopped,true);assert.ok(r.result.url.startsWith('blob:'));r.dispose();
});
test('Title-free frames are explicitly requested and frame rate is bounded',async()=>{
 const {r,video}=fixture();r.start();await r.ready;r.frame(1);assert.equal(video.frames,1);assert.equal(r.needsFrame(1.001),false);assert.equal(r.needsFrame(1.04),true);await r.stop();r.dispose();
});
test('Empty encoder output is an error, never reported as saved',async()=>{
 const {r}=fixture({empty:true});r.start();await r.ready;r.frame(0);await assert.rejects(r.stop(),/no playable frames/);assert.equal(r.result,null);assert.equal(r.state,'error');
});
test('Asynchronous failure releases tracks and cannot turn stop into success',async()=>{
 const {r,original,stream}=fixture();const done=r.start();await r.ready;r.frame(1);r.recorder.onerror({error:new Error('GPU encoder lost')});
 await assert.rejects(done,/GPU encoder lost/);assert.equal(r.state,'error');assert.equal(r.result,null);assert.equal(original.stopped,false);assert.equal(stream.tracks[0].readyState,'ended');
});
test('No first-frame/start event has a bounded, recoverable failure',async()=>{
 const {r}=fixture({hang:true});await assert.rejects(r.start(),/did not start/);assert.equal(r.active,false);
});
test('Native WebGPU recording rejects missing readback instead of recording black',async()=>{
 const {r}=fixture();r.renderer.requiresReadback=true;const done=r.start();await r.ready;
 assert.throws(()=>r.frame(1),/did not return/);r.fail(new Error('Readback failed'));await assert.rejects(done,/Readback failed/);
});
test('A second recording works and replaces the previous downloadable result',async()=>{
 const {r}=fixture();r.start();await r.ready;r.frame(1);await r.stop();const url=r.result.url;
 r.start();await r.ready;r.frame(2);await r.stop();assert.notEqual(r.result.url,url);assert.equal(r.frames,1);r.dispose();
});
test('A missing audio track fails before creating a recording',()=>{
 const {r,sound}=fixture();sound.destination=null;assert.throws(()=>r.start(),/enable the orchestra/);
});
