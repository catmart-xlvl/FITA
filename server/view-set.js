import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { referenceReady } from './lineage.js';

const groups = ['head', 'body'];
const views = ['front', 'right', 'back'];
export const ALL_VIEWS = ['front','right','back','left'];
export function selectedViews(p,g) {
 const explicit=p.groups?.[g]?.selectedViews;
 return Array.isArray(explicit)?ALL_VIEWS.filter(v=>explicit.includes(v)):views.filter(v=>p.groups?.[g]?.views?.[v]);
}
const PART_CRITERIA={version:2,minSide:256,minPixels:262144};
export const VIEW_SET_CRITERIA = Object.freeze({
  version: 1,
  minSide: 256,
  minPixels: 262144,
});
const maxBytes = 20 * 1024 * 1024;
const maxPixels = 40000000;

/** Stable identity of the exact reference, notes revision and six view assets.
 * Stored assets are immutable (a replacement receives a new asset ID). Approval
 * IDs are deliberately excluded: technical validation never grants approval.
 */
function legacyFingerprint(project) {
  const snapshot = {
    criteria: VIEW_SET_CRITERIA,
    referenceId: project.reference?.id ?? null,
    referenceRevision: project.referenceRevision ?? 0,
    referenceState: {
      status: project.referenceState?.status ?? 'empty',
      referenceId: project.referenceState?.referenceId ?? null,
    },
    notesRevision: project.notesRevision ?? 0,
    demo: project.demo === true,
    items: groups.flatMap(group => views.map(view => {
      const asset = project.groups?.[group]?.views?.[view];
      return {
        group, view,
        assetId: asset?.id ?? null,
        referenceId: asset?.referenceId ?? null,
        notesRevision: asset?.notesRevision ?? null,
        source: asset?.source ?? null,
      };
    })),
  };
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

export function fingerprintViewSet(project,group) {
 if(!group && groups.every(g=>JSON.stringify(selectedViews(project,g))===JSON.stringify(views.filter(v=>project.groups?.[g]?.views?.[v]))))return legacyFingerprint(project);
 const scope=group?[group]:groups;
 const value={criteria:PART_CRITERIA,referenceId:project.reference?.id??null,referenceRevision:project.referenceRevision??0,referenceState:{status:project.referenceState?.status??'empty',referenceId:project.referenceState?.referenceId??null},notesRevision:project.notesRevision??0,demo:project.demo===true,
  groups:scope.map(g=>({group:g,selection:selectedViews(project,g),items:selectedViews(project,g).map(view=>{const a=project.groups[g].views[view];return {view,id:a?.id??null,referenceId:a?.referenceId??null,notesRevision:a?.notesRevision??null,source:a?.source??null};})}))};
 return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function validationReport(p,g) { return p.viewSetValidations?.[g] || (p.viewSetValidation?.group===g||!p.viewSetValidation?.group?p.viewSetValidation:null); }
export function validationCurrent(p,report=p.viewSetValidation) {
 if(!report)return false;
 return report.fingerprint===(report.criteria?.version===1?legacyFingerprint(p):fingerprintViewSet(p,report.group));
}
/** Decode the six saved files. readAsset(asset) must return their bytes.
 * Minimum dimensions are 256 px on both axes and 262144 pixels in total.
 * These are technical baseline checks only: neither image quality, the visible
 * angle, anatomy, completeness nor character consistency is assessed by AI.
 * The caller must reject/report a fingerprint change before persisting results
 * if the project was edited while this asynchronous inspection was running.
 */
export async function validateViewSet(project, readAsset, part) {
  if(part&&!groups.includes(part))throw new Error("Invalid view group.");
  const snapshot = structuredClone(project);
  const report = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    fingerprint: part?fingerprintViewSet(snapshot,part):fingerprintViewSet(snapshot),
    ...(part?{group:part,selectedViews:selectedViews(snapshot,part)}:{}),
    criteria: { ...(part?PART_CRITERIA:VIEW_SET_CRITERIA) },
    technicalValid: false,
    reasonCode: !referenceReady(snapshot)?'reference_unconfirmed':part&&!selectedViews(snapshot,part).length?'no_selection':null,
    items: [],
    humanReview: null,
  };
  const decodedHashes = new Map();
  for (const group of part?[part]:groups) {
    for (const view of part?selectedViews(snapshot,group):views) {
      const asset = snapshot.groups?.[group]?.views?.[view];
      const item = {
        group, view,
        assetId: asset?.id ?? null,
        status: 'invalid',
        width: null,
        height: null,
        reasonCode: null,
        duplicateOf: null,
      };
      report.items.push(item);
      if (!asset?.id) { item.reasonCode = 'missing_view'; continue; }
      // Notes may change while retaining useful files. The new report and human
      // review must acknowledge those notes, but files need not be regenerated.
      if (!snapshot.reference?.id || asset.referenceId !== snapshot.reference.id) {
        item.reasonCode = 'stale_reference';
      } else if (!snapshot.demo && asset.source === 'demo procedural') {
        item.reasonCode = 'demo_asset';
      }
      let buffer;
      try {
        const bytes = await readAsset(asset);
        if (!(bytes instanceof Uint8Array)) throw new TypeError('Asset bytes required');
        buffer = Buffer.from(bytes);
      } catch {
        item.reasonCode = 'unreadable_file';
        continue;
      }
      if (buffer.length > maxBytes) { item.reasonCode = 'file_too_large'; continue; }
      try {
        const metadata = await sharp(buffer, {limitInputPixels:maxPixels}).metadata();
        if (!['png','jpeg','webp'].includes(metadata.format) || (metadata.pages || 1) > 1) {
          item.reasonCode = 'invalid_format';
          continue;
        }
        // Hash decoded pixels after orientation, color-space and channel
        // normalization, so lossless re-encoding cannot hide exact duplicates.
        const {data, info} = await sharp(buffer, {limitInputPixels:maxPixels})
          .rotate().toColourspace('srgb').ensureAlpha().raw()
          .toBuffer({resolveWithObject:true});
        item.width = info.width;
        item.height = info.height;
        if (info.width < VIEW_SET_CRITERIA.minSide ||
            info.height < VIEW_SET_CRITERIA.minSide ||
            info.width * info.height < VIEW_SET_CRITERIA.minPixels) {
          item.reasonCode ||= 'low_resolution';
        }
        const hash = createHash('sha256')
          .update(`${info.width}:${info.height}:${info.channels}:`)
          .update(data).digest('hex');
        const duplicates = decodedHashes.get(hash) || [];
        duplicates.push(item);
        decodedHashes.set(hash, duplicates);
        item.status = item.reasonCode ? 'invalid' : 'valid';
      } catch {
        item.reasonCode = 'decode_failed';
      }
    }
  }
  for (const duplicates of decodedHashes.values()) {
    if (duplicates.length < 2) continue;
    for (const item of duplicates) {
      const other = duplicates.find(candidate => candidate !== item);
      item.duplicateOf = {group:other.group, view:other.view, assetId:other.assetId};
      item.reasonCode ||= 'duplicate_view';
      item.status = 'invalid';
    }
  }
  report.technicalValid = !report.reasonCode && report.items.every(item => item.status === 'valid');
  return report;
}

/** A technical pass cannot authorize 3D. A separate, explicit human review must
 * identify this exact report and fingerprint. Legacy approval booleans are not
 * accepted, and a reference/view/notes change invalidates the report immediately.
 */
export function viewSetReady(project,part) {
 if(!part)return groups.some(g=>viewSetReady(project,g));
 if(!groups.includes(part))return false;
 const report=validationReport(project,part),selection=selectedViews(project,part);
 if(!referenceReady(project)||!selection.length||!report?.id||!report.technicalValid||report.reasonCode||!validationCurrent(project,report))return false;
 const legacy=report.criteria?.version===1;
 const criteria=legacy?VIEW_SET_CRITERIA:PART_CRITERIA;
 if(!Object.entries(criteria).every(([key,value])=>report.criteria?.[key]===value))return false;
 if(legacy){
  if(JSON.stringify(selection)!==JSON.stringify(views)||report.items?.length!==6)return false;
 }else if(report.group!==part||JSON.stringify(report.selectedViews)!==JSON.stringify(selection)||report.items?.length!==selection.length)return false;
 for(const view of selection){
  const matching=report.items.filter(item=>item.group===part&&item.view===view),asset=project.groups?.[part]?.views?.[view];
  if(matching.length!==1||!asset?.id||asset.referenceId!==project.reference.id||matching[0].assetId!==asset.id||matching[0].status!=='valid'||matching[0].reasonCode||matching[0].duplicateOf)return false;
 }
 return report.humanReview?.approved===true&&report.humanReview.reportId===report.id&&report.humanReview.fingerprint===report.fingerprint;
}
