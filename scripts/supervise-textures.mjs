// Portable Node helper: waits in code, never launches an LLM or clicks paid steps.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
export async function waitForTextureEvent(read,{after='',now=Date.now,stallMs=25*60000}={}){
 let changedAt=now();
 for(;;){
  const state=await read({waitMs:25000,after});
  if(state.cursor!==after){after=state.cursor;changedAt=now();}
  if(['awaiting-review','awaiting-consent','references-required','attention','finish-required','finishing','completed'].includes(state.stage))return state;
  if(now()-changedAt>=stallMs)return {...state,stage:'stalled',error:'SUPERVISOR_NO_PROGRESS'};
 }
}
export async function waitForApproval(read,{now=Date.now,timeoutMs=60000}={}){
 const duration=Math.max(1,Math.min(60000,timeoutMs)),deadline=now()+duration,signal=AbortSignal.timeout(duration);
 let after='';
 while(now()<deadline&&!signal.aborted){
  let state;try{state=await read({after,waitMs:after?Math.min(25000,deadline-now()):0,signal});}catch(e){if(signal.aborted)break;throw e;}
  if(state.stage==='references-required'&&state.consent?.accepted===true&&state.planId===state.consent.planId)return state;
  if(['attention','finish-required','finishing','completed','texturing'].includes(state.stage))return state;
  after=state.cursor;
 }
 return {stage:'approval-wait-ended',approved:false,message:'Dime cuando apruebes la generación de texturas.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))try{
 const c=JSON.parse(await fs.readFile(path.join(root,'SUPERVISION_LOCAL.json'),'utf8')),url=new URL(c.endpoint);
 if(c.schema!=='workbench-texture-supervisor/v1'||url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!==`/api/texture-supervisors/${c.id}`||url.search||url.hash||url.username||url.password||!/^[a-f0-9]{64}$/.test(c.token))throw Error('Configuración inválida');
 const mode=process.argv[2]||'wait',cursorFile=path.join(root,'SUPERVISION_CURSOR.json');
 const call=async(suffix,options={})=>{const r=await fetch(url+suffix,{...options,redirect:'error',headers:{Authorization:'Bearer '+c.token,...options.headers},signal:options.signal||AbortSignal.timeout(240000)});if(!r.ok)throw Error((await r.json()).error||'Supervisor no disponible');return r;};
 const read=async({after='',waitMs=0,signal}={})=>{const state=await(await call('/events?waitMs='+waitMs+'&after='+encodeURIComponent(after),{signal})).json();if(state.projectId!==c.projectId)throw Error('Proyecto incorrecto');return state;};
 if(['references','finish'].includes(mode)){
  const r=await call('/package',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:mode,renew:process.argv.includes('--renew')})});const file=path.join(root,mode==='references'?'fita_texture_references.zip':'fita_texture_finish.zip');await fs.writeFile(file,Buffer.from(await r.arrayBuffer()));console.log(JSON.stringify({downloaded:file,projectId:c.projectId}));
 }else if(mode==='wait-approval'){
  const state=await waitForApproval(read);console.log(JSON.stringify({projectId:c.projectId,...state}));
 }else if(mode==='resume'){
  const state=await read();
  if(state.stage!=='attention'||!state.consent?.accepted||state.planId!==state.consent.planId)throw Error('SUPERVISOR_STAGE_MISMATCH');
  console.log(JSON.stringify(await(await call('/resume',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({planId:state.planId})})).json()));
 }else if(['wait','status'].includes(mode)){
  let after='';try{const previous=JSON.parse(await fs.readFile(cursorFile,'utf8'));if(previous.id===c.id)after=previous.cursor;}catch{}
  const state=mode==='status'?await read():await waitForTextureEvent(read,{after});
  await fs.writeFile(cursorFile,JSON.stringify({id:c.id,cursor:state.cursor}));console.log(JSON.stringify(state));
 }else throw Error('Usa wait, wait-approval, status, references, resume o finish');
}catch(e){console.error(e.message);process.exitCode=1;}
