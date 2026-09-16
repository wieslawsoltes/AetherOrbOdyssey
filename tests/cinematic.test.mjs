import test from 'node:test';
import assert from 'node:assert/strict';
import {FrameGraph} from '../src/rendering/frame-graph.js';
import {RenderTargetPool} from '../src/rendering/target-pool.js';
import {AdaptiveQuality,evenSize,CINEMA_QUALITIES,CINEMA_LOOKS} from '../src/rendering/quality.js';
import {GpuTimer} from '../src/rendering/gpu-timer.js';
const gpu=()=>({createTexture(d){return {descriptor:d,createView(){return {descriptor:d};},destroy(){this.destroyed=true;}};}});
test('Frame graph sorts dependencies independent of declaration order',()=>{
 const trace=[],g=new FrameGraph(['camera']);g.add('finish',{reads:['hdr'],writes:['screen'],run:()=>trace.push('finish')});
 g.add('scene',{reads:['camera'],writes:['hdr'],run:()=>trace.push('scene')});g.compile().execute({},{});assert.deepEqual(trace,['scene','finish']);
 assert.throws(()=>g.add('late',{run(){}}),/compiled/);
});
test('Frame graph rejects missing producers, duplicate writes and cycles',()=>{
 assert.throws(()=>new FrameGraph().add('a',{reads:['x'],run(){}}).compile(),/Missing producer/);
 assert.throws(()=>new FrameGraph().add('a',{writes:['x'],run(){}}).add('b',{writes:['x'],run(){}}).compile(),/Duplicate writer/);
 assert.throws(()=>new FrameGraph().add('a',{reads:['y'],writes:['x'],run(){}}).add('b',{reads:['x'],writes:['y'],run(){}}).compile(),/cycle/);
 assert.throws(()=>new FrameGraph().add('a',{reads:['x'],writes:['x'],run(){}}),/versioned/);
});
test('Target pool caches views and reuses only matching descriptors',()=>{
 const pool=new RenderTargetPool(gpu()),d={width:320,height:180,usage:20};const first=pool.acquire(d),view=first.view;
 pool.release(first);const again=pool.acquire(d);assert.equal(first,again);assert.equal(again.view,view);
 const other=pool.acquire({...d,format:'rgba8unorm'});assert.notEqual(other,again);assert.equal(pool.stats.created,2);assert.equal(pool.stats.reused,1);
 pool.dispose();assert.equal(pool.stats.liveBytes,0);assert.equal(pool.stats.idleBytes,0);assert.throws(()=>pool.acquire(d),/disposed/);
});
test('Target pool bounds idle memory and refuses ownership errors',()=>{
 const pool=new RenderTargetPool(gpu(),{maxIdleBytes:100});const t=pool.acquire({width:32,height:32,usage:20});pool.release(t);
 assert.equal(pool.stats.idleBytes,0);assert.equal(t.texture.destroyed,true);assert.throws(()=>pool.release(t),/already/);
 assert.throws(()=>pool.release({}),/Foreign/);assert.throws(()=>pool.acquire({width:1.5,height:2,usage:20}),/Invalid/);
});
test('Output extents are positive, even, device bounded and portrait-safe',()=>{
 assert.deepEqual(evenSize(1921,1081),[1920,1080]);assert.deepEqual(evenSize(1080,1920,.5),[540,960]);
 const [w,h]=evenSize(8000,4000,1,2048);assert.equal(w,2048);assert.equal(h,1024);
 for(const values of [[0,10],[NaN,10],[10,10,-1],[10,10,1,0]])assert.throws(()=>evenSize(...values),/Invalid/);
});
test('Adaptive quality lowers workload under sustained pressure, with cooldown',()=>{
 const a=new AdaptiveQuality();let changes=0;for(let i=0;i<160;i++)if(a.observe(35,i*20))changes++;
 assert.ok(a.scale<1);assert.ok(changes<=2);assert.ok(a.scale>=a.minScale);
 const scale=a.scale;for(let i=0;i<300;i++)a.observe(80,5000+i*20,{locked:true});assert.equal(a.scale,scale);
});
test('Adaptive quality ignores invalid samples and recovers gradually',()=>{
 const a=new AdaptiveQuality();for(let i=0;i<160;i++)a.observe(35,i*20);const low=a.scale;
 for(const x of [NaN,Infinity,-1,0,500])assert.equal(a.observe(x,9999),false);
 for(let i=0;i<600;i++)a.observe(4,5000+i*20);assert.ok(a.scale>low);assert.ok(a.scale<=1);
 a.reset();assert.equal(a.scale,1);assert.equal(a.samples,0);
});
test('Presets cover every effect budget and clean mode removes advanced optics',()=>{
 for(const q of Object.values(CINEMA_QUALITIES)){assert.ok(q.sceneScale<=1&&q.sceneScale>0);assert.ok(q.fogSteps<=24);assert.ok(q.particles<=32768);assert.ok(q.bloomLevels>=3);}
 assert.equal(CINEMA_LOOKS.clean.intensity,0);assert.equal(CINEMA_LOOKS.clean.streak,0);assert.equal(CINEMA_LOOKS.clean.fog,0);
});
test('Timestamp telemetry has a zero-resource unsupported-feature path',()=>{
 const t=new GpuTimer({features:new Set()},()=>assert.fail());assert.equal(t.begin(0),null);assert.equal(t.writes(null),undefined);t.dispose();
});
