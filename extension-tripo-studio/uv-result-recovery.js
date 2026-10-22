// Recover a stale result VIEW of an already-recorded UV operation. This helper
// has no submit control and cannot start another paid job.
export async function recoverUvResultView({receipt,state,bridge,read,inspect,getTab,reload,persist,pause,now=Date.now}){
 if(receipt.step!=='smartUV'||receipt.clicked!==true||receipt.saveAttempted||receipt.uvSelection||receipt.resultObserved)throw Error('SEG_UV_SAVE_NOT_VERIFIED');
 if(state.blockingDialog)throw Error('CLOSE_OTHER_DIALOGS_FIRST');
 if(state.pending)return state;
 if(state.busy){if(receipt.uvViewRecovery&&!receipt.uvViewRecovery.refreshes){receipt.uvViewRecovery.emptySince=now();await persist();}return state;}
 const recovery=receipt.uvViewRecovery||={emptySince:now(),refreshes:0};
 await persist();
 if(now()-recovery.emptySince<30000)return state;
 if(recovery.refreshes){
  if(now()-recovery.refreshedAt>=30000)throw Error('SEG_UV_RESULT_NOT_FOUND');
  return state;
 }
 const current=await read();
 if(current.taskId!==receipt.taskId||current.workflow!=='smart-uv')throw Error('CONFIRMED_TASK_CHANGED');
 state=await inspect();
 if(state.blockingDialog)throw Error('CLOSE_OTHER_DIALOGS_FIRST');
 if(state.pending)return state;
 if(state.busy){recovery.emptySince=now();await persist();return state;}
 if(current.unsavedChanges!==false)throw Error('SEG_UNSAVED_CHANGES');
 if(!state.generateEnabled)return state;
 if(typeof getTab!=='function'||typeof reload!=='function'||!Number.isInteger(bridge.tabId))throw Error('SEG_UV_VIEW_REFRESH_UNAVAILABLE');
 const tab=await getTab(bridge.tabId),url=new URL(tab.url);
 const route=/^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?workspace\/smart-uv\//;
 if(url.origin!=='https://studio.tripo3d.ai'||!route.test(url.pathname)||!url.pathname.endsWith(receipt.taskId)&&!url.pathname.endsWith(receipt.taskId+'/'))throw Error('CONFIRMED_TASK_CHANGED');
 // Persist BEFORE refresh. Even a lost acknowledgement or worker restart
 // cannot refresh twice or clear the receipt of the paid operation.
 recovery.refreshes=1;recovery.refreshedAt=now();await persist();
 await reload(bridge.tabId);
 for(let i=0;i<60;i++){
  await pause(500);state=await inspect();
  if(state.taskId!==receipt.taskId)throw Error('CONFIRMED_TASK_CHANGED');
  if(state.blockingDialog)throw Error('CLOSE_OTHER_DIALOGS_FIRST');
  if(state.pending||state.busy)return state;
 }
 throw Error('SEG_UV_RESULT_NOT_FOUND');
}
