import { cameraBasis } from './director.js';
import {CINEMA_QUALITIES,CINEMA_LOOKS,AdaptiveQuality,evenSize} from './rendering/quality.js';
import {GpuTimer} from './rendering/gpu-timer.js';
import {CinematicPipeline} from './rendering/cinematic-pipeline.js';

const QUALITIES=CINEMA_QUALITIES;
const HDR='rgba16float';
const load=async name=>{const r=await fetch(new URL(`../shaders/${name}.wgsl?v=cinema-1`,import.meta.url));if(!r.ok)throw new Error(`Shader ${name}: HTTP ${r.status}`);return r.text();};

/** Native WebGPU: analytic 3D ray tracing → compute particles → 4-level HDR bloom → film grade. */
export class FilmRenderer extends EventTarget {
  constructor(canvas,{quality='balanced',look='cinematic',adaptive=true}={}) {
    super();this.canvas=canvas;this.quality=quality in QUALITIES?quality:'balanced';
    this.values=new Float32Array(32);this.postValues=new Float32Array(8);
    this.ready=false;this.frames=0;this.gpuMs=0;this.errors=[];
    this.look=look in CINEMA_LOOKS?look:'cinematic';this.adaptiveEnabled=adaptive;
    this.adaptive=new AdaptiveQuality();this.inFlight=0;this.maxInFlight=2;this.skippedFrames=0;
    this.cpuMs=0;this.completionMs=0;this.disposed=false;this.captureLocked=false;
    this.frameContext={film:null,outputView:null,timing:null};
  }
  async init() {
    if(!navigator.gpu)throw new Error('WebGPU is not available. Open this page on HTTPS or localhost in a WebGPU-capable browser.');
    const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
    if(!adapter)throw new Error('No WebGPU adapter was returned. Check hardware acceleration in the browser settings.');
    this.adapter=adapter;this.adapterInfo={vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description};
    this.device=await adapter.requestDevice({requiredFeatures:adapter.features.has('timestamp-query')?['timestamp-query']:[]});this.device.label='Aether Odyssey GPU';
    this.device.lost.then(info=>{if(this.disposed)return;this.ready=false;this.dispatchEvent(new CustomEvent('lost',{detail:info.message||'GPU device lost.'}));});
    this.device.addEventListener('uncapturederror',e=>{this.errors.push(e.error.message);console.error(e.error.message);this.dispatchEvent(new CustomEvent('error',{detail:e.error.message}));});
    this.context=this.canvas.getContext('webgpu');
    if(!this.context)throw new Error('Cannot create a WebGPU canvas context.');
    this.format=navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({device:this.device,format:this.format,alphaMode:'opaque',
      usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
    this.requiresReadback=true;
    const d=this.device;
    const [common,scene,particles,post,fog]=await Promise.all(['common','scene','particles','cinematic-post','volumetric'].map(load));
    const particleRead=particles.slice(0,particles.indexOf('@compute')).replace('read_write','read')+particles.slice(particles.indexOf('struct ParticleVertex'));
    const modules=await Promise.all([
      this.module(common+scene,'3D ray tracing / glass / metal / atmosphere'),
      this.module(common+particles.slice(0,particles.indexOf('struct ParticleVertex')),'Deterministic orbital particle compute'),
      this.module(common+particleRead,'HDR particle rasterization'),
      this.module(post,'Cinematic bloom, anamorphic glare and film grade'),
      this.module(common+fog,'Depth-aware half-resolution volumetrics')
    ]);
    this.uniform=d.createBuffer({label:'Film camera uniforms',size:128,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    this.sampler=d.createSampler({magFilter:'linear',minFilter:'linear',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge'});
    this.engraving=await this.makeEngraving();
    const commonLayout=this.commonLayout=d.createBindGroupLayout({entries:[
      {binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT|GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},
      {binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{}},
      {binding:2,visibility:GPUShaderStage.FRAGMENT,sampler:{}}
    ]});
    this.commonGroup=d.createBindGroup({layout:commonLayout,entries:[
      {binding:0,resource:{buffer:this.uniform}}, {binding:1,resource:this.engraving.createView()}, {binding:2,resource:this.sampler}
    ]});
    const writable=d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}}]});
    const readable=d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}}]});
    this.particleBuffer=d.createBuffer({label:'32768 orbital particle records',size:32768*32,usage:GPUBufferUsage.STORAGE});
    this.computeGroup=d.createBindGroup({layout:writable,entries:[{binding:0,resource:{buffer:this.particleBuffer}}]});
    this.particleGroup=d.createBindGroup({layout:readable,entries:[{binding:0,resource:{buffer:this.particleBuffer}}]});
    const targets=[{format:HDR}];
    this.scenePipeline=await d.createRenderPipelineAsync({label:'Analytic world',layout:d.createPipelineLayout({bindGroupLayouts:[commonLayout]}),vertex:{module:modules[0],entryPoint:'fullscreen'},fragment:{module:modules[0],entryPoint:'sceneFragment',targets},primitive:{topology:'triangle-list'}});
    this.computePipeline=await d.createComputePipelineAsync({label:'Orbit integration at absolute film time',layout:d.createPipelineLayout({bindGroupLayouts:[commonLayout,writable]}),compute:{module:modules[1],entryPoint:'simulate'}});
    this.particlePipeline=await d.createRenderPipelineAsync({label:'Additive particle billboards',layout:d.createPipelineLayout({bindGroupLayouts:[commonLayout,readable]}),vertex:{module:modules[2],entryPoint:'particleVertex'},fragment:{module:modules[2],entryPoint:'particleFragment',targets:[{format:HDR,blend:{color:{srcFactor:'one',dstFactor:'one',operation:'add'},alpha:{srcFactor:'zero',dstFactor:'one',operation:'add'}}}]},primitive:{topology:'triangle-list'}});
    this.timer=new GpuTimer(d,ms=>{this.gpuMs=this.gpuMs?this.gpuMs*.8+ms*.2:ms;});
    this.cinematic=new CinematicPipeline(this);await this.cinematic.init(modules[3],modules[4]);
    this.ready=true;this.resize();return this;
  }
  async module(code,label) {
    const module=this.device.createShaderModule({label,code});
    const info=await module.getCompilationInfo();
    const errors=info.messages.filter(x=>x.type==='error');
    if(errors.length)throw new Error(`${label}\n${errors.map(x=>`${x.lineNum}:${x.linePos} ${x.message}`).join('\n')}`);
    return module;
  }
  async makeEngraving() {
    const c=document.createElement('canvas');c.width=1024;c.height=128;
    const ctx=c.getContext('2d');ctx.fillStyle='#000';ctx.fillRect(0,0,1024,128);
    ctx.fillStyle='#fff';ctx.font='300 44px Arial';ctx.textAlign='center';ctx.textBaseline='middle';
    const letters='CRYSTALBALL';const spacing=66;
    for(let i=0;i<letters.length;i++)ctx.fillText(letters[i],512+(i-(letters.length-1)/2)*spacing,64);
    const texture=this.device.createTexture({label:'Engraved wordmark',size:[1024,128],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});
    this.device.queue.copyExternalImageToTexture({source:c},{texture},[1024,128]);return texture;
  }
  setQuality(quality){
    if(!(quality in QUALITIES))throw new Error(`Unknown quality: ${quality}`);
    this.quality=quality;this.adaptive.reset();this.resize(true);
  }
  setLook(look){if(!(look in CINEMA_LOOKS))throw new Error(`Unknown cinematic look: ${look}`);this.look=look;this.resize(true);}
  setAdaptiveEnabled(value){this.adaptiveEnabled=!!value;this.adaptive.reset();}
  get canSubmit(){return this.inFlight<this.maxInFlight;}
  resize(force=false,width=0,height=0){
    if(!this.ready)return;
    const rect=this.canvas.getBoundingClientRect(),dpr=Math.min(globalThis.devicePixelRatio||1,2);
    const ow=width||rect.width*dpr,oh=height||rect.height*dpr;if(ow<2||oh<2)return;
    const q=QUALITIES[this.quality],limit=this.device.limits.maxTextureDimension2D;
    const scale=width&&height?1:Math.min(1,Math.sqrt(q.pixels/(ow*oh)));
    const [w,h]=evenSize(ow,oh,scale,limit);
    if(w!==this.width||h!==this.height){this.width=this.canvas.width=w;this.height=this.canvas.height=h;this.releaseCapture();}
    this.resizeScene(1);
  }
  resizeScene(scale){
    const q=QUALITIES[this.quality];const [w,h]=evenSize(this.width,this.height,q.sceneScale*scale);
    this.sceneWidth=w;this.sceneHeight=h;
    this.cinematic.resize(this.width,this.height,w,h,q,CINEMA_LOOKS[this.look]);
  }
  async render(film,{audioEnergy=0,wait=false,capture=false,adaptive=false}={}){
    if(!this.ready)return null;
    if(!wait&&!capture&&!this.canSubmit){this.skippedFrames++;return null;}
    const begin=performance.now();const q=QUALITIES[this.quality],look=CINEMA_LOOKS[this.look];
    const scalable=adaptive&&this.adaptiveEnabled&&!capture&&!this.captureLocked;
    const scale=scalable?this.adaptive.scale:1;
    this.resizeScene(scale);
    const basis=cameraBasis(film.camera,film.target),{forward,right,up}=basis;
    // Fixed arrays are reused. Internal rendering and native presentation are independent.
    const v=this.values;v[0]=this.sceneWidth;v[1]=this.sceneHeight;v[2]=film.time;v[3]=this.width/this.height;
    v.set(film.camera,4);v[7]=Math.tan(film.fov*Math.PI/360);
    v.set(right,8);v[11]=film.world;v.set(up,12);v[15]=film.energy*(1+Math.min(.12,audioEnergy*.12));
    v.set(forward,16);v[19]=film.explode;
    v[20]=film.sun;v[21]=film.fade;v[22]=Math.max(12,Math.round(q.steps*(.72+.28*scale)));v[23]=audioEnergy;
    v[24]=0;v[25]=.47+film.explode*1.44;v[26]=0;v[27]=1.15;
    this.activeParticles=Math.max(128,Math.floor(q.particles*(.5+.5*scale)/128)*128);
    v[28]=scale;v[29]=look.intensity;v[30]=Math.max(6,Math.round(q.fogSteps*scale));v[31]=this.activeParticles;
    this.device.queue.writeBuffer(this.uniform,0,v);this.cinematic.update(film,look,basis);
    const enc=this.device.createCommandEncoder({label:'Cinematic film frame'});
    const output=this.context.getCurrentTexture();const f=this.frameContext;
    f.film=film;f.outputView=output.createView();f.timing=this.timer.begin(this.frames);
    this.cinematic.encode(enc,f);
    let readback=null;
    if(capture){
      const layout=readbackLayout(this.width,this.height);
      if(!this.captureBuffer||this.captureBuffer.size!==layout.size){
        this.releaseCapture();this.captureBuffer=this.device.createBuffer({label:'Recording RGBA readback',size:layout.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      }
      readback=this.captureBuffer;
      enc.copyTextureToBuffer({texture:output},{buffer:readback,bytesPerRow:layout.bytesPerRow},[this.width,this.height]);
    }
    const timing=f.timing;this.timer.resolve(enc,timing);
    this.device.queue.submit([enc.finish()]);this.frames++;this.inFlight++;
    const submissionEnd=performance.now();this.cpuMs=this.cpuMs*.9+(submissionEnd-begin)*.1;
    this.timer.collect(timing);
    // A fence releases backpressure asynchronously; playback does NOT await it.
    const completed=this.device.queue.onSubmittedWorkDone();
    completed.then(()=>{
      const ms=performance.now()-submissionEnd;this.completionMs=this.completionMs*.9+ms*.1;
      if(!this.timer.enabled)this.gpuMs=this.completionMs;
      if(!this.disposed)this.adaptive.observe(this.timer.samples?this.gpuMs:ms,performance.now(),{locked:!scalable||this.captureLocked});
    }).catch(()=>{}).finally(()=>{this.inFlight=Math.max(0,this.inFlight-1);});
    if(readback){
      await readback.mapAsync(GPUMapMode.READ);
      try{return new ImageData(unpackCapturePixels(new Uint8Array(readback.getMappedRange()),this.width,this.height,this.format),this.width,this.height);}
      finally{readback.unmap();}
    }
    if(wait)await completed;
    return null;
  }
  get diagnostics(){return {
    engine:'Cinematic WebGPU 3',output:[this.width,this.height],internal:[this.sceneWidth,this.sceneHeight],
    quality:this.quality,look:this.look,adaptiveEnabled:this.adaptiveEnabled,adaptiveScale:this.adaptive.scale,
    inFlight:this.inFlight,maxInFlight:this.maxInFlight,skippedFrames:this.skippedFrames,
    cpuSubmissionMs:this.cpuMs,completionLatencyMs:this.completionMs,
    gpuTimestampMs:this.timer?.enabled?this.gpuMs:null,timestampSamples:this.timer?.samples||0,
    particles:this.activeParticles,...this.cinematic?.diagnostics};}
  releaseCapture(){this.captureBuffer?.destroy();this.captureBuffer=null;}
  dispose(){
    if(this.disposed)return;this.disposed=true;this.ready=false;this.releaseCapture();this.timer?.dispose();this.cinematic?.dispose();
    this.uniform?.destroy();this.particleBuffer?.destroy();this.engraving?.destroy();this.context?.unconfigure();this.device?.destroy();
  }
}

/** Texture-to-buffer rows must be 256-byte aligned; dimensions need not be. */
export function readbackLayout(width,height){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)throw new RangeError('Invalid capture dimensions.');
 const bytesPerRow=Math.ceil(width*4/256)*256;
 return {bytesPerRow,size:bytesPerRow*height};
}
export function unpackCapturePixels(bytes,width,height,format){
 const {bytesPerRow,size}=readbackLayout(width,height);
 if(bytes.byteLength<size)throw new RangeError('Incomplete GPU capture buffer.');
 if(format!=='rgba8unorm'&&format!=='bgra8unorm')throw new Error(`Unsupported capture format: ${format}`);
 const pixels=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)pixels.set(bytes.subarray(y*bytesPerRow,y*bytesPerRow+width*4),y*width*4);
 if(format==='bgra8unorm')for(let i=0;i<pixels.length;i+=4){const blue=pixels[i];pixels[i]=pixels[i+2];pixels[i+2]=blue;}
 return pixels;
}
