import {modelViewAppearance} from './production-appearance.js';
import {workflowStage,rewindProject} from './workflow-stages.js';
import {poseGuideFiles,tPosePrompt} from './t-pose-guide.js';
import express from "express";
import multer from "multer";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {PRODUCT_NAME,PRODUCT_ID} from '../shared/product.js';
import {localRepairParent,commitLocalRepair} from './local-model-repair.js';
import {generationLimits} from '../shared/generation-profile.js';
import {
  Store,
  emptyProject,
  event,
  fail,
  groups,
  views,
  labels,
} from "./storage.js";
import {
  createProviders,
  cleanError,
  SIWC,
  IMAGE_MODEL,
  MESH_MODEL,
} from "./providers.js";
import { imageBuffer, glbBuffer, inspectReference } from "./validation.js";
import { validateViewSet, fingerprintViewSet, viewSetReady, selectedViews, validationCurrent, validationReport } from "./view-set.js";
import {reviewAllViews,recoverUnchangedReview} from './joint-view-review.js';
import { mountStudioBridge } from "./studio-bridge.js";
import { mountStudioWorkflow } from "./studio-workflow.js";
import {mountTextureWorkflow} from './texture-workflow.js';
import {texturePreviewState} from './texture-preview.js';
import {mountPlacement} from './placement.js';
import {mountPlacementHandoff} from './placement-handoff.js';
import {mountRigging} from './rigging.js';
import {mountProjectArchive,freeSpace} from './project-archive.js';
import {mountProjectCleanup} from './project-cleanup.js';
import {mountCodexHandoff,extraReferenceLimit} from './codex-handoff.js';
import {createCodexDelivery} from './codex-delivery.js';
import {mountTextureAtlasAdjustment} from './texture-atlas-adjustment.js';
import {createSegmentation} from './segmentation.js';
import {createTextureSupervisor} from './texture-supervisor.js';
import {createTextureRefinement} from './texture-refinement.js';
import {
  referenceReady,
  completeCurrentViews,
  approvedCurrent,
  revokeApprovals,
  invalidateModels,
  viewIds,
  snapshot,
  present,
  modelCurrent,
} from "./lineage.js";

