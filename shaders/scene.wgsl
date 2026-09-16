@group(0) @binding(1) var engraving: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;

fn stars(rd:vec3f)->vec3f{
 var out=vec3f(0);let dir=rotateZ(rotateY(rd,.25),-.42);
 // Direction-space stars stay fixed in world space during camera motion.
 for(var j=0;j<3;j++) {
  let scale=vec3f(210.0+f32(j)*97.0);
  let p=dir*scale+u.camera.xyz*(.018+f32(j)*.012);let id=floor(p);let f=fract(p)-.5;
  let h=hash31(id+f32(j)*7.13);let d=length(f);
  let star=exp(-d*d*(170.0+f32(j)*80.0))*smoothstep(.925,.992,h);
  out+=star*mix(vec3f(.64,.78,1.0),vec3f(1,.82,.66),h)*3.8;
 }
 let cloud=noise3(dir*4.2)*.65+noise3(dir*10.1)*.35;
 let band=exp(-pow(abs(dir.y+.12),2.0)*19.0);
 out+=vec3f(.034,.044,.072)*pow(cloud,3.0)*band;
 return out;
}
fn studio(rd:vec3f)->vec3f{
 let sky=mix(vec3f(.007,.009,.018),vec3f(.055,.061,.080),saturate(rd.y*.5+.5));
 let keyDirection=normalize(vec3f(-1.5,.75,1.35));
 let keyRight=normalize(cross(keyDirection,vec3f(0,1,0)));
 let keyUp=cross(keyRight,keyDirection);
 let key=(1-smoothstep(.042,.060,abs(dot(rd,keyRight))))*(1-smoothstep(.29,.35,abs(dot(rd,keyUp))))*smoothstep(.65,.8,dot(rd,keyDirection))*5.2;
 let strip=pow(max(dot(rd,normalize(vec3f(.80,.22,-.70))),0.0),100.0)*5.5;
 let overhead=pow(max(dot(rd,normalize(vec3f(-.1,1.0,.1))),0.0),32.0)*2.2;
 let soft=pow(max(dot(rd,normalize(vec3f(1.1,.7,1.2))),0.0),9.0)*.34;
 return sky+key*vec3f(.87,.94,1.0)+strip*vec3f(.39,.36,.9)+overhead*vec3f(.70,.83,1.0)+soft*vec3f(1.0,.81,.62);
}
fn atmosphere(ro:vec3f,rd:vec3f)->vec3f{
 let pc=vec3f(0,-18.45,-34);let pr=19.0;
 let sunDir=normalize(vec3f(.005,-.014+u.parameters.x*.116,-1));
 var color=stars(rd)*.68+vec3f(.0008,.0010,.0020);
 let angular=acos(clamp(dot(rd,sunDir),-.999999,.999999));
 color+=vec3f(1.0,.83,.53)*exp(-angular*angular*950.0)*(.25+u.parameters.x*2.0);
 color+=vec3f(1.0,.97,.81)*(1-smoothstep(.010,.013,angular))*7.0;
 let hit=sphereHit(ro,rd,pc,pr);
 if(hit.x>0.0){
  let p=ro+rd*hit.x;let n=normalize(p-pc);let rim=pow(1.0-max(0.0,dot(n,-rd)),4.0);
  let light=max(0.0,dot(n,sunDir));
  let cloud=noise3(n*36.0)*.65+noise3(n*83.0)*.35;
  color=vec3f(.0008,.0012,.0023)+vec3f(.014,.021,.032)*cloud*light;
  color+=rim*vec3f(.15,.31,.54)*(.13+light*3.2);
  color+=pow(rim,4.0)*vec3f(.8,.50,.20)*pow(max(dot(n,sunDir),0.0),.5)*u.parameters.x;
 } else {
  let q=pc-ro;let closest=length(q-rd*max(dot(q,rd),0.0));
  color+=vec3f(.18,.36,.65)*exp(-max(0.0,closest-pr)*15.0)*(.10+u.parameters.x*.5);
 }
 let moon=vec3f(0,4.8,-28);let mh=sphereHit(ro,rd,moon,1.65);
 if(mh.x>0.0 && (hit.x<0.0||mh.x<hit.x)) {
  let n=normalize(ro+rd*mh.x-moon);let rim=pow(1-max(0.0,dot(n,-rd)),4.0);
  let tex=noise3(n*32.0);
  color=vec3f(.003,.0034,.004)*tex+vec3f(.29,.25,.18)*rim*.19;
 }
 // Very restrained anamorphic flare, not an opaque neon line.
 let flare=exp(-pow(rd.y-sunDir.y,2.0)*150000.0)*exp(-abs(rd.x-sunDir.x)*9.0);
 if(hit.x<0.0){color+=vec3f(.16,.25,.47)*flare*u.parameters.x*.6;}
 return color;
}
fn cylinder(p:vec3f,r:f32,h:f32)->f32 {
 let q=vec2f(length(p.xz)-r,abs(p.y)-h);return length(max(q,vec2f(0)))+min(max(q.x,q.y),0.0);
}
fn beveledCone(p:vec3f,bottom:f32,top:f32,h:f32,bevel:f32)->f32{
 let r=mix(bottom,top,saturate(p.y/(2*h)+.5));
 let q=vec2f(length(p.xz)-r,abs(p.y)-h);
 return length(max(q,vec2f(0)))+min(max(q.x,q.y),0.0)-bevel;
}
fn machinery(p:vec3f)->vec2f{
 let ex=u.forward.w;
 var d=beveledCone(p-vec3f(0,-.60+ex*.16,0),.915,.846,.178,.041);
 var mat=1.0;
 let foot=cylinder(p-vec3f(0,-.838,0),.942,.041)-.017;
 if(foot<d){d=foot;mat=2.0;}
 let lip=cylinder(p-vec3f(0,-.346+ex*.52,0),.853,.026)-.011;
 if(lip<d){d=lip;mat=1.0;}
 let led=length(vec2f(length(p.xz)-.847,p.y+.309-ex*.52))-.010;
 if(led<d){d=led;mat=3.0;}
 // Concept assembly: a separate substrate becomes visible only in the exploded shot.
 if(ex>.04){
  let pcb=cylinder(p-vec3f(0,-.23+ex*.82,0),.74,.018)-.005;
  if(pcb<d){d=pcb;mat=4.0;}
  let disc=cylinder(p-vec3f(0,-.11+ex*1.13,0),.55,.010)-.005;
  if(disc<d){d=disc;mat=5.0;}
 }
 return vec2f(d,mat);
}
fn machineryHit(ro:vec3f,rd:vec3f)->vec2f{
 let bounds=sphereHit(ro,rd,vec3f(0,-.21+u.forward.w*.4,0),1.50);
 if(bounds.y<0.0){return vec2f(-1.0);}
 var t=max(0.002,bounds.x);
 for(var i=0;i<76;i++) {
  let d=machinery(ro+rd*t);
  if(d.x<.0007*(1.0+t*.2)){return vec2f(t,d.y);}
  t+=d.x*.72;
  if(t>bounds.y){break;}
 }
 return vec2f(-1.0);
}
fn machineNormal(p:vec3f)->vec3f{
 // Tetrahedral SDF gradient: four evaluations instead of six.
 let a=vec3f(1,-1,-1)*.0015;let b=vec3f(-1,-1,1)*.0015;
 let c=vec3f(-1,1,-1)*.0015;let d=vec3f(1,1,1)*.0015;
 return normalize(a*machinery(p+a).x+b*machinery(p+b).x+c*machinery(p+c).x+d*machinery(p+d).x);
}
fn machineColor(p:vec3f,n:vec3f,rd:vec3f,material:f32)->vec3f{
 let nv=max(dot(n,-rd),.001);let refl=reflect(rd,n);
 let fres=.56+.44*pow(1.0-nv,5.0);
 let angle=atan2(p.x,p.z);
 let brush=.988+.012*sin(p.y*2500.0+noise3(p*31.0)*2.0);
 var metal=studio(refl)*mix(vec3f(.42,.45,.51),vec3f(.83,.87,.95),pow(1.0-nv,3.0))*fres*brush;
 metal+=vec3f(.034,.034,.041)*max(dot(n,normalize(vec3f(-2,3,4))),0.0);
 let seam=1.0-smoothstep(.002,.009,abs(p.y+.747-u.forward.w*.16));
 metal*=1.0-seam*.80;
 if(material>1.5 && material<2.5){metal*=.15;}
 if(material>2.5 && material<3.5){return vec3f(.45,.68,1.0)*3.6*u.up.w;}
 if(material>3.5 && material<4.5){
  let r=length(p.xz);let a=atan2(p.z,p.x);
  let tracks=pow(.5+.5*sin(r*120.0),25.0)*.45+pow(.5+.5*sin(a*26.0),60.0)*.65;
  return mix(vec3f(.008,.021,.02),vec3f(.65,.40,.115)*(.4+max(n.y,0.0)*.5),saturate(tracks)) + studio(refl)*.13;
 }
 if(material>4.5){return vec3f(.12,.22,.42)*studio(refl)+vec3f(.05,.08,.14);}
 // The wordmark is an engraved texture in object space, not a floating label.
 let uv=vec2f(.5+angle*.88,.5-(p.y+.59-u.forward.w*.16)/.115);
 if(all(uv>vec2f(0))&&all(uv<vec2f(1))&&p.z>0.0){
  let etch=textureSampleLevel(engraving,linearSampler,uv,0.0).r;
  metal=mix(metal,vec3f(.25,.29,.37)+studio(refl)*.06,etch*.9);
 }
 let led=exp(-pow((p.y+.705-u.forward.w*.16)*420.0,2.0))*(1-smoothstep(.024,.044,abs(angle)));
 metal+=vec3f(.32,.65,1.0)*led*2.0;
 return metal;
}
fn energyVolume(ro:vec3f,rd:vec3f,near:f32,far:f32,steps:f32)->vec3f{
 let len=max(0.0,far-near);let stride=len/max(steps,1.0);
 var sum=vec3f(0);var trans=1.0;
 let t=u.resolution.z;let core=u.orb.xyz;
 let start=near+stride*.5;
 for(var j=0;j<64;j++) {
  if(f32(j)>=steps||trans<.025){break;}
  let pos=ro+rd*(start+f32(j)*stride);let raw=(pos-core)/u.orb.w;
  let q=rotateY(raw,t*.12);let radial=length(q);
  let n=noise3(q*5.2+vec3f(0,t*.04,0));
  var n2=n;if(u.extra.x>.65){n2=noise3(q*12.1-vec3f(t*.02,0,0));}
  let haze=pow(max(0.0,n*.7+n2*.3-.38),2.0)*3.0*(1-smoothstep(.72,1.0,radial));
  var density=haze*.25;var emitted=mix(vec3f(.17,.04,.42),vec3f(.045,.13,.35),n)*haze*.28;
  for(var k=0;k<3;k++){
   let f=f32(k);var v=rotateZ(rotateX(q,.35+f*1.04+t*.025),f*.77+t*.05);
   let rr=length(v.xz);let sn=v.z/max(rr,.00001);let cs=v.x/max(rr,.00001);
   let sin2=2.0*sn*cs;let cos2=cs*cs-sn*sn;let sin3=sn*(3.0-4.0*sn*sn);let cos3=cs*(4.0*cs*cs-3.0);
   let path=.49+f*.095+.04*(sin3*cos(t*.18+f*2.0)+cos3*sin(t*.18+f*2.0));
   let torus=length(vec2f(rr-path,v.y*.85+.062*(sin2*cos(f-t*.1)+cos2*sin(f-t*.1))));
   let variance=.00011+f*.000025;
   let footprint=variance+stride*stride/12.0;
   let filament=exp(-torus*torus/footprint)*sqrt(variance/footprint);
   let shroud=exp(-torus*torus/.0020)*(.6+n2*.4);
   let current=.34+.66*pow(.5+.5*(sin2*cos(f-t*(.8+f*.18))+cos2*sin(f-t*(.8+f*.18))),3.0);
   let arc=pow(max(0.0,sin(v.x*43.0+v.z*31.0+t*(1.2+f*.4))),14.0)*shroud;
   emitted+=vec3f(.28,.67,1.0)*arc*.85*u.extra.y;
   emitted+=mix(vec3f(.080,.43,1.0),vec3f(.40,.20,.90),f*.44)*(filament*5.5+shroud*.28)*current;
   density+=filament*.1+shroud*.055;
  }
  let heart=exp(-radial*radial/.0025);
  emitted+=vec3f(.35,.69,1.0)*heart*4.5;
  sum+=trans*emitted*stride*3.0*u.up.w;
  trans*=exp(-density*stride*.72);
 }
 // A compact luminous source gives the trails a coherent centre.
 let d=length(cross(core-ro,rd));let nearest=dot(core-ro,rd);
 if(nearest>near && nearest<far){sum+=vec3f(.50,.83,1.0)*exp(-d*d/.0006)*1.3*u.up.w;}
 return sum;
}
fn glass(ro:vec3f,rd:vec3f,hit:vec2f,reflectionOnly:bool)->vec3f{
 let p=ro+rd*hit.x;let n=normalize(p-u.orb.xyz);
 let nv=max(0.0,dot(n,-rd));let fres=.035+.965*pow(1.0-nv,5.0);
 let inDir=refract(rd,n,1.0/1.46);
 let inStart=p+inDir*.002;let second=sphereHit(inStart,inDir,u.orb.xyz,u.orb.w);
 let exitPoint=inStart+inDir*max(second.y,0.0);let exitN=normalize(exitPoint-u.orb.xyz);
 let outDir=refract(inDir,-exitN,1.46);
 var backdrop=studio(normalize(outDir+vec3f(.00001)))*.20+stars(normalize(outDir+vec3f(.00001)))*.25;
 let shellAbsorb=exp(-vec3f(.09,.055,.015)*max(second.y,0.0));
 var steps=u.parameters.z;
 if(reflectionOnly){steps=12.0;}
 let inner=energyVolume(inStart,inDir,0,max(second.y,0.0),steps);
 var col=(backdrop*shellAbsorb+inner)*(1-fres*.80)+studio(reflect(rd,n))*fres;
 // A second, slightly displaced interface gives the glass shell a visible thickness.
 let rim=pow(1-nv,11.0);
 col+=rim*vec3f(.21,.31,.59)*.44;
 col+=pow(max(dot(reflect(rd,n),normalize(vec3f(-1.5,.75,1.35))),0.0),240.0)*vec3f(.7,.83,1.0)*2.0;
 return col;
}
fn product(ro:vec3f,rd:vec3f,reflected:bool)->vec4f{
 let ball=sphereHit(ro,rd,u.orb.xyz,u.orb.w);
 let solid=machineryHit(ro,rd);
 if(solid.x>0.0 && (ball.x<0.0||solid.x<ball.x)){
  let p=ro+rd*solid.x;return vec4f(machineColor(p,machineNormal(p),rd,solid.y),solid.x);
 }
 if(ball.x>0.0){return vec4f(glass(ro,rd,ball,reflected),ball.x);}
 return vec4f(0,0,0,-1);
}
fn holography(ro:vec3f,rd:vec3f,sceneDepth:f32)->vec3f{
 let strength=u.extra.y*smoothstep(31.0,36.0,u.resolution.z);var light=vec3f(0);
 if(strength<=0.0){return light;}
 for(var i=0;i<2;i++){
  let k=f32(i);let normal=normalize(vec3f(.15*k,1.0,.22*k));
  let center=u.orb.xyz+vec3f(0,-.90+k*1.0,0);let denom=dot(rd,normal);
  if(abs(denom)>.0001){
   let distance=dot(center-ro,normal)/denom;
   if(distance>0.0 && distance<sceneDepth){
    let p=ro+rd*distance-center;let radius=length(p);let angle=atan2(p.z,p.x);
    let ringRadius=1.40+k*.35;let footprint=max(.004,distance*u.camera.w/u.resolution.y*1.4);
    let ring=exp(-pow((radius-ringRadius)/footprint,2.0));
    let dash=smoothstep(.05,.22,sin(angle*(22.0+k*9.0)+u.resolution.z*(.24-k*.43)));
    let ticks=pow(max(0.0,cos(angle*64.0)),28.0)*(1.0-smoothstep(.016,.043,abs(radius-ringRadius+.05)));
    let breathing=.65+.35*sin(u.resolution.z*.65+k);
    light+=mix(vec3f(.055,.35,.78),vec3f(.40,.23,.08),k*.5)*(ring*dash+ticks*.55)*strength*breathing;
   }
  }
 }
 return light;
}
@fragment fn sceneFragment(in:VertexOut)->@location(0) vec4f{
 let ro=u.camera.xyz;let rd=direction(in.uv);
 if(u.right.w<.5){return vec4f(atmosphere(ro,rd),1000.0);}
 if(u.right.w>1.5){
  let h=sphereHit(ro,rd,u.orb.xyz,u.orb.w*1.28);
  var col=energyVolume(ro,rd,max(h.x,0.0),max(h.y,0.0),u.parameters.z+8.0);
  col+=stars(rd)*.14;return vec4f(col,max(h.y,.01));
 }
 let hit=product(ro,rd,false);
 var col=vec3f(.0017,.0022,.0034)+stars(rd)*.055;var depth=1000.0;
 if(hit.w>0.0){col=hit.rgb;depth=hit.w;}
 let ground=(-.906-ro.y)/rd.y;
 if(ground>0.0 && (hit.w<0.0||ground<hit.w)){
  depth=ground;
  let p=ro+rd*ground;let n=vec3f(0,1,0);let refl=reflect(rd,n);
  let rr=length(p.xz);let fres=.08+.70*pow(1-max(dot(n,-rd),0.0),5.0);
  let reflection=product(p+vec3f(0,.005,0),refl,true);
  let floorNoise=noise3(p*7.0)*.65+noise3(p*27.0)*.35;
  col=vec3f(.004,.005,.008)+studio(refl)*.018*(.8+floorNoise*.2);
  if(reflection.w>0.0){col+=reflection.rgb*fres*.67;}
  let halo=exp(-rr*rr*1.35)*(.55+.45*floorNoise);
  col+=vec3f(.024,.055,.14)*halo*u.up.w;
  let contact=1.0-.9*exp(-rr*rr*1.7);col*=contact+.10;
  col=mix(vec3f(.0017,.0022,.0034)+stars(rd)*.045,col,smoothstep(.0,.17,abs(rd.y)));
 }
 col+=holography(ro,rd,depth);
 // Alpha is the distance along this ray, consumed by the volumetric pass.
 return vec4f(col,min(depth,1000.0));
}
