export async function analysisZipBlob(url,{request=fetch}={}){
 const response=await request(url);
 if(!response.ok)throw Error('The analysis ZIP could not be downloaded. Try again.');
 const blob=await response.blob(),signature=new Uint8Array(await blob.slice(0,4).arrayBuffer());
 if(blob.size<22||signature[0]!==80||signature[1]!==75||signature[2]!==3||signature[3]!==4)throw Error('The analysis ZIP could not be downloaded. Try again.');
 return blob;
}
