export function applyFacialPose(root,bindings,values={}){
  const targets=new Map();
  root.traverse(node=>{if(!node.isMesh||!node.morphTargetDictionary)return;let owner=node;while(owner&&!owner.userData?.workbenchSourceName)owner=owner.parent;
    const name=owner?.userData.workbenchSourceName||node.name;if(!targets.has(name))targets.set(name,[]);targets.get(name).push(node);
  });
  const controlled=new Map();
  for(const [expression,list] of Object.entries(bindings?.expressions||{}))for(const entry of list){
    const value=Number.isFinite(values[expression])?Math.min(1,Math.max(0,values[expression])):0;
    for(const mesh of targets.get(entry.mesh)||[]){const index=mesh.morphTargetDictionary[entry.shape];if(index===undefined)continue;if(!controlled.has(mesh))controlled.set(mesh,new Map());const map=controlled.get(mesh);map.set(index,Math.min(1,(map.get(index)||0)+value*entry.weight));}
  }
  for(const [mesh,map] of controlled)for(const [index,value] of map)mesh.morphTargetInfluences[index]=value;
}
