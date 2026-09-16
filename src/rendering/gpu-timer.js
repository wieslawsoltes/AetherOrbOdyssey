/** Optional timestamp-query telemetry, asynchronously read through a 3-slot ring.
 * No timing result is awaited by playback. Timestamp values may be quantized. */
export class GpuTimer {
  constructor(device,onSample){
    this.device=device;this.onSample=onSample;this.enabled=device.features.has('timestamp-query');
    this.slots=[];this.disposed=false;this.samples=0;this.lastMs=0;
    if(this.enabled)for(let i=0;i<3;i++)this.slots.push({busy:false,
      query:device.createQuerySet({type:'timestamp',count:2}),
      resolve:device.createBuffer({size:256,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC}),
      read:device.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ})});
  }
  begin(frame){if(!this.enabled||this.disposed||frame%8!==0)return null;const s=this.slots.find(s=>!s.busy);if(s)s.busy=true;return s||null;}
  writes(slot,end=false){if(!slot)return undefined;return end?{querySet:slot.query,endOfPassWriteIndex:1}:{querySet:slot.query,beginningOfPassWriteIndex:0};}
  resolve(encoder,slot){if(!slot)return;encoder.resolveQuerySet(slot.query,0,2,slot.resolve,0);encoder.copyBufferToBuffer(slot.resolve,0,slot.read,0,16);}
  collect(slot){
    if(!slot)return;
    slot.read.mapAsync(GPUMapMode.READ).then(()=>{
      try{if(this.disposed)return;const t=new BigUint64Array(slot.read.getMappedRange());const ms=Number(t[1]-t[0])/1e6;
        if(ms>0&&ms<1000){this.lastMs=ms;this.samples++;this.onSample(ms);}
      }finally{slot.read.unmap();}
    }).catch(()=>{}).finally(()=>{slot.busy=false;});
  }
  dispose(){this.disposed=true;for(const s of this.slots){s.query.destroy();s.resolve.destroy();s.read.destroy();}this.slots=[];}
}
