import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {placementSkillFiles,placementSkillName} from '../server/placement-skill.js';

const home=process.env.CODEX_HOME||path.join(os.homedir(),'.codex');
const root=path.resolve(home,'skills',placementSkillName);
for(const [name,bytes] of Object.entries(await placementSkillFiles())){
  const relative=name.slice(`skills/${placementSkillName}/`.length),file=path.resolve(root,relative);
  if(!file.startsWith(root+path.sep))throw Error('Invalid skill resource path');
  await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);
}
console.log('Skill instalada: '+root);
