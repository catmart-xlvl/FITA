// glTF coordinates: Y up, metres. All transforms are absolute, never accumulated.
export const identityPart=()=>({position:[0,0,0],rotation:[0,0,0],scale:1});
export function placementEstimate(head,body,settings={}){
 const center=b=>b.min.map((v,i)=>(v+b.max[i])/2);
 const region=head.anatomy||head.face,core=body.anatomy;
 const ratio=settings.ratio??.16;
 if(!region||!core)return {transforms:null,report:{confidence:'low',reason:'regions-required',ratio,provenance:'explicit-anime-preset'}};
 const bh=core.max[1]-core.min[1],hh=region.max[1]-region.min[1];
 if(!(bh>1e-8&&hh>1e-8&&ratio>=.08&&ratio<=.5))throw Error('PLACEMENT_INVALID_HEIGHT');
 const scale=ratio*bh/hh,h=head.anchor||[center(region)[0],region.min[1],center(region)[2]],b=body.anchor||[center(core)[0],core.max[1],center(core)[2]];
 const origin=[center(core)[0],body.ground??core.min[1],center(core)[2]];
 const confidence=head.confidence==='medium'&&body.confidence==='medium'?'medium':'low';
 const transforms={body:{...identityPart(),rotation:body.rotation||[0,0,0],position:origin.map(n=>-n)},head:{...identityPart(),rotation:head.rotation||[0,0,0],scale,position:b.map((n,i)=>n-origin[i]-h[i]*scale)}};
 if(!validManualPlacement(transforms))throw Error('PLACEMENT_INVALID_SETTINGS');
 return {transforms,report:{version:2,confidence,reason:confidence==='low'?'estimated-regions':'estimated-proportions',ratio,provenance:settings.provenance||'explicit-anime-preset',bodyHeight:bh,cranialHeight:hh,cranialWidth:region.max[0]-region.min[0],scale,headAnchor:h,bodyAnchor:b,bodyGround:origin[1],headRegion:region,bodyRegion:core,headMethod:head.method,bodyMethod:body.method,seedTransforms:structuredClone(transforms),coordinateSystem:'glTF scene transforms, user-selectable up/front axes; relative source units',reviewRequired:true}};
}
// Refresh only an untouched automatic draft made by the old measurement. Never
// move an approval, a manual draft, or a user's adjustment to that old seed.
export function outdatedAutomaticPlacement(draft,manual){
 if(!draft||manual||draft.initialPlacement?.editedByUser)return false;
 const report=draft.initialPlacement?.report;if(report?.version!==1||!report.headRegion||!report.bodyRegion||!validManualPlacement(draft.transforms))return false;
 try{const expected=placementEstimate({anatomy:report.headRegion,anchor:report.headAnchor,rotation:draft.transforms.head.rotation},{anatomy:report.bodyRegion,anchor:report.bodyAnchor,rotation:draft.transforms.body.rotation},{ratio:report.ratio}).transforms;
 return ['head','body'].every(g=>Math.abs(expected[g].scale-draft.transforms[g].scale)<1e-10&&['position','rotation'].every(k=>expected[g][k].every((v,i)=>Math.abs(v-draft.transforms[g][k][i])<1e-10)));
 }catch{return false;}
}
export const automaticPlacement=(head,body,settings)=>placementEstimate(head,body,settings).transforms;
export function validManualPlacement(value){
 const finite=(v,lo,hi)=>typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi;
 return !!value&&['head','body'].every(g=>{
  const p=value[g];return p&&finite(p.scale,.00001,10000)&&['position','rotation'].every(k=>Array.isArray(p[k])&&p[k].length===3&&p[k].every(v=>finite(v,k==='rotation'?-Math.PI*2:-10000,k==='rotation'?Math.PI*2:10000)));
 });
}
