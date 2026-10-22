import fs from 'node:fs/promises';

// Refresh guidance on every package request without changing source manifests.
export async function facialWorkflowFiles(){
  return {'FACIAL_EXPRESSIONS_WORKFLOW.md':await fs.readFile(new URL('../docs/FACIAL_EXPRESSIONS_WORKFLOW.md',import.meta.url))};
}
