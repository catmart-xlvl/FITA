// Mirrors runInTab: page functions report failures as {adapterError}, because
// a throw inside chrome.scripting.executeScript reaches the worker as an empty
// result. The worker rethrows that code; tests expecting a page failure do too.
export function throwAdapterError(value){
  const check=v=>{if(v&&typeof v==='object'&&typeof v.adapterError==='string')throw new Error(v.adapterError);return v;};
  return value&&typeof value.then==='function'?value.then(check):check(value);
}
export const asWorker=fn=>(...args)=>throwAdapterError(fn(...args));
