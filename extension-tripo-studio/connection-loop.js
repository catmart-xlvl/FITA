// Chrome alarms remain the wake-up fallback after worker suspension.
// While paired, this loop removes the alarm's 30-second command latency.
export function createConnectionLoop({run, connected, schedule=setTimeout, cancel=clearTimeout}) {
  let epoch=0, timer=null;
  function stop(){epoch++;if(timer!==null)cancel(timer);timer=null;}
  function start(){
    stop();const current=epoch;
    const tick=async()=>{
      timer=null;let delay=1000;
      try {
        if(current!==epoch||!await connected())return;
        delay=await run()||1000;
      } catch {delay=10000;}
      if(current===epoch)timer=schedule(tick,delay);
    };
    timer=schedule(tick,0);
  }
  return {start,stop};
}

// A long command owns the mutation queue, but must not block fresh, read-only
// heartbeats. Never poll a second command or restore a revoked session here.
export function createCommandHeartbeat({session,inspect,send,epoch,now=Date.now,intervalMs=20000}){
 let active=false,lastAt=-Infinity;
 return async()=>{
  if(active||now()-lastAt<intervalMs)return false;
  active=true;lastAt=now();
  try{
   const generation=epoch(),before=await session();
   if(!before?.token||!Number.isInteger(before.tabId))return false;
   const snapshot=await inspect(before.tabId),after=await session();
   if(epoch()!==generation||after?.token!==before.token||after.tabId!==before.tabId||after.automationAuthorized!==before.automationAuthorized)return false;
   await send({...snapshot,automationAuthorized:before.automationAuthorized===true},before.token);
   return true;
  }catch{return false;}
  finally{active=false;}
 };
}
