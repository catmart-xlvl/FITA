export const generationFaceLimits=Object.freeze({
  head:Object.freeze([17000,20000,23000,25000]),
  body:Object.freeze([18000,20000,22500,25000]),
});
export function generationLimits(group){
  if(!generationFaceLimits[group])throw Error('STUDIO_INVALID_GROUP');
  return [...generationFaceLimits[group]];
}
export function matchingGenerationLimits(group,observed){
  return Array.isArray(observed)&&JSON.stringify(observed)===JSON.stringify(generationLimits(group));
}
