/** Small explicit frame graph. Logical resource versions may alias a physical target. */
export class FrameGraph {
  constructor(imports=[]){this.imports=new Set(imports);this.nodes=[];this.order=null;}
  add(name,{reads=[],writes=[],after=[],run}){
    if(this.order)throw new Error('Cannot mutate a compiled frame graph.');
    if(this.nodes.some(n=>n.name===name)||typeof run!=='function')throw new Error(`Invalid/duplicate pass: ${name}`);
    if(reads.some(r=>writes.includes(r)))throw new Error('Use versioned logical resources for read/write passes.');
    // Dependency data is a snapshot, not a mutable alias to caller-owned arrays.
    this.nodes.push(Object.freeze({name,reads:Object.freeze([...reads]),writes:Object.freeze([...writes]),after:Object.freeze([...after]),run}));return this;
  }
  compile(){
    const producers=new Map(),byName=new Map(this.nodes.map(n=>[n.name,n]));
    for(const n of this.nodes)for(const w of n.writes){if(producers.has(w)||this.imports.has(w))throw new Error(`Duplicate writer: ${w}`);producers.set(w,n);}
    const visited=new Set(),active=new Set(),order=[];
    const visit=n=>{
      if(visited.has(n))return;if(active.has(n))throw new Error(`Frame graph cycle: ${n.name}`);active.add(n);
      for(const r of n.reads){const p=producers.get(r);if(p)visit(p);else if(!this.imports.has(r))throw new Error(`Missing producer: ${r}`);}
      for(const name of n.after){if(!byName.has(name))throw new Error(`Unknown pass: ${name}`);visit(byName.get(name));}
      active.delete(n);visited.add(n);order.push(n);
    };
    this.nodes.forEach(visit);this.order=Object.freeze(order);return this;
  }
  execute(encoder,frame){if(!this.order)throw new Error('Compile the frame graph first.');for(const n of this.order)n.run(encoder,frame);}
  get passes(){return (this.order||this.nodes).map(n=>({name:n.name,reads:n.reads,writes:n.writes}));}
}
