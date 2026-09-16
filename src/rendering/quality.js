/** Quality budgets are independent from output size: typography/capture stay sharp. */
export const CINEMA_QUALITIES = Object.freeze({
  preview: Object.freeze({pixels:580_000,steps:18,particles:4096,sceneScale:.78,bloomLevels:3,fogScale:.5,fogSteps:8}),
  balanced: Object.freeze({pixels:1_300_000,steps:26,particles:12288,sceneScale:.85,bloomLevels:4,fogScale:.5,fogSteps:12}),
  cinema: Object.freeze({pixels:2_100_000,steps:36,particles:24576,sceneScale:.92,bloomLevels:5,fogScale:.5,fogSteps:16}),
  ultra: Object.freeze({pixels:8_300_000,steps:48,particles:32768,sceneScale:1,bloomLevels:5,fogScale:.5,fogSteps:20})
});
export const CINEMA_LOOKS = Object.freeze({
  clean: Object.freeze({bloom:.50,streak:0,fog:0,intensity:0,exposure:1.25}),
  cinematic: Object.freeze({bloom:.72,streak:.34,fog:.85,intensity:.75,exposure:1.22}),
  odyssey: Object.freeze({bloom:.90,streak:.62,fog:1.15,intensity:1.2,exposure:1.16})
});
export function evenSize(width,height,scale=1,limit=16384){
  if(![width,height,scale,limit].every(Number.isFinite)||width<=0||height<=0||scale<=0||limit<2)throw new RangeError('Invalid render extent.');
  const s=Math.min(scale,limit/width,limit/height);
  return [Math.max(2,Math.floor(width*s/2)*2),Math.max(2,Math.floor(height*s/2)*2)];
}
/** Discrete levels + hysteresis prevent per-frame texture churn and quality pumping. */
export class AdaptiveQuality {
  constructor({targetMs=16.67,minScale=.55,maxScale=1,cooldownMs=1800}={}){
    if(![targetMs,minScale,maxScale,cooldownMs].every(Number.isFinite)||!(targetMs>0&&minScale>0&&minScale<=maxScale&&maxScale<=1&&cooldownMs>=0))throw new RangeError('Invalid adaptive quality budget.');
    Object.assign(this,{targetMs,minScale,maxScale,cooldownMs});this.reset();
  }
  reset(){this.scale=this.maxScale;this.average=0;this.samples=0;this.slow=0;this.fast=0;this.lastChange=-Infinity;}
  observe(ms,now,{locked=false}={}){
    if(locked||!Number.isFinite(ms)||ms<=0||!Number.isFinite(now))return false;
    // A legitimately overloaded GPU must still trigger downscaling. Saturate
    // extreme samples instead of discarding every frame on a slow device.
    ms=Math.min(ms,250);
    this.average=this.samples++?this.average*.9+ms*.1:ms;
    if(this.samples<12)return false;
    this.slow=this.average>this.targetMs*1.18?this.slow+1:0;
    this.fast=this.average<this.targetMs*.67?this.fast+1:0;
    if(now-this.lastChange<this.cooldownMs)return false;
    let next=this.scale;
    if(this.slow>=8)next=Math.max(this.minScale,Math.round((this.scale-.1)*100)/100);
    else if(this.fast>=90)next=Math.min(this.maxScale,Math.round((this.scale+.05)*100)/100);
    if(next===this.scale)return false;
    this.scale=next;this.lastChange=now;this.slow=this.fast=0;return true;
  }
}
