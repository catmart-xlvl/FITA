import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {studioUvCandidatesControl,optimizeUvCandidates} from '../extension-tripo-studio/uv-candidates.js';
import {throwAdapterError,asWorker} from './page-call.js';

class Node {
 constructor(tag,text='',attrs={},children=[]){this.tagName=tag.toUpperCase();this.ownText=text;this.attrs=attrs;this.children=children;this.disabled=false;this.clicks=0;for(const c of children)c.parentElement=this;}
 get innerText(){return [this.ownText,...this.children.map(c=>c.innerText)].filter(Boolean).join(' ');}
 get textContent(){return this.innerText;}
 get currentSrc(){return this.attrs.src||'';}
 getAttribute(k){return this.attrs[k]??null;}
 getBoundingClientRect(){return {width:this.tagName==='IMG'?48:this.attrs.width||100,height:48};}
 contains(n){return this===n||this.children.some(c=>c.contains(n));}
 matches(query){return query.split(',').some(q=>{q=q.trim();if(q.startsWith('[')){const m=q.match(/^\[([^=\]]+)(?:="([^"]+)")?\]$/);return !!m&&this.attrs[m[1]]!=null&&(m[2]===undefined||this.attrs[m[1]]===m[2]);}return q.toUpperCase()===this.tagName;});}
 descendants(){return this.children.flatMap(c=>[c,...c.descendants()]);}
 querySelectorAll(q){return this.descendants().filter(c=>c.matches(q));}
 click(){this.clicks++;this.onClick?.();}
}
function scene({label='UV Space Utilization Rate: 67.1%',hidden=false,count=1,active=true,nativeTrack=false,conflicting=false,heading='Smart UV',split=false,extraLabel=null,retryLabel='Free Retry (×3)'}={}){
 const id='11111111-2222-3333-4444-555555555555';
 const save=new Node('button','Save',{'data-trace':'studio.workspace_smart-uv.asset_save_button'});
 const retry=new Node('button',retryLabel,{'data-trace':'studio.workspace_smart-uv.free_retry_button'});
 const title=split?new Node('div','',{},[new Node('span','Utilization'),new Node('span','72.6%')]):new Node('div',label);
 const tiles=Array.from({length:count},(_,i)=>new Node('div','',{class:'cursor-pointer '+(active&&i===0?'border-purple-1':''),width:60},[new Node('img','',{src:'https://assets.example/uv-'+i+'.png'})]));
 if(nativeTrack)for(const [i,tile]of tiles.entries()){tile.tagName='BUTTON';tile.attrs.class='workspace-thumbnail-item'+(active&&(i===0||conflicting&&i===1)?' workspace-thumbnail-active':'');}
 const panel=new Node('div','',{width:500},[title,...tiles]);panel.hidden=hidden;
 const property=new Node('button','Property',{role:'tab','aria-selected':String(!hidden),'data-state':hidden?'inactive':'active'});
 property.onClick=()=>{panel.hidden=false;property.attrs['aria-selected']='true';property.attrs['data-state']='active';};
 const workspace=new Node('div','',{width:1200},[new Node('div',heading),property,panel,save,retry,...(extraLabel?[new Node('div',extraLabel)]:[])]);
 const body=new Node('body','',{width:1400},[workspace]);
 const context={URL,location:{origin:'https://studio.tripo3d.ai',href:'https://studio.tripo3d.ai/workspace/smart-uv/'+id,pathname:'/workspace/smart-uv/'+id},document:{body,querySelectorAll:q=>body.querySelectorAll(q)},getComputedStyle:e=>{let hidden=false;for(let n=e;n;n=n.parentElement)hidden ||= n.hidden===true;return {display:hidden?'none':'block',visibility:'visible'};}};
 return {id,save,retry,property,title,tiles,panel,run:arg=>throwAdapterError(vm.runInNewContext('('+studioUvCandidatesControl+')('+JSON.stringify({taskId:id,...arg})+')',context))};
}
test('English rate labels with inline percentages, Spanish comma decimals and Japanese labels are measured',()=>{
 for(const [label,value] of [['UV Space Utilization Rate: 67.1%',67.1],['UV occupancy ratio 72.5%',72.5],['Ocupación del espacio UV: 68,4%',68.4],['UV使用率 71.2%',71.2]]){
  const s=scene({label});const state=s.run({diagnostic:true});
  assert.equal(state.occupancy,value,label);assert.equal(state.candidates.length,1);assert.ok(state.selectedKey);assert.equal(s.save.clicks+s.retry.clicks,0);
 }
});
test('observed bare Utilization label works inline or split, scoped to the named Smart UV result',()=>{
 for(const options of [{label:'Utilization 72.6%'},{label:'Utilisation: 72,6%'},{split:true}]){
  const s=scene(options),state=s.run({diagnostic:true});
  assert.equal(state.occupancy,72.6);assert.equal(state.candidates.length,1);assert.ok(state.selectedKey);assert.equal(state.remaining,3);
  assert.equal(s.save.clicks+s.retry.clicks,0);
 }
});
test('bare utilization without a Smart UV result heading or with conflicting metrics is not guessed',()=>{
 assert.equal(scene({label:'Utilization 72.6%',heading:'Texture'}).run({}).occupancy,null);
 assert.equal(scene({label:'Utilization 72.6%',extraLabel:'Utilization 80%'}).run({}).occupancy,null);
});
test('a hidden Properties panel can be revealed with a free tab action before any retry',()=>{
 const s=scene({hidden:true});let state=s.run({});
 assert.equal(state.occupancy,null);assert.equal(state.properties.available,true);assert.equal(state.properties.active,false);
 assert.equal(s.run({action:'show-properties'}).opened,true);assert.equal(s.property.clicks,1);
 state=s.run({});assert.equal(state.occupancy,67.1);assert.equal(state.candidates.length,1);assert.equal(s.save.clicks+s.retry.clicks,0);
});
test('a single unmarked thumbnail is unambiguous but several unmarked candidates are never guessed',()=>{
 assert.ok(scene({active:false}).run({}).selectedKey);
 assert.equal(scene({active:false,count:2}).run({}).selectedKey,null);
});

test('native workspace UV thumbnails expose their selected result without a Properties tab or legacy border classes',()=>{
 for(const count of [2,3,4]){
  const s=scene({nativeTrack:true,count}),state=s.run({});
  assert.equal(state.candidates.length,count);assert.equal(state.candidates[0].selected,true);
  assert.equal(state.selectedKey,state.candidates[0].key);assert.equal(state.occupancy,67.1);
  assert.equal(s.property.clicks+s.retry.clicks+s.save.clicks,0);
  assert.equal(s.run({action:'select',key:state.candidates[1].key}).clicked,true);
 }
 assert.equal(scene({nativeTrack:true,count:4,active:false}).run({}).selectedKey,null);
 assert.equal(scene({nativeTrack:true,count:4,conflicting:true}).run({}).selectedKey,null);
});

test('native UV track completes three exact free retries, measures all results and retains the first best on ties',async()=>{
 const values=[74,76.5,76.5,70],s=scene({nativeTrack:true,count:1,label:'Utilization 74%'});let time=0,persisted;
 s.property.attrs['aria-selected']='false';s.property.attrs['data-state']='inactive';
 const activate=tile=>{for(const t of s.tiles)t.attrs.class='workspace-thumbnail-item'+(t===tile?' workspace-thumbnail-active':'');s.title.ownText='Utilization '+values[s.tiles.indexOf(tile)]+'%';};
 s.tiles[0].onClick=()=>activate(s.tiles[0]);
 s.retry.onClick=()=>{const i=s.tiles.length;assert(i<=3);assert.equal(persisted.uvSelection.pendingRetry.remaining,4-i);const tile=new Node('button','',{class:'workspace-thumbnail-item',width:60},[new Node('img','',{src:'https://assets.example/uv-'+i+'.png'})]);tile.parentElement=s.panel;tile.onClick=()=>activate(tile);s.tiles.push(tile);s.panel.children.push(tile);activate(tile);s.retry.ownText=i===3?'Retry 10':'Free Retry (×'+(3-i)+')';};
 const receipt={taskId:s.id};
 assert.equal(await optimizeUvCandidates({receipt,inspect:async()=>s.run({}),act:async input=>s.run(input),persist:async()=>{persisted=structuredClone(receipt);},now:()=>time,pause:async ms=>{time+=ms;}}),true);
 assert.equal(s.retry.clicks,3);assert.equal(s.property.clicks,0);assert.equal(s.save.clicks,0);
 assert.equal(receipt.uvSelection.samples.length,4);assert.equal(receipt.uvSelection.retries,3);
 assert.equal(receipt.uvSelection.selected.occupancy,76.5);
 assert.equal(receipt.uvSelection.selected.key,s.run({}).candidates[1].key);
 assert.equal(s.run({}).selectedKey,s.run({}).candidates[1].key);
});
test('unrelated percentages are not used as UV occupancy',()=>{
 for(const label of ['Battery 80%','Texture opacity 75%','UV Space Utilization Rate: 67% and 80%']){
  const s=scene({label});assert.equal(s.run({}).occupancy,null);assert.equal(s.retry.clicks,0);
 }
});

test('native free retry counters work independently of label language and four results never trigger a translated paid retry',()=>{
 for(const retryLabel of ['無料再試行 (×3)','Erneut kostenlos (×3)','Réessayer gratuitement (×3)']){
  const s=scene({retryLabel});assert.equal(s.run({}).remaining,3);assert.equal(s.run({action:'retry',expectedRemaining:3}).clicked,true);assert.equal(s.retry.clicks,1);
 }
 const exhausted=scene({count:4,retryLabel:'再試行 10'});assert.equal(exhausted.run({}).remaining,0);assert.equal(exhausted.run({}).retryEnabled,false);
 assert.throws(()=>exhausted.run({action:'retry',expectedRemaining:0}),/SEG_UV_FREE_RETRY_UNVERIFIED/);assert.equal(exhausted.retry.clicks,0);
});
