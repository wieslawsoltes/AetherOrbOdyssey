struct Particle {position:vec4f,color:vec4f};
@group(1) @binding(0) var<storage,read_write> outputParticles:array<Particle>;
@compute @workgroup_size(128) fn simulate(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=arrayLength(&outputParticles)){return;}
 let f=f32(i);let h=hash11(f*.871+3.12);let h2=hash11(f*2.131+9.4);let h3=hash11(f*.12+7.9);
 let t=u.resolution.z;let arm=f32(i%5u);let a=h*PI*2.0+t*(.14+h2*.09);
 let r=.23+h2*.61;let tube=.038*(h3-.5);
 var p=vec3f(cos(a)*r,tube+sin(a*3+t*.21)*.055,sin(a)*r);
 p=rotateX(rotateZ(p,arm*.63+.24),arm*.74+.40);
 p+=vec3f(sin(a*5+f)*tube,cos(a*4+f)*tube,0);
 let fade=(.26+.74*pow(.5+.5*sin(a*3-t*.41),4.0));
 let size=mix(.0009,.0033,pow(h3,7.0));
 outputParticles[i].position=vec4f(u.orb.xyz+p*u.orb.w,size);
 outputParticles[i].color=vec4f(mix(vec3f(.12,.55,1.0),vec3f(.71,.33,1.0),h2),fade*(.5+h3)*u.up.w);
}
struct ParticleVertex{@builtin(position) position:vec4f,@location(0) uv:vec2f,@location(1) color:vec4f};
@vertex fn particleVertex(@builtin(vertex_index) vi:u32,@builtin(instance_index) instance:u32)->ParticleVertex{
 var vertices=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));
 let p=outputParticles[instance];let d=p.position.xyz-u.camera.xyz;
 let depth=dot(d,u.forward.xyz);let xy=vec2f(dot(d,u.right.xyz)/u.resolution.w,dot(d,u.up.xyz))/u.camera.w;
 let corner=vertices[vi];let sz=p.position.w*2.3;
 var o:ParticleVertex;
 o.position=vec4f(xy+corner*vec2f(sz/u.resolution.w,sz)/u.camera.w,depth*.99,max(depth,.001));
 o.uv=corner;o.color=p.color;
 if(depth<.03||u.right.w<.5){o.position=vec4f(5,5,0,1);}
 return o;
}
@fragment fn particleFragment(in:ParticleVertex)->@location(0) vec4f{
 let r=dot(in.uv,in.uv);let glow=exp(-r*4.0)*(1-smoothstep(.55,1.0,r));
 return vec4f(in.color.rgb*in.color.a*glow*.85,0);
}
