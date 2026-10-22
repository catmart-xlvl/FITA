import { groups, views, event } from "./storage.js";
import { selectedViews } from "./view-set.js";

export function referenceReady(p) {
  return (
    !!p.reference &&
    p.referenceState?.status === "ready" &&
    p.referenceState.referenceId === p.reference.id
  );
}
export function viewIds(p, g) {
  return selectedViews(p,g).map((v) => p.groups[g].views[v]?.id || null);
}
export function completeCurrentViews(p, g) {
  return selectedViews(p,g).length>0 && selectedViews(p,g).every((v) => {
    const a = p.groups[g].views[v];
    return (
      a &&
      a.referenceId === p.reference?.id &&
      (p.demo || a.source !== "demo procedural")
    );
  });
}
export function approvedCurrent(p, g) {
  const a = p.groups[g].approval;
  return (
    referenceReady(p) &&
    completeCurrentViews(p, g) &&
    !!a &&
    a.referenceId === p.reference.id &&
    a.notesRevision === p.notesRevision &&
    JSON.stringify(a.viewIds) === JSON.stringify(viewIds(p, g))
  );
}
export function syncApprovals(p) {
  for (const g of groups) p.groups[g].approved = approvedCurrent(p, g);
  return p;
}
export function invalidateModels(p, reason, onlyGroup) {
  const reports=[p.viewSetValidation,...Object.values(p.viewSetValidations||{})].filter(Boolean);
  for(const report of reports)if(!onlyGroup||!report.group||report.group===onlyGroup){
    p.viewSetValidationHistory ||= [];
    if(!p.viewSetValidationHistory.some(old=>old.id===report.id))p.viewSetValidationHistory.push(structuredClone(report));
  }
  if(!onlyGroup||!p.viewSetValidation?.group||p.viewSetValidation.group===onlyGroup)p.viewSetValidation=null;
  if(onlyGroup&&p.viewSetValidations)delete p.viewSetValidations[onlyGroup];
  else if(!onlyGroup)p.viewSetValidations={};
  for (const m of p.models)
    if (!m.obsolete && (!onlyGroup||!m.group||m.group===onlyGroup||m.group==='imported')) {
      m.obsolete = true;
      m.obsoleteReason = reason;
      m.obsoleteAt = new Date().toISOString();
    }
}
export function revokeApprovals(p, reason, onlyGroup) {
  for (const g of onlyGroup ? [onlyGroup] : groups) {
    if(p.groups[g].approval){p.groups[g].approvalHistory ||= [];p.groups[g].approvalHistory.push(structuredClone(p.groups[g].approval));}
    p.groups[g].approved = false;
    p.groups[g].approval = null;
    p.groups[g].reviewReason = reason;
  }
  invalidateModels(p, reason, onlyGroup);
}
export function modelCurrent(p, m) {
  if (
    m.obsolete ||
    m.source === "demo procedural" ||
    !m.lineage ||
    m.lineage.referenceId !== p.reference?.id ||
    m.lineage.notesRevision !== p.notesRevision ||
    !referenceReady(p)
  )
    return false;
  if (["Tripo API", "Tripo Studio"].includes(m.source))
    return (groups.includes(m.group)?[m.group]:groups).every(
      (g) =>
        approvedCurrent(p, g) &&
        JSON.stringify(m.lineage.views[g]) === JSON.stringify(viewIds(p, g)),
    );
  return m.source === "importado";
}
export function snapshot(p) {
  return {
    referenceId: p.reference?.id || null,
    referenceRevision: p.referenceRevision,
    notesRevision: p.notesRevision,
    views: Object.fromEntries(groups.map((g) => [g, viewIds(p, g)])),
    approvalIds: Object.fromEntries(
      groups.map((g) => [g, p.groups[g].approval?.id || null]),
    ),
  };
}
export function present(p) {
  syncApprovals(p);
  return {
    ...p,
    models: p.models.map((m) => ({ ...m, current: modelCurrent(p, m) })),
  };
}

// Existing files are kept verbatim. Legacy approval booleans are archived, never
// upgraded into a new explicit confirmation or trusted source lineage.
export function migrate(p) {
  if (p.schemaVersion === 2) return;
  p.legacyState = {
    migratedAt: new Date().toISOString(),
    approvals: Object.fromEntries(groups.map((g) => [g, p.groups[g].approved])),
  };
  p.schemaVersion = 2;
  p.referenceRevision = p.reference ? 1 : 0;
  p.notesRevision = 0;
  p.referenceState = {
    status: p.reference ? "pending" : "empty",
    referenceId: p.reference?.id || null,
  };
  for (const g of groups) {
    for (const a of Object.values(p.groups[g].views))
      a.referenceId = p.reference?.id || null;
    p.groups[g].approval = null;
    p.groups[g].approved = false;
  }
  invalidateModels(
    p,
    "Resultado anterior: la versión previa no guardaba la relación con la referencia.",
  );
  event(
    p,
    "Actualización del taller: archivos conservados. Confirma la referencia; las aprobaciones antiguas no se aplican a esta revisión.",
  );
}
