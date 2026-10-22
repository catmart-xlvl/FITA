// Bind only four new links observed after this extension's own paid submission.
export function captureBatch(before,after,previous=[]){
  const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
  const old=new Set([...(before.existingTaskIds||[]),before.currentTaskId].filter(Boolean));
  const ids=[...new Set([...(after.existingTaskIds||[]),after.currentTaskId].filter(id=>uuid.test(id||'')&&!old.has(id)))];
  if(ids.length!==4||!ids.includes(after.currentTaskId))return {ids,verified:false};
  return {ids,verified:previous.length===4&&ids.every(id=>previous.includes(id))};
}
export function textureTiming(snapshot,taskId){
  const text=(snapshot.taskCards||[]).filter(c=>c.taskId===taskId).flatMap(c=>[c.text,c.title]).filter(Boolean).join(' ');
  const processing=/generando textura|generating texture|texturizing|texturing|procesando textura/i.test(text);
  const match=text.match(/(?:~|≈|about|aprox\.?|estimated|estimado|restante[s]?)?\s*(\d{1,4})\s*(seconds?|secs?|segundos?|s|min(?:utes?|utos?)?)\b/i);
  const seconds=processing&&match?Number(match[1])*(/^min/i.test(match[2])?60:1):null;
  return {processing,estimatedSeconds:seconds>0&&seconds<=7200?seconds:null};
}
