// Linear HDR throughout the pyramid. Grade / display transfer happen exactly once.
struct CineParams { size:vec4f, look:vec4f, film:vec4f, source:vec4f, lens:vec4f };
@group(0) @binding(0) var cineInput:texture_2d<f32>;
@group(0) @binding(1) var cineSampler:sampler;
@group(0) @binding(2) var<uniform> cp:CineParams;
@group(0) @binding(3) var cineBloom:texture_2d<f32>;
@group(0) @binding(4) var cineStreak:texture_2d<f32>;
@group(0) @binding(5) var cineFog:texture_2d<f32>;
struct CineVertex{@builtin(position) position:vec4f,@location(0) uv:vec2f};
@vertex fn cineVertex(@builtin(vertex_index) i:u32)->CineVertex{
 let x=f32((i<<1u)&2u);let y=f32(i&2u);var o:CineVertex;
 o.position=vec4f(x*2-1,y*2-1,0,1);o.uv=vec2f(x,1-y);return o;
}
fn sampleCine(uv:vec2f)->vec3f{return textureSampleLevel(cineInput,cineSampler,uv,0).rgb;}
@fragment fn bloomDown(in:CineVertex)->@location(0) vec4f{
 let px=1.0/vec2f(textureDimensions(cineInput));let uv=in.uv;
 // 9 bilinear taps; downfilter and blur are fused, replacing 3 passes/level.
 var c=sampleCine(uv)*.25;
 c+=(sampleCine(uv+px*vec2f(-1,-1))+sampleCine(uv+px*vec2f(1,-1))+sampleCine(uv+px*vec2f(-1,1))+sampleCine(uv+px*vec2f(1,1)))*.125;
 c+=(sampleCine(uv+px*vec2f(-2,0))+sampleCine(uv+px*vec2f(2,0))+sampleCine(uv+px*vec2f(0,-2))+sampleCine(uv+px*vec2f(0,2)))*.0625;
 if(cp.look.x>.5){
  let peak=max(c.r,max(c.g,c.b));let knee=clamp(peak-.5,0.0,.8);
  let weight=max(peak-.9,knee*knee/.8*.25)/max(peak,.0001);c*=weight;
 }
 return vec4f(c,1);
}
@fragment fn bloomUp(in:CineVertex)->@location(0) vec4f{
 let px=1.25/vec2f(textureDimensions(cineInput));let uv=in.uv;
 let small=(sampleCine(uv)*4+(sampleCine(uv+vec2f(px.x,0))+sampleCine(uv-vec2f(px.x,0))+sampleCine(uv+vec2f(0,px.y))+sampleCine(uv-vec2f(0,px.y)))*2+
 sampleCine(uv+px)+sampleCine(uv-px)+sampleCine(uv+px*vec2f(1,-1))+sampleCine(uv+px*vec2f(-1,1)))/16;
 let detail=textureSampleLevel(cineBloom,cineSampler,uv,0).rgb;
 return vec4f(mix(detail,small,.67),1);
}
@fragment fn anamorphic(in:CineVertex)->@location(0) vec4f{
 let pixel=1.0/vec2f(textureDimensions(cineInput));var c=sampleCine(in.uv)*.18;
 var total=.18;
 // Exponentially spaced highlights give long optical streaks at 1/8 resolution.
 for(var i=1;i<=8;i++){
  let x=f32(i);let offset=pixel.x*x*x*1.8;let w=exp(-x*.27)*.12;
  c+=(sampleCine(in.uv+vec2f(offset,0))+sampleCine(in.uv-vec2f(offset,0)))*w;total+=2*w;
 }
 return vec4f(c/total*vec3f(.42,.65,1.15),1);
}
fn cineAces(c:vec3f)->vec3f{return clamp((c*(2.51*c+.03))/(c*(2.43*c+.59)+.14),vec3f(0),vec3f(1));}
fn fogAt(uv:vec2f,depth:f32)->vec3f{
 // Four depth-weighted samples avoid fog bleeding across the product silhouette.
 let dims=vec2f(textureDimensions(cineFog));let p=uv*dims-.5;let f=fract(p);let base=floor(p)+.5;
 var sum=vec3f(0);var total=0.0;
 for(var y=0;y<2;y++){for(var x=0;x<2;x++){
  let s=textureSampleLevel(cineFog,cineSampler,(base+vec2f(f32(x),f32(y)))/dims,0);
  let wx=select(1-f.x,f.x,x==1);let wy=select(1-f.y,f.y,y==1);
  let w=wx*wy/(1+abs(s.a-depth)*4/max(1.0,depth));sum+=s.rgb*w;total+=w;
 }}
 return sum/max(total,.0001);
}
@fragment fn cineFinish(in:CineVertex)->@location(0) vec4f{
 let uv=in.uv;let p=uv-.5;let asp=cp.size.x/cp.size.y;
 let radial=(uv-cp.source.xy)*vec2f(asp,1);let r=length(radial);
 let shock=exp(-pow((r-cp.source.w)*60,2))*cp.source.z;
 let wobble=sin(r*72-cp.film.x*2.8)*.0003*cp.film.w;
 let warped=clamp(uv+normalize(radial+vec2f(.00001))*vec2f(1/asp,1)*(shock*.008+wobble),vec2f(.001),vec2f(.999));
 let chroma=p*dot(p,p)*(.001+shock*.003)*cp.film.w;
 let scene=textureSampleLevel(cineInput,cineSampler,warped,0);
 var col=scene.rgb;
 if(cp.film.w>0){col=vec3f(sampleCine(warped+chroma).r,col.g,sampleCine(warped-chroma).b);}
 if(cp.look.w>0){
  let px=1.0/cp.size.zw;let blur=(sampleCine(warped+vec2f(px.x,0))+sampleCine(warped-vec2f(px.x,0))+sampleCine(warped+vec2f(0,px.y))+sampleCine(warped-vec2f(0,px.y)))*.25;
  // Contrast-limited reconstruction; no bright ringing around emissive filaments.
  col+=clamp(col-blur,-vec3f(.12),vec3f(.12))*cp.look.w;
 }
 let glow=textureSampleLevel(cineBloom,cineSampler,warped,0).rgb;
 col+=glow*cp.look.x;
 if(cp.look.y>0){
  col+=textureSampleLevel(cineStreak,cineSampler,warped,0).rgb*cp.look.y;
  // Off-axis lens ghosts respond to the image, not to a constant overlay.
  let ghostUV=vec2f(.5)-p*.72;
  let ghost=textureSampleLevel(cineBloom,cineSampler,ghostUV,0).rgb;
  col+=ghost*vec3f(.16,.22,.32)*cp.look.y*smoothstep(.12,.65,length(p));
 }
 if(cp.look.z>0){col+=fogAt(warped,scene.a)*cp.look.z;}
 let dirt=pow(.5+.5*sin(uv.x*21+sin(uv.y*17))*sin(uv.y*31),6.0);
 col+=glow*dirt*.055*cp.film.w;
 col+=shock*vec3f(.025,.12,.25);
 let lum=dot(col,vec3f(.2126,.7152,.0722));
 col*=mix(vec3f(.94,.99,1.06),vec3f(1.045,1.012,.97),smoothstep(.1,1.8,lum));
 let vignette=1-dot(p*vec2f(.78,1),p*vec2f(.78,1))*.4;
 col=cineAces(max(col,vec3f(0))*cp.film.z*vignette)*cp.film.y;
 col=pow(col,vec3f(1/2.2));
 let grain=fract(sin(dot(floor(uv*cp.size.xy),vec2f(12.9898,78.233))+floor(cp.film.x*24)*.17)*43758.5453)-.5;
 return vec4f(clamp(col+grain*.0022*cp.film.y,vec3f(0),vec3f(1)),1);
}
