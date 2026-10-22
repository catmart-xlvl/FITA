import test from 'node:test';
import assert from 'node:assert/strict';
import {textureAssembly} from '../src/texture-assembly.js';
function fixture(){return {project:{segmentationBaseline:{id:'base'},segmentations:[{id:'seg',identity:JSON.stringify({baseline:'base'}),reconstruction:{textureIds:['h','b'],blend:{url:'/result.blend'}}}]},textures:[{id:'h',group:'head',segmentationId:'seg',current:true,url:'/h.glb'},{id:'b',group:'body',segmentationId:'seg',current:true,url:'/b.glb'}]};}
test('assembled preview uses both reconstructed textures and the original placement',()=>{const {project,textures}=fixture();assert.deepEqual(textureAssembly(project,textures),{head:textures[0],body:textures[1],blend:{url:'/result.blend'}});});
test('reads detailed segmentation response when the project only contains summaries',()=>{const {project,textures}=fixture(),current=project.segmentations[0];project.segmentations=[{id:'seg'}];assert.equal(textureAssembly(project,textures,current).head.id,'h');});
test('never combines stale, incomplete, unrelated or whole-part texture results',()=>{
 for(const mutate of [(p,t)=>t.pop(),(p,t)=>t[0].current=false,(p,t)=>t[1].segmentationId='other',(p,t)=>t[0].id='newer-whole-part',(p)=>p.segmentationBaseline.id='new-base',(p)=>delete p.segmentationBaseline,(p)=>p.segmentations[0].identity='invalid']){const {project,textures}=fixture();mutate(project,textures);assert.equal(textureAssembly(project,textures),null);}
});
