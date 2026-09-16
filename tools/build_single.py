#!/usr/bin/env python3
"""Deterministically inline first-party modules and WGSL; no bundler dependency."""
import json,pathlib,re
ROOT=pathlib.Path(__file__).resolve().parents[1]
def main():
    shaders={p.stem:p.read_text() for p in sorted((ROOT/'shaders').glob('*.wgsl'))}
    code='const INLINE_SHADERS='+json.dumps(shaders,separators=(',',':'))+';\n'
    code+='const INLINE_COMPAT='+json.dumps((ROOT/'shaders/compat-scene.glsl').read_text())+';\n'
    for filename in ['director.js','renderer.js','compatibility.js','audio.js','export.js','app.js']:
        source=(ROOT/'src'/filename).read_text()
        source=re.sub(r'^import .*?;\n','',source,flags=re.MULTILINE)
        source=re.sub(r'^export ','',source,flags=re.MULTILINE)
        if filename=='renderer.js':
            source=re.sub(r'^const load=async name=>.*?;\n',"const load=async name=>INLINE_SHADERS[name];\n",source,flags=re.MULTILINE)
        if filename=='compatibility.js':
            source=re.sub(r'^const loadCompat=async\(\)=>.*?;\n',"const loadCompat=async()=>INLINE_COMPAT;\n",source,flags=re.MULTILINE)
        code+='\n// -------- '+filename+' --------\n'+source
    html=(ROOT/'index.html').read_text()
    html=re.sub(r'<link rel="stylesheet" href="style\.css(?:\?[^"]*)?">',lambda _:'<style>\n'+(ROOT/'style.css').read_text()+'\n</style>',html)
    html=re.sub(r'<script type="module" src="src/app\.js(?:\?[^"]*)?"></script>',lambda _:'<script type="module">\n'+code.replace('</script','<\\/script')+'\n</script>',html)
    (ROOT/'Aether-Orb-Odyssey.html').write_text(html)
    print(f'Built {ROOT / "Aether-Orb-Odyssey.html"} ({len(html):,} characters)')
if __name__=='__main__':main()
