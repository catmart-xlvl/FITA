import fs from 'node:fs/promises';

// Read on every handoff so an existing export receives maintained guidance
// without changing the hashes that identify its approved character inputs.
export async function vrchatPreparationFiles(){
  const [guide,profile,facialGuide,skinGuide]=await Promise.all([
    fs.readFile(new URL('../docs/VRCHAT_PC_CODEX_HANDOFF.md',import.meta.url)),
    fs.readFile(new URL('../docs/VRCHAT_PC_REFERENCE_PROFILE.json',import.meta.url)),
    fs.readFile(new URL('../docs/VRCHAT_PC_FACIAL_SETUP.md',import.meta.url)),
    fs.readFile(new URL('../docs/VRCHAT_PC_SKIN_SETUP.md',import.meta.url)),
  ]);
  return {'VRCHAT_PC_HANDOFF.md':guide,'VRCHAT_PC_REFERENCE_PROFILE.json':profile,'VRCHAT_PC_FACIAL_SETUP.md':facialGuide,'VRCHAT_PC_SKIN_SETUP.md':skinGuide};
}
