struct Uniforms {
 resolution: vec4f, // width, height, film seconds, aspect
 camera: vec4f, // xyz, tangent of half vertical field of view
 right: vec4f, // xyz, world: 0 dawn, 1 studio, 2 interior
 up: vec4f, // xyz, energy
 forward: vec4f, // xyz, exploded amount
 parameters: vec4f, // sunrise, film fade, volume steps, audio energy
 orb: vec4f, // xyz centre, radius
 extra: vec4f // render scale, reserved
};
@group(0) @binding(0) var<uniform> u: Uniforms;
const PI: f32 = 3.14159265359;
fn saturate(x:f32)->f32{return clamp(x,0.0,1.0);}
fn hash31(p:vec3f)->f32{var q=fract(p*.1031);q+=vec3f(dot(q,q.yzx+33.33));return fract((q.x+q.y)*q.z);}
fn hash11(p:f32)->f32{return fract(sin(p*127.1)*43758.5453);}
fn rotateX(p:vec3f,a:f32)->vec3f{let c=cos(a);let s=sin(a);return vec3f(p.x,c*p.y-s*p.z,s*p.y+c*p.z);}
fn rotateY(p:vec3f,a:f32)->vec3f{let c=cos(a);let s=sin(a);return vec3f(c*p.x+s*p.z,p.y,-s*p.x+c*p.z);}
fn rotateZ(p:vec3f,a:f32)->vec3f{let c=cos(a);let s=sin(a);return vec3f(c*p.x-s*p.y,s*p.x+c*p.y,p.z);}
fn noise3(p:vec3f)->f32{
 let i=floor(p);let f=fract(p);let s=f*f*(3.0-2.0*f);
 return mix(mix(mix(hash31(i),hash31(i+vec3f(1,0,0)),s.x),mix(hash31(i+vec3f(0,1,0)),hash31(i+vec3f(1,1,0)),s.x),s.y),
 mix(mix(hash31(i+vec3f(0,0,1)),hash31(i+vec3f(1,0,1)),s.x),mix(hash31(i+vec3f(0,1,1)),hash31(i+vec3f(1,1,1)),s.x),s.y),s.z);
}
fn sphereHit(ro:vec3f,rd:vec3f,center:vec3f,r:f32)->vec2f{
 let q=ro-center;let b=dot(q,rd);let h=b*b-dot(q,q)+r*r;
 if(h<0.0){return vec2f(-1.0);}
 let s=sqrt(h);return vec2f(-b-s,-b+s);
}
fn direction(uv:vec2f)->vec3f{
 let q=vec2f(uv.x*2.0-1.0,1.0-uv.y*2.0);
 return normalize(u.forward.xyz+(q.x*u.resolution.w*u.right.xyz+q.y*u.up.xyz)*u.camera.w);
}
struct VertexOut{@builtin(position) position:vec4f,@location(0) uv:vec2f};
@vertex fn fullscreen(@builtin(vertex_index) i:u32)->VertexOut{
 var p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));var o:VertexOut;
 o.position=vec4f(p[i],0,1);o.uv=p[i]*vec2f(.5,-.5)+.5;return o;
}
