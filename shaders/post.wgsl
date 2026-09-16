struct Post { size:vec4f, values:vec4f };
@group(0) @binding(0) var inputTexture:texture_2d<f32>;
@group(0) @binding(1) var texSampler:sampler;
@group(0) @binding(2) var<uniform> post:Post;
struct V{@builtin(position) position:vec4f,@location(0) uv:vec2f};
@vertex fn vs(@builtin(vertex_index) i:u32)->V{
 var p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));var o:V;o.position=vec4f(p[i],0,1);o.uv=p[i]*vec2f(.5,-.5)+.5;return o;
}
@fragment fn down(in:V)->@location(0) vec4f{
 let px=1.0/vec2f(textureDimensions(inputTexture));
 var c=textureSampleLevel(inputTexture,texSampler,in.uv+px*vec2f(-1,-1),0).rgb;
 c+=textureSampleLevel(inputTexture,texSampler,in.uv+px*vec2f(1,-1),0).rgb;
 c+=textureSampleLevel(inputTexture,texSampler,in.uv+px*vec2f(-1,1),0).rgb;
 c+=textureSampleLevel(inputTexture,texSampler,in.uv+px*vec2f(1,1),0).rgb;c*=.25;
 if(post.values.x>.5){let lum=max(max(c.r,c.g),c.b);c*=max(0.0,lum-.80)/max(lum,.001);}
 return vec4f(c,1);
}
@fragment fn blur(in:V)->@location(0) vec4f{
 let step=post.size.zw/vec2f(textureDimensions(inputTexture));
 var c=textureSampleLevel(inputTexture,texSampler,in.uv,0).rgb*.227027;
 c+=(textureSampleLevel(inputTexture,texSampler,in.uv+step*1.384615,0).rgb+textureSampleLevel(inputTexture,texSampler,in.uv-step*1.384615,0).rgb)*.316216;
 c+=(textureSampleLevel(inputTexture,texSampler,in.uv+step*3.230769,0).rgb+textureSampleLevel(inputTexture,texSampler,in.uv-step*3.230769,0).rgb)*.070270;
 return vec4f(c,1);
}
@group(0) @binding(3) var bloom0:texture_2d<f32>;
@group(0) @binding(4) var bloom1:texture_2d<f32>;
@group(0) @binding(5) var bloom2:texture_2d<f32>;
@group(0) @binding(6) var bloom3:texture_2d<f32>;
fn aces(c:vec3f)->vec3f{return clamp((c*(2.51*c+.03))/(c*(2.43*c+.59)+.14),vec3f(0),vec3f(1));}
@fragment fn finish(in:V)->@location(0) vec4f{
 let uv=in.uv;let p=uv-.5;
 let chroma=p*dot(p,p)*.0009;
 var col=vec3f(textureSampleLevel(inputTexture,texSampler,uv+chroma,0).r,textureSampleLevel(inputTexture,texSampler,uv,0).g,textureSampleLevel(inputTexture,texSampler,uv-chroma,0).b);
 col+=textureSampleLevel(bloom0,texSampler,uv,0).rgb*.25;
 col+=textureSampleLevel(bloom1,texSampler,uv,0).rgb*.25;
 col+=textureSampleLevel(bloom2,texSampler,uv,0).rgb*.24;
 col+=textureSampleLevel(bloom3,texSampler,uv,0).rgb*.24;
 let vignette=1.0-dot(p*vec2f(.83,1.0),p*vec2f(.83,1.0))*.55;
 col=aces(col*1.30*vignette)*post.values.y;
 col=pow(col,vec3f(1.0/2.2));
 let hash=fract(sin(dot(floor(uv*post.size.xy),vec2f(12.9898,78.233))+floor(post.values.z*24)*.17)*43758.5453);
 col+=(hash-.5)*.0035;
 return vec4f(max(col,vec3f(0)),1);
}
