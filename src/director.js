/** Pure, deterministic film direction. All times are seconds, all dimensions are metres. */
export const DURATION = 86.06;
export const clamp = (x,a=0,b=1) => Math.max(a,Math.min(b,x));
export const ease = x => { x=clamp(x); return x*x*(3-2*x); };
const mix = (a,b,t) => a+(b-a)*t;
const vlerp = (a,b,t) => a.map((x,i)=>mix(x,b[i],t));
export const SHOTS = [
 {name:'Dawn',start:0,end:14, camera:[[0,.15,7],[0,.45,6]], target:[[0,.25,-14],[0,.7,-14]],fov:[47,43],world:0,energy:[0,0],explode:[0,0]},
 {name:'First light',start:14,end:24, camera:[[1.46,1.17,1.66],[2.55,1.40,2.48]],target:[[.12,.86,0],[0,.7,0]],fov:[32,34],world:1,energy:[.42,.82],explode:[0,0]},
 {name:'Material',start:24,end:34,camera:[[1.02,-.13,1.68],[-.91,-.01,1.87]],target:[[.03,-.43,0],[0,-.32,0]],fov:[38,38],world:1,energy:[.52,.72],explode:[0,0]},
 {name:'Presence',start:34,end:47,camera:[[2.55,1.55,5.8],[-1.80,1.35,5.5]],target:[[-.75,.30,0],[-.92,.45,0]],fov:[38,37],world:1,energy:[.80,1.12],explode:[0,0]},
 {name:'Inner universe',start:47,end:57,camera:[[.07,.53,.72],[-.12,.54,-.16]],target:[[.18,.57,-1.25],[-.37,.28,-1.0]],fov:[70,82],world:2,energy:[.9,1.35],explode:[0,0]},
 {name:'Architecture',start:57,end:69,camera:[[3.2,2.30,6.80],[1.95,1.74,6.4]],target:[[-.9,.70,0],[-.80,.8,0]],fov:[38,39],world:1,energy:[.65,.92],explode:[.18,1]},
 {name:'Arrival',start:69,end:78,camera:[[-1.20,1.14,6.50],[.82,1.4,6.7]],target:[[0,.65,0],[0,.70,0]],fov:[41,41],world:1,energy:[1.3,1.18],explode:[.8,0]},
 {name:'Aether Orb',start:78,end:DURATION,camera:[[2.10,1.45,6.10],[2.38,1.38,6.5]],target:[[-1,.45,0],[-1.08,.40,0]],fov:[37,36],world:1,energy:[.95,.76],explode:[0,0]}
];
export const TITLES = [
 {from:3,to:10.9,kicker:'CRYSTALBALL PRESENTS',lines:['A new dawn.'],align:'center',size:'quiet',sub:'FOR AMBIENT INTELLIGENCE'},
 {from:17.0,to:22.8,kicker:'01 / FIRST LIGHT',lines:['Something','extraordinary.'],align:'left',size:'medium',sub:''},
 {from:26,to:32.3,kicker:'02 / MATERIAL & LIGHT',lines:['Made to','be present.'],align:'left',size:'medium',sub:'A STUDY IN GLASS, LIGHT AND FORM'},
 {from:35.4,to:45.6,kicker:'03 / A NEW KIND OF INTERFACE',lines:['Intelligence.','With presence.'],align:'left',size:'large',sub:'VOICE.  TEXT.  PRESENCE.'},
 {from:49.8,to:55.9,kicker:'04 / INNER UNIVERSE',lines:['A universe.','Within reach.'],align:'center',size:'large',sub:''},
 {from:59.1,to:67.8,kicker:'05 / THE PLATFORM VISION',lines:['Beautiful outside.','Possibility within.'],align:'left',size:'medium',sub:'HARDWARE  /  FIRMWARE  /  BROWSER PROTOTYPE'},
 {from:70.5,to:76.9,kicker:'CRYSTALBALL',lines:['Aether Orb.'],align:'center-top',size:'hero',sub:''},
 {from:79,to:86.06,kicker:'CRYSTALBALL',lines:['Aether Orb.'],align:'left',size:'hero',sub:'Ambient AI, reimagined.',cta:true}
];
export function sampleFilm(time, aspect=16/9) {
 const t=clamp(Number.isFinite(time)?time:0,0,DURATION);
 const shot=SHOTS.find(s=>t<s.end)||SHOTS.at(-1);
 const p=clamp((t-shot.start)/(shot.end-shot.start));
 const e=ease(p);
 let camera=vlerp(...shot.camera,e), target=vlerp(...shot.target,e), fov=mix(...shot.fov,e);
 // Portrait is an actual reframing, not a crop of the landscape camera.
 if(aspect<1.25 && shot.world!==0 && shot.world!==2 && shot.name!=='Material' && shot.name!=='First light') {
   camera=camera.map((x,i)=>i===2?x*1.32:x);
   target[0]*=.18; target[1]+=.58;
 }
 const explode=mix(...shot.explode,shot.name==='Arrival'?ease(p*1.65):e);
 // Deliberate film cuts. Brief exposure dips conceal no loading or shader work.
 const cut=shot.start===0?ease(t/2.7):.35+.65*ease((t-shot.start)/.42);
 const outgoing=shot.end===DURATION?1:1-.60*ease((t-shot.end+.20)/.20);
 const fade=cut*outgoing*(1-.88*ease((t-85.4)/.66));
 const title=TITLES.find(x=>t>=x.from&&t<x.to)||null;
 let titleOpacity=0,titleProgress=0;
 if(title) {titleProgress=clamp((t-title.from)/1.25); titleOpacity=ease(titleProgress)*(title.cta?1:ease((title.to-t)/.7));}
 return {time:t,shot,progress:p,camera,target,fov,world:shot.world,energy:mix(...shot.energy,e),explode,fade,
   sun:ease(t/13.5),title,titleOpacity,titleProgress,portrait:aspect<1.25};
}
export function cameraBasis(position,target) {
 const normalize=v=>{const n=Math.hypot(...v)||1;return v.map(x=>x/n)};
 const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 const forward=normalize(target.map((x,i)=>x-position[i]));
 const right=normalize(cross(forward,[0,1,0]));
 const up=normalize(cross(right,forward));
 return {forward,right,up};
}
