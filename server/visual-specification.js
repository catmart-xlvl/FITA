import {fileURLToPath} from 'node:url';

// App-owned resources: never depend on the developer's personal Codex profile.
export const visualSpecification = Object.freeze({
  revision: 'fita-visual-spec/v1',
  invocation: 'only-when-image-generation-is-authorized',
  name: 'especificacion-visual-coherente',
  entry: fileURLToPath(new URL('../skills/especificacion-visual-coherente/SKILL.md', import.meta.url)),
  contract: fileURLToPath(new URL('../skills/especificacion-visual-coherente/references/contrato-visual.md', import.meta.url)),
});

export const visualSpecificationInstructions = `ESPECIFICACIÓN VISUAL DE FITA
Antes de cada generación o edición de imágenes autorizada, lee la skill de la aplicación en ${visualSpecification.entry} y su contrato en ${visualSpecification.contract}. Si no están accesibles, solicita el paquete vigente de FITA; no dependas de una skill personal instalada. Este método NO autoriza generar imágenes en etapas que lo prohíben, gastar créditos, cambiar geometría aprobada ni alterar los entregables o la segmentación de esta etapa.
El agente analiza las referencias y fija las decisiones antes de llamar al generador. Guarda especificacion-visual.json en el directorio de salida indicado por UBICACIONES.json y reutilízalo entre vistas y reanudaciones. Registra revisión, fuentes, procedencia observada/medida/estimada/elegida, inventario de piezas y materiales, paleta sRGB HEX/RGB por región (tono medio, luces y sombras pertinentes), proporciones y dimensiones con unidades y anclas, conexiones y origen de cada pieza, asimetrías, pliegues estructurales y arrugas, cámara, encuadre y comprobaciones.
Para pose, fija ejes, postura de referencia, lado anatómico, posiciones y ángulos pertinentes de torso, cabeza y articulaciones, incluidos contactos de manos y dedos; un nombre como pose T no es suficiente. Usa la geometría y guías aprobadas cuando existan; no reinterpretes sus medidas. Resuelve lo oculto solo dentro del alcance de la etapa. Cada solicitud transmite los valores y relaciones ya elegidos junto con las referencias autorizadas: no delegues alternativas ni supongas memoria del generador.
Conserva identidad, proporciones y preferencias del artista de ESTE proyecto; no apliques ideales corporales ajenos ni modifiques anatomía para hacerla encajar en el lienzo. Aprovecha el área disponible con el margen mínimo que evite cortes; conserva la escala común exigida entre vistas. La división cabeza/cuerpo o por segmentos de FITA prevalece sobre una recomendación genérica de cuerpo entero. No conviertas a apariencia 3D gris ni suprimas detalles hacia texturas salvo pedido específico.
Inspecciona cada resultado contra la referencia y el contrato, registra discrepancias observables y corrige solo las vistas afectadas. Los números son objetivos firmes, no prueba de exactitud del generador. La revisión visual del usuario sigue pendiente hasta su aprobación. Conserva el contrato y la revisión como archivos de trabajo; no los añadas al ZIP de entrega si su esquema no los admite.
`;

export function withVisualSpecification(files) {
  const descriptor = JSON.parse(files['UBICACIONES.json']);
  if (descriptor.visualSpecification?.revision === visualSpecification.revision) return files;
  descriptor.visualSpecification = visualSpecification;
  const instructionName=files['INSTRUCTIONS.txt']?'INSTRUCTIONS.txt':'INSTRUCCIONES.txt';
  return {...files,
    'UBICACIONES.json': Buffer.from(JSON.stringify(descriptor, null, 2)),
    [instructionName]: Buffer.concat([files[instructionName], Buffer.from('\n'+visualSpecificationInstructions)]),
  };
}
