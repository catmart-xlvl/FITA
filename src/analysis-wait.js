export function analysisGate(data,receipt,error=''){
 const awaiting=data?.delivery?.status==='waiting'&&receipt?.deliveryId===data.delivery.id&&receipt.cancelled!==true;
 const valid=!!data?.current?.id&&Array.isArray(data.current.groups);
 return {awaiting,showWaiting:awaiting&&!error,groupsLocked:awaiting||!valid};
}
