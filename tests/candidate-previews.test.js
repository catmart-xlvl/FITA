import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {saveCandidatePreviews} from '../server/candidate-previews.js';
import {readCandidatePreviews} from '../extension-tripo-studio/candidate-previews.js';

test('thumbnail import binds only confirmed tasks, rejects arbitrary formats, and caches successful previews',async()=>{
  const png=await sharp({create:{width:96,height:96,channels:4,background:'#bb3355'}}).png().toBuffer();
  const calls=[],project={},submission={candidates:[{taskId:'one'},{taskId:'two'},{taskId:'three'}]};
  const store={asset:async(p,bytes,extension)=>{assert.equal(p,project);assert.equal(extension,'png');assert.equal((await sharp(bytes).metadata()).format,'png');calls.push(bytes);return {id:'saved',url:'/files/preview.png'};}};
  const previews=[{taskId:'unrelated',dataBase64:png.toString('base64')},{taskId:'one',dataBase64:png.toString('base64')},{taskId:'two',dataBase64:Buffer.from('<svg/>').toString('base64')},{taskId:'three',dataBase64:'https://untrusted/image.png'}];
  await saveCandidatePreviews({store,project,submission,previews});
  await saveCandidatePreviews({store,project,submission,previews});
  assert.equal(calls.length,1);assert.equal(submission.candidates[0].preview.id,'saved');
  assert.equal(submission.candidates[1].preview,undefined);assert.equal(submission.candidates[2].preview,undefined);
});
test('oversize thumbnails and corrupt images never fail the generation workflow',async()=>{
  const png=await sharp({create:{width:193,height:192,channels:4,background:'#bb3355'}}).png().toBuffer();
  let calls=0;await saveCandidatePreviews({store:{asset:async()=>{calls++;}},project:{},submission:{candidates:[{taskId:'one'}]},previews:[{taskId:'one',dataBase64:png.toString('base64')},{taskId:'one',dataBase64:'a'.repeat(70001)}]});assert.equal(calls,0);
});
test('browser captures only uniquely matched confirmed task cards, never unrelated cards',async()=>{
  const task='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
  const img={complete:true,naturalWidth:192,naturalHeight:192};let paints=0;
  const card=(id,images=[img])=>({href:`https://studio.tripo3d.ai/workspace/generate/${id}`,querySelectorAll:()=>images});
  const document={querySelectorAll:()=>[card(other),card(task)],createElement:()=>({getContext:()=>({drawImage:()=>{paints++;}}),toDataURL:()=> 'data:image/png;base64,cG5n'})};
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const run=new AsyncFunction('document','location','ids',`return (${readCandidatePreviews.toString()})(ids)`);
  assert.deepEqual(await run(document,{origin:'https://studio.tripo3d.ai'},[task]),[{taskId:task,dataBase64:'cG5n'}]);
  assert.equal(paints,1);
  document.querySelectorAll=()=>[card('model-'+task)];
  assert.deepEqual(await run(document,{origin:'https://studio.tripo3d.ai'},[task]),[{taskId:task,dataBase64:'cG5n'}]);
  // Current Studio cards put a descriptive slug before the task UUID.
  document.querySelectorAll=()=>[card('red-jacket-black-shirt-gray-cargo-pants-worn-by-a-stylized-human-cha-'+task)];
  assert.deepEqual(await run(document,{origin:'https://studio.tripo3d.ai'},[task]),[{taskId:task,dataBase64:'cG5n'}]);
  // The UUID must end the route: nested paths or trailing text are another resource.
  for(const href of [task+'-extra',task+'/nested','slug-'+other])document.querySelectorAll=()=>[card(href)],assert.deepEqual(await run(document,{origin:'https://studio.tripo3d.ai'},[task]),[]);
  assert.deepEqual(await run(document,{origin:'https://other.example'},[task]),[]);
  document.querySelectorAll=()=>[card(task,[img,img])];
  assert.deepEqual(await run(document,{origin:'https://studio.tripo3d.ai'},[task]),[]);
});
