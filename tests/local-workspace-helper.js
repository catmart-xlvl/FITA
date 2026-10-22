import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
// Test harness follows the exported locator exactly as a local Codex would.
export async function workspaceFiles(files){
 if(!files['UBICACIONES.json'])return files;
 const m=JSON.parse(files['UBICACIONES.json']);assert.equal(m.schema,'workbench-local-instructions/v1');
 assert.deepEqual(Object.keys(files).sort(),[['views','segmentation'].includes(m.kind)?'INSTRUCTIONS.txt':'INSTRUCCIONES.txt','UBICACIONES.json']);
 const result={};for(const entry of m.entries){const b=await fs.readFile(entry.path);assert.equal(createHash('sha256').update(b).digest('hex'),entry.sha256);result[entry.name]=b;}
 assert(!Object.keys(result).some(n=>n.startsWith('skills/')));
 return result;
}
