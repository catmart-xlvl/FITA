import {localPreviewModels} from './candidate-navigation.js';
export function chosenModel(project,group) {
  return project.models.find(model=>model.id===project.groups[group].selectedModelId&&model.group===group&&model.current);
}
export function bodyReady(project) {
  return !!project.viewSetReadyByGroup?.body&&project.groups.body.approved===true;
}
export function afterViewApproval(project) {
  if(!['head','body'].every(group=>project.groups[group].approved===true&&project.viewSetReadyByGroup?.[group]))return null;
  return {stage:2,studioGroup:chosenModel(project,'head')?'body':'head',showSetReview:false};
}
export function afterHeadChoice(project) {
  return {stage:bodyReady(project)?2:1,viewGroup:'body',studioGroup:'body',showSetReview:false};
}
export function bodyPreparationMessage(project) {
  const body=project.groups.body,views=body.selectedViews||[];
  if(!views.length||views.some(view=>!body.views[view]))return 'Load and select the body views to continue.';
  if(!body.approved)return 'Review and approve the body views to continue.';
  if(!bodyReady(project))return 'Click Next to validate the body views and confirm their visual review.';
  return 'The body views are ready. Upload them to Studio, then review the cost before generating.';
}
export function restoreNavigation(project,storage) {
  const head=chosenModel(project,'head'),body=chosenModel(project,'body'),fallback=head?(body?{stage:3,viewGroup:'body',studioGroup:'body',showSetReview:false}:afterHeadChoice(project)):{stage:localPreviewModels(project).length?2:0,viewGroup:'head',studioGroup:'head',showSetReview:false};
  try{
    const saved=JSON.parse(storage.getItem('projectNavigation:'+project.id)||'null');
    if(saved&&saved.headModelId===(head?.id||null)&&[0,1,2,3,4,5,6].includes(saved.stage)&&(saved.stage<3||body)&&['head','body'].includes(saved.viewGroup)&&['head','body'].includes(saved.studioGroup))
      return {...saved,showSetReview:saved.showSetReview===true&&project.validationCurrent&&project.viewSetValidation?.group===saved.viewGroup};
  }catch{}
  return fallback;
}
export function persistNavigation(project,navigation,storage) {
  try{storage.setItem('projectNavigation:'+project.id,JSON.stringify({...navigation,headModelId:chosenModel(project,'head')?.id||null}));}catch{}
}
