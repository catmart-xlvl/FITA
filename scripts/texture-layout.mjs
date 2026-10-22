// Portable atlas-only editor. Geometry, UVs, transforms and material assignments
// stay byte-for-byte identical; no Blender re-export or guessed correspondence.
import {createHash} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=()=>{throw Error('REFINE_LAYOUT_CHANGED');};
export function parseGlb(bytes){
 if(bytes.length<28||bytes.toString('ascii',0,4)!=='glTF'||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length||bytes.readUInt32LE(16)!==0x4e4f534a)fail();
 const end=20+bytes.readUInt32LE(12),json=JSON.parse(bytes.toString('utf8',20,end));
 if(end+8>bytes.length||bytes.readUInt32LE(end+4)!==0x004e4942||end+8+bytes.readUInt32LE(end)!==bytes.length||json.buffers?.length!==1||json.buffers[0].uri)fail();
 return {json,bin:bytes.subarray(end+8)};
}
export function buildGlb(json,bin){
 const j=Buffer.from(JSON.stringify(json)),jp=Buffer.alloc((j.length+3)&~3,32),bp=Buffer.alloc((bin.length+3)&~3);j.copy(jp);bin.copy(bp);
 const head=Buffer.alloc(20),bh=Buffer.alloc(8);head.write('glTF');head.writeUInt32LE(2,4);head.writeUInt32LE(28+jp.length+bp.length,8);head.writeUInt32LE(jp.length,12);head.writeUInt32LE(0x4e4f534a,16);bh.writeUInt32LE(bp.length);bh.writeUInt32LE(0x004e4942,4);return Buffer.concat([head,jp,bh,bp]);
}
function viewBytes(json,bin,index){const v=json.bufferViews?.[index];if(!v||v.buffer!==0||!Number.isInteger(v.byteLength)||v.byteLength<1||(v.byteOffset||0)<0||(v.byteOffset||0)+v.byteLength>bin.length)fail();return bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength);}
export function atlasImages(bytes){
 const {json,bin}=parseGlb(bytes),base=new Set(),other=new Set();
 const source=t=>json.textures?.[t?.index]?.source;
 for(const m of json.materials||[]){base.add(source(m.pbrMetallicRoughness?.baseColorTexture));
  const walk=(v,key='')=>{if(!v||typeof v!=='object')return;if(/texture$/i.test(key)&&key!=='baseColorTexture')other.add(source(v));for(const [k,x]of Object.entries(v))walk(x,k);};walk(m);
 }
 return (json.images||[]).map((im,i)=>{
  let pixels;if(Number.isInteger(im.bufferView))pixels=viewBytes(json,bin,im.bufferView);else if(/^data:image\/(png|jpeg);base64,/.test(im.uri||''))pixels=Buffer.from(im.uri.split(',')[1],'base64');else fail();
  const mime=pixels.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':pixels[0]===255&&pixels[1]===216?'image/jpeg':null;if(!mime)fail();
  return {index:i,editable:base.has(i)&&!other.has(i),mime,bytes:pixels,sha256:hash(pixels)};
 });
}
function layout(bytes){
 const {json,bin}=parseGlb(bytes),images=atlasImages(bytes),imageViews=new Set((json.images||[]).map(i=>i.bufferView).filter(Number.isInteger));
 // An image may not alias mesh data. Protect even malformed shared views.
 const geometryViews=new Set((json.accessors||[]).flatMap(a=>[a.bufferView,a.sparse?.indices?.bufferView,a.sparse?.values?.bufferView]).filter(Number.isInteger));
 if([...geometryViews].some(v=>imageViews.has(v)))fail();
 json.bufferViews=(json.bufferViews||[]).map((v,i)=>imageViews.has(i)?{image:true}:{...v,byteOffset:0,sha256:hash(viewBytes(json,bin,i))});
 json.images=(json.images||[]).map((im,i)=>{const copy={...im};delete copy.uri;delete copy.mimeType;return {...copy,protectedImage:images[i].editable?null:images[i].sha256};});
 json.buffers=[{buffer:0}];
 return JSON.stringify(json);
}
export function verifyTextureLayout(original,result){if(layout(original)!==layout(result))fail();return {geometryPreserved:true,uvPreserved:true,transformsPreserved:true};}
export function replaceAtlases(original,replacements){
 const {json,bin}=parseGlb(original),images=atlasImages(original);let chunks=[bin],length=bin.length;
 for(const [index,value]of replacements){const im=images[index];if(!im?.editable)fail();const mime=value.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':value[0]===255&&value[1]===216?'image/jpeg':null;if(!mime)fail();
  const target=json.images[index];if(target.uri){target.uri=`data:${mime};base64,${value.toString('base64')}`;continue;}
  const padding=Buffer.alloc((4-length%4)%4);chunks.push(padding,value);length+=padding.length;json.bufferViews[target.bufferView]={buffer:0,byteOffset:length,byteLength:value.length};length+=value.length;target.mimeType=mime;
 }
 json.buffers[0].byteLength=length;const result=buildGlb(json,Buffer.concat(chunks));verifyTextureLayout(original,result);return result;
}
