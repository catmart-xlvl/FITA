import {BufferGeometry,Float32BufferAttribute} from 'three';
// These IDs come from the native FBX polygons, before GPU triangulation.
// Never infer quads from adjacent triangles or hide arbitrary mesh edges.
export function nativeTopology(geometry){
 const ids=geometry.getAttribute('_wb_face'),positions=geometry.getAttribute('position');
 if(!ids||!positions||ids.count!==positions.count)return null;
 const count=geometry.index?.count||positions.count,faces=new Map();
 const vertex=i=>geometry.index?geometry.index.getX(i):i;
 const point=i=>[positions.getX(i),positions.getY(i),positions.getZ(i)];
 for(let i=0;i<count;i+=3){
  const vertices=[vertex(i),vertex(i+1),vertex(i+2)],id=ids.getX(vertices[0]);
  if(!Number.isSafeInteger(id)||id<0||vertices.some(v=>ids.getX(v)!==id))return null;
  if(!faces.has(id))faces.set(id,new Map());const edges=faces.get(id);
  for(let j=0;j<3;j++){
   const a=point(vertices[j]),b=point(vertices[(j+1)%3]);const key=[a.join(','),b.join(',')].sort().join('|');
   const edge=edges.get(key)||{a,b,count:0};edge.count++;edges.set(key,edge);
  }
 }
 const unique=new Map();let quads=0,triangles=0,ngons=0;
 for(const edges of faces.values()){
  const boundary=[...edges.entries()].filter(([,edge])=>edge.count===1);
  if(boundary.length===4)quads++;else if(boundary.length===3)triangles++;else if(boundary.length>4)ngons++;else return null;
  for(const [key,edge]of boundary)unique.set(key,edge);
 }
 const lines=new BufferGeometry();lines.setAttribute('position',new Float32BufferAttribute([...unique.values()].flatMap(e=>[...e.a,...e.b]),3));
 return {geometry:lines,polygons:faces.size,quads,triangles,ngons};
}
