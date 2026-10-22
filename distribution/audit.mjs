import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync,zstdDecompressSync} from 'node:zlib';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const files=JSON.parse(await fs.readFile(path.join(root,'distribution','source-files.json'),'utf8'));
const forbiddenPath=/(?:^|\/)(?:data|projects|node_modules|\.runtime|runtime|\.git|studies|fita-idol|__pycache__)(?:\/|$)|\.(?:pem|crx|log|env)$/i;
const word=codes=>String.fromCharCode(...codes);
const contentPatterns=[new RegExp(word([99,104,97,114,97,107,117,114,117]),'i'),new RegExp(word([122,101,110,108,101,115,115]),'i'),new RegExp('\\b'+word([122,122,122])+'\\b','i'),new RegExp(word([66,82,65,78,68,79,78])+'|'+word([69,83,84,85,68,73,79,32,68,69,32,51,68]),'i'),/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/\b(?:sk-proj-|ghp_|github_pat_)[A-Za-z0-9_]{12,}/];
const issues=[];let bytes=0;
for(const rel of files){
 if(forbiddenPath.test(rel))issues.push({path:rel,issue:'excluded path'});
 let data=await fs.readFile(path.join(root,rel));bytes+=data.length;
 // Read compressed Blender metadata as well as plain text/GLB resources.
 try{if(data[0]===0x1f&&data[1]===0x8b)data=gunzipSync(data);else if(data.length>=4&&data.readUInt32LE(0)===0xfd2fb528)data=zstdDecompressSync(data);}catch(error){issues.push({path:rel,issue:'compressed resource could not be inspected'});}
 const text=data.toString('utf8')+'\n'+data.toString('utf16le');
 for(let i=0;i<contentPatterns.length;i++){
   // A three-letter abbreviation in numeric binary data is not a source reference.
   const input=i===2&&!/\.(?:js|jsx|mjs|py|md|txt|json|html|css)$/i.test(rel)?'':text;
   if(contentPatterns[i].test(input))issues.push({path:rel,issue:'content pattern '+i});
 }
}
const report={schema:1,sourceFiles:files.length,sourceBytes:bytes,issues};
console.log(JSON.stringify(report,null,2));if(issues.length)process.exitCode=1;
