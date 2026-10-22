// The upload consent and the later paid confirmation are deliberately independent.
export function preparationBlocker({project,group,status,connectionError,busy,active,uploadConsent}) {
  if (busy || active) return 'PREPARE_BUSY';
  if (project.demo) return 'STUDIO_DEMO_BLOCKED';
  if (!(project.viewSetReadyByGroup?.[group]??project.viewSetReady)) return 'PREPARE_REVIEW';
  if (connectionError) return 'PREPARE_STATUS_ERROR';
  if (!status) return 'PREPARE_CHECKING';
  if (!status.paired) return 'PREPARE_PAIR';
  if (!status.connected) return 'PREPARE_HEARTBEAT';
  if (!status.controlAvailable) return 'PREPARE_TAB';
  if (status.adapterVersion !== 2) return 'PREPARE_ADAPTER';
  if (!status.automationAuthorized) return 'PREPARE_PERMISSION';
  if (!status.adapter?.supported && status.adapter?.generationNavigationVersion!==1) return 'PREPARE_WORKSPACE';
  if (!status.preparationAvailable) return 'PREPARE_CAPABILITY';
  if (status.pending) return 'PREPARE_BUSY';
  if (!uploadConsent) return 'PREPARE_CONSENT';
  return null;
}
