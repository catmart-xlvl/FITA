import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {buildGlb} from '../scripts/texture-layout.mjs';
const exec=promisify(execFile),hash=b=>createHash('sha256').update(b).digest('hex');
const dependencies=fileURLToPath(new URL('../.runtime/texture-paint-libs/',import.meta.url));
async function fixture(t,{overlap=false}={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'local-paint-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 for(const name of ['models','atlases','masks'])await fs.mkdir(path.join(dir,name));
 await fs.copyFile(new URL('../scripts/local-texture-paint.py',import.meta.url),path.join(dir,'PINTAR_TEXTURAS.py'));
 await fs.writeFile(path.join(dir,'paint-runtime.json'),JSON.stringify({pythonPackages:dependencies}));
 const pixels=Buffer.alloc(64*64*4);
 for(let y=6;y<51;y++)for(const [lo,hi,base] of [[6,29,[195,105,64]],[35,58,[105,56,35]]])for(let x=lo;x<hi;x++)pixels.set([...base.map(v=>v+Math.floor((x-lo)/3)),255],4*(y*64+x));
 for(let y=19;y<31;y++)for(let x=17;x<22;x++)pixels.set([242,181,169,255],4*(y*64+x));
 const png=await sharp(pixels,{raw:{width:64,height:64,channels:4}}).png().toBuffer();
 await fs.writeFile(path.join(dir,'atlases/body_0.png'),png);await fs.writeFile(path.join(dir,'atlas-index.json'),JSON.stringify([{part:'body',index:0,file:'body_0.png',editable:true}]));
 const positions=[-1,0,0,1,0,0,1,1,0,-1,1,0,-1,1,0,1,1,0,1,1,-1,-1,1,-1],normals=[...Array(4).fill([0,0,1]).flat(),...Array(4).fill([0,1,0]).flat()],uv=[.1,.1,.45,.1,.45,.8,.1,.8,...(overlap?[.1,.1,.45,.1,.45,.8,.1,.8]:[.55,.1,.9,.1,.9,.8,.55,.8])],indices=[0,1,2,0,2,3,4,5,6,4,6,7];
 const bin=Buffer.alloc(positions.length*4+normals.length*4+uv.length*4+indices.length*2);
 let offset=0;for(const array of [positions,normals,uv])for(const value of array){bin.writeFloatLE(value,offset);offset+=4;}for(const i of indices){bin.writeUInt16LE(i,offset);offset+=2;}
 const bytes=buildGlb({asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'outfit',mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2},indices:3,material:0}]}],materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}}}],textures:[{source:0}],images:[{bufferView:4,mimeType:'image/png'}],buffers:[{byteLength:bin.length+png.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:96},{buffer:0,byteOffset:96,byteLength:96},{buffer:0,byteOffset:192,byteLength:64},{buffer:0,byteOffset:256,byteLength:24},{buffer:0,byteOffset:bin.length,byteLength:png.length}],accessors:[{bufferView:0,type:'VEC3',componentType:5126,count:8},{bufferView:1,type:'VEC3',componentType:5126,count:8},{bufferView:2,type:'VEC2',componentType:5126,count:8},{bufferView:3,type:'SCALAR',componentType:5123,count:12}]},Buffer.concat([bin,png]));
 await fs.writeFile(path.join(dir,'models/body.glb'),bytes);
 async function mask(name,fn){const raw=Buffer.alloc(4096);for(let y=0;y<64;y++)for(let x=0;x<64;x++)if(fn(x,y))raw[y*64+x]=255;await sharp(raw,{raw:{width:64,height:64,channels:1}}).png().toFile(path.join(dir,'masks',name+'.png'));}
 await mask('error',(x,y)=>x>=17&&x<22&&y>=19&&y<31);await mask('front',(x,y)=>x<30);await mask('top',(x,y)=>x>=35);
 const clone={id:'foreign-skin-on-leather',purpose:'projection-error',method:'clone',surface:{node:0,mesh:0,primitive:0,faces:[0,1]},mask:'masks/error.png',donorMask:'masks/front.png',featherPx:3};
 const shade={id:'upper-belt-return',purpose:'dirty-shadow',method:'shade',surface:{node:0,mesh:0,primitive:0,faces:[2,3]},mask:'masks/top.png',featherPx:2,lightDirection:[0,-1,1],shadowColor:[95,50,32],baseColor:[200,110,70],highlightColor:[215,125,83]};
 const plan={schema:'fita-local-paint-plan/v1',reviewedRegions:true,atlases:[{part:'body',index:0,input:'atlases/body_0.png',inputHash:hash(png),paddingPx:3,operations:[clone,shade]}]};
 const run=(...args)=>exec('python',['PINTAR_TEXTURAS.py',...args],{cwd:dir,windowsHide:true,maxBuffer:1024*1024});
 const apply=async p=>{await fs.writeFile(path.join(dir,'paint-plan.json'),JSON.stringify(p));return run('apply','paint-plan.json');};
 return {dir,bytes,pixels,png,plan,run,apply};
}

test('paint helper removes a false projection, shades upper returns independently, pads free texels and is repeatable',async t=>{
 const f=await fixture(t);await f.run('surface','body','0');await f.apply(f.plan);
 const filename=path.join(f.dir,'edited/body_0.png'),first=await fs.readFile(filename),result=await sharp(first).ensureAlpha().raw().toBuffer(),pixel=(x,y)=>[...result.subarray(4*(y*64+x),4*(y*64+x)+4)];
 assert(pixel(19,24)[0]<220&&pixel(19,24)[1]<140,'foreign skin projection replaced with nearby leather');
 assert(pixel(40,24)[0]<pixel(10,24)[0]-60,'upper surface has its own darker painted band');
 const audit=JSON.parse(await fs.readFile(path.join(f.dir,'output/local-paint-audit.json'))),allowed=await sharp(path.join(f.dir,'output/body_0-paint-mask.png')).extractChannel(0).raw().toBuffer();
 assert(audit.atlases[0].marginPixels>0);for(let i=0;i<4096;i++){assert.equal(result[4*i+3],f.pixels[4*i+3]);if(!allowed[i])assert(result.subarray(4*i,4*i+4).equals(f.pixels.subarray(4*i,4*i+4)));}
 assert((await fs.readFile(path.join(f.dir,'models/body.glb'))).equals(f.bytes));
 await f.apply(f.plan);assert((await fs.readFile(filename)).equals(first));
 await fs.writeFile(filename,Buffer.from('manual edit'));await assert.rejects(()=>f.apply(f.plan),/PAINT_OUTPUT_EXISTS/);
});

test('paint helper rejects cross-angle donors, shared UV surfaces and stale correspondence before writing',async t=>{
 const f=await fixture(t);await f.run('surface','body','0');const bad=structuredClone(f.plan);bad.atlases[0].operations=[{...bad.atlases[0].operations[0],surface:{node:0,mesh:0,primitive:0,faces:[0,1,2,3]},donorMask:'masks/top.png'}];
 await assert.rejects(()=>f.apply(bad),/MATCHING_SURFACE_ANGLE/);await assert.rejects(()=>fs.access(path.join(f.dir,'edited/body_0.png')));
 await fs.appendFile(path.join(f.dir,'models/body.glb'),'changed');await assert.rejects(()=>f.apply(f.plan),/SOURCE_CHANGED/);
 const g=await fixture(t,{overlap:true});await g.run('surface','body','0');await assert.rejects(()=>g.apply(g.plan),/SHARED_UV/);await assert.rejects(()=>fs.access(path.join(g.dir,'edited/body_0.png')));
});
