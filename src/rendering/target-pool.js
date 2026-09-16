const FORMAT_BYTES=Object.freeze({rgba16float:8,rgba8unorm:4,bgra8unorm:4,r32float:4,rg16float:4});
/** Descriptor-keyed pool. Lease objects cache views; bounded LRU idle storage. */
export class RenderTargetPool {
  constructor(device,{maxIdleBytes=48*1024*1024}={}){
    this.device=device;this.maxIdleBytes=maxIdleBytes;this.free=[];this.live=new Set();
    this.created=0;this.reused=0;this.destroyed=0;this.idleBytes=0;this.liveBytes=0;this.disposed=false;
  }
  acquire({width,height,format='rgba16float',usage,label='Cinematic target'}){
    if(this.disposed)throw new Error('Render target pool is disposed.');
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||!FORMAT_BYTES[format]||!usage)throw new RangeError('Invalid render target descriptor.');
    const key=`${width}/${height}/${format}/${usage}`;
    const i=this.free.findIndex(t=>t.key===key);let target;
    if(i>=0){target=this.free.splice(i,1)[0];this.idleBytes-=target.bytes;this.reused++;}
    else {
      const texture=this.device.createTexture({label,size:[width,height],format,usage});
      target={key,width,height,format,texture,view:texture.createView(),bytes:width*height*FORMAT_BYTES[format],owner:this};this.created++;
    }
    this.live.add(target);this.liveBytes+=target.bytes;return target;
  }
  release(target){
    if(target?.owner!==this||!this.live.delete(target))throw new Error('Foreign or already released render target.');
    this.liveBytes-=target.bytes;this.free.push(target);this.idleBytes+=target.bytes;this.trim();
  }
  trim(){while(this.idleBytes>this.maxIdleBytes&&this.free.length){const t=this.free.shift();this.idleBytes-=t.bytes;t.texture.destroy();this.destroyed++;}}
  get stats(){return {created:this.created,reused:this.reused,destroyed:this.destroyed,live:this.live.size,idle:this.free.length,liveBytes:this.liveBytes,idleBytes:this.idleBytes};}
  dispose(){if(this.disposed)return;this.disposed=true;for(const t of [...this.live,...this.free]){t.texture.destroy();this.destroyed++;}this.live.clear();this.free=[];this.liveBytes=this.idleBytes=0;}
}
