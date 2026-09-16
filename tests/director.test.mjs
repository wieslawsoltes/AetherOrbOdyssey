import test from 'node:test';
import assert from 'node:assert/strict';
import {DURATION,SHOTS,sampleFilm,cameraBasis} from '../src/director.js';
test('Every instant belongs to one finite, deterministic camera shot',()=>{
 for(let t=0;t<=DURATION;t+=.035) {
  const f=sampleFilm(t); assert.deepEqual(f,sampleFilm(t));
  for(const x of [...f.camera,...f.target,f.fov,f.energy,f.explode,f.fade]) assert.ok(Number.isFinite(x));
  assert.ok(f.fade>=0&&f.fade<=1); assert.ok(f.explode>=0&&f.explode<=1);
 }
});
test('Timeline has no gaps, NaNs, negative duration or missing end frame',()=>{
 assert.equal(SHOTS[0].start,0);
 for(let i=1;i<SHOTS.length;i++) assert.equal(SHOTS[i].start,SHOTS[i-1].end);
 assert.equal(SHOTS.at(-1).end,DURATION);
 assert.equal(sampleFilm(Infinity).time,0); assert.equal(sampleFilm(-42).time,0);
 assert.equal(sampleFilm(1000).time,DURATION);
});
test('Camera basis is orthonormal for every shot, including the macro shots',()=>{
 for(const s of SHOTS){const f=sampleFilm((s.start+s.end)/2);const b=cameraBasis(f.camera,f.target);const vs=Object.values(b);
  for(const v of vs) assert.ok(Math.abs(Math.hypot(...v)-1)<1e-12);
  for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)assert.ok(Math.abs(vs[i].reduce((n,x,k)=>n+x*vs[j][k],0))<1e-12);
 }
});
test('Portrait camera is intentionally reframed',()=>assert.notDeepEqual(sampleFilm(40,9/16).camera,sampleFilm(40,16/9).camera));
