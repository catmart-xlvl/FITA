import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {createHash} from 'node:crypto';
import {reservedRigParts} from '../server/rig-reserved-parts.js';import {exportInstructions} from '../server/avatar-delivery.js';
test('destination-only garments are copied with verified hashes and explicit merge guidance',async t=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'fita-reserved-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));await fs.mkdir(path.join(folder,'output/reserved'),{recursive:true});
 assert.deepEqual(await reservedRigParts(folder,{}),{files:{},parts:null});const files=[];
 for(const name of ['character-with-coat.blend','character-with-coat.glb','runtime-with-coat.json']){const data=Buffer.from(name);await fs.writeFile(path.join(folder,'output/reserved',name),data);files.push({file:'reserved/'+name,sha256:createHash('sha256').update(data).digest('hex')});}
 const report={reservedForVrchat:{schema:'fita-reserved-rig-parts/v1',meshes:['coat'],files}},result=await reservedRigParts(folder,report);assert.equal(Object.keys(result.files).length,3);assert.deepEqual(result.parts.meshes,['coat']);assert.match(exportInstructions({reservedParts:result.parts}),/Never replace the approved body/);
 const traversal=structuredClone(report);traversal.reservedForVrchat.files[0].file='../elsewhere.blend';await assert.rejects(()=>reservedRigParts(folder,traversal),/RESERVED_RIG/);
 await fs.writeFile(path.join(folder,'output/reserved/character-with-coat.blend'),'changed');await assert.rejects(()=>reservedRigParts(folder,report),/RESERVED_RIG/);
});
