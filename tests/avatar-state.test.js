import test from 'node:test';
import assert from 'node:assert/strict';
import {loadAvatarState,rigCharacterPreview,avatarLoadMessages} from '../src/avatar-state.js';
import {createLocalRequest} from '../src/local-request.js';
import {catalog} from '../src/locales.js';

const rig={source:{preview:{url:'/placed.glb'}},runs:[{id:'body',version:'v2',current:true,preview:{url:'/original-rig.glb'}}],donor:{asset:{url:'/donor.glb'}}};
test('both delivery tabs show the current original when an older server lacks the new routes',async()=>{
  for(const route of ['rigging/face','export/vrchat']){
    const calls=[],api=createLocalRequest(async url=>{calls.push(url);if(url.endsWith('/rigging/refinement'))return Response.json(rig);if(url.endsWith('/rigging/manual'))return Response.json({edits:[]});return Response.json({error:'Ruta no encontrada.'},{status:404});});
    const result=await loadAvatarState(api.request,'/projects/p/'+route,'p');
    assert.equal(result.preview,'/original-rig.glb');assert.equal(result.data,null);assert.equal(result.error,'AVATAR_SERVER_UPDATE_REQUIRED');assert.equal(calls.length,3);
  }
});
test('latest matching original manual weights win; stale edits and donor models never become the preview',()=>{
  const edit=(url,version='v2',kind='result')=>({current:true,rootSource:{kind,id:'body',version},asset:{url}});
  assert.equal(rigCharacterPreview(rig,{edits:[edit('/manual.glb'),edit('/stale.glb','v1'),edit('/donor.glb','v2','donor')]}),'/manual.glb');
  assert.equal(rigCharacterPreview({...rig,runs:[]},{edits:[edit('/stale.glb')]}),'/placed.glb');
  assert.equal(rigCharacterPreview({donor:rig.donor},{}),null);
});
test('current server preview is visible before preparing either handoff; face result takes precedence',async()=>{
  for(const data of [{eligible:false,bodyPreview:{url:'/body.glb'}},{run:{preview:'/face.glb'},bodyPreview:{url:'/body.glb'}},{face:{preview:'/face.glb'},bodyPreview:{url:'/body.glb'}}]){
    let calls=0;const result=await loadAvatarState(async()=>{calls++;return data;},'/state','p');
    assert.equal(result.preview,data.face?.preview||data.run?.preview||'/body.glb');assert.equal(result.error,'');assert.equal(calls,1);assert.equal(result.data,data);
  }
});
test('failed manual query does not hide the rig and a stalled state request terminates with a retryable error',async()=>{
  let signal;const result=await loadAvatarState((url,options)=>{if(url.endsWith('/refinement'))return Promise.resolve(rig);if(url.endsWith('/manual'))return Promise.reject(Error('offline'));signal=options.signal;return new Promise(()=>{});},'/state','p',{timeoutMs:10});
  assert.equal(signal.aborted,true);assert.equal(result.preview,'/original-rig.glb');assert.equal(result.error,'AVATAR_LOAD_TIMEOUT');
});
test('all delivery load errors have readable English and translated messages',()=>{
  for(const message of Object.values(avatarLoadMessages)){assert(!message.startsWith('AVATAR_'));const row=catalog.find(r=>r[0]===message);assert(row?.[1]&&row?.[2]);}
});
