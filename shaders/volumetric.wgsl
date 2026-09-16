// Evaluated at half internal resolution. Uses scene alpha as linear ray distance.
@group(1) @binding(0) var fogDepth:texture_2d<f32>;
@group(1) @binding(1) var fogSampler:sampler;
@fragment fn fogFragment(in:VertexOut)->@location(0) vec4f{
 let scene=textureSampleLevel(fogDepth,fogSampler,in.uv,0);
 let ro=u.camera.xyz;let rd=direction(in.uv);let center=u.orb.xyz;
 let bounds=sphereHit(ro,rd,center,4.4);
 let near=max(0.0,bounds.x);let far=min(min(scene.a,bounds.y),18.0);
 if(far<=near||u.right.w<.5||u.extra.y<=0){return vec4f(0,0,0,scene.a);}
 let steps=u.extra.z;let step=(far-near)/max(steps,1.0);var sum=vec3f(0);var trans=1.0;
 // Static interleaved sampling is time-addressable and cannot ghost across cuts.
 let jitter=fract(52.9829189*fract(dot(floor(in.position.xy),vec2f(.06711056,.00583715))));
 let time=u.resolution.z;
 for(var i=0;i<24;i++){
  if(f32(i)>=steps){break;}
  let d=near+(f32(i)+jitter)*step;let p=ro+rd*d;let q=p-center;
  let r2=dot(q,q);let inside=smoothstep(1.0,1.6,r2);
  let strata=.65+.35*sin(p.y*2.3+sin(p.x*1.2+time*.11));
  let density=.026*exp(-r2*.16)*strata*inside;
  let cone1=exp(-pow(length(q.xz)-abs(q.y)*.37,2)*30)*exp(-abs(q.y)*.48);
  let cone2=exp(-pow(q.x*.45+q.y*.86+q.z*.27,2)*22)*exp(-r2*.32);
  let toward=normalize(center-p+vec3f(.0001));let phase=.30+1.7*pow(max(dot(rd,toward),0.0),5);
  let light=vec3f(.055,.22,.55)*(1.1+cone1*6.5)+vec3f(.28,.09,.4)*cone2*2.0;
  sum+=trans*density*light*phase*step*u.up.w;trans*=exp(-density*step);
 }
 return vec4f(sum*u.extra.y,scene.a);
}
