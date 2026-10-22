import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from 'sharp';
import { createApp } from "../server/app.js";
import { createProviders } from "../server/providers.js";
import { glbBuffer } from "../server/validation.js";
import {afterHeadChoice,persistNavigation,restoreNavigation} from '../src/project-navigation.js';
const fixture = await fs.readFile("fixtures/body-front.png"),
  glb = await fs.readFile("fixtures/mannequin.glb");
const viewFixtures = Object.fromEntries(await Promise.all(
  ['head','body'].flatMap(group => ['front','right','back'].map(async view => [
    `${group}-${view}`, await fs.readFile(`fixtures/${group}-${view}.png`),
  ])),
));
async function harness(t, { providers, root } = {}) {
  const dataDir =
    root || (await fs.mkdtemp(path.join(os.tmpdir(), "anime-workbench-test-")));
  const { app, store } = await createApp({ dataDir, providers, pollMs: 5 });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`,
    token = (await (await fetch(base + "/api/session")).json()).token;
  t.after(() => new Promise((r) => server.close(r)));
  async function call(route, body, method = body ? "POST" : "GET", extra = {}) {
    const response = await fetch(base + "/api" + route, {
      method,
      headers: {
        "x-workbench-token": token,
        ...(!(body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        ...extra,
      },
      ...(body
        ? { body: body instanceof FormData ? body : JSON.stringify(body) }
        : {}),
    });
    return { status: response.status, data: await response.json() };
  }
  async function upload(id, kind, view, buffer = fixture, name = "test.png") {
    const f = new FormData();
    f.set("file", new Blob([buffer]), name);
    f.set("kind", kind);
    if (view) f.set("view", view);
    return call(`/projects/${id}/upload`, f);
  }
  return { call, upload, store, base, dataDir };
}
const mock = () => ({
  verify: async (k) => ({
    verifiedAt: new Date().toISOString(),
    ...(k === "tripo"
      ? { balance: 100, frozen: 0 }
      : { imageModelListed: true }),
  }),
  image: async () => ({ buffer: fixture, usage: { total_tokens: 50 } }),
  upload: async () => "file_test",
  mesh: async () => "task_test",
  task: async () => ({
    status: "success",
    progress: 100,
    credits_consumed: 30,
    output: { model_url: "https://cdn.tripo3d.ai/test.glb" },
  }),
  download: async () => glb,
});
async function ready(h) {
  const { data: p } = await h.call("/projects", {
    name: "Personaje de prueba",
  });
  await h.upload(p.id, "reference");
  assert.equal((await h.call(`/projects/${p.id}/confirm-reference`,{})).status,200);
  for (const g of ["head", "body"]) {
    for (const v of ["front", "right", "back"])
      assert.equal((await h.upload(p.id, g, v, viewFixtures[`${g}-${v}`])).status,200);
  }
  await validateAndReview(h,p.id);
  return p.id;
}
async function validateAndReview(h,id) {
  const checked = await h.call(`/projects/${id}/validate-view-set`,{});
  assert.equal(checked.status,200);
  assert.equal(checked.data.viewSetValidation.technicalValid,true,
    JSON.stringify(checked.data.viewSetValidation.items));
  assert.equal(checked.data.viewSetValidation.humanReview,null);
  assert.equal(checked.data.viewSetReady,false);
  const reviewed = await h.call(`/projects/${id}/review-view-set`,{
    reportId:checked.data.viewSetValidation.id,approved:true,
  });
  assert.equal(reviewed.status,200);
  assert.equal(reviewed.data.viewSetReady,true);
  return reviewed.data;
}
async function waitJob(h, id) {
  for (let i = 0; i < 100; i++) {
    const p = (await h.call("/projects/" + id)).data;
    if (!["queued", "running"].includes(p.jobs.at(-1)?.status)) return p;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("Job did not finish");
}

test('candidate choice is explicit, persists independently of preview and keeps all four files and their lineage',async t=>{
 const h=await harness(t,{providers:mock()}),id=await ready(h),p=h.store.get(id);
 const lineage={referenceId:p.reference.id,referenceRevision:p.referenceRevision,notesRevision:p.notesRevision,views:Object.fromEntries(['head','body'].map(g=>[g,['front','right','back'].map(v=>p.groups[g].views[v].id)]))};
 for(let index=0;index<4;index++)p.models.push({...await h.store.asset(p,glb,'glb','Tripo Studio'),group:'head',label:`Candidate ${index+1}`,studioSubmissionId:'batch-1',candidateIndex:index,studioTaskId:`task-${index}`,lineage:structuredClone(lineage)});
 const ids=p.models.map(m=>m.id);p.studioOperations=[{id:'batch-1',type:'submit',group:'head',status:'succeeded',generationComplete:false}];await h.store.save(p);
 let shown=(await h.call('/projects/'+id)).data;assert.equal(shown.groups.head.selectedModelId,undefined,'The first downloaded candidate must not be selected automatically');assert(shown.models.every(m=>m.current));
 assert.equal((await h.call(`/projects/${id}/select-model`,{group:'body',modelId:ids[0]})).status,409);
 assert.equal((await h.call(`/projects/${id}/select-model`,{group:'head',modelId:'not-in-project'})).status,409);
 let choice=await h.call(`/projects/${id}/select-model`,{group:'head',modelId:ids[2]});assert.equal(choice.status,200,'Local candidate choice can happen while remaining candidates are processing');assert.equal(choice.data.groups.head.selectedModelId,ids[2]);assert.equal(choice.data.models.length,4);
 const navigation=afterHeadChoice(choice.data);assert.equal(navigation.stage,2);assert.equal(navigation.studioGroup,'body');
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};persistNavigation(choice.data,navigation,storage);
 const h2=await harness(t,{root:h.dataDir,providers:mock()});shown=(await h2.call('/projects/'+id)).data;assert.equal(shown.groups.head.selectedModelId,ids[2]);assert.equal(shown.groups.body.selectedModelId,undefined);
 assert.equal(restoreNavigation(shown,storage).studioGroup,'body');assert.equal(shown.jobs.length,0,'Choosing a head must not generate the body');
 choice=await h.call(`/projects/${id}/select-model`,{group:'head',modelId:ids[1]});assert.equal(choice.data.groups.head.selectedModelId,ids[1]);assert.deepEqual(choice.data.models.map(m=>m.id),ids);assert.equal(choice.data.groups.head.modelSelectionHistory[0].modelId,ids[2]);
 for(const model of choice.data.models){assert.deepEqual(model.lineage,lineage);assert.equal((await fetch(h.base+model.url)).status,200);}
 const other=(await h.call('/projects',{name:'Other project'})).data.id;assert.equal((await h.call(`/projects/${other}/select-model`,{group:'head',modelId:ids[0]})).status,409);
 p.notesRevision++;await h.store.save(p);assert.equal((await h.call(`/projects/${id}/select-model`,{group:'head',modelId:ids[0]})).status,409,'Historical candidates cannot be chosen as current');shown=(await h.call('/projects/'+id)).data;assert(shown.models.every(m=>!m.current));assert.equal(shown.groups.head.selectedModelId,ids[1],'Historical choice is retained without making the model current');
});

test('part selection persists, permits one left image, preserves files and keeps the API three-view requirement',async t=>{
 const h=await harness(t,{providers:mock()});let p=(await h.call('/projects',{name:'One selected part'})).data;const id=p.id;
 await h.upload(id,'reference');await h.call(`/projects/${id}/confirm-reference`,{});
 p=(await h.upload(id,'head','right',viewFixtures['head-right'],'my-right.png')).data;
 const right=p.groups.head.views.right;
 p=(await h.upload(id,'head','left',viewFixtures['head-front'],'my-left.png')).data;
 const left=p.groups.head.views.left;
 assert.deepEqual(p.groups.head.selectedViews,['right'],'New left file is not automatically selected');
 assert.equal(p.groups.head.views.right.id,right.id,'Adding left does not move or mirror right');
 assert.equal((await h.call(`/projects/${id}/view-selection`,{group:'head',views:['left','left']})).status,400);
 p=(await h.call(`/projects/${id}/view-selection`,{group:'head',views:['left']})).data;
 assert.deepEqual(p.groups.head.selectedViews,['left']);
 p=(await h.call(`/projects/${id}/validate-view-set`,{group:'head'})).data;
 const reportId=p.viewSetValidation.id;
 assert.equal(p.viewSetValidation.technicalValid,true);assert.equal(p.viewSetValidation.items.length,1);assert.equal(p.viewSetReady,false);
 assert.equal((await h.call(`/projects/${id}/studio-preparation`,{group:'head'})).status,409);
 p=(await h.call(`/projects/${id}/review-view-set`,{reportId,approved:true})).data;
 assert.deepEqual(p.viewSetReadyByGroup,{head:true,body:false});assert.equal(p.groups.head.approved,true);assert.equal(p.groups.body.approved,false);
 const prep=await h.call(`/projects/${id}/studio-preparation`,{group:'head'});assert.equal(prep.status,200);assert.deepEqual(prep.data.parts[0].views.map(x=>x.view),['left']);
 assert.equal((await h.call(`/projects/${id}/studio-preparation`,{group:'body'})).status,409);
 await h.call('/connections/tripo',{key:'test-only-secret'});
 const quote=await h.call(`/projects/${id}/quote`,{type:'mesh',group:'head'});assert.equal(quote.status,409);assert.match(quote.data.error,/front, right profile and back/);
 const reload=await harness(t,{root:h.dataDir,providers:mock()});p=(await reload.call('/projects/'+id)).data;
 assert.deepEqual(p.groups.head.selectedViews,['left']);assert.equal(p.viewSetReadyByGroup.head,true);
 p=(await h.call(`/projects/${id}/view-selection`,{group:'head',views:[]})).data;
 assert.equal(p.viewSetReady,false);assert.equal(p.groups.head.approved,false);assert.equal(p.groups.head.approvalHistory.length,1);assert(p.viewSetValidationHistory.some(r=>r.id===reportId));
 assert.equal((await h.call(`/projects/${id}/review-view-set`,{reportId,approved:true})).status,409);
 for(const asset of [right,left])assert.equal((await fetch(h.base+asset.url)).status,200,'Selection changes preserve files');
 p=(await h.call(`/projects/${id}/validate-view-set`,{group:'head'})).data;assert.equal(p.viewSetValidation.reasonCode,'no_selection');assert.equal(p.viewSetValidation.technicalValid,false);
});

test("Local persistence, file validation, reference revision and approval boundaries", async (t) => {
  const h = await harness(t);
  let { data: p } = await h.call("/projects", { name: "Prueba local" });
  assert.equal(
    (
      await h.call(`/projects/${p.id}/approve`, {
        group: "head",
        approved: true,
      })
    ).status,
    400,
  );
  assert.equal(
    (await h.upload(p.id, "reference", null, Buffer.from("<svg/>"))).status,
    400,
  );
  assert.equal((await h.upload(p.id, "reference")).status, 200);
  assert.equal((await h.call(`/projects/${p.id}/confirm-reference`,{})).status,200);
  assert.equal(
    (
      await h.call(`/projects/${p.id}/approve`, {
        group: "head",
        approved: true,
      })
    ).status,
    409,
  );
  for (const v of ["front", "right", "back"]) await h.upload(p.id, "head", v);
  p = (
    await h.call(`/projects/${p.id}/approve`, { group: "head", approved: true })
  ).data;
  assert.equal(p.groups.head.approved, true);
  assert.equal(p.groups.body.approved, false);
  assert.equal((await h.upload(p.id, "head", "front")).status, 409);
  await h.call(
    `/projects/${p.id}`,
    { name: "Nombre conservado", notes: "Conservar silueta" },
    "PATCH",
  );
  assert.equal((await h.call('/projects/'+p.id)).data.groups.head.approved,false);
  await h.call(`/projects/${p.id}/approve`,{group:'head',approved:true});
  const h2 = await harness(t, { root: h.dataDir });
  p = (await h2.call("/projects/" + p.id)).data;
  assert.equal(p.name, "Nombre conservado");
  assert.equal(p.notes, "Conservar silueta");
  assert.equal(p.groups.head.approved, true);
  const old = p.reference.url;
  p = (await h.upload(p.id, "reference")).data;
  assert.equal(p.groups.head.approved, false);
  assert.equal(Object.keys(p.groups.head.views).length, 0);
  assert.equal(p.referenceHistory[0].reference.url, old);
  assert.equal(p.referenceHistory[0].groups.head.approved, true);
  assert.equal((await fetch(h.base + old)).status, 200);
});

test("Paid gating, stale and single-use confirmation, mock async Tripo completion", async (t) => {
  const provider = mock();
  let submissions = 0;
  provider.mesh = async (key, inputs) => {
    submissions++;
    assert.deepEqual(
      inputs.map((x) => Object.keys(x)[0]),
      ["front", "right", "back"],
    );
    return "task_paid_mock";
  };
  const h = await harness(t, { providers: provider });
  const id = await ready(h);
  assert.equal(
    (await h.call(`/projects/${id}/quote`, { type: "mesh", group: "body" }))
      .status,
    409,
  );
  await h.call("/connections/tripo", { key: "test-only-secret" });
  await h.call(`/projects/${id}/approve`, { group: "body", approved: false });
  assert.equal(
    (await h.call(`/projects/${id}/quote`, { type: "mesh", group: "body" }))
      .status,
    409,
  );
  assert.equal(submissions, 0);
  await h.call(`/projects/${id}/approve`, { group: "body", approved: true });
  await validateAndReview(h,id);
  let q = (
    await h.call(`/projects/${id}/quote`, { type: "mesh", group: "body" })
  ).data;
  assert.equal(
    (
      await h.call(`/projects/${id}/generate`, {
        quoteId: q.id,
        confirmPaid: false,
      })
    ).status,
    409,
  );
  assert.equal(submissions, 0);
  await h.call(`/projects/${id}`, { notes: "Revision nueva" }, "PATCH");
  assert.equal(
    (
      await h.call(`/projects/${id}/generate`, {
        quoteId: q.id,
        confirmPaid: true,
      })
    ).status,
    409,
  );
  for(const g of ['head','body'])await h.call(`/projects/${id}/approve`,{group:g,approved:true});
  await validateAndReview(h,id);
  q = (await h.call(`/projects/${id}/quote`, { type: "mesh", group: "body" }))
    .data;
  assert.equal(
    (
      await h.call(`/projects/${id}/generate`, {
        quoteId: q.id,
        confirmPaid: true,
      })
    ).status,
    202,
  );
  const result = await waitJob(h, id);
  assert.equal(result.jobs.at(-1).status, "success");
  assert.equal(result.models.length, 1);
  assert.equal(result.models[0].credits, 30);
  assert.equal(submissions, 1);
  const file = await fetch(h.base + result.models[0].url);
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), glb);
  assert.equal(
    (
      await h.call(`/projects/${id}/generate`, {
        quoteId: q.id,
        confirmPaid: true,
      })
    ).status,
    409,
  );
  assert.equal(submissions, 1);
  assert.equal(JSON.stringify(result).includes("test-only-secret"), false);
});

test("Image provider failure preserves approved group and prior view; retry succeeds", async (t) => {
  const provider = mock();
  provider.image = async () => {
    throw new Error("Proveedor temporalmente no disponible");
  };
  const h = await harness(t, { providers: provider });
  const id = await ready(h);
  await h.call("/connections/openai", { key: "test-only-secret" });
  await h.call(`/projects/${id}/approve`, { group: "body", approved: false });
  const old = (await h.call("/projects/" + id)).data.groups.body.views.front.id;
  let q = (
    await h.call(`/projects/${id}/quote`, {
      type: "image",
      group: "body",
      view: "front",
    })
  ).data;
  await h.call(`/projects/${id}/generate`, {
    quoteId: q.id,
    confirmPaid: true,
  });
  let p = await waitJob(h, id);
  assert.equal(p.jobs.at(-1).status, "failed");
  assert.equal(p.groups.head.approved, true);
  assert.equal(p.groups.body.views.front.id, old);
  provider.image = async (key, refs, prompt) => {
    assert.equal(refs.length, 3);
    assert.equal((await sharp(refs.at(-1)).metadata()).width,1280);
    assert.match(prompt,/LAST input image.*POSE-ONLY/);
    assert.match(prompt,/never identity, anatomy, body proportions/);
    assert.match(prompt, /FRONT/);
    return { buffer: fixture };
  };
  q = (
    await h.call(`/projects/${id}/quote`, {
      type: "image",
      group: "body",
      view: "front",
    })
  ).data;
  await h.call(`/projects/${id}/generate`, {
    quoteId: q.id,
    confirmPaid: true,
  });
  p = await waitJob(h, id);
  assert.equal(p.jobs.at(-1).status, "success");
  assert.equal(p.groups.head.approved, true);
  assert.notEqual(p.groups.body.views.front.id, old);
  assert.equal(p.viewHistory.at(-1).asset.id, old);
});

test("Tripo polling failure resumes the same task, without duplicate generation", async (t) => {
  const provider = mock();
  let submits = 0;
  provider.mesh = async () => {
    submits++;
    return "task_resume";
  };
  provider.task = async () => {
    throw new Error("Conexión perdida");
  };
  const h = await harness(t, { providers: provider });
  const id = await ready(h);
  await h.call("/connections/tripo", { key: "test-only-secret" });
  const q = (
    await h.call(`/projects/${id}/quote`, { type: "mesh", group: "body" })
  ).data;
  await h.call(`/projects/${id}/generate`, {
    quoteId: q.id,
    confirmPaid: true,
  });
  let p = await waitJob(h, id);
  assert.equal(p.jobs.at(-1).status, "paused");
  assert.equal(
    (await h.call(`/projects/${id}`, { name: "Bloqueado" }, "PATCH")).status,
    409,
  );
  provider.task = mock().task;
  await h.call(`/projects/${id}/jobs/${p.jobs.at(-1).id}/resume`, {});
  p = await waitJob(h, id);
  assert.equal(p.jobs.at(-1).status, "success");
  assert.equal(submits, 1);
});

test("Restart pauses pending operations and does not restore secrets", async (t) => {
  const h = await harness(t, { providers: mock() });
  const id = await ready(h);
  await h.call("/connections/tripo", { key: "test-only-secret" });
  const p = h.store.get(id);
  p.jobs.push({
    id: "pending",
    type: "mesh",
    group: "body",
    status: "running",
    taskId: "task_restart",
  });
  await h.store.save(p);
  const h2 = await harness(t, { root: h.dataDir, providers: mock() });
  const restored = (await h2.call("/projects/" + id)).data;
  assert.equal(restored.jobs[0].status, "paused");
  assert.equal(restored.jobs[0].taskId, "task_restart");
  assert.equal((await h2.call("/connections")).data.tripo.configured, false);
  assert.equal(
    (await h2.call(`/projects/${id}/jobs/pending/resume`, {})).status,
    409,
  );
});

test('native FBX asset links return their original bytes while private and unsupported files stay inaccessible',async t=>{
 const h=await harness(t),{data:p}=await h.call('/projects',{name:'Native quad download'});
 const bytes=Buffer.from('; FBX 7.4.0 project file\nObjects: {}\n');
 const asset=await h.store.asset(h.store.get(p.id),bytes,'fbx','Tripo native source');
 const response=await fetch(h.base+asset.url);
 assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
 for(const ext of ['json','zip','js'])assert.equal((await fetch(h.base+asset.url.replace(/\.fbx$/,'.'+ext))).status,404);
 assert.equal((await fetch(h.base+asset.url.replace(asset.id,'..%2Fproject.json'))).status,404);
});

test("GLB import, local protection and demo cannot spend credits", async (t) => {
  const h = await harness(t, { providers: mock() });
  const { data: p } = await h.call("/projects", { name: "Import" });
  assert.equal(
    (await h.upload(p.id, "model", null, Buffer.from("not a glb"), "bad.glb"))
      .status,
    400,
  );
  const next = (await h.upload(p.id, "model", null, glb, "modelo.glb")).data;
  assert.equal(next.models[0].source, "importado");
  assert.equal(
    (
      await h.call("/projects", { name: "Forbidden" }, "POST", {
        "x-workbench-token": "",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await h.call("/projects", { name: "Forbidden" }, "POST", {
        Origin: "https://evil.example",
      })
    ).status,
    403,
  );
  assert.equal((await fetch(h.base + "/files/" + p.id + ".json")).status, 404);
  assert.equal(
    (await fetch(h.base + "/files/" + p.id + "/../../../package.json")).status,
    404,
  );
  const demo = (await h.call("/demo", {})).data;
  assert.equal(demo.demo, true);
  assert.equal(demo.models[0].source, "demo procedural");
  await h.call("/connections/tripo", { key: "test-only-secret" });
  assert.equal(
    (
      await h.call(`/projects/${demo.id}/quote`, {
        type: "mesh",
        group: "body",
      })
    ).status,
    409,
  );
});

test("Official adapter wire contract and credentials remain server-side (mock transport)", async () => {
  const seen = [];
  const fetcher = async (url, options) => {
    seen.push({ url, options });
    if (url.endsWith("/models"))
      return Response.json({ data: [{ id: "gpt-image-2" }] });
    if (url.endsWith("/account/balance"))
      return Response.json({ code: 0, data: { balance: 30, frozen: 0 } });
    if (url.endsWith("/images/edits"))
      return Response.json({
        data: [{ b64_json: fixture.toString("base64") }],
      });
    if (url.endsWith("/files"))
      return Response.json({ code: 0, data: { file_token: "file_mock" } });
    if (url.endsWith("/multiview-to-model"))
      return Response.json({ code: 0, data: { task_id: "task_mock" } });
    return Response.json({
      code: 0,
      data: { status: "success", progress: 100 },
    });
  };
  const api = createProviders(fetcher);
  assert.equal(
    (await api.verify("openai", "test-secret")).imageModelListed,
    true,
  );
  assert.equal((await api.verify("tripo", "test-secret")).balance, 30);
  assert.deepEqual(
    (await api.image("test-secret", [fixture], "Prompt")).buffer,
    fixture,
  );
  assert.equal(await api.upload("test-secret", fixture), "file_mock");
  assert.equal(
    await api.mesh("test-secret", [
      { front: "file_mock" },
      { back: "file_mock2" },
    ]),
    "task_mock",
  );
  await api.task("test-secret", "task_mock");
  const body = JSON.parse(
    seen.find((x) => x.url.endsWith("/images/edits")).options.body,
  );
  assert.equal(body.model, "gpt-image-2");
  assert.equal(
    body.images[0].image_url.startsWith("data:image/png;base64,"),
    true,
  );
  const meshBody = JSON.parse(
    seen.find((x) => x.url.endsWith("/multiview-to-model")).options.body,
  );
  assert.equal(meshBody.model, "v3.1-20260211");
  assert.equal(meshBody.texture, true);
  assert.equal(
    seen.every((x) => x.options.headers.Authorization === "Bearer test-secret"),
    true,
  );
  await assert.rejects(() => api.download("http://127.0.0.1/private"));
  const bad = createProviders(async () =>
    Response.json(
      { error: { code: "invalid_api_key", message: "secret" } },
      { status: 401 },
    ),
  );
  await assert.rejects(
    () => bad.verify("openai", "test-secret"),
    /Clave inválida/,
  );
  assert.doesNotThrow(() => glbBuffer(glb));
});

test('Reference confirmation is explicit and technical; upload never approves or enables image generation',async t=>{
 const h=await harness(t,{providers:mock()});const {data:p}=await h.call('/projects',{name:'Confirmación explícita'});
 assert.equal(p.reference,null);assert.deepEqual(p.models,[]);assert.equal(p.groups.head.approved,false);assert.equal(p.groups.body.approved,false);
 await h.call('/connections/openai',{key:'test-only-secret'});
 let n=(await h.upload(p.id,'reference')).data;assert.equal(n.referenceState.status,'pending');assert.equal(n.groups.head.approved,false);
 assert.equal((await h.call(`/projects/${p.id}/quote`,{type:'image',group:'head',view:'front'})).status,409);
 for(const v of ['front','right','back'])await h.upload(p.id,'head',v);
 assert.equal((await h.call(`/projects/${p.id}/approve`,{group:'head',approved:true})).status,409);
 n=(await h.call(`/projects/${p.id}/confirm-reference`,{})).data;
 assert.equal(n.referenceState.status,'ready');assert.equal(n.referenceState.validation.width,500);assert.equal(n.referenceState.validation.height,600);assert.equal(n.referenceState.validation.decoded,true);assert.equal(n.groups.head.approved,false);assert.equal(n.groups.body.approved,false);
 assert.equal((await h.call(`/projects/${p.id}/quote`,{type:'image',group:'head',view:'front'})).status,200);
 assert.equal((await h.call(`/projects/${p.id}/approve`,{group:'head',approved:true})).status,200);
});

test('Regression: replacing an approved demo reference removes current eligibility without deleting any old file',async t=>{
 const h=await harness(t,{providers:mock()});let p=(await h.call('/demo',{})).data;const id=p.id,oldReference=p.reference,oldModel=p.models[0],oldView=p.groups.head.views.front;
 assert.equal(p.referenceState.status,'pending');assert.equal(p.groups.head.approved,false);assert.equal(p.models[0].current,false);
 await h.call(`/projects/${id}/confirm-reference`,{});for(const g of ['head','body'])await h.call(`/projects/${id}/approve`,{group:g,approved:true});
 p=(await h.upload(id,'reference')).data;assert.equal(p.demo,false);assert.equal(p.referenceState.status,'pending');assert.equal(p.groups.head.approved,false);assert.equal(p.groups.body.approved,false);assert.deepEqual(p.groups.head.views,{});assert.deepEqual(p.groups.body.views,{});assert.equal(p.models.length,1);assert.equal(p.models[0].current,false);assert.equal(p.models[0].source,'demo procedural');assert.equal(p.referenceHistory.at(-1).reference.id,oldReference.id);
 for(const file of [oldReference,oldModel,oldView])assert.equal((await fetch(h.base+file.url)).status,200);
 await h.call('/connections/tripo',{key:'test-only-secret'});assert.equal((await h.call(`/projects/${id}/quote`,{type:'mesh',group:'body'})).status,409);
 await h.call(`/projects/${id}/confirm-reference`,{});assert.equal((await h.call(`/projects/${id}/quote`,{type:'mesh',group:'body'})).status,409);
 const summary=(await h.call('/projects')).data.find(x=>x.id===id);assert.equal(summary.models,0);assert.equal(summary.approved,0);
});

test('Derived model lineage is invalidated by view replacement, notes and new concept',async t=>{
 const h=await harness(t,{providers:mock()});const id=await ready(h);await h.call('/connections/tripo',{key:'test-only-secret'});
 let q=(await h.call(`/projects/${id}/quote`,{type:'mesh',group:'body'})).data;await h.call(`/projects/${id}/generate`,{quoteId:q.id,confirmPaid:true});let p=await waitJob(h,id);assert.equal(p.models[0].current,true);assert.equal(p.models[0].lineage.referenceId,p.reference.id);assert.equal(p.models[0].lineage.views.body.length,3);
 await h.call(`/projects/${id}/approve`,{group:'head',approved:false});p=(await h.upload(id,'head','front',viewFixtures['head-front'])).data;assert.equal(p.models[0].current,true,'Changing head keeps the separate body model current');assert.equal(p.groups.body.approved,true);assert.equal(p.groups.head.approved,false);
 assert.equal((await h.call(`/projects/${id}/quote`,{type:'mesh',group:'body'})).status,409);
 await h.call(`/projects/${id}/approve`,{group:'head',approved:true});p=(await h.call(`/projects/${id}`,{notes:'Nueva silueta de cabello'},'PATCH')).data;assert.equal(p.groups.head.approved,false);assert.equal(p.groups.body.approved,false);assert.equal(Object.keys(p.groups.head.views).length,3);assert.equal(p.models[0].current,false);
 for(const g of ['head','body'])await h.call(`/projects/${id}/approve`,{group:g,approved:true});p=(await h.call('/projects/'+id)).data;assert.equal(p.models[0].current,false);
 const corrupted=h.store.get(id);corrupted.groups.head.views.front.referenceId='different-reference';corrupted.groups.head.approved=true;assert.equal((await h.call(`/projects/${id}/quote`,{type:'mesh',group:'body'})).status,409);assert.equal((await h.call(`/projects/${id}/approve`,{group:'head',approved:true})).status,409);
});

test('Technical reference validation detects corrupted saved pixels and migration does not invent consent',async t=>{
 const h=await harness(t);let p=(await h.call('/projects',{name:'Legacy'})).data;await h.upload(p.id,'reference');p=h.store.get(p.id);
 const source=p.reference.id;await fs.writeFile(path.join(h.dataDir,p.id,source),'corrupt');assert.equal((await h.call(`/projects/${p.id}/confirm-reference`,{})).status,400);assert.equal((await h.call('/projects/'+p.id)).data.referenceState.status,'invalid');
 await h.upload(p.id,'reference');p=h.store.get(p.id);delete p.schemaVersion;p.groups.head.approved=true;p.models.push({id:'legacy.glb',source:'demo procedural'});await h.store.save(p);
 const h2=await harness(t,{root:h.dataDir});const migrated=(await h2.call('/projects/'+p.id)).data;assert.equal(migrated.reference.id,p.reference.id);assert.equal(migrated.schemaVersion,2);assert.equal(migrated.referenceState.status,'pending');assert.equal(migrated.groups.head.approved,false);assert.equal(migrated.models[0].current,false);assert.equal(migrated.legacyState.approvals.head,true);
});

test('Combined view review blocks missing/duplicate/stale sets and prepares Studio without any paid submission',async t=>{
  const provider = mock();
  const paidCalls = [];
  for (const operation of ['image','upload','mesh','task','download']) {
    const original = provider[operation];
    provider[operation] = async (...args) => { paidCalls.push(operation);return original(...args); };
  }
  const h = await harness(t,{providers:provider});
  const id = (await h.call('/projects',{name:'Combined review integration'})).data.id;
  await h.upload(id,'reference');
  await h.call(`/projects/${id}/confirm-reference`,{});
  await h.call('/connections/tripo',{key:'test-only-secret'});
  const meshQuote = () => h.call(`/projects/${id}/quote`,{type:'mesh',group:'body'});
  const prepareStudio = () => h.call(`/projects/${id}/studio-preparation`,{});

  let checked = await h.call(`/projects/${id}/validate-view-set`,{});
  assert.equal(checked.status,200);
  assert.equal(checked.data.viewSetValidation.technicalValid,false);
  assert(checked.data.viewSetValidation.items.every(item=>item.reasonCode==='missing_view'));
  assert.equal((await h.call(`/projects/${id}/review-view-set`,{
    reportId:checked.data.viewSetValidation.id,approved:true,
  })).status,409);
  assert.equal((await meshQuote()).status,409);
  assert.equal((await prepareStudio()).status,409);

  // Six IDs and six successful uploads are insufficient when they decode to
  // the same picture. A deliberate duplicate set must fail the real endpoint.
  for(const group of ['head','body'])for(const view of ['front','right','back'])
    assert.equal((await h.upload(id,group,view,fixture)).status,200);
  checked = await h.call(`/projects/${id}/validate-view-set`,{});
  assert.equal(checked.data.viewSetValidation.technicalValid,false);
  assert(checked.data.viewSetValidation.items.every(item=>item.reasonCode==='duplicate_view'));
  assert.equal((await h.call(`/projects/${id}/review-view-set`,{
    reportId:checked.data.viewSetValidation.id,approved:true,
  })).status,409);

  for(const group of ['head','body'])for(const view of ['front','right','back'])
    assert.equal((await h.upload(id,group,view,viewFixtures[`${group}-${view}`])).status,200);
  // Legacy per-group approvals remain insufficient for the combined gate.
  for(const group of ['head','body'])
    assert.equal((await h.call(`/projects/${id}/approve`,{group,approved:true})).status,200);
  assert.equal((await meshQuote()).status,409);
  assert.equal((await prepareStudio()).status,409);
  checked = await h.call(`/projects/${id}/validate-view-set`,{});
  const report = checked.data.viewSetValidation;
  assert.equal(report.technicalValid,true);
  assert.equal(report.humanReview,null);
  assert.equal(checked.data.viewSetReady,false);
  assert.equal(checked.data.validationCurrent,true);
  assert.equal((await meshQuote()).status,409,'Technical validation alone must not enable 3D');
  for(const body of [
    {reportId:report.id,approved:false},
    {reportId:report.id,approved:'true'},
    {reportId:'forged-report',approved:true},
    {approved:true},
  ]) assert.equal((await h.call(`/projects/${id}/review-view-set`,body)).status,409);
  let reviewed = await h.call(`/projects/${id}/review-view-set`,{reportId:report.id,approved:true});
  assert.equal(reviewed.status,200);
  assert.equal(reviewed.data.viewSetReady,true);
  assert.equal(reviewed.data.groups.head.approved,true);
  assert.equal(reviewed.data.groups.body.approved,true);
  assert.equal(reviewed.data.viewSetValidation.humanReview.reportId,report.id);

  const prepared = await prepareStudio();
  assert.equal(prepared.status,200);
  assert.equal(prepared.data.generationAvailable,false);
  assert.equal(prepared.data.reportId,report.id);
  assert.deepEqual(prepared.data.parts.map(part=>part.group),['head','body']);
  assert(prepared.data.parts.every(part=>part.views.length===3));
  const sourceFiles = prepared.data.parts.flatMap(part=>part.views.map(view=>view.url));
  for(const url of sourceFiles)assert.equal((await fetch(h.base+url)).status,200);
  assert.equal((await meshQuote()).status,200,'A quote is reviewable without submitting a job');
  assert.deepEqual(paidCalls,[],'Preparation, validation, review and quotes must not call paid providers');

  // Simulate an edit observed between report production and review, keeping
  // the report object to ensure the fingerprint check itself rejects it.
  h.store.get(id).notesRevision++;
  assert.equal((await h.call(`/projects/${id}/review-view-set`,{reportId:report.id,approved:true})).status,409);
  assert.equal((await prepareStudio()).status,409);
  reviewed = {data:await validateAndReview(h,id)};
  const freshReportId = reviewed.data.viewSetValidation.id;
  const imported = await h.upload(id,'model',null,glb,'independent-model.glb');
  assert.equal(imported.status,200);
  const modelFile = imported.data.models.at(-1).url;
  const noted = await h.call(`/projects/${id}`,{notes:'Keep the new hairstyle'},'PATCH');
  assert.equal(noted.status,200);
  assert.equal(noted.data.viewSetValidation,null);
  assert.equal(noted.data.viewSetReady,false);
  assert.equal(noted.data.groups.head.approved,false);
  assert.equal(noted.data.groups.body.approved,false);
  assert.equal(noted.data.models.at(-1).current,false);
  assert.equal((await h.call(`/projects/${id}/review-view-set`,{reportId:freshReportId,approved:true})).status,409);
  for(const url of [...sourceFiles,modelFile])assert.equal((await fetch(h.base+url)).status,200);
  assert.equal((await meshQuote()).status,409);
  assert.equal((await prepareStudio()).status,409);

  // Reusing these files after new notes requires a fresh report and human
  // review. Replacing a view revokes readiness again and preserves its file.
  let current = await validateAndReview(h,id);
  const oldView = current.groups.head.views.front;
  await h.call(`/projects/${id}/approve`,{group:'head',approved:false});
  const replacedView = await h.upload(id,'head','front',viewFixtures['head-front']);
  assert.equal(replacedView.status,200);
  assert.notEqual(replacedView.data.groups.head.views.front.id,oldView.id);
  assert.equal(replacedView.data.viewSetValidation,null);
  assert.equal(replacedView.data.viewSetReady,false);
  assert.equal(replacedView.data.viewHistory.at(-1).asset.id,oldView.id);
  assert.equal((await fetch(h.base+oldView.url)).status,200);
  assert.equal((await prepareStudio()).status,409);
  current = await validateAndReview(h,id);
  const oldReference = current.reference;
  const newReference = await h.upload(id,'reference');
  assert.equal(newReference.status,200);
  assert.equal(newReference.data.referenceState.status,'pending');
  assert.equal(newReference.data.viewSetValidation,null);
  assert.equal(newReference.data.viewSetReady,false);
  assert.equal(newReference.data.referenceHistory.at(-1).reference.id,oldReference.id);
  assert.equal(newReference.data.models.at(-1).current,false);
  for(const url of [...sourceFiles,oldReference.url,modelFile])assert.equal((await fetch(h.base+url)).status,200);
  assert.equal((await prepareStudio()).status,409);
  assert.deepEqual(paidCalls,[]);
});
