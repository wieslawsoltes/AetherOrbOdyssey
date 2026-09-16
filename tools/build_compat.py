#!/usr/bin/env python3
"""Build a limited GLSL ES compatibility shader from this project's WGSL math.
Not a general WGSL compiler. Native WebGPU remains the primary renderer.
"""
import pathlib,re,json
ROOT=pathlib.Path(__file__).resolve().parents[1]
TYPE={'f32':'float','i32':'int','u32':'uint','vec2f':'vec2','vec3f':'vec3','vec4f':'vec4','bool':'bool','VertexOut':'VertexOut'}
TOKEN=re.compile(r'(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?[fu]?|[A-Za-z_]\w*|==|!=|<=|>=|&&|\|\||\+\+|--|[^\s]')
SCALAR={'dot','length','distance','hash31','hash11','noise3','cylinder','beveledCone'}
class Infer:
 def __init__(self,expr,scope,returns):self.ts=TOKEN.findall(expr);self.i=0;self.scope=scope;self.returns=returns
 def peek(self):return self.ts[self.i] if self.i<len(self.ts) else ''
 def take(self):t=self.peek();self.i+=1;return t
 def expr(self,minp=0):
  ty=self.atom();prec={'||':1,'&&':2,'==':3,'!=':3,'>':4,'<':4,'>=':4,'<=':4,'+':5,'-':5,'*':6,'/':6,'%':6}
  while self.peek() in prec and prec[self.peek()]>=minp:
   op=self.take();other=self.expr(prec[op]+1)
   if op in ['==','!=','>','<','>=','<=','&&','||']:ty='bool'
   elif other.startswith('vec') and not ty.startswith('vec'):ty=other
   elif ty=='int' and other=='float':ty='float'
  return ty
 def atom(self):
  tok=self.take()
  if tok in ['-','+','!']:return self.atom()
  if tok=='(':
   ty=self.expr();self.take()
  elif re.match(r'^(?:\d|\.)',tok):ty='float' if any(c in tok for c in '.ef') else 'int'
  elif self.peek()=='(':
   self.take();args=[]
   if self.peek()!=')':
    while True:
     args.append(self.expr())
     if self.peek()!=',':break
     self.take()
   if self.peek()==')':self.take()
   if tok in TYPE:ty=TYPE[tok]
   elif tok in self.returns:ty=self.returns[tok]
   elif tok in SCALAR:ty='float'
   elif tok in ['all','any']:ty='bool'
   elif tok in ['textureSampleLevel','textureLod']:ty='vec4'
   elif tok in ['greaterThan','lessThan']:ty='bvec2'
   else:ty=args[0] if args else 'float'
  else:ty=self.scope.get(tok,'float')
  while self.peek()=='.':
   self.take();field=self.take()
   if tok=='u':ty='vec4'
   elif field=='uv':ty='vec2'
   elif len(field)>1 and all(x in 'xyzwrgba' for x in field):ty='vec'+str(len(field))
   elif len(field)==1:ty='float'
   tok=''
  return ty

def main():
 common=(ROOT/'shaders/common.wgsl').read_text();scene=(ROOT/'shaders/scene.wgsl').read_text()
 common=common[common.index('const PI:'):common.index('struct VertexOut')]
 scene=re.sub(r'@group\([^\n]+\n','',scene)
 text=common+'\n'+scene
 sig=re.compile(r'(?:@fragment\s+)?fn\s+(\w+)\((.*?)\)\s*->\s*(?:@location\(\d+\)\s*)?(\w+)\s*\{',re.S)
 matches=list(sig.finditer(text));returns={m[1]:TYPE.get(m[3],m[3]) for m in matches}
 prefix='#version 300 es\nprecision highp float;\nprecision highp int;\nuniform sampler2D engraving;\nin vec2 vUv;\nout vec4 fragColor;\nstruct Uniforms{vec4 resolution;vec4 camera;vec4 right;vec4 up;vec4 forward;vec4 parameters;vec4 orb;vec4 extra;};\nuniform Uniforms u;\nconst float PI=3.14159265359;\n'
 output=prefix
 for index,m in enumerate(matches):
  depth=1;end=m.end()
  while depth:
   if text[end]=='{':depth+=1
   if text[end]=='}':depth-=1
   end+=1
  body=text[m.end():end-1];scope={};params=[]
  if m[1]!='sceneFragment':
   for part in m[2].split(','):
    if ':'not in part:continue
    name,t=map(str.strip,part.split(':'));scope[name]=TYPE.get(t,t);params.append(scope[name]+' '+name)
  def decl(match):
   name,expr=match[1],match[2];ty=Infer(expr,scope,returns).expr();scope[name]=ty
   return f'{ty} {name}={expr};'
  body=re.sub(r'\b(?:let|var)\s+(\w+)\s*=\s*([^;]+);',decl,body)
  body=body.replace('in.uv','vUv').replace('atan2(', 'atan(')
  body=re.sub(r'(?<![\w.])(\d+)(?![\w.])',r'\1.0',body)
  body=re.sub(r'for\(int (\w+)=0\.0;\1<(\d+)\.0;\1\+\+\)',r'for(int \1=0;\1<\2;\1++)',body)
  body=body.replace('all(uv>vec2f(0.0))','all(greaterThan(uv,vec2f(0.0)))').replace('all(uv<vec2f(1.0))','all(lessThan(uv,vec2f(1.0)))')
  body=re.sub(r'textureSampleLevel\(engraving,linearSampler,([^,]+),([^\)]+)\)',r'textureLod(engraving,\1,\2)',body)
  for wg,gl in TYPE.items():body=re.sub(r'\b'+wg+r'\b',gl,body)
  output+=f'{returns[m[1]]} {m[1]}('+','.join(params)+'){'+body+'}\n'
 output=re.sub(r'\bout\b','accumulated',output).replace('accumulated vec4 fragColor','out vec4 fragColor')
 output+='void main(){fragColor=sceneFragment();}\n'
 (ROOT/'shaders/compat-scene.glsl').write_text(output)
 print('Built GLSL compatibility shader:',len(output),'bytes')
if __name__=='__main__':main()
