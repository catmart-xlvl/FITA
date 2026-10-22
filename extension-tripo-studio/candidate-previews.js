// Injected only into the authorized Studio tab. No canvas from the 3D editor,
// cookies, local storage or unrelated project cards are read.
export async function readCandidatePreviews(taskIds) {
  if(location.origin!=='https://studio.tripo3d.ai')return [];
  const allowed=new Set((taskIds||[]).filter(id=>/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)).slice(0,4));
  const found=new Map();
  for(const link of document.querySelectorAll('a[href]')){
    let url;try{url=new URL(link.href,location.origin);}catch{continue;}
    // Cards link to /workspace/generate/<descriptive-slug>-<uuid> (observed
    // 2026-10-21); older cards used model-<uuid>. The UUID ends the route.
    const taskId=url.pathname.match(/^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?workspace\/(?:generate|texture)\/(?:[^/]*?-)?([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\/?$/i)?.[1]?.toLowerCase();
    if(url.origin!==location.origin||!allowed.has(taskId)||found.has(taskId))continue;
    const images=[...link.querySelectorAll('img')].filter(img=>img.complete&&img.naturalWidth>=48&&img.naturalHeight>=48);
    if(images.length!==1)continue; // Do not guess between an avatar and a result.
    const img=images[0];let bitmap=null;
    try{
      const paint=source=>{
        const canvas=document.createElement('canvas');
        const scale=Math.min(1,192/(source.naturalWidth||source.width),192/(source.naturalHeight||source.height));
        canvas.width=Math.max(1,Math.round((source.naturalWidth||source.width)*scale));
        canvas.height=Math.max(1,Math.round((source.naturalHeight||source.height)*scale));
        canvas.getContext('2d').drawImage(source,0,0,canvas.width,canvas.height);
        const data=canvas.toDataURL('image/png');
        if(data.length<=70000)found.set(taskId,{taskId,dataBase64:data.slice('data:image/png;base64,'.length)});
      };
      try{paint(img);}catch{
        // Only a thumbnail URL already displayed by this confirmed task card.
        // CORS remains enforced; never forward a signed remote URL to FITA.
        const src=new URL(img.currentSrc||img.src,location.origin);
        if(src.protocol!=='https:'||src.username||src.password)continue;
        const response=await fetch(src.href,{mode:'cors',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(1500)});
        if(!response.ok||!/^image\/(png|jpeg|webp)(?:;|$)/i.test(response.headers.get('content-type')||''))continue;
        const reader=response.body.getReader(),parts=[];let size=0;
        try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024)break;parts.push(value);}}finally{await reader.cancel();}
        if(size>2*1024*1024)continue;
        bitmap=await createImageBitmap(new Blob(parts));paint(bitmap);
      }
    }catch{/* A missing preview must never stop a confirmed GLB download. */}
    finally{bitmap?.close();}
  }
  return [...found.values()];
}
