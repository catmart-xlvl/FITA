// Refresh only a CSRF rejection emitted before route execution. Never replay
// network failures or paid operations whose outcome might already be committed.
export function createLocalRequest(fetcher=fetch){
 let token='',refreshing;
 const refresh=()=>refreshing||=(async()=>{try{const r=await fetcher('/api/session');if(!r.ok)throw Error('Local session unavailable');token=(await r.json()).token;return token;}finally{refreshing=null;}})();
 return {setToken:value=>token=value,async request(url,options={}){
  const headers={...options.headers,'x-workbench-token':token};let body=options.body;
  if(body&&!(body instanceof FormData)){headers['Content-Type']='application/json';body=JSON.stringify(body);}
  const send=()=>fetcher('/api'+url,{...options,body,headers});let r=await send(),d=await r.json();
  if(r.status===403&&['Sesión local inválida. Recarga la página.','Sesión local inválida. Recarga el taller.'].includes(d.error)){headers['x-workbench-token']=await refresh();r=await send();d=await r.json();}
  if(!r.ok)throw Object.assign(Error(d.error||'The operation could not be completed.'),{status:r.status});return d;
 }};
}
