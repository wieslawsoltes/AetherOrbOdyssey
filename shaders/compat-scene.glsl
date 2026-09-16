#version 300 es
precision highp float;
precision highp int;
uniform sampler2D engraving;
in vec2 vUv;
out vec4 fragColor;
struct Uniforms{vec4 resolution;vec4 camera;vec4 right;vec4 up;vec4 forward;vec4 parameters;vec4 orb;vec4 extra;};
uniform Uniforms u;
const float PI=3.14159265359;
float saturate(float x){return clamp(x,0.0,1.0);}
float hash31(vec3 p){vec3 q=fract(p*.1031);q+=vec3(dot(q,q.yzx+33.33));return fract((q.x+q.y)*q.z);}
float hash11(float p){return fract(sin(p*127.1)*43758.5453);}
vec3 rotateX(vec3 p,float a){float c=cos(a);float s=sin(a);return vec3(p.x,c*p.y-s*p.z,s*p.y+c*p.z);}
vec3 rotateY(vec3 p,float a){float c=cos(a);float s=sin(a);return vec3(c*p.x+s*p.z,p.y,-s*p.x+c*p.z);}
vec3 rotateZ(vec3 p,float a){float c=cos(a);float s=sin(a);return vec3(c*p.x-s*p.y,s*p.x+c*p.y,p.z);}
float noise3(vec3 p){
 vec3 i=floor(p);vec3 f=fract(p);vec3 s=f*f*(3.0-2.0*f);
 return mix(mix(mix(hash31(i),hash31(i+vec3(1.0,0.0,0.0)),s.x),mix(hash31(i+vec3(0.0,1.0,0.0)),hash31(i+vec3(1.0,1.0,0.0)),s.x),s.y),
 mix(mix(hash31(i+vec3(0.0,0.0,1.0)),hash31(i+vec3(1.0,0.0,1.0)),s.x),mix(hash31(i+vec3(0.0,1.0,1.0)),hash31(i+vec3(1.0,1.0,1.0)),s.x),s.y),s.z);
}
vec2 sphereHit(vec3 ro,vec3 rd,vec3 center,float r){
 vec3 q=ro-center;float b=dot(q,rd);float h=b*b-dot(q,q)+r*r;
 if(h<0.0){return vec2(-1.0);}
 float s=sqrt(h);return vec2(-b-s,-b+s);
}
vec3 direction(vec2 uv){
 vec2 q=vec2(uv.x*2.0-1.0,1.0-uv.y*2.0);
 return normalize(u.forward.xyz+(q.x*u.resolution.w*u.right.xyz+q.y*u.up.xyz)*u.camera.w);
}
vec3 stars(vec3 rd){
 vec3 accumulated=vec3(0.0);vec3 dir=rotateZ(rotateY(rd,.25),-.42);
 // Direction-space stars stay fixed in world space during camera motion.
 for(int j=0;j<3;j++) {
  vec3 scale=vec3(210.0+float(j)*97.0);
  vec3 p=dir*scale+u.camera.xyz*(.018+float(j)*.012);vec3 id=floor(p);vec3 f=fract(p)-.5;
  float h=hash31(id+float(j)*7.13);float d=length(f);
  float star=exp(-d*d*(170.0+float(j)*80.0))*smoothstep(.925,.992,h);
  accumulated+=star*mix(vec3(.64,.78,1.0),vec3(1.0,.82,.66),h)*3.8;
 }
 float cloud=noise3(dir*4.2)*.65+noise3(dir*10.1)*.35;
 float band=exp(-pow(abs(dir.y+.12),2.0)*19.0);
 accumulated+=vec3(.034,.044,.072)*pow(cloud,3.0)*band;
 return accumulated;
}
vec3 studio(vec3 rd){
 vec3 sky=mix(vec3(.007,.009,.018),vec3(.055,.061,.080),saturate(rd.y*.5+.5));
 vec3 keyDirection=normalize(vec3(-1.5,.75,1.35));
 vec3 keyRight=normalize(cross(keyDirection,vec3(0.0,1.0,0.0)));
 vec3 keyUp=cross(keyRight,keyDirection);
 float key=(1.0-smoothstep(.042,.060,abs(dot(rd,keyRight))))*(1.0-smoothstep(.29,.35,abs(dot(rd,keyUp))))*smoothstep(.65,.8,dot(rd,keyDirection))*5.2;
 float strip=pow(max(dot(rd,normalize(vec3(.80,.22,-.70))),0.0),100.0)*5.5;
 float overhead=pow(max(dot(rd,normalize(vec3(-.1,1.0,.1))),0.0),32.0)*2.2;
 float soft=pow(max(dot(rd,normalize(vec3(1.1,.7,1.2))),0.0),9.0)*.34;
 return sky+key*vec3(.87,.94,1.0)+strip*vec3(.39,.36,.9)+overhead*vec3(.70,.83,1.0)+soft*vec3(1.0,.81,.62);
}
vec3 atmosphere(vec3 ro,vec3 rd){
 vec3 pc=vec3(0.0,-18.45,-34.0);float pr=19.0;
 vec3 sunDir=normalize(vec3(.005,-.014+u.parameters.x*.116,-1.0));
 vec3 color=stars(rd)*.68+vec3(.0008,.0010,.0020);
 float angular=acos(clamp(dot(rd,sunDir),-.999999,.999999));
 color+=vec3(1.0,.83,.53)*exp(-angular*angular*950.0)*(.25+u.parameters.x*2.0);
 color+=vec3(1.0,.97,.81)*(1.0-smoothstep(.010,.013,angular))*7.0;
 vec2 hit=sphereHit(ro,rd,pc,pr);
 if(hit.x>0.0){
  vec3 p=ro+rd*hit.x;vec3 n=normalize(p-pc);float rim=pow(1.0-max(0.0,dot(n,-rd)),4.0);
  float light=max(0.0,dot(n,sunDir));
  float cloud=noise3(n*36.0)*.65+noise3(n*83.0)*.35;
  color=vec3(.0008,.0012,.0023)+vec3(.014,.021,.032)*cloud*light;
  color+=rim*vec3(.15,.31,.54)*(.13+light*3.2);
  color+=pow(rim,4.0)*vec3(.8,.50,.20)*pow(max(dot(n,sunDir),0.0),.5)*u.parameters.x;
 } else {
  vec3 q=pc-ro;float closest=length(q-rd*max(dot(q,rd),0.0));
  color+=vec3(.18,.36,.65)*exp(-max(0.0,closest-pr)*15.0)*(.10+u.parameters.x*.5);
 }
 vec3 moon=vec3(0.0,4.8,-28.0);vec2 mh=sphereHit(ro,rd,moon,1.65);
 if(mh.x>0.0 && (hit.x<0.0||mh.x<hit.x)) {
  vec3 n=normalize(ro+rd*mh.x-moon);float rim=pow(1.0-max(0.0,dot(n,-rd)),4.0);
  float tex=noise3(n*32.0);
  color=vec3(.003,.0034,.004)*tex+vec3(.29,.25,.18)*rim*.19;
 }
 // Very restrained anamorphic flare, not an opaque neon line.
 float flare=exp(-pow(rd.y-sunDir.y,2.0)*150000.0)*exp(-abs(rd.x-sunDir.x)*9.0);
 if(hit.x<0.0){color+=vec3(.16,.25,.47)*flare*u.parameters.x*.6;}
 return color;
}
float cylinder(vec3 p,float r,float h){
 vec2 q=vec2(length(p.xz)-r,abs(p.y)-h);return length(max(q,vec2(0.0)))+min(max(q.x,q.y),0.0);
}
float beveledCone(vec3 p,float bottom,float top,float h,float bevel){
 float r=mix(bottom,top,saturate(p.y/(2.0*h)+.5));
 vec2 q=vec2(length(p.xz)-r,abs(p.y)-h);
 return length(max(q,vec2(0.0)))+min(max(q.x,q.y),0.0)-bevel;
}
vec2 machinery(vec3 p){
 float ex=u.forward.w;
 float d=beveledCone(p-vec3(0.0,-.60+ex*.16,0.0),.915,.846,.178,.041);
 float mat=1.0;
 float foot=cylinder(p-vec3(0.0,-.838,0.0),.942,.041)-.017;
 if(foot<d){d=foot;mat=2.0;}
 float lip=cylinder(p-vec3(0.0,-.346+ex*.52,0.0),.853,.026)-.011;
 if(lip<d){d=lip;mat=1.0;}
 float led=length(vec2(length(p.xz)-.847,p.y+.309-ex*.52))-.010;
 if(led<d){d=led;mat=3.0;}
 // Concept assembly: a separate substrate becomes visible only in the exploded shot.
 if(ex>.04){
  float pcb=cylinder(p-vec3(0.0,-.23+ex*.82,0.0),.74,.018)-.005;
  if(pcb<d){d=pcb;mat=4.0;}
  float disc=cylinder(p-vec3(0.0,-.11+ex*1.13,0.0),.55,.010)-.005;
  if(disc<d){d=disc;mat=5.0;}
 }
 return vec2(d,mat);
}
vec2 machineryHit(vec3 ro,vec3 rd){
 vec2 bounds=sphereHit(ro,rd,vec3(0.0,-.21+u.forward.w*.4,0.0),1.50);
 if(bounds.y<0.0){return vec2(-1.0);}
 float t=max(0.002,bounds.x);
 for(int i=0;i<76;i++) {
  vec2 d=machinery(ro+rd*t);
  if(d.x<.0007*(1.0+t*.2)){return vec2(t,d.y);}
  t+=d.x*.72;
  if(t>bounds.y){break;}
 }
 return vec2(-1.0);
}
vec3 machineNormal(vec3 p){
 // Tetrahedral SDF gradient: four evaluations instead of six.
 vec3 a=vec3(1.0,-1.0,-1.0)*.0015;vec3 b=vec3(-1.0,-1.0,1.0)*.0015;
 vec3 c=vec3(-1.0,1.0,-1.0)*.0015;vec3 d=vec3(1.0,1.0,1.0)*.0015;
 return normalize(a*machinery(p+a).x+b*machinery(p+b).x+c*machinery(p+c).x+d*machinery(p+d).x);
}
vec3 machineColor(vec3 p,vec3 n,vec3 rd,float material){
 float nv=max(dot(n,-rd),.001);vec3 refl=reflect(rd,n);
 float fres=.56+.44*pow(1.0-nv,5.0);
 float angle=atan(p.x,p.z);
 float brush=.988+.012*sin(p.y*2500.0+noise3(p*31.0)*2.0);
 vec3 metal=studio(refl)*mix(vec3(.42,.45,.51),vec3(.83,.87,.95),pow(1.0-nv,3.0))*fres*brush;
 metal+=vec3(.034,.034,.041)*max(dot(n,normalize(vec3(-2.0,3.0,4.0))),0.0);
 float seam=1.0-smoothstep(.002,.009,abs(p.y+.747-u.forward.w*.16));
 metal*=1.0-seam*.80;
 if(material>1.5 && material<2.5){metal*=.15;}
 if(material>2.5 && material<3.5){return vec3(.45,.68,1.0)*3.6*u.up.w;}
 if(material>3.5 && material<4.5){
  float r=length(p.xz);float a=atan(p.z,p.x);
  float tracks=pow(.5+.5*sin(r*120.0),25.0)*.45+pow(.5+.5*sin(a*26.0),60.0)*.65;
  return mix(vec3(.008,.021,.02),vec3(.65,.40,.115)*(.4+max(n.y,0.0)*.5),saturate(tracks)) + studio(refl)*.13;
 }
 if(material>4.5){return vec3(.12,.22,.42)*studio(refl)+vec3(.05,.08,.14);}
 // The wordmark is an engraved texture in object space, not a floating label.
 vec2 uv=vec2(.5+angle*.88,.5-(p.y+.59-u.forward.w*.16)/.115);
 if(all(greaterThan(uv,vec2(0.0)))&&all(lessThan(uv,vec2(1.0)))&&p.z>0.0){
  float etch=textureLod(engraving,uv,0.0).r;
  metal=mix(metal,vec3(.25,.29,.37)+studio(refl)*.06,etch*.9);
 }
 float led=exp(-pow((p.y+.705-u.forward.w*.16)*420.0,2.0))*(1.0-smoothstep(.024,.044,abs(angle)));
 metal+=vec3(.32,.65,1.0)*led*2.0;
 return metal;
}
vec3 energyVolume(vec3 ro,vec3 rd,float near,float far,float steps){
 float len=max(0.0,far-near);float stride=len/max(steps,1.0);
 vec3 sum=vec3(0.0);float trans=1.0;
 float t=u.resolution.z;vec3 core=u.orb.xyz;
 float start=near+stride*.5;
 for(int j=0;j<64;j++) {
  if(float(j)>=steps||trans<.025){break;}
  vec3 pos=ro+rd*(start+float(j)*stride);vec3 raw=(pos-core)/u.orb.w;
  vec3 q=rotateY(raw,t*.12);float radial=length(q);
  float n=noise3(q*5.2+vec3(0.0,t*.04,0.0));
  float n2=n;if(u.extra.x>.65){n2=noise3(q*12.1-vec3(t*.02,0.0,0.0));}
  float haze=pow(max(0.0,n*.7+n2*.3-.38),2.0)*3.0*(1.0-smoothstep(.72,1.0,radial));
  float density=haze*.25;vec3 emitted=mix(vec3(.17,.04,.42),vec3(.045,.13,.35),n)*haze*.28;
  for(int k=0;k<3;k++){
   float f=float(k);vec3 v=rotateZ(rotateX(q,.35+f*1.04+t*.025),f*.77+t*.05);
   float rr=length(v.xz);float sn=v.z/max(rr,.00001);float cs=v.x/max(rr,.00001);
   float sin2=2.0*sn*cs;float cos2=cs*cs-sn*sn;float sin3=sn*(3.0-4.0*sn*sn);float cos3=cs*(4.0*cs*cs-3.0);
   float path=.49+f*.095+.04*(sin3*cos(t*.18+f*2.0)+cos3*sin(t*.18+f*2.0));
   float torus=length(vec2(rr-path,v.y*.85+.062*(sin2*cos(f-t*.1)+cos2*sin(f-t*.1))));
   float variance=.00011+f*.000025;
   float footprint=variance+stride*stride/12.0;
   float filament=exp(-torus*torus/footprint)*sqrt(variance/footprint);
   float shroud=exp(-torus*torus/.0020)*(.6+n2*.4);
   float current=.34+.66*pow(.5+.5*(sin2*cos(f-t*(.8+f*.18))+cos2*sin(f-t*(.8+f*.18))),3.0);
   float arc=pow(max(0.0,sin(v.x*43.0+v.z*31.0+t*(1.2+f*.4))),14.0)*shroud;
   emitted+=vec3(.28,.67,1.0)*arc*.85*u.extra.y;
   emitted+=mix(vec3(.080,.43,1.0),vec3(.40,.20,.90),f*.44)*(filament*5.5+shroud*.28)*current;
   density+=filament*.1+shroud*.055;
  }
  float heart=exp(-radial*radial/.0025);
  emitted+=vec3(.35,.69,1.0)*heart*4.5;
  sum+=trans*emitted*stride*3.0*u.up.w;
  trans*=exp(-density*stride*.72);
 }
 // A compact luminous source gives the trails a coherent centre.
 float d=length(cross(core-ro,rd));float nearest=dot(core-ro,rd);
 if(nearest>near && nearest<far){sum+=vec3(.50,.83,1.0)*exp(-d*d/.0006)*1.3*u.up.w;}
 return sum;
}
vec3 glass(vec3 ro,vec3 rd,vec2 hit,bool reflectionOnly){
 vec3 p=ro+rd*hit.x;vec3 n=normalize(p-u.orb.xyz);
 float nv=max(0.0,dot(n,-rd));float fres=.035+.965*pow(1.0-nv,5.0);
 vec3 inDir=refract(rd,n,1.0/1.46);
 vec3 inStart=p+inDir*.002;vec2 second=sphereHit(inStart,inDir,u.orb.xyz,u.orb.w);
 vec3 exitPoint=inStart+inDir*max(second.y,0.0);vec3 exitN=normalize(exitPoint-u.orb.xyz);
 vec3 outDir=refract(inDir,-exitN,1.46);
 vec3 backdrop=studio(normalize(outDir+vec3(.00001)))*.20+stars(normalize(outDir+vec3(.00001)))*.25;
 vec3 shellAbsorb=exp(-vec3(.09,.055,.015)*max(second.y,0.0));
 float steps=u.parameters.z;
 if(reflectionOnly){steps=12.0;}
 vec3 inner=energyVolume(inStart,inDir,0.0,max(second.y,0.0),steps);
 vec3 col=(backdrop*shellAbsorb+inner)*(1.0-fres*.80)+studio(reflect(rd,n))*fres;
 // A second, slightly displaced interface gives the glass shell a visible thickness.
 float rim=pow(1.0-nv,11.0);
 col+=rim*vec3(.21,.31,.59)*.44;
 col+=pow(max(dot(reflect(rd,n),normalize(vec3(-1.5,.75,1.35))),0.0),240.0)*vec3(.7,.83,1.0)*2.0;
 return col;
}
vec4 product(vec3 ro,vec3 rd,bool reflected){
 vec2 ball=sphereHit(ro,rd,u.orb.xyz,u.orb.w);
 vec2 solid=machineryHit(ro,rd);
 if(solid.x>0.0 && (ball.x<0.0||solid.x<ball.x)){
  vec3 p=ro+rd*solid.x;return vec4(machineColor(p,machineNormal(p),rd,solid.y),solid.x);
 }
 if(ball.x>0.0){return vec4(glass(ro,rd,ball,reflected),ball.x);}
 return vec4(0.0,0.0,0.0,-1.0);
}
vec3 holography(vec3 ro,vec3 rd,float sceneDepth){
 float strength=u.extra.y*smoothstep(31.0,36.0,u.resolution.z);vec3 light=vec3(0.0);
 if(strength<=0.0){return light;}
 for(int i=0;i<2;i++){
  float k=float(i);vec3 normal=normalize(vec3(.15*k,1.0,.22*k));
  vec3 center=u.orb.xyz+vec3(0.0,-.90+k*1.0,0.0);float denom=dot(rd,normal);
  if(abs(denom)>.0001){
   float distance=dot(center-ro,normal)/denom;
   if(distance>0.0 && distance<sceneDepth){
    vec3 p=ro+rd*distance-center;float radius=length(p);float angle=atan(p.z,p.x);
    float target=1.40+k*.35;float footprint=max(.004,distance*u.camera.w/u.resolution.y*1.4);
    float ring=exp(-pow((radius-target)/footprint,2.0));
    float dash=smoothstep(.05,.22,sin(angle*(22.0+k*9.0)+u.resolution.z*(.24-k*.43)));
    float ticks=pow(max(0.0,cos(angle*64.0)),28.0)*(1.0-smoothstep(.016,.043,abs(radius-target+.05)));
    float breathing=.65+.35*sin(u.resolution.z*.65+k);
    light+=mix(vec3(.055,.35,.78),vec3(.40,.23,.08),k*.5)*(ring*dash+ticks*.55)*strength*breathing;
   }
  }
 }
 return light;
}
vec4 sceneFragment(){
 vec3 ro=u.camera.xyz;vec3 rd=direction(vUv);
 if(u.right.w<.5){return vec4(atmosphere(ro,rd),1000.0);}
 if(u.right.w>1.5){
  vec2 h=sphereHit(ro,rd,u.orb.xyz,u.orb.w*1.28);
  vec3 col=energyVolume(ro,rd,max(h.x,0.0),max(h.y,0.0),u.parameters.z+8.0);
  col+=stars(rd)*.14;return vec4(col,max(h.y,.01));
 }
 vec4 hit=product(ro,rd,false);
 vec3 col=vec3(.0017,.0022,.0034)+stars(rd)*.055;float depth=1000.0;
 if(hit.w>0.0){col=hit.rgb;depth=hit.w;}
 float ground=(-.906-ro.y)/rd.y;
 if(ground>0.0 && (hit.w<0.0||ground<hit.w)){
  depth=ground;
  vec3 p=ro+rd*ground;vec3 n=vec3(0.0,1.0,0.0);vec3 refl=reflect(rd,n);
  float rr=length(p.xz);float fres=.08+.70*pow(1.0-max(dot(n,-rd),0.0),5.0);
  vec4 reflection=product(p+vec3(0.0,.005,0.0),refl,true);
  float floorNoise=noise3(p*7.0)*.65+noise3(p*27.0)*.35;
  col=vec3(.004,.005,.008)+studio(refl)*.018*(.8+floorNoise*.2);
  if(reflection.w>0.0){col+=reflection.rgb*fres*.67;}
  float halo=exp(-rr*rr*1.35)*(.55+.45*floorNoise);
  col+=vec3(.024,.055,.14)*halo*u.up.w;
  float contact=1.0-.9*exp(-rr*rr*1.7);col*=contact+.10;
  col=mix(vec3(.0017,.0022,.0034)+stars(rd)*.045,col,smoothstep(.0,.17,abs(rd.y)));
 }
 col+=holography(ro,rd,depth);
 // Alpha is the distance along this ray, consumed by the volumetric pass.
 return vec4(col,min(depth,1000.0));
}
void main(){fragColor=sceneFragment();}
