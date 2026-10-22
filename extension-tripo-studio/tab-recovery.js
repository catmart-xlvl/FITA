import {parseStudioUrl} from './studio-map.js';
// Any of the 12 Studio sections (with or without a model) is a place the
// authorized tab may return to. Query strings, fragments and other pages are not.
export function resumeUrl(value){
 const place=parseStudioUrl(value);
 return place.page==='workspace'&&place.clean?new URL(value).href:null;
}
export function reopenedTab(bridge,tabs){
 if(!bridge.closedTabId||!bridge.automationAuthorized||!resumeUrl(bridge.resumeUrl))return null;
 const candidates=tabs.filter(t=>t.id!==bridge.closedTabId&&(bridge.tabWindowId==null||t.windowId===bridge.tabWindowId)&&resumeUrl(t.url)&&!bridge.priorTabIds?.includes(t.id));
 return candidates.length===1?candidates[0]:null;
}
