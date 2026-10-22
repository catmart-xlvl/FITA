import test from 'node:test';import assert from 'node:assert/strict';
import {resumeUrl,reopenedTab} from '../extension-tripo-studio/tab-recovery.js';
const url='https://studio.tripo3d.ai/workspace/texture/model-11111111-2222-4333-8444-555555555555';
test('reopen is scoped to an authorized session, original browser window and one unambiguous Tripo tab',()=>{
 const b={closedTabId:12,tabWindowId:1,automationAuthorized:true,resumeUrl:url,priorTabIds:[12,13]};const tab={id:14,windowId:1,url};
 assert.equal(reopenedTab(b,[tab]).id,14);assert.equal(reopenedTab({...b,automationAuthorized:false},[tab]),null);
 assert.equal(reopenedTab(b,[{...tab,windowId:2}]),null);assert.equal(reopenedTab(b,[tab,{...tab,id:15}]),null);
 assert.equal(reopenedTab(b,[{...tab,id:13,url:'https://studio.tripo3d.ai/workspace/generate/other'}]),null);
 assert.equal(reopenedTab(b,[{...tab,id:13}]),null,'an existing tab is never adopted, even on the same asset');
 for(const bad of ['https://evil.test/workspace/generate',url+'?token=private',url+'#private','https://studio.tripo3d.ai/account'])assert.equal(resumeUrl(bad),null);
});
