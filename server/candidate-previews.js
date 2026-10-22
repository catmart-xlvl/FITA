import sharp from 'sharp';

export async function saveCandidatePreviews({store,project,submission,previews}) {
  if(!Array.isArray(previews))return;
  for(const preview of previews.slice(0,4)){
    const candidate=submission?.candidates?.find(c=>c.taskId===preview?.taskId);
    if(!candidate||candidate.preview||typeof preview.dataBase64!=='string'||preview.dataBase64.length>70000||!/^[A-Za-z0-9+/]+={0,2}$/.test(preview.dataBase64))continue;
    try{
      const input=Buffer.from(preview.dataBase64,'base64');
      const image=sharp(input,{limitInputPixels:192*192});
      const metadata=await image.metadata();
      if(metadata.format!=='png'||metadata.width>192||metadata.height>192)continue;
      const bytes=await image.png().toBuffer();
      candidate.preview=await store.asset(project,bytes,'png','Tripo Studio preview');
    }catch{/* Previews are optional; never fail the model workflow. */}
  }
}
