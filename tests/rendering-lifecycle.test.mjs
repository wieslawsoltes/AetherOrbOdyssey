import test from 'node:test';
import assert from 'node:assert/strict';
import {FilmRenderer} from '../src/renderer.js';
import {FrameGraph} from '../src/rendering/frame-graph.js';
import {AdaptiveQuality} from '../src/rendering/quality.js';
import {GpuTimer} from '../src/rendering/gpu-timer.js';

const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('Stable scene extents bypass pipeline resize; every relevant change invalidates the cache',()=>{
 const calls=[];
 const r=Object.assign(Object.create(FilmRenderer.prototype),{
  width:960,height:540,quality:'balanced',look:'cinematic',
  cinematic:{resize(...args){calls.push(args);}}
 });
 r.resizeScene(1);
 for(let i=0;i<120;i++)r.resizeScene(1);
 assert.equal(calls.length,1);assert.deepEqual([r.sceneWidth,r.sceneHeight],[816,458]);
 r.resizeScene(.65);assert.equal(calls.length,2);
 r.width=540;r.height=960;r.resizeScene(.65);assert.equal(calls.length,3);
 r.quality='ultra';r.resizeScene(.65);assert.equal(calls.length,4);
 r.look='clean';r.resizeScene(.65);assert.equal(calls.length,5);
 r.resizeScene(1);assert.equal(calls.length,6);
 assert.deepEqual([r.sceneWidth,r.sceneHeight],[540,960]);
});
test('A failed extent rebuild is retried instead of caching an incomplete layout',()=>{
 let calls=0;
 const r=Object.assign(Object.create(FilmRenderer.prototype),{
  width:960,height:540,quality:'balanced',look:'cinematic',
  cinematic:{resize(){if(++calls===1)throw new Error('allocation failed');}}
 });
 assert.throws(()=>r.resizeScene(1),/allocation/);r.resizeScene(1);assert.equal(calls,2);
});
test('Sustained extreme GPU pressure still reduces quality; capture locks do not',()=>{
 const a=new AdaptiveQuality();
 for(let i=0;i<80;i++)a.observe(900,i*900);
 assert.equal(a.scale,a.minScale);assert.equal(a.average,250);
 a.reset();for(let i=0;i<80;i++)a.observe(900,i*900,{locked:true});
 assert.equal(a.scale,1);assert.equal(a.samples,0);
});
test('Adaptive configuration rejects nonfinite budgets and invalid timing samples',()=>{
 for(const options of [{targetMs:Infinity},{cooldownMs:Infinity},{minScale:NaN},{maxScale:Infinity}])
  assert.throws(()=>new AdaptiveQuality(options),/Invalid/);
 const a=new AdaptiveQuality();for(const ms of [NaN,Infinity,-Infinity,0,-1])a.observe(ms,100);
 a.observe(20,NaN);assert.equal(a.samples,0);
});
test('Graph inputs and exposed dependency lists cannot mutate compiled execution',()=>{
 const reads=['source'],after=['source-pass'],trace=[];
 const g=new FrameGraph().add('finish',{reads,after,run(){trace.push('finish');}})
  .add('source-pass',{writes:['source'],run(){trace.push('source');}});
 reads[0]='missing';after[0]='missing';g.compile().execute({},{});
 assert.deepEqual(trace,['source','finish']);
 assert.throws(()=>g.passes[1].reads.push('other'),TypeError);
 assert.throws(()=>g.nodes[0].run=()=>{},TypeError);
});

function fakeTimestampDevice(){
 const buffers=[];const queries=[];
 const device={features:new Set(['timestamp-query']),
  createQuerySet(){const q={destroy(){this.destroyed=true;}};queries.push(q);return q;},
  createBuffer(desc){
   let resolve,reject;
   const data=new ArrayBuffer(desc.size);
   const b={...desc,data,unmaps:0,destroyed:false,
    mapAsync(){return new Promise((ok,no)=>{resolve=ok;reject=no;});},
    getMappedRange(){return data;},unmap(){this.unmaps++;},
    finish(start,end){new BigUint64Array(data).set([start,end]);resolve();},
    reject(){reject(new Error('device lost'));},destroy(){this.destroyed=true;}};
   buffers.push(b);return b;
  }
 };
 return {device,buffers,queries};
}
// These numeric usage flags are official WebGPU bit positions, not a GPU mock.
globalThis.GPUBufferUsage={MAP_READ:1,COPY_SRC:4,COPY_DST:8,QUERY_RESOLVE:512};
globalThis.GPUMapMode={READ:1};
test('Timestamp ring is bounded and maps without blocking rendering',async()=>{
 const {device,buffers}=fakeTimestampDevice(),samples=[],timer=new GpuTimer(device,x=>samples.push(x));
 assert.equal(timer.begin(1),null);
 const slots=[timer.begin(0),timer.begin(8),timer.begin(16)];assert.ok(slots.every(Boolean));
 assert.equal(timer.begin(24),null);assert.equal(buffers.length,6);
 assert.equal(timer.writes(slots[0]).beginningOfPassWriteIndex,0);
 assert.equal(timer.writes(slots[0],true).endOfPassWriteIndex,1);
 const ops=[];timer.resolve({resolveQuerySet(...a){ops.push(a);},copyBufferToBuffer(...a){ops.push(a);}},slots[0]);
 assert.equal(ops[0][2],2);assert.equal(ops[1][4],16);
 assert.equal(timer.collect(slots[0]),undefined);
 slots[0].read.finish(1_000_000n,8_500_000n);await flush();
 assert.deepEqual(samples,[7.5]);assert.equal(timer.samples,1);assert.equal(slots[0].read.unmaps,1);
 assert.equal(timer.begin(32),slots[0]);timer.dispose();
});
test('Timestamp map rejection frees the ring slot; wrapped or zero samples are ignored',async()=>{
 const {device}=fakeTimestampDevice(),timer=new GpuTimer(device,()=>assert.fail());
 let slot=timer.begin(0);timer.collect(slot);slot.read.reject();await flush();assert.equal(slot.busy,false);
 for(const [start,end] of [[5n,5n],[10n,1n],[0n,2_000_000_000n]]){
  slot=timer.begin(8);timer.collect(slot);slot.read.finish(start,end);await flush();
  assert.equal(slot.busy,false);
 }
 assert.equal(timer.samples,0);timer.dispose();
});
test('Disposing timestamp telemetry releases all resources and suppresses late samples',async()=>{
 const {device,buffers,queries}=fakeTimestampDevice(),timer=new GpuTimer(device,()=>assert.fail());
 const slot=timer.begin(0);timer.collect(slot);timer.dispose();timer.dispose();
 slot.read.finish(0n,1_000_000n);await flush();
 assert.ok([...buffers,...queries].every(r=>r.destroyed));assert.equal(timer.begin(8),null);assert.equal(timer.samples,0);
});
