import {FrameGraph} from './frame-graph.js';
import {RenderTargetPool} from './target-pool.js';

/** Cached full-screen triangle pass; no per-frame bind groups or attachment arrays. */
export class FullscreenPass {
  constructor({label,pipeline,group,view,loadOp='clear'}){
    Object.assign(this,{pipeline,group});
    this.descriptor={label,colorAttachments:[{view,loadOp,storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]};
  }
  run(encoder,{view,timestampWrites}={}){
    if(view)this.descriptor.colorAttachments[0].view=view;
    this.descriptor.timestampWrites=timestampWrites;
    const pass=encoder.beginRenderPass(this.descriptor);pass.setPipeline(this.pipeline);pass.setBindGroup(0,this.group);pass.draw(3);pass.end();
  }
}
/** Compiled graph and leased HDR resources. Setup cost is paid only on extent/look changes. */
export class CinematicPipeline {
  constructor(renderer){
    this.r=renderer;this.device=renderer.device;this.pool=new RenderTargetPool(this.device);
    this.targets=[];this.buffers=[];this.rebuilds=0;this.pipelineCount=0;
    this.parameters=new Float32Array(20);this.graph=null;this.key=null;
  }
  async init(postModule,fogModule){
    const d=this.device;
    const entries=[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{}},{binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{}},{binding:2,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}];
    this.singleLayout=d.createBindGroupLayout({entries});
    this.upLayout=d.createBindGroupLayout({entries:[...entries,{binding:3,visibility:GPUShaderStage.FRAGMENT,texture:{}}]});
    this.finishLayout=d.createBindGroupLayout({entries:[...entries,...[3,4,5].map(binding=>({binding,visibility:GPUShaderStage.FRAGMENT,texture:{}}))]});
    this.fogLayout=d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{}},{binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{}}]});
    const create=(entry,layout,format)=>d.createRenderPipelineAsync({label:entry,
      layout:d.createPipelineLayout({bindGroupLayouts:[layout]}),vertex:{module:postModule,entryPoint:'cineVertex'},
      fragment:{module:postModule,entryPoint:entry,targets:[{format}]},primitive:{topology:'triangle-list'}});
    [this.down,this.up,this.streak,this.finish,this.fog]=await Promise.all([
      create('bloomDown',this.singleLayout,'rgba16float'),create('bloomUp',this.upLayout,'rgba16float'),
      create('anamorphic',this.singleLayout,'rgba16float'),create('cineFinish',this.finishLayout,this.r.format),
      d.createRenderPipelineAsync({label:'Depth-bounded half-resolution volumetric lighting',
        layout:d.createPipelineLayout({bindGroupLayouts:[this.r.commonLayout,this.fogLayout]}),
        vertex:{module:fogModule,entryPoint:'fullscreen'},fragment:{module:fogModule,entryPoint:'fogFragment',targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list'}})
    ]);
    this.pipelineCount=5;
    this.uniform=d.createBuffer({label:'Cinematic frame settings',size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    this.black=d.createTexture({label:'Disabled effect fallback',size:[1,1],format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
    d.queue.writeTexture({texture:this.black},new Uint16Array(4),{bytesPerRow:8},[1,1]);this.blackView=this.black.createView();
  }
  target(width,height,label){
    const t=this.pool.acquire({width,height,label,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});this.targets.push(t);return t;
  }
  group(layout,input,buffer,others=[]){
    return this.device.createBindGroup({layout,entries:[{binding:0,resource:input.view},{binding:1,resource:this.r.sampler},{binding:2,resource:{buffer}},...others.map((view,i)=>({binding:i+3,resource:view}))]});
  }
  constant(threshold=0){const b=this.device.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});const v=new Float32Array(20);v[4]=threshold;this.device.queue.writeBuffer(b,0,v);this.buffers.push(b);return b;}
  resize(width,height,sceneWidth,sceneHeight,quality,look){
    const key=`${width}/${height}/${sceneWidth}/${sceneHeight}/${quality.bloomLevels}/${look.streak>0}/${look.fog>0}`;
    if(this.key===key)return;this.key=key;this.rebuilds++;
    for(const t of this.targets)this.pool.release(t);for(const b of this.buffers)b.destroy();this.targets=[];this.buffers=[];
    const r=this.r,d=this.device,g=new FrameGraph();
    this.hdr=this.target(sceneWidth,sceneHeight,'Linear HDR / ray distance');
    const scenePass=new FullscreenPass({label:'Analytic product and starfield',pipeline:r.scenePipeline,group:r.commonGroup,view:this.hdr.view});
    g.add('scene',{writes:['sceneHDR'],run:(e,f)=>scenePass.run(e,{timestampWrites:r.timer.writes(f.timing)})});
    g.add('particle-compute',{writes:['particleData'],after:['scene'],run:(e,f)=>{
      if(f.film.world<.5)return;const p=e.beginComputePass({label:'Time-addressable energy and dust'});p.setPipeline(r.computePipeline);p.setBindGroup(0,r.commonGroup);p.setBindGroup(1,r.computeGroup);p.dispatchWorkgroups(Math.ceil(r.activeParticles/128));p.end();
    }});
    const particleDesc={label:'HDR orbital trails and atmospheric motes',colorAttachments:[{view:this.hdr.view,loadOp:'load',storeOp:'store'}]};
    g.add('particles',{reads:['sceneHDR','particleData'],writes:['litHDR'],run:(e,f)=>{
      if(f.film.world<.5)return;const p=e.beginRenderPass(particleDesc);p.setPipeline(r.particlePipeline);p.setBindGroup(0,r.commonGroup);p.setBindGroup(1,r.particleGroup);p.draw(6,r.activeParticles);p.end();
    }});
    const pyramid=[];let prev=this.hdr,previousName='litHDR';const noThreshold=this.constant(0),threshold=this.constant(1);
    for(let i=0;i<quality.bloomLevels;i++){
      const t=this.target(Math.max(2,sceneWidth>>(i+1)),Math.max(2,sceneHeight>>(i+1)),`Bloom down ${i}`);pyramid.push(t);
      const pass=new FullscreenPass({label:`Fused bloom down ${i}`,pipeline:this.down,group:this.group(this.singleLayout,prev,i===0?threshold:noThreshold),view:t.view});
      const name=`bloom-down-${i}`;g.add(name,{reads:[previousName],writes:[name],run:e=>pass.run(e)});prev=t;previousName=name;
    }
    for(let i=pyramid.length-2;i>=0;i--){
      const t=this.target(pyramid[i].width,pyramid[i].height,`Bloom up ${i}`);
      const pass=new FullscreenPass({label:`Tent bloom up ${i}`,pipeline:this.up,group:this.group(this.upLayout,prev,noThreshold,[pyramid[i].view]),view:t.view});
      const name=`bloom-up-${i}`;g.add(name,{reads:[previousName,`bloom-down-${i}`],writes:[name],run:e=>pass.run(e)});prev=t;previousName=name;
    }
    this.bloom=prev;let streakView=this.blackView,fogView=this.blackView;const finalReads=['litHDR',previousName];
    if(look.streak>0){
      const input=pyramid[Math.min(2,pyramid.length-1)];const t=this.target(input.width,input.height,'1/8 resolution anamorphic glare');streakView=t.view;
      const pass=new FullscreenPass({label:'Anamorphic streaks',pipeline:this.streak,group:this.group(this.singleLayout,input,noThreshold),view:t.view});
      g.add('anamorphic',{reads:[`bloom-down-${Math.min(2,pyramid.length-1)}`],writes:['glare'],run:e=>pass.run(e)});finalReads.push('glare');
    }
    if(look.fog>0){
      const t=this.target(Math.max(2,Math.floor(sceneWidth*quality.fogScale)),Math.max(2,Math.floor(sceneHeight*quality.fogScale)),'Half-resolution depth-aware fog');fogView=t.view;
      const group=d.createBindGroup({layout:this.fogLayout,entries:[{binding:0,resource:this.hdr.view},{binding:1,resource:r.sampler}]});
      const desc={label:'Volumetric shafts and haze',colorAttachments:[{view:t.view,loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]};
      g.add('volumetrics',{reads:['litHDR'],writes:['fog'],run:e=>{const p=e.beginRenderPass(desc);p.setPipeline(this.fog);p.setBindGroup(0,r.commonGroup);p.setBindGroup(1,group);p.draw(3);p.end();}});finalReads.push('fog');
    }
    const finalPass=new FullscreenPass({label:'Reconstruction / shockwave / glare / grade',pipeline:this.finish,
      group:this.group(this.finishLayout,this.hdr,this.uniform,[this.bloom.view,streakView,fogView]),view:this.hdr.view});
    g.add('composite',{reads:finalReads,writes:['present'],run:(e,f)=>finalPass.run(e,{view:f.outputView,timestampWrites:r.timer.writes(f.timing,true)})});
    this.graph=g.compile();
  }
  update(film,look,cameraBasis){
    const r=this.r,p=this.parameters;const [cx,cy,cz]=film.camera;const y=.47+film.explode*1.44;
    const dx=-cx,dy=y-cy,dz=-cz;const {right,up,forward}=cameraBasis;
    const depth=dx*forward[0]+dy*forward[1]+dz*forward[2];const tan=Math.tan(film.fov*Math.PI/360);
    const sx=.5+(dx*right[0]+dy*right[1]+dz*right[2])/Math.max(.1,depth*tan*r.width/r.height)*.5;
    const sy=.5-(dx*up[0]+dy*up[1]+dz*up[2])/Math.max(.1,depth*tan)*.5;
    // Time-addressable hero pulses, never event-accumulated: seeking is reproducible.
    const pulseAge=film.time>=73?film.time-73:film.time-39.5;
    const pulse=pulseAge>0&&pulseAge<3?Math.sin(Math.PI*pulseAge/3)*Math.exp(-pulseAge*.8)*look.intensity:0;
    p.set([r.width,r.height,r.sceneWidth,r.sceneHeight],0);
    p.set([look.bloom,look.streak,film.world<.5?0:look.fog,r.sceneWidth<r.width?.32:0],4);
    p.set([film.time,film.fade,look.exposure,look.intensity],8);
    p.set([Math.max(-2,Math.min(3,sx)),Math.max(-2,Math.min(3,sy)),depth>0?pulse:0,Math.max(0,pulseAge)*.28],12);
    p.set([0,0,0,0],16);this.device.queue.writeBuffer(this.uniform,0,p);
  }
  encode(encoder,frame){this.graph.execute(encoder,frame);}
  get diagnostics(){return {passes:this.graph?.passes||[],rebuilds:this.rebuilds,pipelines:this.pipelineCount,targets:this.pool.stats};}
  dispose(){this.pool.dispose();for(const b of this.buffers)b.destroy();this.uniform?.destroy();this.black?.destroy();}
}
