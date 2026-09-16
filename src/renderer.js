import { cameraBasis } from './director.js';

const QUALITIES = {
  preview: {pixels:580_000,steps:20,particles:4096},
  balanced: {pixels:1_300_000,steps:32,particles:12288},
  cinema: {pixels:2_100_000,steps:46,particles:24576},
  ultra: {pixels:8_300_000,steps:52,particles:32768}
};
const HDR='rgba16float';
const load=async name=>{const r=await fetch(new URL(`../shaders/${name}.wgsl`,import.meta.url));if(!r.ok)throw new Error(`Shader ${name}: HTTP ${r.status}`);return r.text();};

/** Native WebGPU: analytic 3D ray tracing → compute particles → 4-level HDR bloom → film grade. */
export class FilmRenderer extends EventTarget {
  constructor(canvas,{quality='balanced'}={}) {
    super();this.canvas=canvas;this.quality=quality in QUALITIES?quality:'balanced';
    this.values=new Float32Array(32);this.postValues=new Float32Array(8);
    this.resources=[];this.ready=false;this.frames=0;this.gpuMs=0;this.errors=[];
  }
  async init() {
    if(!navigator.gpu)throw new Error('WebGPU is not available. Open this page on HTTPS or localhost in a WebGPU-capable browser.');
    const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
    if(!adapter)throw new Error('No WebGPU adapter was returned. Check hardware acceleration in the browser settings.');
    this.adapterInfo={...adapter.info};
    this.device=await adapter.requestDevice();this.device.label='Aether Odyssey GPU';
    this.device.lost.then(info=>{this.ready=false;this.dispatchEvent(new CustomEvent('lost',{detail:info.message||'GPU device lost.'}));});
    this.device.addEventListener('uncapturederror',e=>{this.errors.push(e.error.message);console.error(e.error.message);this.dispatchEvent(new CustomEvent('error',{detail:e.error.message}));});
    this.context=this.canvas.getContext('webgpu');
    if(!this.context)throw new Error('Cannot create a WebGPU canvas context.');
    this.format=navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({device:this.device,format:this.format,alphaMode:'opaque'});
    const d=this.device;
    const [common,scene,particles,post]=await Promise.all(['common','scene','particles','post'].map(load));
    const particleRead=particles.slice(0,particles.indexOf('@compute')).replace('read_write','read')+particles.slice(particles.indexOf('struct ParticleVertex'));
    const modules=await Promise.all([
      this.module(common+scene,'3D ray tracing / glass / metal / atmosphere'),
      this.module(common+particles.slice(0,particles.indexOf('struct ParticleVertex')),'Deterministic orbital particle compute'),
      this.module(common+particleRead,'HDR particle rasterization'),
      this.module(post,'Bloom and film grade')
    ]);
    this.uniform=d.createBuffer({label:'Film camera uniforms',size:128,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    this.sampler=d.createSampler({magFilter:'linear',minFilter:'linear',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge'});
    this.engraving=await this.makeEngraving();
    const commonLayout=d.createBindGroupLayout({entries:[
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
    const entries=[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{}},{binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{}},{binding:2,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}];
    this.postLayout=d.createBindGroupLayout({entries});
    this.finalLayout=d.createBindGroupLayout({entries:[...entries,...[3,4,5,6].map(binding=>({binding,visibility:GPUShaderStage.FRAGMENT,texture:{}}))]});
    const postDesc=(entry,layout,format)=>({layout:d.createPipelineLayout({bindGroupLayouts:[layout]}),vertex:{module:modules[3],entryPoint:'vs'},fragment:{module:modules[3],entryPoint:entry,targets:[{format}]},primitive:{topology:'triangle-list'}});
    [this.downPipeline,this.blurPipeline,this.finalPipeline]=await Promise.all([
      d.createRenderPipelineAsync(postDesc('down',this.postLayout,HDR)),d.createRenderPipelineAsync(postDesc('blur',this.postLayout,HDR)),d.createRenderPipelineAsync(postDesc('finish',this.finalLayout,this.format))
    ]);
    this.finalUniform=d.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
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
  setQuality(quality) {if(!(quality in QUALITIES))throw new Error(`Unknown quality: ${quality}`);this.quality=quality;this.resize(true);}
  texture(w,h,label) {
    const t=this.device.createTexture({label,size:[w,h],format:HDR,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});this.resources.push(t);return t;
  }
  makePostGroup(texture,values) {
    const buffer=this.device.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    this.device.queue.writeBuffer(buffer,0,new Float32Array(values));this.resources.push(buffer);
    return this.device.createBindGroup({layout:this.postLayout,entries:[{binding:0,resource:texture.createView()},{binding:1,resource:this.sampler},{binding:2,resource:{buffer}}]});
  }
  resize(force=false,width=0,height=0) {
    if(!this.ready)return;
    const rect=this.canvas.getBoundingClientRect();const dpr=Math.min(devicePixelRatio||1,2);
    let w=Math.round(width||rect.width*dpr),h=Math.round(height||rect.height*dpr);
    if(w<2||h<2)return;
    const max=this.device.limits.maxTextureDimension2D;
    let scale=Math.min(1,Math.sqrt(QUALITIES[this.quality].pixels/(w*h)),max/w,max/h);
    if(width&&height)scale=Math.min(1,max/w,max/h);
    w=Math.max(2,Math.round(w*scale/2)*2);h=Math.max(2,Math.round(h*scale/2)*2);
    if(!force&&this.width===w&&this.height===h)return;
    for(const resource of this.resources)resource.destroy();this.resources=[];
    this.width=this.canvas.width=w;this.height=this.canvas.height=h;
    this.hdr=this.texture(w,h,'Full HDR scene');this.hdrView=this.hdr.createView();
    this.bloom=[];let prev=this.hdr;this.passes=[];
    for(let i=0;i<4;i++) {
      const bw=Math.max(2,w>>(i+1)),bh=Math.max(2,h>>(i+1));
      const a=this.texture(bw,bh,`Bloom ${i} / vertical`),b=this.texture(bw,bh,`Bloom ${i} / horizontal`);
      this.passes.push({pipeline:this.downPipeline,group:this.makePostGroup(prev,[bw,bh,0,0,i===0?1:0,0,0,0]),view:a.createView()});
      this.passes.push({pipeline:this.blurPipeline,group:this.makePostGroup(a,[bw,bh,1,0,0,0,0,0]),view:b.createView()});
      this.passes.push({pipeline:this.blurPipeline,group:this.makePostGroup(b,[bw,bh,0,1,0,0,0,0]),view:a.createView()});
      this.bloom.push(a);prev=a;
    }
    this.finalGroup=this.device.createBindGroup({layout:this.finalLayout,entries:[
      {binding:0,resource:this.hdrView},{binding:1,resource:this.sampler},{binding:2,resource:{buffer:this.finalUniform}},
      ...this.bloom.map((t,i)=>({binding:i+3,resource:t.createView()}))
    ]});
  }
  drawPass(encoder,pipeline,group,view,label='Post process') {
    const pass=encoder.beginRenderPass({label,colorAttachments:[{view,loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});
    pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.draw(3);pass.end();
  }
  async render(film,{audioEnergy=0,wait=false}={}) {
    if(!this.ready)return;
    const start=performance.now();const {forward,right,up}=cameraBasis(film.camera,film.target);const q=QUALITIES[this.quality];
    this.values.set([this.width,this.height,film.time,this.width/this.height],0);
    this.values.set([...film.camera,Math.tan(film.fov*Math.PI/360)],4);
    this.values.set([...right,film.world],8);this.values.set([...up,film.energy*(1+Math.min(.12,audioEnergy*.12))],12);
    this.values.set([...forward,film.explode],16);
    this.values.set([film.sun,film.fade,q.steps,audioEnergy],20);
    this.values.set([0,.47+film.explode*1.44,0,1.15],24);
    this.values.set([1,0,0,0],28);
    this.device.queue.writeBuffer(this.uniform,0,this.values);
    this.postValues.set([this.width,this.height,0,0,0,film.fade,film.time,0]);
    this.device.queue.writeBuffer(this.finalUniform,0,this.postValues);
    const enc=this.device.createCommandEncoder({label:`Film ${film.time.toFixed(3)}`});
    if(film.world>.5){const cp=enc.beginComputePass({label:'Time-addressable particle field'});cp.setPipeline(this.computePipeline);cp.setBindGroup(0,this.commonGroup);cp.setBindGroup(1,this.computeGroup);cp.dispatchWorkgroups(Math.ceil(q.particles/128));cp.end();}
    this.drawPass(enc,this.scenePipeline,this.commonGroup,this.hdrView,'Ray-trace analytic world');
    if(film.world>.5) {
      const pass=enc.beginRenderPass({label:'Luminous orbital particles',colorAttachments:[{view:this.hdrView,loadOp:'load',storeOp:'store'}]});
      pass.setPipeline(this.particlePipeline);pass.setBindGroup(0,this.commonGroup);pass.setBindGroup(1,this.particleGroup);pass.draw(6,q.particles);pass.end();
    }
    for(const p of this.passes)this.drawPass(enc,p.pipeline,p.group,p.view);
    this.drawPass(enc,this.finalPipeline,this.finalGroup,this.context.getCurrentTexture().createView(),'Tone mapping / fine grain');
    this.device.queue.submit([enc.finish()]);this.frames++;
    if(wait){await this.device.queue.onSubmittedWorkDone();this.gpuMs=this.gpuMs*.9+(performance.now()-start)*.1;}
  }
  dispose(){this.ready=false;for(const r of this.resources)r.destroy();this.uniform?.destroy();this.finalUniform?.destroy();this.particleBuffer?.destroy();this.engraving?.destroy();this.context?.unconfigure();this.device?.destroy();}
}
