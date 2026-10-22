import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';

export const tPoseGuideVersion='fita-t-pose-guide/v2-tested-silhouette';
export const tPoseGuideSha256='5822541d33092ee2fb226a5d375c5cc634820ffee00afd304c9b7bebf8376582';
export const tPoseAngles=Object.freeze({shoulderAbduction:90,shoulderFlexion:0,elbowFlexion:0,elbowInternal:180,wristFlexion:0,wristDeviation:0});
export const tPosePrompt='POSE REFERENCE ONLY: the attached gray silhouette with horizontal joint axis controls joint orientation, never identity, anatomy, body proportions, silhouette, costume, materials, colors or style. The original concept defines those. Both shoulders abducted 90 degrees from arms hanging along torso; shoulder forward/backward flexion 0; elbows 0 degrees flexion (180 degrees straight internal angle); wrists 0 flexion/deviation, hands collinear with forearms, palms down. Shoulder, elbow, wrist and palm centers form ONE straight horizontal line in front/back. Keep full original arm lengths, no shrug, no A-pose or dropped upper arms. Four fingers straight/slightly separated and thumb naturally open. In exact 90-degree side projection, arms extend along camera depth and overlap at shoulder height; do not lower them or stretch them forward in the image. For profiles, use the corrected front character image as the projection reference, not a mirrored copy of the diagram. Do not copy guide labels, markers, lines, background or proportions.';
export const tPoseInstructions=`GUÍA DE POSE T — SOLO POSE
POSE_T_FRENTE.png es la guía con SILUETA GRIS y eje horizontal usada en la prueba real; NO es un concepto del personaje. Adjunta esta guía al generar cuerpo frontal/posterior o referencia completa frontal. Para perfiles y referencia completa izquierda usa el frontal del PERSONAJE ya corregido y revisado para mantener la T en profundidad. No uses esquemas nuevos sin validar como sustitutos de esta guía. No adjuntes la guía para cabeza aislada.
Repite los roles en CADA solicitud: concept.png define identidad, anatomía, proporciones, silueta, ropa y materiales; imágenes extra apoyan el diseño; la guía solo define orientación de articulaciones. Adapta longitudes y posiciones a las proporciones del concepto: no copies la anatomía esquemática del diagrama ni su color, estilo, etiquetas o fondo. No incluyas la guía en el ZIP de diez resultados.
OBJETIVO: hombro 90° de abducción desde brazo caído junto al torso, 0° de flexión hacia delante/atrás; codo 0° de flexión (ángulo interior 180°); muñeca 0° de flexión/desviación, mano alineada, palmas abajo. Dedos rectos ligeramente separados y pulgar abierto naturalmente. Torso y pelvis nivelados, piernas rectas y pies paralelos. Elevar los brazos a la altura de los hombros sin encoger estos ni acortar los brazos.
RECHAZO POR REVISIÓN: frente/espalda deben alinear hombro-codo-muñeca-centro de palma en una horizontal por lado. Un antebrazo horizontal NO compensa un brazo superior caído. Revisa la articulación bajo las mangas, no el contorno del volante. En perfiles a 90° los brazos quedan superpuestos en profundidad, a la altura del hombro; no bajarlos para hacerlos visibles. Si no puedes comprobarlos, deja la pose pendiente, no afirmes que mide 90°. Una imagen generada interpreta los grados; no ejecuta un rig. La revisión visual sigue siendo obligatoria, y el importador técnico actual no detecta por sí mismo una pose incorrecta.
`;

let cached;
export function poseGuideFiles(){
 cached ||= fs.readFile(new URL('../resources/pose-guides/POSE_T_FRENTE.png',import.meta.url)).then(front=>{
  if(createHash('sha256').update(front).digest('hex')!==tPoseGuideSha256)throw Error('Pose guide differs from the tested silhouette');
  return Object.freeze({'POSE_T_FRENTE.png':front,'POSE_T.txt':Buffer.from(tPoseInstructions)});
 }).catch(error=>{cached=undefined;throw error;});
 return cached;
}
export async function withPoseGuideFiles(files){
 const result={...files,...await poseGuideFiles()};
 delete result['POSE_T_PERFIL.png'];
 for(const name of ['PROMPT.txt','INSTRUCCIONES.txt'])if(result[name]&&!result[name].toString('utf8').includes(tPoseInstructions))result[name]=Buffer.concat([result[name],Buffer.from('\n'+tPoseInstructions)]);
 return result;
}
