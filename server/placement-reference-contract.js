export const placementReferenceInstructions=`REFERENCIAS EXCLUSIVAS DE COLOCACIÓN MANUAL
Además de las ocho vistas separadas de cabeza y cuerpo, genera DOS PNG independientes: reference_front.png y reference_left.png, personaje COMPLETO con cabeza y cuerpo juntos. Estas guías solo se usan en Colocación manual; NO sustituyen las ocho vistas aprobadas ni se envían a Tripo.
Usa el concepto y las vistas separadas adjuntas para conservar identidad, anatomía, outfit, accesorios y todo el cabello. No regeneres diseños ni añadas piezas. Una imagen por vista, sin collage.
Ambas cámaras deben ser ORTOGRÁFICAS, sin perspectiva, sin convergencia ni escorzo, misma escala y altura, suelo y márgenes. Pose T, dedos rectos, brazos horizontales. Lienzo cuadrado amplio o 4:3 horizontal; nunca acortes brazos para encajar. Fondo transparente.
FRONTAL: cámara exactamente frente al personaje, sin giro ni inclinación, simetría de proyección y extremidades completas.
LATERAL IZQUIERDA ANATÓMICA: cámara exactamente a 90 grados del frente, mirando el lado izquierdo; nariz hacia la izquierda de la imagen. No tres cuartos, no espejo del perfil derecho, no cámara elevada. Brazos alineados en profundidad y piernas coincidentes: una sola silueta de brazo y una de pierna, sin separar, abrir ni desplazar el miembro lejano para mostrarlo. Conserva ambos miembros en la anatomía, simplemente quedan ocluidos en esta proyección. Mantén las asimetrías reales de ropa/accesorios sin convertir la vista en perspectiva.
Verifica especialmente nariz, barbilla, oído, cuello, hombros y proporción cabeza/cuerpo. Si se ven dos brazos o piernas separados por giro de cámara, corrige ANTES de entregar. No rellenes con una vista de tres cuartos. No cambies las ocho vistas fuente.
Incluye estos dos PNG junto a los ocho PNG de cabeza/cuerpo en el MISMO fita_views.zip con manifest.json. FITA los guardará automáticamente para Colocación; no se generan en una etapa posterior. La revisión artística corresponde al usuario.
`;

export const guideSlots=['front','left'].map(view=>({group:'placement',view,file:`reference_${view}.png`}));
export function guideBinding(p){return {referenceId:p.reference?.id,notesRevision:p.notesRevision,views:['body','head'].flatMap(g=>['front','left','right','back'].map(v=>p.groups[g].views[v]?.id||null))};}
