const busy=new WeakMap();
const fail=code=>{throw Object.assign(Error(code),{status:409});};
export function placementHandoffState(p){
 const h=p.placementHandoff;if(!h)return null;
 return {id:h.id,status:h.status,manualId:h.manualId,importId:h.importId||null,lastError:h.lastError||null};
}
export function assertPlacementEditing(p){if(p.placementCompleted)fail('PLACEMENT_STAGE_COMPLETED');if(p.placementHandoff?.status==='waiting')fail('PLACEMENT_WAITING_FOR_CODEX');}
export function reservePlacement(store,id){
 let set=busy.get(store);if(!set)busy.set(store,set=new Set());if(set.has(id))fail('PLACEMENT_RUNNING');set.add(id);return()=>set.delete(id);
}
