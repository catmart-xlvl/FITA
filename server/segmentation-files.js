import yauzl from 'yauzl';
export const segFail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
export function readSegmentationZip(buffer,{referencesOnly=false,refinement=false}={}){return new Promise((resolve,reject)=>{
  if(!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>300*1024*1024)return reject(Error('SEG_PACKAGE_INVALID'));
  yauzl.fromBuffer(buffer,{lazyEntries:true,strictFileNames:true,validateEntrySizes:true},(error,zip)=>{
    if(error)return reject(Error('SEG_PACKAGE_INVALID'));let done=false,total=0;const files={};
    const stop=()=>{if(done)return;done=true;zip.close();reject(Error('SEG_PACKAGE_INVALID'));};
    zip.on('error',stop);zip.on('end',()=>{if(!done){done=true;resolve(files);}});
    if(zip.entryCount>240)return stop();
    zip.on('entry',entry=>{
      const name=entry.fileName,allowed=refinement?['manifest.json','report.json','head.glb','body.glb'].includes(name):referencesOnly?['manifest.json','coverage.json'].includes(name)||/^references\/[a-z0-9_-]{1,64}_(front|right|back)\.png$/.test(name):['manifest.json','result.json','segmented.blend'].includes(name)||/^references\/[a-z0-9_-]{1,64}_(front|back)\.png$/.test(name)||/^review\/[a-z0-9_-]{1,64}\.png$/.test(name);
      const max=/\.(blend|glb)$/.test(name)?180*1024*1024:20*1024*1024;
      if(!allowed||files[name]||(entry.externalFileAttributes>>>16&0xf000)===0xa000||entry.generalPurposeBitFlag&1||entry.uncompressedSize>max||(total+=entry.uncompressedSize)>300*1024*1024)return stop();
      zip.openReadStream(entry,(e,stream)=>{if(e)return stop();const chunks=[];let size=0;stream.on('error',stop);stream.on('data',b=>{if((size+=b.length)>max){stream.destroy();stop();}else chunks.push(b);});stream.on('end',()=>{if(!done){files[name]=Buffer.concat(chunks);zip.readEntry();}});});
    });zip.readEntry();
  });
});}
