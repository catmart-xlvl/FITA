import {skillInstructions} from './local-instruction-package.js';
import fs from 'node:fs/promises';

// Skills stay in the app. Task workspaces carry exact locators, never copies.
export const refinementSkillPaths = [
  'docs/FLUJO_ACABADO_Y_VISIBILIDAD.md',
  'docs/preparacion-sombreado.md',
  'skills/normales-rostro-anime/SKILL.md',
  'skills/normales-cabello-anime/SKILL.md',
  'skills/normales-cabello-anime/references/contrato.md',
  'skills/refinamiento-texturas-anime/SKILL.md',
  'skills/refinamiento-texturas-anime/references/pintura-y-cobertura.md',
  'skills/refinamiento-texturas-anime/references/helpers-repintado.md',
  'skills/refinamiento-texturas-anime/references/cobertura-temporal.md',
  'skills/refinamiento-texturas-anime/references/bordes-uv.md',
  'skills/refinamiento-texturas-anime/references/revision-conjunta.md',
  'skills/refinamiento-rasgos-faciales-anime/SKILL.md',
  'skills/refinamiento-rasgos-faciales-anime/references/iris-pintado.md',
  'skills/refinamiento-rasgos-faciales-anime/references/limite-esclera.md',
  'skills/refinamiento-rasgos-faciales-anime/references/atlas-y-coordinacion.md',
  'skills/refinamiento-rasgos-faciales-anime/references/sombra-ocular.md',
  'skills/refinamiento-rasgos-faciales-anime/references/eye-shadow-reference.json',
];
export async function refinementSkillFiles() {
 return {'SKILLS_REQUERIDAS.txt':skillInstructions(['refinamiento-texturas-anime','refinamiento-rasgos-faciales-anime','normales-cabello-anime','normales-rostro-anime']),
 'docs/FLUJO_ACABADO_Y_VISIBILIDAD.md':await fs.readFile(new URL('../docs/FLUJO_ACABADO_Y_VISIBILIDAD.md',import.meta.url)),
 'docs/preparacion-sombreado.md':await fs.readFile(new URL('../docs/preparacion-sombreado.md',import.meta.url))};
}
