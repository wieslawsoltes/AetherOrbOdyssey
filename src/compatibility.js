import {cameraBasis} from './director.js';
/** WebGL2 compatibility, explicitly labelled. Native WebGPU is never misrepresented. */
const GL_VERTEX=`#version 300 es
precision highp float;out vec2 vUv;
void main(){vec2 p=gl_VertexID==0?vec2(-1,-1):gl_VertexID==1?vec2(3,-1):vec2(-1,3);gl_Position=vec4(p,0,1);vUv=p*vec2(.5,-.5)+.5;}`;
const GL_POST_VERTEX=GL_VERTEX.replace('vec2(.5,-.5)','vec2(.5,.5)');
const GL_POST=`#version 300 es
precision highp float;in vec2 vUv;out vec4 fragColor;uniform sampler2D inputTexture;uniform sampler2D bloom0;uniform sampler2D bloom1;uniform sampler2D bloom2;uniform sampler2D bloom3;uniform vec4 settings;uniform vec4 params;
vec3 aces(vec3 c){return clamp((c*(2.51*c+.03))/(c*(2.43*c+.59)+.14),0.,1.);}
void main(){vec2 uv=vUv;vec3 c;
 if(settings.x<.5){vec2 px=1./vec2(textureSize(inputTexture,0));c=(texture(inputTexture,uv+px*vec2(-1,-1)).rgb+texture(inputTexture,uv+px*vec2(1,-1)).rgb+texture(inputTexture,uv+px*vec2(-1,1)).rgb+texture(inputTexture,uv+px*vec2(1,1)).rgb)*.25;if(settings.y>.5){float lum=max(c.r,max(c.g,c.b));c*=max(0.,lum-.80)/max(lum,.001);}}
 else if(settings.x<1.5){vec2 step=settings.zw/vec2(textureSize(inputTexture,0));c=texture(inputTexture,uv).rgb*.227027;c+=(texture(inputTexture,uv+step*1.384615).rgb+texture(inputTexture,uv-step*1.384615).rgb)*.316216;c+=(texture(inputTexture,uv+step*3.230769).rgb+texture(inputTexture,uv-step*3.230769).rgb)*.070270;}
 else {vec2 p=uv-.5;vec2 chroma=p*dot(p,p)*.0009;c=vec3(texture(inputTexture,uv+chroma).r,texture(inputTexture,uv).g,texture(inputTexture,uv-chroma).b);c+=texture(bloom0,uv).rgb*.25+texture(bloom1,uv).rgb*.25+texture(bloom2,uv).rgb*.24+texture(bloom3,uv).rgb*.24;float vignette=1.-dot(p*vec2(.83,1.),p*vec2(.83,1.))*.55;c=pow(aces(c*1.30*vignette)*params.x,vec3(1./2.2));float grain=fract(sin(dot(floor(uv*params.zw),vec2(12.9898,78.233))+floor(params.y*24.)*.17)*43758.5453);c+=(grain-.5)*.0035;}
 fragColor=vec4(max(c,0.),1.);}`;
