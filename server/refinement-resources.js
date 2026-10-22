import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {refinementInstructions} from './texture-refinement-prompts.js';
export const refinementGuidanceVersion='tripo-uv-local-paint-eyeshadow/v2';
// Only maintained instructions/helpers. Never replace models, manifests, reports,
// atlas edits, output files or delivery authorization when refreshing a handoff.
export async function refinementSupportFiles(){
 const files={'INSTRUCCIONES.txt':Buffer.from(refinementInstructions),
  'paint-runtime.json':Buffer.from(JSON.stringify({schema:'fita-paint-runtime/v1',pythonPackages:fileURLToPath(new URL('../.runtime/texture-paint-libs/',import.meta.url))},null,2))};
 const scripts={'PINTAR_TEXTURAS.py':'local-texture-paint.py','RETOCAR_TEXTURAS.mjs':'refine-textures.mjs','texture-layout.mjs':'texture-layout.mjs','facial-preparation.mjs':'facial-preparation.mjs','INTEGRAR_ROSTRO.mjs':'integrate-facial-preparation.mjs','PREPARAR_NORMALES_CABELLO.mjs':'prepare-hair-normals.mjs','hair-normal-preparation.mjs':'hair-normal-preparation.mjs','face-normal-preparation.mjs':'face-normal-preparation.mjs','PREPARAR_NORMALES_ROSTRO.mjs':'prepare-face-normals.mjs','AJUSTAR_MASCARA_ROSTRO.py':'fit-face-normal-mask.py','EMPAQUETAR_RETOQUE.py':'package-texture-refinement.py','ENTREGAR_RETOQUE.mjs':'deliver-texture-refinement.mjs'};
 for(const [dest,source] of Object.entries(scripts))files[dest]=await fs.readFile(new URL('../scripts/'+source,import.meta.url));
 for(const name of ['face-normal-mask.glb','face-normal-mask.blend','template.json'])files['face-normal-mask/'+name]=await fs.readFile(new URL('../resources/face-normals/'+name,import.meta.url));
 for(const name of ['preparacion-facial-acabado.md','preparacion-sombreado.md','FLUJO_ACABADO_Y_VISIBILIDAD.md'])files['docs/'+name]=await fs.readFile(new URL('../docs/'+name,import.meta.url));
 return files;
}
