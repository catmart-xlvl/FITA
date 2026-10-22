import {Vector3,Matrix4,Euler,Quaternion} from 'three';

export const emptyDeformers=()=>({version:1,pins:[]});
export function validateDeformers(value){
 if(value===undefined)return emptyDeformers();
 const vector=a=>Array.isArray(a)&&a.length===3&&a.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=10000);
 if(value?.version!==1||!Array.isArray(value.pins)||value.pins.length>32)throw Error('PLACEMENT_INVALID_DEFORMERS');
 const ids=new Set();
 for(const p of value.pins){
  if(!p||typeof p.id!=='string'||!/^[-\w]{1,64}$/.test(p.id)||ids.has(p.id)||!['head','body'].includes(p.part)||typeof p.mesh!=='string'||!/^\d+:\d+$/.test(p.mesh)||!Number.isInteger(p.vertex)||p.vertex<0||p.vertex>2000000||!vector(p.center)||!vector(p.delta)||typeof p.radius!=='number'||!Number.isFinite(p.radius)||p.radius<.001||p.radius>2||typeof p.connectedOnly!=='boolean'||typeof p.enabled!=='boolean')throw Error('PLACEMENT_INVALID_DEFORMERS');
  ids.add(p.id);
 }
 return {version:1,pins:value.pins.map(p=>({id:p.id,part:p.part,mesh:p.mesh,vertex:p.vertex,center:[...p.center],delta:[...p.delta],radius:p.radius,connectedOnly:p.connectedOnly,enabled:p.enabled}))};
}
export function partMatrix(value){return new Matrix4().compose(new Vector3(...value.position),new Quaternion().setFromEuler(new Euler(...value.rotation)),new Vector3().setScalar(value.scale));}

class Heap{
 values=[];
 push(item){const a=this.values;a.push(item);let i=a.length-1;while(i){const p=(i-1)>>1;if(a[p][0]<=item[0])break;a[i]=a[p];i=p;}a[i]=item;}
 pop(){const a=this.values,first=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&a[c+1][0]<a[c][0])c++;if(a[c][0]>=last[0])break;a[i]=a[c];i=c;}a[i]=last;}return first;}
}

