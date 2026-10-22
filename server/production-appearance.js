// FITA production guidance, separate from the general visual-specification skill.
export const productionAppearanceVersion=2;
export function withProductionAppearance(files,kind){
 const rule=kind==='views'?modelViewAppearance:kind==='segment-references'?textureReferenceAppearance:null;
 if(!rule)return files;
 let updated=files;
 for(const [name,bytes] of Object.entries(files)){
  if(!['INSTRUCCIONES.txt','PROMPT.txt'].includes(name)&&!(kind==='segment-references'&&/^prompts\/[\w-]+\.txt$/.test(name)))continue;
  let text=bytes.toString('utf8');if(text.includes(rule))continue;
  // Remove the previous conflicting fine-detail paragraph in old view packages.
  if(kind==='views')text=text.replace(/ACABADO DE ILUSTRACIÓN VTUBER:[\s\S]*?(?=\n\nTRANSPARENCIA:)/,'');
  if(updated===files)updated={...files};
  updated[name]=Buffer.from(text+'\n\n'+rule+'\n');
 }
 return updated;
}
export const modelViewAppearance=`SIMPLIFICACIÓN PARA LAS OCHO VISTAS DE MODELADO
Aplica este tratamiento a body_front/left/right/back y head_front/left/right/back. Conserva silueta, proporciones, volumen, identidad, rasgos, accesorios, asimetrías, piezas y patrones que identifican el diseño. No reduzcas la cantidad de piezas ni cambies sus uniones. Las dos reference_*.png siguen siendo guías completas de colocación: conserva el mismo diseño y proporciones; no les impongas una nueva simplificación ni las regeneres si ya son válidas.
Elimina solo microdetalles dibujados que no cambian forma ni silueta: pelos individuales pintados dentro de un mechón, rayitas internas repetitivas, poros, ruido, trama minúscula y pequeñas variaciones de color. Un mechón completo se representa como una masa limpia con su forma, punta y separación originales, sin subdividirlo en muchos cabellos pintados. Mantén los huecos intencionales entre mechones, flequillo, longitud y volumen. Conserva ojos, labios, cejas, bordes de prendas, costuras estructurales, logos y motivos reconocibles; no borres información del concepto.
Usa masas de color limpias y sombras amplias que describan el volumen, con reflejos pintados contenidos. No añadas textura fotográfica, rayado fino ni detalle nuevo. No conviertas la imagen a un modelo gris ni a una figura sin rasgos. Repite esta regla en cada solicitud junto con el concepto y la especificación del personaje. Revisa las ocho vistas ampliadas y como miniatura: menos ruido interior, mismo diseño y misma silueta. Corrige solo la vista que falle.`;

export const textureReferenceAppearance=`COLOR Y PINTURA PARA TODAS LAS REFERENCIAS DE TEXTURA
Aplica a TODOS los grupos y a sus tres ángulos, también rostro, cabello, piel, ropa, calzado y accesorios. Conserva la paleta por material y la información reconocible del concepto: motivos, bandas, costuras útiles, rasgos y diferencias de material. Separa color base, sombra pintada y highlight pintado. La profundidad debe leerse en Base Color: frente, cantos, retornos e interiores reciben valores distintos de la misma paleta cuando la orientación u oclusión lo justifica. No aplicar el mismo tono a todas las caras ni variar el color según la cámara. Usa colores base más planos y uniformes, sombras amplias bien dibujadas y luces pintadas selectivas del mismo lenguaje anime; no elimines todo el volumen ni produzcas colores completamente planos sin sombreado.
Reduce únicamente microvariación cromática, manchas sucias, ruido, poros, trama diminuta y rayitas de pelo pintadas. Un mechón sigue siendo un mechón completo. Las sombras y highlights siguen la forma y mantienen una familia de tonos coherente entre vistas; no copies una sombra de una pieza a otra ni pintes una falsa línea de corte sobre un cinturón que pasa por encima. Bordes de sombra definidos y controlados cuando el diseño los requiere, sin borrones vagos ni contornos de triángulos. Una reparación local se funde suavemente con la pintura vecina, aunque el diseño de la sombra sea definido. No apliques desenfoque, posterización ni contraste global como sustituto de pintar.
Respeta removeLighting: si false, conserva estas sombras y highlights pintados; si true, prepara el mismo color limpio y conserva motivos propios del material, eliminando sombras y reflejos direccionales de iluminación. Nunca cambies ese ajuste ni un presupuesto aprobado desde este paso. Compara todos los grupos bajo la misma luz neutra antes de entregar; las imágenes guían texturas, no rediseñan la geometría.`;
