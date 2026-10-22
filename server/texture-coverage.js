import {segFail as fail} from './segmentation-files.js';
export const COVERAGE_POLICY='opaque-temporary-coverage/v1';
export function validateCoverage(value,groups){
 if(value?.schema!==COVERAGE_POLICY||!Array.isArray(value.groups)||value.groups.length!==groups.length)fail('SEG_COVERAGE_REQUIRED');
 const seen=new Set();
 for(const entry of value.groups){
  const g=groups.find(g=>g.id===entry.groupId);
  if(!g||seen.has(g.id)||!['none','temporary'].includes(entry.status)||!Array.isArray(entry.areas)||entry.areas.some(a=>!['chest','pelvis'].includes(a))||new Set(entry.areas).size!==entry.areas.length)fail('SEG_COVERAGE_REQUIRED');
  if(entry.status==='temporary'&&(g.part!=='body'||!entry.areas.length||typeof entry.description!=='string'||!entry.description.trim()||entry.description.length>1200))fail('SEG_COVERAGE_REQUIRED');
  if(entry.status==='none'&&entry.areas.length)fail('SEG_COVERAGE_REQUIRED');
  seen.add(g.id);
 }
 return value;
}
