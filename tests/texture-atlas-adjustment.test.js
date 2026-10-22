import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {adjustAtlasSaturation,replaceMatchingAtlases} from '../server/texture-atlas-adjustment.js';
import {buildGlb,atlasImages,verifyTextureLayout} from '../scripts/texture-layout.mjs';
const png=async values=>sharp(Buffer.from(values),{raw:{width:values.length/4,height:1,channels:4}}).png().toBuffer();
test('requested saturation ratios preserve value, alpha, grays and image dimensions',async()=>{
 const before=await png([200,100,50,17,90,90,90,255,0,0,0,0]);
 const result=await adjustAtlasSaturation(before,.6),raw=await sharp(result).ensureAlpha().raw().toBuffer();
 assert.deepEqual([...raw],[200,140,110,17,90,90,90,255,0,0,0,0]);
 assert.deepEqual([...(await sharp(await adjustAtlasSaturation(before,.9)).ensureAlpha().raw().toBuffer()).subarray(0,4)],[200,110,65,17]);
 await assert.rejects(adjustAtlasSaturation(before,NaN),/ATLAS_INVALID_SATURATION/);
 await assert.rejects(adjustAtlasSaturation(before,1.1),/ATLAS_INVALID_SATURATION/);
});
test('saved-model atlas matching preserves mesh buffers, other atlases and layout',async()=>{
 const a=await png([200,100,50,255]),b=await png([10,20,30,255]),replacement=await adjustAtlasSaturation(a,.6);
 const meshBytes=Buffer.alloc(12);meshBytes.writeFloatLE(3.25,0);
 const glb=buildGlb({asset:{version:'2.0'},buffers:[{byteLength:12+a.length+b.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:12},{buffer:0,byteOffset:12,byteLength:a.length},{buffer:0,byteOffset:12+a.length,byteLength:b.length}],accessors:[{bufferView:0,componentType:5126,type:'VEC3',count:1}],images:[{bufferView:1,mimeType:'image/png'},{bufferView:2,mimeType:'image/png'}],textures:[{source:0},{source:1}],materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}}},{pbrMetallicRoughness:{baseColorTexture:{index:1}}}]},Buffer.concat([meshBytes,a,b]));
 const original=atlasImages(glb),result=replaceMatchingAtlases(glb,original,new Map([[0,replacement]]));
 assert(verifyTextureLayout(glb,result).geometryPreserved);
 assert.equal(atlasImages(result)[1].sha256,original[1].sha256);
 assert.throws(()=>replaceMatchingAtlases(glb,[{sha256:'missing'}],new Map([[0,replacement]])),/ATLAS_SAVED_IMAGE_NOT_FOUND/);
});