// Records keep the original vertex order. Shared source IDs join render-only
// UV splits; absent IDs, matching complete boundary edges bridge UV seams.
// No distance weld, remeshing or link between different scene nodes occurs.
export function createDeformationSurface(records){
 const lookup=new Map(),vertices=[],adjacency=[],groups=new Map();
 let bodyMin=Infinity,bodyMax=-Infinity,allMin=Infinity,allMax=-Infinity;
 for(const record of records){
  if(lookup.has(record.part+'/'+record.key))throw Error('PLACEMENT_DEFORMER_SOURCE_CHANGED');
  const matrix=new Matrix4().fromArray(record.matrix),inverse=matrix.clone().invert(),start=vertices.length;
  const item={...record,matrix,inverse,start,count:record.positions.length/3};lookup.set(record.part+'/'+record.key,item);
  const groupKey=record.part+'/'+record.key.split(':')[0];if(!groups.has(groupKey))groups.set(groupKey,[]);groups.get(groupKey).push(item);
  for(let i=0;i<item.count;i++){const p=new Vector3().fromArray(record.positions,i*3).applyMatrix4(matrix);vertices.push(p);adjacency.push(new Map());allMin=Math.min(allMin,p.y);allMax=Math.max(allMax,p.y);if(record.part==='body'){bodyMin=Math.min(bodyMin,p.y);bodyMax=Math.max(bodyMax,p.y);}}
 }
 const height=Math.max(Number.isFinite(bodyMax-bodyMin)?bodyMax-bodyMin:allMax-allMin,1e-8);
 const link=(a,b,d=vertices[a].distanceTo(vertices[b]))=>{adjacency[a].set(b,d);adjacency[b].set(a,d);};
 const positionKey=i=>vertices[i].toArray().map(n=>Math.round(n/Math.max(height*1e-8,1e-10))).join(',');
 for(const group of groups.values()){
  const identities=new Map(),boundaries=new Map();
  for(const item of group){
   const indices=item.indices||Array.from({length:item.count},(_,i)=>i),edgeCounts=new Map();
   for(let i=0;i+2<indices.length;i+=3)for(const [a,b] of [[indices[i],indices[i+1]],[indices[i+1],indices[i+2]],[indices[i+2],indices[i]]]){link(item.start+a,item.start+b);const k=a<b?a+':'+b:b+':'+a;const e=edgeCounts.get(k)||{a:item.start+a,b:item.start+b,count:0};e.count++;edgeCounts.set(k,e);}
   if(item.vertexIds)for(let i=0;i<item.count;i++){const id=item.vertexIds[i],v=item.start+i;if(identities.has(id)){const other=identities.get(id);if(vertices[v].distanceTo(vertices[other])>height*1e-7)throw Error('PLACEMENT_DEFORMER_SOURCE_CHANGED');link(v,other,0);}else identities.set(id,v);}
   else for(const e of edgeCounts.values())if(e.count===1){const a=positionKey(e.a),b=positionKey(e.b),key=a<b?a+'|'+b:b+'|'+a;if(!boundaries.has(key))boundaries.set(key,[]);boundaries.get(key).push({...e,ak:a,bk:b});}
  }
  for(const edges of boundaries.values())if(edges.length===2){const [a,b]=edges;link(a.a,a.ak===b.ak?b.a:b.b,0);link(a.b,a.bk===b.bk?b.b:b.a,0);}
 }
 const weightCache=new Map();
 function weights(pin){
  const target=lookup.get(pin.part+'/'+pin.mesh);if(!target||pin.vertex>=target.count)throw Error('PLACEMENT_DEFORMER_SOURCE_CHANGED');
  const center=new Vector3(...pin.center).applyMatrix4(target.matrix),radius=pin.radius*height,key=JSON.stringify([pin.part,pin.mesh,pin.vertex,pin.center,pin.radius,pin.connectedOnly]);
  if(weightCache.has(key))return {...weightCache.get(key),center};
  const distances=new Float64Array(vertices.length).fill(Infinity);
  if(pin.connectedOnly){
   const seed=target.start+pin.vertex,heap=new Heap();distances[seed]=vertices[seed].distanceTo(center);heap.push([distances[seed],seed]);
   while(heap.values.length){const [d,i]=heap.pop();if(d!==distances[i]||d>=radius)continue;for(const [j,length] of adjacency[i]){const next=d+length;if(next<distances[j]&&next<radius){distances[j]=next;heap.push([next,j]);}}}
  }else for(let i=0;i<vertices.length;i++)distances[i]=vertices[i].distanceTo(center);
  const influenced=[];for(let i=0;i<vertices.length;i++){const x=distances[i]/radius;if(x>=1)continue;const w=1-x*x*(3-2*x),gradient=vertices[i].clone().sub(center);if(gradient.lengthSq()>1e-20)gradient.normalize().multiplyScalar(-6*x*(1-x)/radius);else gradient.set(0,0,0);influenced.push({i,w,gradient});}
  const result={influenced,radius};weightCache.set(key,result);return {...result,center};
 }
 function apply(value){
  const pins=validateDeformers(value).pins,positions=vertices.map(p=>p.clone()),fields=new Map();
  for(const pin of pins){const info=weights(pin);if(!pin.enabled)continue;const delta=new Vector3(...pin.delta);if(!delta.lengthSq())continue;
   for(const {i,w,gradient:g} of info.influenced){positions[i].addScaledVector(delta,w);let a=fields.get(i);if(!a)fields.set(i,a=[1,0,0,0,1,0,0,0,1]);for(let row=0;row<3;row++)for(let col=0;col<3;col++)a[row*3+col]+=delta.getComponent(row)*g.getComponent(col);}
  }
  const output=records.map(record=>{const item=lookup.get(record.part+'/'+record.key),array=new Float32Array(record.positions);for(let i=0;i<item.count;i++)if(fields.has(item.start+i))positions[item.start+i].clone().applyMatrix4(item.inverse).toArray(array,i*3);return {record,positions:array};});
  return {output,world:positions,original:vertices,fields};
 }
 return {height,records,lookup,weights,apply};
}