const GL_PARTICLE_VERTEX=`#version 300 es
precision highp float;uniform vec4 cam;uniform vec4 right;uniform vec4 up;uniform vec4 forward;uniform vec4 orb;uniform vec4 film;out vec2 particleUV;out vec4 particleColor;
float h(float x){return fract(sin(x*127.1)*43758.5453);}vec3 rx(vec3 p,float a){float c=cos(a),s=sin(a);return vec3(p.x,c*p.y-s*p.z,s*p.y+c*p.z);}vec3 rz(vec3 p,float a){float c=cos(a),s=sin(a);return vec3(c*p.x-s*p.y,s*p.x+c*p.y,p.z);}
void main(){float f=float(gl_InstanceID),r1=h(f*.871+3.12),r2=h(f*2.131+9.4),r3=h(f*.12+7.9);float t=film.x,arm=float(gl_InstanceID%5),a=r1*6.283185+t*(.14+r2*.09),r=.23+r2*.61,tube=.038*(r3-.5);vec3 p=vec3(cos(a)*r,tube+sin(a*3.+t*.21)*.055,sin(a)*r);p=rx(rz(p,arm*.63+.24),arm*.74+.40);p+=vec3(sin(a*5.+f)*tube,cos(a*4.+f)*tube,0);p=orb.xyz+p*orb.w;vec3 d=p-cam.xyz;float z=dot(d,forward.xyz);vec2 xy=vec2(dot(d,right.xyz)/film.y,dot(d,up.xyz))/cam.w;vec2 c=gl_VertexID==0?vec2(-1,-1):gl_VertexID==1?vec2(1,-1):gl_VertexID==2?vec2(-1,1):gl_VertexID==3?vec2(-1,1):gl_VertexID==4?vec2(1,-1):vec2(1,1);float size=mix(.0009,.0033,pow(r3,7.))*2.3;gl_Position=vec4(xy+c*vec2(size/film.y,size)/cam.w,z*.99,max(z,.001));if(z<.03)gl_Position=vec4(5,5,0,1);particleUV=c;particleColor=vec4(mix(vec3(.12,.55,1.),vec3(.71,.33,1.),r2),(.26+.74*pow(.5+.5*sin(a*3.-t*.41),4.))*(.5+r3)*film.z);}`;
const GL_PARTICLE_FRAGMENT=`#version 300 es
precision highp float;in vec2 particleUV;in vec4 particleColor;out vec4 fragColor;void main(){float r=dot(particleUV,particleUV);float g=exp(-r*4.)*(1.-smoothstep(.55,1.,r));fragColor=vec4(particleColor.rgb*particleColor.a*g*.85,0);}`;
const GL_QUALITY={preview:{pixels:580000,steps:20,particles:4096},balanced:{pixels:1300000,steps:32,particles:12288},cinema:{pixels:2100000,steps:46,particles:24576},ultra:{pixels:8300000,steps:52,particles:32768}};
const loadCompat=async()=>{const r=await fetch(new URL('../shaders/compat-scene.glsl?v=cinema-1',import.meta.url));if(!r.ok)throw new Error('Cannot load compatibility shader.');return r.text();};
export class CompatibilityRenderer extends EventTarget {
 constructor(canvas,{quality='balanced'}={}){super();this.canvas=canvas;this.quality=quality in GL_QUALITY?quality:'balanced';this.errors=[];this.frames=0;this.gpuMs=0;this.resources=[];this.backend='WebGL2 compatibility';}
 async init(){
  const gl=this.gl=this.canvas.getContext('webgl2',{alpha:false,antialias:false,preserveDrawingBuffer:true,powerPreference:'high-performance'});
  if(!gl)throw new Error('Neither WebGPU nor the WebGL2 compatibility renderer is available.');
  if(!gl.getExtension('EXT_color_buffer_float'))throw new Error('Floating-point render targets are unavailable.');
  gl.getExtension('OES_texture_float_linear');this.scene=this.program(GL_VERTEX,await loadCompat());this.post=this.program(GL_POST_VERTEX,GL_POST);this.particles=this.program(GL_PARTICLE_VERTEX,GL_PARTICLE_FRAGMENT);
  this.vao=gl.createVertexArray();gl.bindVertexArray(this.vao);
  this.device={queue:{onSubmittedWorkDone:async()=>{gl.finish();}},limits:{maxTextureDimension2D:gl.getParameter(gl.MAX_TEXTURE_SIZE)}};
  const debug=gl.getExtension('WEBGL_debug_renderer_info');this.adapterInfo={backend:this.backend,renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};
  const c=document.createElement('canvas');c.width=1024;c.height=128;const ctx=c.getContext('2d');ctx.fillStyle='#000';ctx.fillRect(0,0,1024,128);ctx.fillStyle='#fff';ctx.font='300 44px Arial';ctx.textAlign='center';ctx.textBaseline='middle';const letters='CRYSTALBALL';for(let i=0;i<letters.length;i++)ctx.fillText(letters[i],512+(i-(letters.length-1)/2)*66,64);
  this.engraving=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.engraving);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,c);this.textureParams();
  this.canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.ready=false;this.dispatchEvent(new CustomEvent('lost',{detail:'The WebGL2 compatibility context was lost.'}));});
  this.ready=true;this.resize();return this;
 }
 program(vs,fs){const g=this.gl;const compile=(type,source)=>{const s=g.createShader(type);g.shaderSource(s,source);g.compileShader(s);if(!g.getShaderParameter(s,g.COMPILE_STATUS)){const msg=g.getShaderInfoLog(s);this.errors.push(msg);throw new Error(msg);}return s;};const p=g.createProgram();const v=compile(g.VERTEX_SHADER,vs),f=compile(g.FRAGMENT_SHADER,fs);g.attachShader(p,v);g.attachShader(p,f);g.linkProgram(p);g.deleteShader(v);g.deleteShader(f);if(!g.getProgramParameter(p,g.LINK_STATUS))throw new Error(g.getProgramInfoLog(p));return {p,locations:new Map()};}
 location(p,n){if(!p.locations.has(n))p.locations.set(n,this.gl.getUniformLocation(p.p,n));return p.locations.get(n);}
 v4(p,n,a){this.gl.uniform4fv(this.location(p,n),a);}
 textureParams(){const g=this.gl;g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);}
 target(w,h){const g=this.gl,t=g.createTexture();g.bindTexture(g.TEXTURE_2D,t);g.texImage2D(g.TEXTURE_2D,0,g.RGBA16F,w,h,0,g.RGBA,g.HALF_FLOAT,null);this.textureParams();const fb=g.createFramebuffer();g.bindFramebuffer(g.FRAMEBUFFER,fb);g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_2D,t,0);if(g.checkFramebufferStatus(g.FRAMEBUFFER)!==g.FRAMEBUFFER_COMPLETE)throw new Error('Incomplete HDR framebuffer.');const result={t,fb,w,h};this.resources.push(result);return result;}
 setQuality(q){if(!(q in GL_QUALITY))throw new Error('Unknown quality');this.quality=q;this.resize(true);}
 resize(force=false,width=0,height=0){if(!this.ready)return;const rect=this.canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);let w=Math.round(width||rect.width*dpr),h=Math.round(height||rect.height*dpr);if(w<2||h<2)return;const max=this.device.limits.maxTextureDimension2D;let scale=Math.min(1,Math.sqrt(GL_QUALITY[this.quality].pixels/(w*h)),max/w,max/h);if(width&&height)scale=Math.min(1,max/w,max/h);w=Math.max(2,Math.round(w*scale/2)*2);h=Math.max(2,Math.round(h*scale/2)*2);if(!force&&w===this.width&&h===this.height)return;const g=this.gl;for(const r of this.resources){g.deleteTexture(r.t);g.deleteFramebuffer(r.fb);}this.resources=[];this.width=this.canvas.width=w;this.height=this.canvas.height=h;this.hdr=this.target(w,h);this.bloom=[];for(let i=0;i<4;i++)this.bloom.push([this.target(Math.max(2,w>>(i+1)),Math.max(2,h>>(i+1))),this.target(Math.max(2,w>>(i+1)),Math.max(2,h>>(i+1)))]);}
 tex(p,name,t,unit){const g=this.gl;g.activeTexture(g.TEXTURE0+unit);g.bindTexture(g.TEXTURE_2D,t);g.uniform1i(this.location(p,name),unit);}
 postPass(src,dst,settings){const g=this.gl;g.bindFramebuffer(g.FRAMEBUFFER,dst.fb);g.viewport(0,0,dst.w,dst.h);g.useProgram(this.post.p);this.tex(this.post,'inputTexture',src.t,0);for(let i=0;i<4;i++)g.uniform1i(this.location(this.post,`bloom${i}`),0);this.v4(this.post,'settings',settings);g.drawArrays(g.TRIANGLES,0,3);}
 async render(f,{audioEnergy=0,wait=false}={}){
  if(!this.ready)return;const start=performance.now(),g=this.gl,{right,up,forward}=cameraBasis(f.camera,f.target),q=GL_QUALITY[this.quality],tan=Math.tan(f.fov*Math.PI/360),aspect=this.width/this.height,energy=f.energy*(1+Math.min(.12,audioEnergy*.12)),orb=[0,.47+f.explode*1.44,0,1.15];
  g.bindVertexArray(this.vao);g.disable(g.BLEND);g.bindFramebuffer(g.FRAMEBUFFER,this.hdr.fb);g.viewport(0,0,this.width,this.height);g.useProgram(this.scene.p);
  this.v4(this.scene,'u.resolution',[this.width,this.height,f.time,aspect]);this.v4(this.scene,'u.camera',[...f.camera,tan]);this.v4(this.scene,'u.right',[...right,f.world]);this.v4(this.scene,'u.up',[...up,energy]);this.v4(this.scene,'u.forward',[...forward,f.explode]);this.v4(this.scene,'u.parameters',[f.sun,f.fade,q.steps,audioEnergy]);this.v4(this.scene,'u.orb',orb);this.v4(this.scene,'u.extra',[1,0,0,0]);this.tex(this.scene,'engraving',this.engraving,0);g.drawArrays(g.TRIANGLES,0,3);
  if(f.world>.5){g.enable(g.BLEND);g.blendFunc(g.ONE,g.ONE);g.useProgram(this.particles.p);this.v4(this.particles,'cam',[...f.camera,tan]);this.v4(this.particles,'right',[...right,0]);this.v4(this.particles,'up',[...up,0]);this.v4(this.particles,'forward',[...forward,0]);this.v4(this.particles,'orb',orb);this.v4(this.particles,'film',[f.time,aspect,energy,0]);g.drawArraysInstanced(g.TRIANGLES,0,6,q.particles);g.disable(g.BLEND);}
  let prev=this.hdr;for(let i=0;i<4;i++){const[a,b]=this.bloom[i];this.postPass(prev,a,[0,i===0?1:0,0,0]);this.postPass(a,b,[1,0,1,0]);this.postPass(b,a,[1,0,0,1]);prev=a;}
  g.bindFramebuffer(g.FRAMEBUFFER,null);g.viewport(0,0,this.width,this.height);g.useProgram(this.post.p);this.tex(this.post,'inputTexture',this.hdr.t,0);this.v4(this.post,'settings',[2,0,0,0]);this.v4(this.post,'params',[f.fade,f.time,this.width,this.height]);for(let i=0;i<4;i++)this.tex(this.post,`bloom${i}`,this.bloom[i][0].t,i+1);g.drawArrays(g.TRIANGLES,0,3);
  if(wait)g.finish();this.frames++;this.gpuMs=this.gpuMs*.9+(performance.now()-start)*.1;
  const error=g.getError();if(error!==g.NO_ERROR){const msg=`WebGL compatibility error 0x${error.toString(16)}`;if(!this.errors.includes(msg)){this.errors.push(msg);console.error(msg);}}
 }
 dispose(){this.ready=false;const g=this.gl;for(const r of this.resources){g.deleteTexture(r.t);g.deleteFramebuffer(r.fb);}for(const p of [this.scene,this.post,this.particles])g.deleteProgram(p.p);g.deleteTexture(this.engraving);g.deleteVertexArray(this.vao);}
}
