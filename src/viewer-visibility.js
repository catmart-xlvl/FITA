// Animated limbs and separate face meshes can leave their cached rest sphere.
// For a single reviewed character, avoid per-frame CPU skinning just for culling.
export function keepAnimatedMeshesVisible(root){
  let count=0;
  root.traverse(node=>{
    if(node.isSkinnedMesh || node.isMesh && node.morphTargetInfluences?.length){
      node.frustumCulled=false;
      count++;
    }
  });
  return count;
}
