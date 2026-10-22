import {createHash} from 'node:crypto';
import {segFail as fail} from './segmentation-files.js';

export const MESH_REPAIR_POLICY='reviewed-hole-repair/v1';
export const REPAIR_VIEWS={head:['front','left','right','back','top','interior'],body:['front','left','right','back']};
export const REPAIR_REGIONS={head:['roots','crown','nape','face'],body:['body']};
export const meshRepairInstructions=`LIMPIEZA Y CIERRE DE HUECOS — OBLIGATORIO ANTES DE SEGMENTAR
1. Ejecuta analyze. Tras eliminar duplicados exactos, revisa mesh-inspection.json y source.blend. Inspecciona cabello aislado y con rostro: raíces, coronilla, nuca, interior, perfiles y tres cuartos. Revisa también rostro y cuerpo. Las costuras UV coincidentes no son huecos; un espacio entre mechones puede revelar una calva aunque no exista un borde abierto detectable.
2. Edita mesh-repair.json. Cierra los defectos con triángulos que sigan la curvatura y, cuando falte, reconstruye el interior/scalp bajo los mechones. Usa operations con vértices locales nuevos, caras triangulares, material y UV por esquina; consulta REPARAR_HUECOS.md. Conserva vértices, caras, UV y materiales existentes. No tapes con una placa plana ni unas todos los mechones. Conserva aberturas del diseño: separación de mechones, boca, ojos, cuello y extremos de prendas cuando corresponda. Justifica cada borde conservado; no ejecutes Fill Holes sobre toda la malla.
3. Ejecuta preview_repair para inspeccionar la copia reparada. Guarda capturas reales antes/después en review/ y completa decisiones before/after y visualReview con rutas y SHA-256. Si no hay defectos, operations queda vacío, pero la revisión y sus pruebas siguen siendo obligatorias. Cualquier región dudosa o reparación pendiente bloquea el paso; no marques revisado sin inspeccionar.
4. Ejecuta prepare. Solo entonces clasifica las caras de proposal.json y ejecuta build. Las caras añadidas reciben IDs y viajan hasta la reconstrucción; no reutilices IDs de un análisis anterior a la reparación. No omitas este paso aunque el texturizado pueda disimular el defecto.
`;

// Independent server gate: a fake/stale Blender result cannot omit the review.
export function validateMeshRepairReview(repair,files){
 const text=value=>typeof value==='string'&&value.trim().length>0;
 if(repair?.policy!==MESH_REPAIR_POLICY||!Array.isArray(repair.operations)||!Array.isArray(repair.pending)||repair.pending.length||!/^[a-f0-9]{64}$/.test(repair.sourceFingerprint||'')||!Array.isArray(repair.decisions?.before)||!Array.isArray(repair.decisions?.after))fail('SEG_MESH_REPAIR_REQUIRED');
 const paths=new Set();
 for(const part of ['head','body']){
  const review=repair.visualReview?.[part];
  if(!text(review?.findings))fail('SEG_MESH_REPAIR_REQUIRED');
  for(const region of REPAIR_REGIONS[part]){
   const item=review.regions?.[region];
   if(!['clear','repaired','intentional','not-applicable'].includes(item?.status)||!text(item.reason))fail('SEG_MESH_REPAIR_REQUIRED');
   if(item.status==='repaired'&&(!Array.isArray(item.operationIds)||!item.operationIds.length||item.operationIds.some(id=>!repair.operations.some(op=>op.id===id&&op.part===part&&op.region===region))))fail('SEG_MESH_REPAIR_REQUIRED');
  }
  for(const view of REPAIR_VIEWS[part])for(const phase of ['before','after']){
   const proof=review.views?.[view]?.[phase];
   if(!/^review\/[a-z0-9_-]{1,64}\.png$/.test(proof?.file||'')||! /^[a-f0-9]{64}$/.test(proof?.sha256||'')||paths.has(proof.file))fail('SEG_MESH_REPAIR_EVIDENCE');
   paths.add(proof.file);
   const bytes=files?.[proof.file];
   if(!bytes||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||createHash('sha256').update(bytes).digest('hex')!==proof.sha256)fail('SEG_MESH_REPAIR_EVIDENCE');
  }
 }
 return [...paths];
}