export async function createApp({
  dataDir,
  bridgeDevicesFile = null,
  projectArchiveOptions = {},
  projectCleanupOptions = {},
  providers = createProviders(),
  pollMs = 5000,
  demoDir = path.resolve("fixtures"),
  codexDeliveryOptions = {},
  segmentationOptions = {},
  distribution = null,
} = {}) {
  const app = express(),
    store = new Store(dataDir);
  await store.init();
  const csrf = randomBytes(32).toString("hex"),
    secrets = { openai: null, tripo: null },
    connections = {},
    quotes = new Map(),
    active = new Set();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 150 * 1024 * 1024, files: 1, fields: 5 },
  });
  app.disable("x-powered-by");
  // Remembered browsers live outside data/: every .json there is read as a project.
  const bridge = mountStudioBridge(app, { csrf, devicesFile: bridgeDevicesFile ?? null });
  const placementDeliveryRouter=express.Router();app.use('/api/placement-deliveries',placementDeliveryRouter);
  const codexDelivery=await createCodexDelivery({store,editable,...codexDeliveryOptions});
  app.use('/api/codex-deliveries',codexDelivery.router);
  const segmentation=await createSegmentation({store,editable,gate,presentProject,bridge,...segmentationOptions});
  app.use('/api/segmentation-deliveries',segmentation.delivery.router);
  app.use('/api/segment-references-deliveries',segmentation.references.router);
  const refinement=await createTextureRefinement({store,ensure:p=>{editable(p);if(segmentation.isBusy(p.id)||(p.textureOperations||[]).some(o=>['queued','running'].includes(o.status)))fail('SEG_BUSY',409);}});
  app.use('/api/texture-refinement-deliveries',refinement.delivery.router);
  const textureSupervisor=await createTextureSupervisor({store,segmentation,refinement,baseUrl:segmentationOptions.deliveryOptions?.baseUrl});
  segmentation.setSupervisor(textureSupervisor);app.use('/api/texture-supervisors',textureSupervisor.router);
  app.use((req, res, next) => {
    const host = req.headers.host || "";
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host))
      return res.status(403).json({ error: "Solo se acepta acceso local." });
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    });
    if (req.headers.origin && req.headers.origin !== `http://${host}`)
      return res.status(403).json({ error: "Origen no permitido." });
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers["x-workbench-token"] !== csrf
    )
      return res
        .status(403)
        .json({ error: "Sesión local inválida. Recarga la página." });
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.get("/api/session", (req, res) => res.json({ token: csrf }));
  app.get("/api/health", (req, res) =>
    res.json({ ok: true, local: true, app: PRODUCT_ID, name: PRODUCT_NAME }),
  );
  function status() {
    return {
      siwc: SIWC,
      openai: { configured: !!secrets.openai, ...connections.openai },
      tripo: { configured: !!secrets.tripo, ...connections.tripo },
    };
  }
  function editable(p) {
    if(p.rigStudioJobs?.some(j=>['preparing','running'].includes(j.stage)&&bridge.getOperation(j.operationId)))fail('Wait for the Tripo rigging operation before editing the project.',409);
    if (p.studioOperations?.some(o => !o.trackingClosed && (["queued", "running", "unknown"].includes(o.status) || (o.type === "submit" && o.status === "succeeded" && !o.generationComplete))))
      fail("STUDIO_GENERATION_ALREADY_TRACKED", 409);
    if (p.referenceState?.status === "validating")
      fail("Se está validando la referencia. Espera a que termine.", 409);
    if (p.jobs.some((j) => ["queued", "running", "paused"].includes(j.status)))
      fail(
        "Hay una operación en curso o pendiente de resolver. Termínala, reanúdala o cierra su seguimiento antes de cambiar el proyecto.",
        409,
      );
  }
  function groupCheck(g) {
    if (!groups.includes(g)) fail("Grupo inválido.");
  }
  function viewCheck(v) {
    if (!views.includes(v)) fail("Vista inválida.");
  }
  function keyCheck(k) {
    if (!secrets[k] || !connections[k]?.verifiedAt)
      fail(`Conecta y verifica ${k} primero.`, 409);
  }
  function presentProject(p) {
    const value=present(p);
    const preview=texturePreviewState(p),visibleIds=new Set(preview.textures.map(t=>t.id));
    return {...value,workflowStage:workflowStage(p),texturePreviewPending:preview.previewPending,textures:(value.textures||[]).filter(t=>visibleIds.has(t.id)),segmentations:(p.segmentations||[]).map(s=>({id:s.id,createdAt:s.createdAt,approval:s.approval,groupCount:s.groups.length})),groups:Object.fromEntries(groups.map(g=>[g,{...value.groups[g],selectedViews:selectedViews(p,g)}])),
      viewSetReady:viewSetReady(p),viewSetReadyByGroup:Object.fromEntries(groups.map(g=>[g,viewSetReady(p,g)])),
      viewSetFingerprints:Object.fromEntries(groups.map(g=>[g,fingerprintViewSet(p,g)])),
      validationCurrent:validationCurrent(p)};
  }
  function gate(p,group) {
    if(group&&!groups.includes(group))fail('Select head or body.',400);
    if(!viewSetReady(p,group))fail('Validate the selected views and complete the visual review for this part.',409);
    const required=group?[group]:groups.filter(g=>viewSetReady(p,g));
    if(required.some(g=>!approvedCurrent(p,g)))fail('Approve the selected views for this part.',409);
  }
  function apiGate(p,group) {
    gate(p,group);
    if(!['front','right','back'].every(v=>selectedViews(p,group).includes(v)&&p.groups[group].views[v]))
      fail('Advanced Tripo API requires approved front, right profile and back views. Studio selection remains flexible.',409);
  }
  mountStudioWorkflow(app,{store,bridge,editable,gate,presentProject});
  // Save / open whole projects as portable .fita archives (lobby).
  // Free disk space (lobby): never while a save/open runs, nor in a busy project.
  const projectBusy=p=>{
    try{editable(p);}catch{return true;}
    const active=(list,states)=>(list||[]).some(r=>states.includes(r?.status));
    // As for rewind: an old uncertain status check (monitor/observe) never blocks.
    const uncertainSubmit=o=>o.type==='submit'&&o.status==='unknown'&&Date.now()-Date.parse(o.updatedAt||o.createdAt||0)<30*60000;
    return segmentation.isBusy(p.id)||active(p.segmentTextureRuns,['pending','running','attention'])||(p.textureOperations||[]).some(o=>!o.trackingClosed&&(['queued','running'].includes(o.status)||uncertainSubmit(o)))
      ||['placements','riggingRuns','rigRefinements','facialRigRuns','vrchatExports','rigStudioJobs'].some(k=>active(p[k],['queued','running','preparing']));
  };
  let cleanup=null;
  const archive=mountProjectArchive(app,{store,othersBusy:()=>cleanup?.busy()??false,...projectArchiveOptions});
  cleanup=mountProjectCleanup(app,{store,isBusy:projectBusy,othersBusy:archive.busy,measureSpace:projectArchiveOptions.measureSpace||freeSpace,...projectCleanupOptions});
  mountTextureWorkflow(app,{store,bridge,editable,gate,presentProject});
  segmentation.mount(app);
  refinement.mount(app);
  mountTextureAtlasAdjustment(app,{store,editable});
  mountPlacement(app,{store,editable,presentProject});
  const placementHandoff=mountPlacementHandoff(app,{store,editable,presentProject,baseUrl:codexDeliveryOptions.baseUrl});placementDeliveryRouter.use(placementHandoff.router);
  mountRigging(app,{store,editable,bridge});
  mountCodexHandoff(app,{store,upload,editable,presentProject,delivery:codexDelivery});
  app.post('/api/projects/:id/select-model',async(req,res)=>{
    const p=store.get(req.params.id),{group,modelId}=req.body;groupCheck(group);
    const model=p.models.find(m=>m.id===modelId);
    if(!model||model.group!==group||!modelCurrent(p,model))fail('Choose an available model from the current revision of this part.',409);
    const part=p.groups[group];
    if(part.selectedModelId!==model.id){
      part.modelSelectionHistory ||= [];
      if(part.selectedModelId)part.modelSelectionHistory.push({modelId:part.selectedModelId,selectedAt:part.modelSelectedAt});
      part.selectedModelId=model.id;part.modelSelectedAt=new Date().toISOString();
      event(p,'Model choice saved. All other candidates remain available.');
      await store.save(p);
    }
    res.json(presentProject(p));
  });
  app.get("/api/connections", (req, res) => res.json(status()));
  app.post("/api/connections/:kind", async (req, res) => {
    const k = req.params.kind;
    if (!["openai", "tripo"].includes(k)) fail("Conector no disponible.");
    const key = req.body.key;
    if (
      typeof key !== "string" ||
      key.length < 10 ||
      key.length > 512 ||
      /\s/.test(key)
    )
      fail("Introduce una API key válida.");
    if (active.size)
      fail(
        "Espera a que termine la operación activa antes de cambiar credenciales.",
        409,
      );
    connections[k] = {};
    secrets[k] = null;
    try {
      const result = await providers.verify(k, key);
      secrets[k] = key;
      connections[k] = result;
      res.json(status());
    } catch (e) {
      connections[k] = { error: cleanError(e) };
      throw e;
    }
  });
  app.delete("/api/connections/:kind", (req, res) => {
    const k = req.params.kind;
    if (!["openai", "tripo"].includes(k)) fail("Conector inválido.");
    if (active.size) fail("Espera a que termine la operación activa.", 409);
    secrets[k] = null;
    connections[k] = {};
    res.json(status());
  });
  app.get("/api/projects", (req, res) =>
    res.json(
      [...store.projects.values()]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((p) => ({
          id: p.id,
          name: p.name,
          updatedAt: p.updatedAt,
          demo: p.demo,
          reference: p.reference,
          referenceState: p.referenceState,
          approved: groups.filter((g) => approvedCurrent(p, g)).length,
          workflowStage: workflowStage(p),
          models: presentProject(p).models.filter((m) => m.current).length,
          previousModels: p.models.filter(
            (m) => !presentProject(p).models.find((x) => x.id === m.id)?.current,
          ).length,
        })),
    ),
  );
  app.post("/api/projects", async (req, res) => {
    if (typeof req.body.name !== "string") fail("Escribe un nombre.");
    const p = emptyProject(req.body.name);
    event(p, "Proyecto creado. Los archivos se guardan en este equipo.");
    await store.save(p);
    res.status(201).json(p);
  });
  app.get('/api/project-trash',async(req,res)=>res.json(await store.listTrash()));
  app.delete('/api/project-trash/:id',async(req,res)=>{
    if(archive.busy()||cleanup?.busy())fail('FITA_TRASH_DELETE_BUSY',409);
    res.json(await store.purge(req.params.id,{confirm:req.body?.confirm,projectId:req.body?.projectId,busy:projectBusy}));
  });
  app.post('/api/project-trash/:id/restore',async(req,res)=>res.json(presentProject(await store.restore(req.params.id))));
  app.delete('/api/projects/:id',async(req,res)=>{
    const p=store.get(req.params.id);editable(p);
    if(segmentation.isBusy(p.id)||(p.segmentTextureRuns||[]).some(o=>['pending','running','attention'].includes(o.status))||(p.textureOperations||[]).some(o=>!o.trackingClosed&&['queued','running','unknown'].includes(o.status))||(p.placements||[]).some(o=>['queued','running'].includes(o.status)))fail('Finish the active operation before deleting the project.',409);
    res.json(await store.trash(p.id));
  });
  app.get("/api/projects/:id", (req, res) =>
    res.json(presentProject(store.get(req.params.id))),
  );
  app.get("/api/projects/:id/manifest", (req, res) => {
    const p = store.get(req.params.id);
    res.attachment("proyecto.json").json(p);
  });
  app.post('/api/projects/:id/rewind',async(req,res)=>{
    const p=store.get(req.params.id);editable(p);
    // Only work that may still be running blocks a rewind. An uncertain paid
    // texture submission blocks for 30 minutes; an old uncertain status check
    // (monitor/observe) never does, or one stale record locks the project.
    const recentlyUncertain=r=>r.type==='submit'&&r.status==='unknown'&&Date.now()-Date.parse(r.updatedAt||r.createdAt||0)<30*60000;
    if(segmentation.isBusy(p.id)||(p.placements||[]).some(r=>['queued','running'].includes(r.status))||(p.textureOperations||[]).some(r=>!r.trackingClosed&&(['queued','running'].includes(r.status)||recentlyUncertain(r))))fail('WORKFLOW_BUSY',409);
    const {next,archive}=rewindProject(p,req.body),dir=path.join(store.root,p.id,'workflow-history');
    await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,archive.id+'.json'),JSON.stringify(archive));
    if(store.get(p.id)!==p||p.revision!==archive.previous.revision)fail('WORKFLOW_PROJECT_CHANGED',409);
    await store.save(next);res.json(presentProject(next));
  });
  app.patch("/api/projects/:id", async (req, res) => {
    const p = store.get(req.params.id);
    editable(p);
    if (req.body.name !== undefined) {
      if (typeof req.body.name !== "string" || !req.body.name.trim())
        fail("El nombre no puede estar vacío.");
      p.name = req.body.name.trim().slice(0, 80);
    }
    if (req.body.notes !== undefined) {
      if (typeof req.body.notes !== "string") fail("Notas inválidas.");
      const notes = req.body.notes.slice(0, 3000);
      if (notes !== p.notes) {
        p.notesRevision++;
        revokeApprovals(
          p,
          "Las notas de dirección cambiaron. Revisa las vistas antes de aprobar otra vez.",
        );
        p.notes = notes;
        event(
          p,
          "Notas actualizadas. Se revocaron las aprobaciones y los modelos anteriores dejaron de ser vigentes.",
        );
      }
    }
    p.revision++;
    await store.save(p);
    res.json(presentProject(p));
  });
  app.post("/api/projects/:id/confirm-reference", async (req, res) => {
    const p = store.get(req.params.id);
    editable(p);
    if (!p.reference) fail("Carga una imagen antes de confirmarla.");
    const referenceId = p.reference.id;
    p.referenceState = { status: "validating", referenceId };
    await store.save(p);
    try {
      const checks = await inspectReference(await store.read(p, p.reference));
      p.referenceState = {
        status: "ready",
        referenceId,
        confirmedAt: new Date().toISOString(),
        validation: checks,
      };
      event(
        p,
        `Referencia confirmada y validada: ${checks.width} × ${checks.height} px, ${checks.format.toUpperCase()}. Sin evaluación artística por IA.`,
      );
      await store.save(p);
      res.json(presentProject(p));
    } catch (e) {
      p.referenceState = {
        status: "invalid",
        referenceId,
        error:
          "No se pudo validar el archivo. Vuelve a cargar una imagen PNG, JPG o WebP válida.",
      };
      revokeApprovals(p, "La referencia no superó la validación técnica.");
      await store.save(p);
      fail(p.referenceState.error, 400);
    }
  });
  app.post(
    "/api/projects/:id/upload",
    upload.single("file"),
    async (req, res) => {
      const p = store.get(req.params.id);
      editable(p);
      const revision = p.revision;
      function stillEditable() {
        editable(p);
        if (p.revision !== revision)
          fail(
            "El proyecto cambió durante la carga. Revisa la etapa y vuelve a importar.",
            409,
          );
      }
      if (!req.file) fail("Selecciona un archivo.");
      const kind = req.body.kind;
      let asset;
      if (kind === "model") {
        const repairParent=localRepairParent(p,req.body);
        if(repairParent&&segmentation.isBusy(p.id))fail('SEG_BUSY',409);
        const b = glbBuffer(req.file.buffer);
        asset = await store.asset(p, b, "glb", "importado");
        stillEditable();
        if(repairParent)localRepairParent(p,req.body);
        const model={
          ...asset,
          label: req.file.originalname.slice(0, 100),
          group: repairParent?req.body.part:"imported",
          ...(repairParent?{parentModelId:repairParent.id,localRepair:{scope:String(req.body.repairScope||'Local geometry correction').slice(0,300),createdAt:new Date().toISOString()}}:{}),
          revision: p.revision,
          lineage: snapshot(p),
          obsolete: !p.reference,
          obsoleteReason: !p.reference
            ? "Importado sin referencia vinculada."
            : "",
        };
        if(repairParent){
          let next;
          try{
            next=await commitLocalRepair({project:p,store,model,input:req.body,check:()=>{stillEditable();if(segmentation.isBusy(p.id))fail('SEG_BUSY',409);}});
          }catch(e){await fs.unlink(path.join(store.root,p.id,asset.id)).catch(()=>{});throw e;}
          return res.json(presentProject(next));
        }
        p.models.push(model);
        event(p,"Modelo GLB importado. No es un resultado de generación.");
      } else if (kind === "extra-reference") {
        // Extra images of the same character (DIS-001 v06). Support only: they never
        // replace the main reference, revoke approvals or change the confirmed concept.
        if (!p.reference) fail("Carga primero una referencia.");
        if ((p.extraReferences || []).length >= extraReferenceLimit) fail("You can add up to 4 extra images.", 409);
        const b = await imageBuffer(req.file.buffer);
        asset = await store.asset(p, b, "png", "importado");
        stillEditable();
        p.extraReferences = [...(p.extraReferences || []), { ...asset, label: req.file.originalname.slice(0, 100), addedAt: new Date().toISOString() }];
        event(p, "Imagen adicional del concepto añadida.");
        p.revision++;
      } else {
        if (kind !== "reference") {
          groupCheck(kind);
          viewCheck(req.body.view);
          if (p.groups[kind].approved)
            fail(
              "Abre la revisión del grupo antes de sustituir una vista.",
              409,
            );
        }
        const b = await imageBuffer(req.file.buffer);
        asset = await store.asset(p, b, "png", "importado");
        stillEditable();
        if (kind === "reference") {
          if (p.reference) {
            p.referenceHistory = [
              ...(p.referenceHistory || []),
              { reference: p.reference, groups: structuredClone(p.groups) },
            ];
          }
          p.reference = asset;
          p.demo = false;
          p.referenceRevision++;
          p.referenceState = { status: "pending", referenceId: asset.id };
          invalidateModels(
            p,
            "La referencia cambió. Este resultado pertenece a un concepto anterior.",
          );
          for (const g of groups) p.groups[g] = { views: {}, approved: false };
          event(
            p,
            "Imagen cargada, pendiente de confirmar. Cabeza y cuerpo aún no están aprobados.",
          );
        } else {
          const previous = p.groups[kind].views[req.body.view];
          if (previous)
            p.viewHistory = [
              ...(p.viewHistory || []),
              { group: kind, view: req.body.view, asset: previous },
            ];
          p.groups[kind].views[req.body.view] = {
            ...asset,
            referenceId: p.reference?.id || null,
            notesRevision: p.notesRevision,
          };
          revokeApprovals(
            p,
            "Se reemplazó una vista. Es necesaria una nueva aprobación.",
            kind,
          );
          event(p, `${labels[kind]} · ${labels[req.body.view]} importada.`);
        }
        p.revision++;
      }
      await store.save(p);
      res.json(presentProject(p));
    },
  );
  app.delete("/api/projects/:id/extra-references/:assetId", async (req, res) => {
    const p = store.get(req.params.id);
    editable(p);
    const before = (p.extraReferences || []).length;
    p.extraReferences = (p.extraReferences || []).filter((a) => a.id !== req.params.assetId);
    if (p.extraReferences.length === before) fail("Imagen no encontrada.", 404);
    event(p, "Imagen adicional del concepto retirada.");
    p.revision++;
    await store.save(p);
    res.json(presentProject(p));
  });
  app.post("/api/projects/:id/approve", async (req, res) => {
    const p = store.get(req.params.id);
    editable(p);
    const g = req.body.group;
    groupCheck(g);
    if (!p.reference) fail("Carga primero una referencia.");
    if (!referenceReady(p))
      fail("Confirma y valida la referencia antes de aprobar vistas.", 409);
    if (req.body.approved !== true && req.body.approved !== false)
      fail("Decisión inválida.");
    if (req.body.approved && !completeCurrentViews(p, g))
      fail(
        "Select at least one current view to approve this part.",
        409,
      );
    if (req.body.approved) {
      p.groups[g].approval = {
        id: randomUUID(),
        at: new Date().toISOString(),
        referenceId: p.reference.id,
        notesRevision: p.notesRevision,
        viewIds: viewIds(p, g),
      };
      p.groups[g].approved = true;
      p.groups[g].reviewReason = null;
    } else
      revokeApprovals(
        p,
        "Se reabrió la revisión de " + labels[g].toLowerCase() + ".",
        g,
      );
    p.revision++;
    event(
      p,
      `${labels[g]}: ${req.body.approved ? "vistas aprobadas por el usuario" : "revisión reabierta"}.`,
    );
    await store.save(p);
    res.json(presentProject(p));
  });
  app.post('/api/projects/:id/recover-reviewed-views',async(req,res)=>{
    const p=store.get(req.params.id);editable(p);const next=recoverUnchangedReview(p);
    await store.save(next);res.json(presentProject(next));
  });
  app.post('/api/projects/:id/review-views',async(req,res)=>{
    const p=store.get(req.params.id);editable(p);const revision=p.revision;
    const next=await reviewAllViews(p,a=>store.read(p,a),req.body.approved);
    if(store.get(p.id)!==p||p.revision!==revision)fail('The views changed during validation. Review them again.',409);
    editable(p);event(next,req.body.approved?'Head and body views approved together.':'View review reopened.');
    await store.save(next);res.json(presentProject(next));
  });
  app.post('/api/projects/:id/view-selection',async(req,res)=>{
    const p=store.get(req.params.id);editable(p);const group=req.body.group;groupCheck(group);
    const requested=req.body.views;
    if(!Array.isArray(requested)||requested.length>4||new Set(requested).size!==requested.length||requested.some(v=>!views.includes(v)))fail('Select between zero and four distinct view slots.',400);
    const next=views.filter(v=>requested.includes(v));
    if(JSON.stringify(next)!==JSON.stringify(selectedViews(p,group))){
      revokeApprovals(p,'View selection changed. Review the selected images again.',group);p.revision++;
      event(p,'View selection updated. Existing images remain saved.');
    }
    p.groups[group].selectedViews=next;
    await store.save(p);res.json(presentProject(p));
  });
  app.post('/api/projects/:id/validate-view-set',async(req,res)=>{
    const p=store.get(req.params.id);editable(p);const group=req.body.group;
    if(group!==undefined)groupCheck(group);
    const report=await validateViewSet(p,a=>store.read(p,a),group);
    if(report.fingerprint!==fingerprintViewSet(p,group))fail('The views changed during validation. Run Next again.',409);
    if(p.viewSetValidation){p.viewSetValidationHistory ||= [];if(!p.viewSetValidationHistory.some(old=>old.id===p.viewSetValidation.id))p.viewSetValidationHistory.push(structuredClone(p.viewSetValidation));}
    p.viewSetValidation=report;
    if(group){p.viewSetValidations ||= {};p.viewSetValidations[group]=report;}
    event(p,report.technicalValid?'Selected files passed technical validation. Visual review is still required.':'The view set needs corrections. Read the validation report.');
    await store.save(p);res.json(presentProject(p));
  });
  app.post('/api/projects/:id/review-view-set',async(req,res)=>{
    const p=store.get(req.params.id);editable(p);
    const report=[p.viewSetValidation,...Object.values(p.viewSetValidations||{})].find(r=>r?.id===req.body.reportId);
    if(!report||req.body.approved!==true)fail('Confirm the visual review of the current report.',409);
    const review={approved:true,reportId:report.id,fingerprint:report.fingerprint,at:new Date().toISOString()};
    const candidate={...report,humanReview:review},check={...p,viewSetValidation:candidate,viewSetValidations:{...p.viewSetValidations,...(report.group?{[report.group]:candidate}:{})}};
    if(!(report.group?viewSetReady(check,report.group):groups.every(g=>viewSetReady(check,g))))fail('The report is invalid or outdated. Run Next again.',409);
    report.humanReview=review;p.viewSetValidation=report;
    for(const g of report.group?[report.group]:groups){p.groups[g].approval={id:randomUUID(),at:review.at,referenceId:p.reference.id,notesRevision:p.notesRevision,viewIds:viewIds(p,g)};p.groups[g].approved=true;p.groups[g].reviewReason=null;}
    p.revision++;event(p,'Visual review confirmed. The selected part is ready for 3D.');
    await store.save(p);res.json(presentProject(p));
  });
  app.post('/api/projects/:id/studio-preparation',(req,res)=>{
    const p=store.get(req.params.id),group=req.body.group;gate(p,group);
    const targets=group?[group]:groups.filter(g=>viewSetReady(p,g));
    res.json({reportId:validationReport(p,targets[0])?.id,generationAvailable:false,parts:targets.map(g=>({group:g,views:selectedViews(p,g).map(view=>({view,assetId:p.groups[g].views[view].id,url:p.groups[g].views[view].url}))})),message:'Preparation metadata only. No files were sent and no credits were used.'});
  });
  app.post("/api/projects/:id/quote", (req, res) => {
    const p = store.get(req.params.id);
    editable(p);
    if (p.demo)
      fail(
        "La demostración no permite envíos de pago. Crea un proyecto con tu referencia.",
        409,
      );
    if (!p.reference) fail("Carga una referencia primero.");
    if (!referenceReady(p))
      fail("Confirma y valida la referencia antes de generar.", 409);
    const { type, group, view } = req.body;
    groupCheck(group);
    if (type === "image") {
      keyCheck("openai");
      viewCheck(view);
      if (p.groups[group].approved)
        fail("Reabre el grupo para regenerarlo.", 409);
    } else if (type === "mesh") {
      keyCheck("tripo");
      apiGate(p,group);
    } else fail("Operación no disponible.");
    const faceLimit=type==='mesh'?generationLimits(group)[p.jobs.filter(j=>j.type==='mesh'&&j.group===group&&j.lineage?.notesRevision===p.notesRevision&&j.lineage?.referenceId===p.reference.id&&JSON.stringify(j.lineage?.views?.[group])===JSON.stringify(viewIds(p,group))).length%4]:null;
    const q = {
      id: randomUUID(),
      projectId: p.id,
      revision: p.revision,
      type,
      group,
      view: type === "image" ? view : null,
      expiresAt: Date.now() + 300000,
      provider: type === "image" ? "openai" : "tripo",
      model: type === "image" ? IMAGE_MODEL : MESH_MODEL,
      ...(type==='mesh'?{faceLimit}:{}),
      summary:
        type === "image"
          ? `Crear una imagen de ${labels[group].toLowerCase()} · ${labels[view]}. Se enviará el concepto y las vistas de apoyo disponibles a OpenAI.`
          : `Crear un modelo de ${labels[group].toLowerCase()} con las tres vistas aprobadas. Objetivo: ${faceLimit} polígonos. Se subirán esas imágenes a Tripo.`,
      cost:
        type === "image"
          ? "1 imagen 1024 × 1024, calidad media. Cobro de OpenAI API por uso; importe variable según entrada/salida. Tu plan de ChatGPT no lo cubre."
          : "Estimación: 30 créditos de Tripo API (H v3.1, textura estándar y PBR). El saldo y el cargo final dependen de tu cuenta; sin rig ni conversiones adicionales.",
    };
    quotes.set(q.id, q);
    res.json(q);
  });
  async function commit(p, j, message) {
    j.message = message;
    event(p, message);
    await store.save(p);
  }
  async function poll(p, j) {
    const key = secrets.tripo;
    if (!key) fail("Vuelve a conectar Tripo para consultar esta tarea.", 409);
    const d = await providers.task(key, j.taskId);
    j.progress = Number.isFinite(d.progress)
      ? Math.max(0, Math.min(100, d.progress))
      : 0;
    if (d.status === "success") {
      j.credits = d.credits_consumed ?? null;
      await commit(p, j, "Tripo terminó. Descargando el GLB al proyecto…");
      if (!d.output?.model_url)
        throw new Error(
          "La tarea terminó sin model_url. Conservamos el task_id para consultarla otra vez.",
        );
      const b = glbBuffer(await providers.download(d.output.model_url));
      const a = await store.asset(p, b, "glb", "Tripo API");
      p.models.push({
        ...a,
        group: j.group,
        label: labels[j.group] + " · Tripo",
        revision: j.revision,
        taskId: j.taskId,
        credits: j.credits,
        lineage: j.lineage,
      });
      j.status = "success";
      j.progress = 100;
      await commit(
        p,
        j,
        `Modelo guardado. Créditos facturados: ${j.credits ?? "no informados"}.`,
      );
      return true;
    }
    if (["failed", "cancelled", "banned", "expired"].includes(d.status)) {
      j.status = "failed";
      await commit(
        p,
        j,
        `Tripo: ${d.status}${d.error_code ? " · código " + d.error_code : ""}. Revisa la tarea en tu consola antes de generar otra.`,
      );
      return true;
    }
    if (!["queued", "running"].includes(d.status))
      throw new Error(
        "Estado de Tripo desconocido. Se conserva la tarea para reanudar consulta.",
      );
    j.status = "running";
    j.message = `Tripo: ${d.status === "queued" ? "en cola" : "generando"} · ${j.progress}%`;
    await store.save(p);
    return false;
  }
  async function runMesh(p, j, resume = false) {
    active.add(j.id);
    try {
      keyCheck("tripo");
      j.status = "running";
      if (!resume) {
        const inputs = [];
        for (const v of ["front","right","back"]) {
          await commit(
            p,
            j,
            `Subiendo ${labels[j.group].toLowerCase()} · ${labels[v]} a Tripo…`,
          );
          const token = await providers.upload(
            secrets.tripo,
            await store.read(p, p.groups[j.group].views[v]),
          );
          inputs.push({ [v]: token });
        }
        await commit(p, j, "Enviando una solicitud de generación a Tripo…");
        j.taskId = await providers.mesh(secrets.tripo, inputs,{faceLimit:j.faceLimit||generationLimits(j.group)[0]});
        await commit(p, j, `Tarea aceptada por Tripo: ${j.taskId}`);
      }
      const deadline = Date.now() + 45 * 60000;
      while (Date.now() < deadline) {
        if (await poll(p, j)) return;
        await new Promise((r) => setTimeout(r, pollMs));
      }
      throw new Error(
        "Se pausó el seguimiento después de 45 minutos. Reanuda la misma tarea sin volver a pagar.",
      );
    } catch (e) {
      j.status = j.taskId ? "paused" : "failed";
      j.message = cleanError(e);
      event(p, j.message, "error");
      await store.save(p);
    } finally {
      active.delete(j.id);
    }
  }
  async function runImage(p, j) {
    active.add(j.id);
    try {
      j.status = "running";
      await commit(
        p,
        j,
        `Preparando referencia para ${labels[j.group]} · ${labels[j.view]}…`,
      );
      const refs = [await store.read(p, p.reference)];
      const front = p.groups[j.group].views.front;
      if (j.view !== "front" && front) refs.push(await store.read(p, front));
      if (j.group === "body" && p.groups.head.approved)
        refs.push(await store.read(p, p.groups.head.views.front));
      if(j.group==='body'){
        const guides=await poseGuideFiles();
        refs.push(guides['POSE_T_FRENTE.png']);
      }
      const prompt = `Create one consistent production reference of the same anime character shown in the first image. Preserve identity, costume, palette, proportions and accessories. Other images are supporting approved/front references. Show ONLY ONE view: ${j.view === "front" ? "orthographic FRONT" : j.view === "back" ? "orthographic BACK" : j.view === "left" ? "orthographic anatomical LEFT SIDE profile" : "orthographic anatomical RIGHT SIDE profile"}. ${j.group === "head" ? "Head WITH complete hairstyle and head accessories, WITHOUT neck, shoulders or torso. Neutral expression, closed mouth, eyes looking naturally in the direction of the face. Entire hairstyle inside frame." : "Complete body WITH neck, full outfit and accessories, WITHOUT head or hair. Symmetrical T-pose, straight arms extended horizontally, straight legs and parallel feet. Neck to soles, hands and feet fully visible, clean neck join without injury."} Neutral white background, centered, flat even lighting, no text, labels, collage, perspective or extra characters. Do not add rigging. User design notes: ${p.notes}`;
      const controlledPrompt=prompt+'\n'+modelViewAppearance+(j.group==='body'?`\nThe LAST input image is a schematic POSE-ONLY guide. ${tPosePrompt}`:'');
      j.prompt = controlledPrompt;
      await commit(
        p,
        j,
        "OpenAI está creando la imagen. El proveedor no informa porcentaje para esta solicitud.",
      );
      const result = await providers.image(secrets.openai, refs, controlledPrompt);
      const b = await imageBuffer(result.buffer);
      const previous = p.groups[j.group].views[j.view];
      if (previous) {
        p.viewHistory = [
          ...(p.viewHistory || []),
          { group: j.group, view: j.view, asset: previous },
        ];
      }
      p.groups[j.group].views[j.view] = {
        ...(await store.asset(p, b, "png", "OpenAI API")),
        referenceId: p.reference.id,
        notesRevision: p.notesRevision,
      };
      revokeApprovals(
        p,
        "Se regeneró una vista. Es necesaria una nueva aprobación.",
        j.group,
      );
      p.revision++;
      j.status = "success";
      j.progress = 100;
      j.usage = result.usage;
      await commit(
        p,
        j,
        "Vista lista para revisión. Comprueba identidad y coherencia antes de aprobar.",
      );
    } catch (e) {
      j.status = "failed";
      j.message = cleanError(e);
      event(p, j.message, "error");
      await store.save(p);
    } finally {
      active.delete(j.id);
    }
  }
  app.post("/api/projects/:id/generate", async (req, res) => {
    const p = store.get(req.params.id);
    editable(p);
    if (active.size)
      fail("Hay otra generación en curso. Espera a que termine.", 409);
    const q = quotes.get(req.body.quoteId);
    if (
      !q ||
      q.projectId !== p.id ||
      q.expiresAt < Date.now() ||
      q.revision !== p.revision
    )
      fail(
        "La revisión cambió o la confirmación venció. Revisa la operación otra vez.",
        409,
      );
    if (req.body.confirmPaid !== true)
      fail("Se requiere confirmar el envío y su costo.", 409);
    keyCheck(q.provider);
    if (!referenceReady(p))
      fail("Confirma y valida la referencia antes de generar.", 409);
    if (q.type === "mesh") apiGate(p,q.group);
    quotes.delete(q.id);
    const j = {
      id: randomUUID(),
      type: q.type,
      group: q.group,
      view: q.view,
      revision: p.revision,
      status: "queued",
      progress: 0,
      message: "Operación preparada",
      createdAt: new Date().toISOString(),
      model: q.model,
      ...(q.type==='mesh'?{faceLimit:q.faceLimit}:{}),
      lineage: snapshot(p),
    };
    p.jobs.push(j);
    active.add(j.id);
    await store.save(p);
    res.status(202).json(p);
    if (j.type === "image") void runImage(p, j);
    else void runMesh(p, j);
  });
  app.post("/api/projects/:id/jobs/:jobId/resume", async (req, res) => {
    const p = store.get(req.params.id),
      j = p.jobs.find((x) => x.id === req.params.jobId);
    if (!j || j.status !== "paused" || !j.taskId)
      fail("No hay una tarea de Tripo para reanudar.");
    keyCheck("tripo");
    if (active.size) fail("Espera a la operación activa.", 409);
    j.status = "queued";
    active.add(j.id);
    await store.save(p);
    res.json(p);
    void runMesh(p, j, true);
  });
  app.post("/api/projects/:id/jobs/:jobId/dismiss", async (req, res) => {
    const p = store.get(req.params.id),
      j = p.jobs.find((x) => x.id === req.params.jobId);
    if (!j || j.status !== "paused")
      fail("Solo se puede cerrar un seguimiento pausado.");
    j.status = "abandoned";
    event(
      p,
      "Seguimiento cerrado localmente. Esto NO cancela ni reembolsa la operación remota. El task_id se conserva.",
      "warning",
    );
    await store.save(p);
    res.json(p);
  });
  app.post("/api/demo", async (req, res) => {
    const p = emptyProject("Sample study · Procedural mannequin");
    p.demo = true;
    p.notes =
      "Procedural example for exploring the workflow. This is not an AI-generated character.";
    p.reference = await store.asset(
      p,
      await fs.readFile(path.join(demoDir, "body-front.png")),
      "png",
      "demo procedural",
    );
    p.referenceRevision = 1;
    p.referenceState = { status: "pending", referenceId: p.reference.id };
    for (const g of groups)
      for (const v of ["front","right","back"])
        p.groups[g].views[v] = {
          ...(await store.asset(
            p,
            await fs.readFile(path.join(demoDir, `${g}-${v}.png`)),
            "png",
            "demo procedural",
          )),
          referenceId: p.reference.id,
          notesRevision: p.notesRevision,
        };
    p.models.push({
      ...(await store.asset(
        p,
        await fs.readFile(path.join(demoDir, "mannequin.glb")),
        "glb",
        "demo procedural",
      )),
      label: "Procedural mannequin · no AI",
      group: "body",
      revision: 0,
      obsolete: true,
      obsoleteReason:
        "Ejemplo procedural sin IA. No es un modelo generado de tu referencia.",
    });
    event(
      p,
      "DEMO: seis dibujos esquemáticos y un maniquí procedural cargados. No se llamó a ningún proveedor.",
    );
    await store.save(p);
    res.status(201).json(presentProject(p));
  });
  app.get("/files/:project/:asset", (req, res) => {
    store.get(req.params.project);
    if (!/^[a-f0-9-]{36}\.(png|glb|blend|fbx)$/.test(req.params.asset))
      fail("Archivo no permitido.", 404);
    // IDs and asset names were validated above; the configured data root itself may be hidden.
    res.sendFile(path.resolve(dataDir, req.params.project, req.params.asset),{dotfiles:'allow'});
  });
  if(distribution){
    app.get('/api/distribution/info',(req,res)=>res.json({extensionFolder:distribution.extensionFolder,extensionVersion:distribution.extensionVersion}));
    app.get('/api/distribution/updates',async(req,res)=>{
      try{const {item,...result}=await distribution.check();res.json(result);}
      catch(error){res.json({status:'unavailable',message:error.message});}
    });
  }
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "Ruta no encontrada." }),
  );
  app.use((err, req, res, next) => {
    res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : err.status || 500).json({
      error:
        err.code === "LIMIT_FILE_SIZE"
          ? "El archivo supera 150 MB."
          : cleanError(err),
    });
  });
  return { app, store };
}
