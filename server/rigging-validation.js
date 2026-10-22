import {glbBuffer} from './validation.js';
import {createHash} from 'node:crypto';
import {Matrix4,Quaternion,Vector3} from 'three';

const fail=()=>{throw Object.assign(new Error('The result needs a complete weighted humanoid GLB.'),{status:400});};
// Compare rendered rest triangles rather than vertex order: adding skinning may
// legitimately split vertices at UV/weight seams during Blender export.
export function inspectRestPreservation(source,result){
  function signature(bytes){
    glbBuffer(bytes);const d=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12))),offset=20+bytes.readUInt32LE(12);
    if(offset+8>bytes.length||bytes.readUInt32LE(offset+4)!==0x004e4942)fail();
    const bin=bytes.subarray(offset+8,offset+8+bytes.readUInt32LE(offset));
    const widths={SCALAR:1,VEC2:2,VEC3:3},sizes={5121:1,5123:2,5125:4,5126:4};
    const accessor=i=>{const a=d.accessors?.[i],v=d.bufferViews?.[a?.bufferView],size=sizes[a?.componentType],width=widths[a?.type];
      if(!a||a.sparse||!v||v.buffer!==0||!size||!width)fail();
      const start=(v.byteOffset||0)+(a.byteOffset||0),stride=v.byteStride||size*width;
      if(!Number.isInteger(a.count)||a.count<1||a.count>2000000||stride<size*width||start<0||start+(a.count-1)*stride+size*width>bin.length||start+(a.count-1)*stride+size*width>(v.byteOffset||0)+v.byteLength)fail();
      return {count:a.count,width,get(row,col=0){if(row<0||row>=a.count||col>=width)fail();const at=start+row*stride+col*size,value=a.componentType===5126?bin.readFloatLE(at):a.componentType===5121?bin.readUInt8(at):a.componentType===5123?bin.readUInt16LE(at):bin.readUInt32LE(at);if(!Number.isFinite(value))fail();return a.normalized?value/(a.componentType===5121?255:65535):value;}};};
    const imageHash=index=>{const image=d.images?.[index];if(!image)fail();let data;
      if(image.uri?.startsWith('data:'))data=Buffer.from(image.uri.slice(image.uri.indexOf(',')+1),'base64');
      else {const v=d.bufferViews?.[image.bufferView];if(!v||v.buffer!==0||(v.byteOffset||0)+v.byteLength>bin.length)fail();data=bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength);}
      return createHash('sha256').update(data).digest('hex');};
    const materialKeys=(d.materials||[]).map(m=>{const color=m.pbrMetallicRoughness?.baseColorTexture,texture=d.textures?.[color?.index];return JSON.stringify({image:color?imageHash(texture?.source):null,factor:m.pbrMetallicRoughness?.baseColorFactor||[1,1,1,1],uv:color?.texCoord||0,transform:color?.extensions?.KHR_texture_transform||null,alpha:m.alphaMode||'OPAQUE',cutoff:m.alphaCutoff??.5,doubleSided:m.doubleSided===true});});
    const triangles=[],seen=new Set(),vector=new Vector3(),rounded=x=>Math.round(x*100000);
    function walk(index,parent){
      const node=d.nodes?.[index];if(!node||seen.has(index))fail();seen.add(index);
      const local=node.matrix?new Matrix4().fromArray(node.matrix):new Matrix4().compose(new Vector3(...(node.translation||[0,0,0])),new Quaternion(...(node.rotation||[0,0,0,1])),new Vector3(...(node.scale||[1,1,1]))),world=parent.clone().multiply(local);
      if(node.mesh!==undefined)for(const primitive of d.meshes?.[node.mesh]?.primitives||[]){
        if((primitive.mode??4)!==4)fail();
        const position=accessor(primitive.attributes.POSITION),material=d.materials?.[primitive.material],t=material?.pbrMetallicRoughness?.baseColorTexture;
        const uv=accessor(primitive.attributes['TEXCOORD_'+(t?.extensions?.KHR_texture_transform?.texCoord??t?.texCoord??0)]),indices=primitive.indices===undefined?null:accessor(primitive.indices),count=indices?.count||position.count;
        if(position.width!==3||uv.width!==2||count%3)fail();
        for(let i=0;i<count;i+=3){const points=[];for(let j=0;j<3;j++){const n=indices?indices.get(i+j):i+j;vector.set(position.get(n,0),position.get(n,1),position.get(n,2)).applyMatrix4(world);points.push([...vector.toArray().map(rounded),rounded(uv.get(n,0)),rounded(uv.get(n,1))].join(','));}triangles.push(materialKeys[primitive.material]+'|'+points.sort().join('|'));}
      }
      for(const child of node.children||[])walk(child,world);
    }
    for(const index of d.scenes?.[d.scene??0]?.nodes||[])walk(index,new Matrix4());
    if(!triangles.length)fail();return createHash('sha256').update(triangles.sort().join('\n')).digest('hex');
  }
  if(signature(source)!==signature(result))throw Object.assign(new Error('The rigged result changed the rest geometry, UVs or base color materials.'),{status:400});
  return {restGeometryAndBaseColorPreserved:true,toleranceMeters:.00001,scope:'Rest triangles, UV coordinates and base color materials. Other shader properties and visual deformation need review.'};
}
export function inspectRiggedGlb(bytes,profile,{baseline=false}={}){
  glbBuffer(bytes);
  const doc=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));
  const offset=20+bytes.readUInt32LE(12);
  if(offset+8>bytes.length||bytes.readUInt32LE(offset+4)!==0x004e4942)fail();
  const bin=bytes.subarray(offset+8,offset+8+bytes.readUInt32LE(offset));
  const widths={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16},sizes={5121:1,5123:2,5125:4,5126:4};
  function accessor(index,type,components){
    const a=doc.accessors?.[index],view=doc.bufferViews?.[a?.bufferView];
    if(!a||a.type!==type||!components.includes(a.componentType)||a.sparse||!view||view.buffer!==0||!Number.isInteger(a.count)||a.count<1||a.count>2000000)fail();
    const width=widths[type],size=sizes[a.componentType],stride=view.byteStride||width*size,start=(view.byteOffset||0)+(a.byteOffset||0);
    if(stride<width*size||start<0||start+(a.count-1)*stride+width*size>bin.length||start+(a.count-1)*stride+width*size>(view.byteOffset||0)+view.byteLength)fail();
    return {count:a.count,normalized:a.normalized,componentType:a.componentType,get(row,col){const at=start+row*stride+col*size;return a.componentType===5126?bin.readFloatLE(at):a.componentType===5121?bin.readUInt8(at):a.componentType===5123?bin.readUInt16LE(at):bin.readUInt32LE(at);}};
  }
  const nodes=doc.nodes||[],parents=new Map();
  for(let i=0;i<nodes.length;i++)for(const child of nodes[i].children||[]){if(!nodes[child]||parents.has(child)||child===i)fail();parents.set(child,i);}
  for(let i=0;i<nodes.length;i++){let n=i;const seen=new Set();while(parents.has(n)){if(seen.has(n))fail();seen.add(n);n=parents.get(n);}}
  const active=new Set(),roots=doc.scenes?.[doc.scene??0]?.nodes||[];
  const walk=i=>{if(!nodes[i])fail();if(active.has(i))return;active.add(i);for(const child of nodes[i].children||[])walk(child);};roots.forEach(walk);
  const jointIndices=new Set((doc.skins||[]).flatMap(s=>s.joints||[]));
  const boneNames=new Map();
  for(const index of active){const n=nodes[index];if(jointIndices.has(index)||n.name?.startsWith('WB_')&&n.mesh===undefined){if(!n.name||boneNames.has(n.name))fail();boneNames.set(n.name,index);}}
  const required=profile?.bones.filter(b=>b.presence!=='optional')||[];
  if(required.some(b=>!boneNames.has(b.name)))fail();
  for(const bone of required){if(bone.parent&&parents.get(boneNames.get(bone.name))!==boneNames.get(bone.parent))fail();}
  const weightedBoneNames=new Set();
  let meshes=0,vertices=0,maxInfluences=0,unweightedVertices=0,unnormalizedVertices=0,unskinnedMeshes=0;
  for(const index of active){const node=nodes[index];if(node.mesh===undefined)continue;
    const skin=doc.skins?.[node.skin],mesh=doc.meshes?.[node.mesh];
    if(baseline&&node.skin===undefined){unskinnedMeshes++;continue;}
    if(!skin?.joints?.length||!mesh?.primitives?.length||new Set(skin.joints).size!==skin.joints.length||skin.joints.some(j=>!active.has(j)))fail();
    const ibm=accessor(skin.inverseBindMatrices,'MAT4',[5126]);if(ibm.count!==skin.joints.length)fail();
    for(let row=0;row<ibm.count;row++)for(let col=0;col<16;col++)if(!Number.isFinite(ibm.get(row,col)))fail();
    for(const primitive of mesh.primitives){
      const attrs=primitive.attributes||{};
      if(!baseline&&(attrs.JOINTS_1!==undefined||attrs.WEIGHTS_1!==undefined))fail();
      const positions=accessor(attrs.POSITION,'VEC3',[5126]),joints=accessor(attrs.JOINTS_0,'VEC4',[5121,5123]),weights=accessor(attrs.WEIGHTS_0,'VEC4',[5121,5123,5126]);
      if(joints.count!==positions.count||weights.count!==positions.count||(weights.componentType!==5126&&!weights.normalized))fail();
      const extra=attrs.JOINTS_1!==undefined||attrs.WEIGHTS_1!==undefined?{joints:accessor(attrs.JOINTS_1,'VEC4',[5121,5123]),weights:accessor(attrs.WEIGHTS_1,'VEC4',[5121,5123,5126])}:null;
      if(extra&&(extra.joints.count!==positions.count||extra.weights.count!==positions.count||extra.weights.componentType!==5126&&!extra.weights.normalized))fail();
      for(let row=0;row<weights.count;row++){
        let sum=0,count=0;
        for(let col=0;col<3;col++)if(!Number.isFinite(positions.get(row,col)))fail();
        for(const pair of [{joints,weights},...(extra?[extra]:[])])for(let col=0;col<4;col++){
          const joint=pair.joints.get(row,col),weight=pair.weights.get(row,col)/(pair.weights.componentType===5121?255:pair.weights.componentType===5123?65535:1);
          if(joint>=skin.joints.length||!Number.isFinite(weight)||weight<0||weight>1)fail();
          sum+=weight;if(weight>0){count++;weightedBoneNames.add(nodes[skin.joints[joint]].name);}
        }
        if(!count)unweightedVertices++;if(Math.abs(sum-1)>.002)unnormalizedVertices++;
        if(!baseline&&(Math.abs(sum-1)>.002||!count))fail();maxInfluences=Math.max(maxInfluences,count);
      }
      vertices+=positions.count;
    }
    meshes++;
  }
  if(!meshes)fail();
  return {meshes,vertices,maxInfluences,bones:boneNames.size,weightedBoneNames:[...weightedBoneNames],unweightedVertices,unnormalizedVertices,unskinnedMeshes,scope:'Structural skin checks only; spatial weight quality requires deformation review.'};
}
