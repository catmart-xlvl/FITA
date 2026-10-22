// Semantic aliases only. Source bone names and hierarchy are never renamed.
export const humanoidAliases={};
const add=(role,...names)=>humanoidAliases[role]=names;
for(const part of ['Hips','Spine','Chest','UpperChest','Neck','Head','Jaw'])add(part,'WB_'+part,part,...(part==='Hips'?['Pelvis']:part==='Chest'?['Spine1']:part==='UpperChest'?['Spine2']:[]));
for(const [side,word] of [['L','Left'],['R','Right']]){
  for(const [part,aliases] of Object.entries({Shoulder:['Shoulder'],UpperArm:['UpperArm','Arm'],LowerArm:['LowerArm','ForeArm'],Hand:['Hand'],UpperLeg:['UpperLeg','UpLeg'],LowerLeg:['LowerLeg','Leg'],Foot:['Foot'],Toes:['Toes','ToeBase'],Eye:['Eye']}))add(`${part}_${side}`,`WB_${part}_${side}`,...aliases.flatMap(a=>[word+a,word+'_'+a,a+'_'+side]));
  for(const [digit,alternate] of [['Thumb','Thumb'],['Index','Index'],['Middle','Middle'],['Ring','Ring'],['Little','Pinky']])for(let i=1;i<=3;i++)add(`${digit}_${String(i).padStart(2,'0')}_${side}`,`WB_${digit}_${String(i).padStart(2,'0')}_${side}`,`${word}_${alternate}${['Proximal','Intermediate','Distal'][i-1]}`,`${word}${digit}${['Proximal','Intermediate','Distal'][i-1]}`,`${word}Hand${alternate}${i}`);
}
export const requiredHumanoidRoles=['Hips','Spine','Head',...['L','R'].flatMap(s=>['UpperArm','LowerArm','Hand','UpperLeg','LowerLeg','Foot'].map(p=>p+'_'+s))];
const key=name=>String(name).replace(/^.*:/,'').replace(/^mixamorig\d*/i,'').replace(/[^a-z0-9]/gi,'').toLowerCase();
export function inferHumanoidMap(names){
  const result={};
  for(const [role,aliases] of Object.entries(humanoidAliases)){
    const matches=names.filter(n=>aliases.some(a=>key(a)===key(n)));
    if(matches.length===1)result[role]=matches[0];
  }
  return result;
}
