import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  Box,
  Plus,
  Image as ImageIcon,
  Layers3,
  Plug,
  ArrowRight,
  Check,
  Upload,
  ChevronRight,
  FolderOpen,
  Download,
  ScanFace,
  UserRound,
  Settings2,
  Clock3,
  ExternalLink,
  X,
  RefreshCw,
  ShieldCheck,
  FlaskConical,
  Sparkles,
  Activity,
  TriangleAlert,
  HardDrive,
  Pencil,
  LoaderCircle,
  Eye,
  Trash2,
  Rotate3d,
} from "lucide-react";
import Viewer from "./Viewer";
import ViewSetReview from "./ViewSetReview";
import { I18nProvider, useI18n } from "./i18n";
import { StudioConnection } from "./StudioConnection";
import StudioWorkflow from "./StudioWorkflow";
import DistributionUpdates from './DistributionUpdates';
import {headCandidatesAvailable} from '../shared/generation-sequence.js';
import {Textures,Placement} from "./Finishing";
import Rigging from './Rigging';
import AvatarDelivery from './AvatarDelivery';
import {ArtistWorkspace,ArtistCanvas,ImageCanvas} from './ArtistWorkspace';
import CodexHandoff from './CodexHandoff';
import {chosenModel,afterHeadChoice,afterViewApproval,bodyPreparationMessage,restoreNavigation,persistNavigation} from './project-navigation';
import "./style.css";
import "./guided.css";
import "./red.css";
import "./artist.css";
import "./motion.css";
import "./theme.css";
import "./lobby.css";
import Brand from "./Brand";
import {HelpLink} from "./Help";
import ProjectCard from "./ProjectCard";
import {useProjectArchive} from "./ProjectArchive";
import {SpaceCleanup} from "./SpaceCleanup";
import LobbySky from "./LobbySky";
import ToolsIntro from "./ToolsIntro";
import {CREATOR} from "./creator";
import {installPointerEffects,burstFrom,effectsEnabled,setEffectsEnabled} from "./effects";
import {createLocalRequest} from './local-request';
import {confirmReferenceForViews,revealReferenceCodex} from './reference-navigation';
import ModelCandidates from './ModelCandidates';
import {candidatePreviewId,localPreviewModels,candidateSelectionEditable} from './candidate-navigation';
const localRequest=createLocalRequest();
async function request(url, options = {}) {
  return localRequest.request(url,options);
}
const views = ["front", "back", "right", "left"];
const selectionFor = (p,g) => p.groups[g].selectedViews ?? ["front","right","back"].filter(v=>p.groups[g].views[v]);
const apiReady = (p,g) => !!p.viewSetReadyByGroup?.[g] && ["front","right","back"].every(v=>selectionFor(p,g).includes(v));
function Pill({ children, tone = "" }) {
  return <span className={"pill " + tone}>{children}</span>;
}
function AdvancedConnection({ advanced, children }) {
  const { t } = useI18n();
  return advanced ? <details className="advanced-api"><summary>{t("Advanced: Tripo API")}</summary>{children}</details> : children;
}
function FileButton({
  children,
  onFile,
  accept = "image/png,image/jpeg,image/webp",
  disabled = false,
  className = "button secondary",
  title,
}) {
  return (
    <label title={title} className={className + (disabled ? " disabled" : "")}>
      <Upload size={15} />
      {children}
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(e) => {
          const f = e.target.files[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </label>
  );
}
function Modal({ title, children, onClose, wide = false }) {
  const { t } = useI18n();
  const ref = useRef();
  useEffect(() => {
    const old = document.activeElement;
    ref.current?.focus();
    const key = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const list = ref.current.querySelectorAll(
          "button:not(:disabled),input:not(:disabled),select,a[href],textarea",
        );
        const first = list[0],
          last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      old?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={"modal " + (wide ? "wide" : "")}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon-button" aria-label={t("Close")} onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function Source({ asset }) {
  const {t,message}=useI18n();
    return (
      <Pill tone={asset?.source === "demo procedural" ? "amber" : ""}>
        {message(asset?.source) || t("No file")}
      </Pill>
    );
  }
function ViewGroup({ g,p,referenceConfirmed,connections,working,busy,setZoom,upload,prepare,approve,uploadStates,selectViews }) {
    const {t,message}=useI18n();
    const [activeView,setActiveView]=useState('front');
    const groupNames={head:t("Head"),body:t("Body")},viewNames={front:t("Front"),right:t("Right profile"),back:t("Back"),left:t("Left profile")};
    const group = p.groups[g],
      selectedViews = selectionFor(p,g),
      ready = selectedViews.length>0 && selectedViews.every((v) => group.views[v]);
    return (
      <section className="view-group">
        <ArtistCanvas title={groupNames[g]} subtitle={viewNames[activeView]} strip={views.map(v=><button key={v} className={'asset-thumb'+(v===activeView?' active':'')} aria-pressed={v===activeView} onClick={()=>setActiveView(v)}>{group.views[v]?<img src={group.views[v].url} alt=""/>:<ImageIcon size={23}/>}<span>{viewNames[v]}</span>{selectedViews.includes(v)&&<Check size={12}/>}</button>)}><ImageCanvas url={group.views[activeView]?.url} alt={groupNames[g]+' · '+viewNames[activeView]}/></ArtistCanvas>
        <header className="group-header">
          <div className="group-heading">
            <span className="group-icon">
              {g === "head" ? <ScanFace size={21} /> : <UserRound size={21} />}
            </span>
            <div>
              <h2>{groupNames[g]}</h2>
              <p>
                {g === "head"
                  ? t("Identity, hair and facial proportions")
                  : t("Silhouette, outfit and overall proportions")}
              </p>
            </div>
          </div>
          <Pill tone={group.approved ? "green" : ""}>
            {group.approved ? (
              <>
                <Check size={12} /> {t("Approved")}</>
            ) : ready ? (
              t("Ready for review")
            ) : (
              t("Views needed")
            )}
          </Pill>
        </header>
        <div className="views-grid">
          {views.map((v, i) => {
            const a = group.views[v];
            const uploadState=uploadStates[[p.id,g,v].join(':')];
            const why = group.approved
              ? t("Reopen the review to edit these views.")
              : !referenceConfirmed
                ? t("Confirm and validate the reference first.")
                : p.demo
                  ? t("The demo does not send paid requests.")
                  : !connections.openai?.verifiedAt
                    ? t("Connect OpenAI API in Connections.")
                    : working
                      ? t("Wait for the operation to finish.")
                      : "";
            return (
              <article className="view-card" key={v} hidden={activeView!==v}>
                <div className="view-card-top">
                  <span>{viewNames[v]}</span>
                  <small>0{i + 1}</small>
                </div>
                <label className="view-selection"><input type="checkbox" checked={selectedViews.includes(v)} disabled={busy||working} onChange={e=>selectViews(g,e.target.checked?[...selectedViews,v]:selectedViews.filter(x=>x!==v))}/>{t('Use this view')}</label>
                <button
                  className="view-image"
                  disabled={!a}
                  title={a ? t("Enlarge view") : t("Import or generate this view")}
                  onClick={() =>
                    setZoom({
                      url: a.url,
                      title: groupNames[g] + " · " + viewNames[v],
                    })
                  }
                >
                  {a ? (
                    <img
                      src={a.url}
                      alt={groupNames[g] + " · " + viewNames[v]}
                    />
                  ) : (
                    <div className="view-placeholder">
                      {g === "head" ? (
                        <ScanFace size={44} strokeWidth={1} />
                      ) : (
                        <UserRound size={44} strokeWidth={1} />
                      )}
                      <span>
                        {v === "front"
                          ? t("No front view")
                          : v === "back"
                            ? t("No back view")
                            : v === "left" ? t("No left view") : t("No side view")}
                      </span>
                    </div>
                  )}
                  {a && (
                    <span className="image-expand">
                      <Eye size={14} />
                    </span>
                  )}
                </button>
                <div className="view-meta">
                  <Source asset={a} />
                  {a && (
                    <a href={a.url} download title={t("Download image")}>
                      <Download size={14} />
                    </a>
                  )}
                </div>
                <div className="view-actions">
                  <FileButton
                    disabled={busy || working || group.approved}
                    onFile={(f) => upload(f, g, v)}
                  >{t("Import")}</FileButton>
                  {connections.openai?.verifiedAt&&<button
                    className="button subtle"
                    disabled={busy || !!why}
                    title={why || t("Review the OpenAI request before generating")}
                    onClick={() => prepare("image", g, v)}
                  >
                    <Sparkles size={14} />
                    {a ? t("Regenerate") : t("Generate")}
                  </button>}
                </div>
                {uploadState&&<div className={"upload-feedback "+uploadState.status} role={uploadState.status==='error'?'alert':'status'}>
                  <span>{uploadState.status==='uploading'?t('Uploading image…'):uploadState.status==='error'?message(uploadState.error):t('Image loaded')}</span>
                  <small>{uploadState.filename}</small>
                </div>}
              </article>
            );
          })}
        </div>
      </section>
    );
  }

function App() {
  const { t, language, setLanguage, message } = useI18n();
  const groupNames = {head: t("Head"), body: t("Body")};
  const viewNames = {front: t("Front"), right: t("Right profile"), back: t("Back"), left:t("Left profile")};
  const [projects, setProjects] = useState([]),
    [p, setP] = useState(null),
    [stage, setStage] = useState(0),
    [viewGroup, setViewGroup] = useState("head"),
    [studioGroup,setStudioGroup]=useState('head'),
    [effects,setEffects]=useState(effectsEnabled),
    [conceptView,setConceptView]=useState(null),
    [referenceValidating, setReferenceValidating] = useState(false),
    [historicalModel, setHistoricalModel] = useState(null),
    [connections, setConnections] = useState({}),
    [modal, setModal] = useState(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [boot, setBoot] = useState(true),
    [newName, setNewName] = useState(t("New character")),
    [keys, setKeys] = useState({ openai: "", tripo: "" }),
    [quote, setQuote] = useState(null),
    [paid, setPaid] = useState(false),
    [modelId, setModelId] = useState(""),
    [notes, setNotes] = useState(""),
    [zoom, setZoom] = useState(null);
  const [showSetReview,setShowSetReview]=useState(false);
  const [uploadStates,setUploadStates]=useState({});
  const [trashedProjects,setTrashedProjects]=useState([]);
  const [toolsIntro,setToolsIntro]=useState(false);
  const mutationEpoch=useRef(0);
  const lastViewImport=useRef(null);
  const selected = useRef(null);
  const referenceNavigation=useRef(null),conceptCodexTarget=useRef(null);
  selected.current = p?.id;
  const working = !!p?.jobs.some((j) =>
    ["running", "queued", "paused"].includes(j.status),
  );
  const latest = p?.jobs.at(-1),
    reviewedPartReady = p?.viewSetReady;
  async function reloadList() {
    setProjects(await request("/projects"));
  }
  // Save / open .fita project files from the lobby.
  const archive = useProjectArchive({request,t,message,onImported:async()=>{await reloadList();}});
  async function openTrash(){await action(async()=>{setTrashedProjects(await request('/project-trash'));setModal('trash');});}
  async function deleteProject(project){await action(async()=>{
    await request('/projects/'+project.id,{method:'DELETE'});
    if(selected.current===project.id){setP(null);selected.current=null;localStorage.removeItem('lastProject');}
    await reloadList();setModal(null);setNotice(t('Project moved to trash. You can restore it from the library.'));
  });}
  async function restoreProject(id){await action(async()=>{
    await request('/project-trash/'+id+'/restore',{method:'POST',body:{}});
    await reloadList();setTrashedProjects(await request('/project-trash'));setNotice(t('Project restored.'));
  });}
  async function purgeProject(pr){await action(async()=>{
    await request('/project-trash/'+pr.id,{method:'DELETE',body:{confirm:true,projectId:pr.projectId}});
    setTrashedProjects(await request('/project-trash'));setModal('trash');setNotice(t('Project permanently deleted.'));
  });}
  async function action(fn) {
    mutationEpoch.current++;
    setBusy(true);
    setError("");
    try {
      return await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      mutationEpoch.current++;
      setBusy(false);
    }
  }
  function openProject(project) {
    lastViewImport.current=project.codexImports?.at(-1)?.id||null;
    const navigation=restoreNavigation(project,localStorage);
    setShowSetReview(navigation.showSetReview);setStage(navigation.stage);setViewGroup(navigation.viewGroup);setStudioGroup(navigation.studioGroup);
    setP(project);
    setNotes(project.notes);
    setModelId(candidatePreviewId(project,''));
    localStorage.setItem("lastProject", project.id);
    setModal(null);
  }
  async function chooseProject(id) {
    await action(async () => {
      openProject(await request("/projects/" + id));
    });
  }
  // Lobby palette (lobby.css) applies while no project is open; on <html> so portals follow it.
  useEffect(() => {
    document.documentElement.classList.toggle("in-lobby", !p);
  }, [!p]);
  useEffect(() => {
    (async () => {
      try {
        localRequest.setToken((await request("/session")).token);
        await reloadList();
        setConnections(await request("/connections"));
        const last=localStorage.getItem('lastProject');
        if(last){try{openProject(await request('/projects/'+last));}catch{localStorage.removeItem('lastProject');}}
      } catch (e) {
        setError(e.message);
      } finally {
        setBoot(false);
      }
    })();
  }, []);
  useEffect(()=>{if(p)persistNavigation(p,{stage,viewGroup,studioGroup,showSetReview},localStorage);},[p?.id,p?.groups.head.selectedModelId,stage,viewGroup,studioGroup,showSetReview]);
  useEffect(() => {
    if (!p?.id) return;
    const id = p.id;
    const timer = setInterval(async () => {
      try {
        const epoch=mutationEpoch.current;
        const next = await request("/projects/" + id);
        if (selected.current === id && mutationEpoch.current===epoch) {
          const imported=next.codexImports?.at(-1)?.id||null;
          if(imported&&imported!==lastViewImport.current){setStage(1);setShowSetReview(false);setViewGroup('body');setNotice(t('Views and placement guides imported. Review them before generating.'));}
          lastViewImport.current=imported;setP(next);
        }
      } catch (e) {
        setError(e.message);
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [p?.id]);
  useEffect(() => {
    if (!notice) return;
    requestAnimationFrame(() => burstFrom(document.querySelector(".toast")));
    const t = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(t);
  }, [notice]);
  async function create(demo = false) {
    await action(async () => {
      const next = await request(demo ? "/demo" : "/projects", {
        method: "POST",
        body: demo ? {} : { name: newName },
      });
      openProject(next);
      setStage(0);
      if(!demo)setToolsIntro(true);
      await reloadList();
    });
  }
  async function importCodex(file,replace) {
    const id=p.id;mutationEpoch.current++;setBusy(true);setError('');
    try {
      const form=new FormData();form.set('file',file);form.set('replace',String(replace));
      const next=await request(`/projects/${id}/codex/import`,{method:'POST',body:form});
      if(selected.current===id){setP(next);setModelId('');setShowSetReview(false);setViewGroup('body');setStage(1);}
      setNotice(t('Views and placement guides imported. Review them before generating.'));await reloadList();
    } finally {mutationEpoch.current++;setBusy(false);}
  }
  async function upload(file, kind, view) {
    if (!p) return;
    const projectId=p.id, slot=[projectId,kind,view||''].join(':');
    setUploadStates(old=>({...old,[slot]:{status:'uploading',filename:file.name}}));
    await action(async()=>{
      try {
        if(kind!=='model'&&file.size>20*1024*1024)throw new Error('The image exceeds 20 MB.');
        if(kind==='model'&&file.size>150*1024*1024)throw new Error('The model exceeds 150 MB.');
        const form=new FormData(); form.set('file',file);form.set('kind',kind);if(view)form.set('view',view);
        const next=await request(`/projects/${projectId}/upload`,{method:'POST',body:form});
        if(selected.current===projectId){setP(next);if(kind==='model')setModelId(next.models.at(-1).id);}
        setUploadStates(old=>({...old,[slot]:{status:'saved',filename:file.name}}));
        setNotice(t('File saved to the project.'));await reloadList();
      } catch(e) {
        setUploadStates(old=>({...old,[slot]:{status:'error',filename:file.name,error:e.message}}));
        throw e;
      }
    });
  }
  async function validateSet(){
    if(notes!==p.notes&&!(await saveNotes()))return;
    await action(async()=>{const next=await request(`/projects/${p.id}/validate-view-set`,{method:'POST',body:{group:viewGroup}});setP(next);setShowSetReview(true);});
  }
  async function reviewViews(approved){
    if(notes!==p.notes&&!(await saveNotes()))return;
    const projectId=p.id;
    await action(async()=>{
      const next=await request(`/projects/${projectId}/review-views`,{method:'POST',body:{approved}});
      if(selected.current===projectId){setP(next);setShowSetReview(false);if(approved)continueFromViews(next);}
      await reloadList();
    });
  }
  function continueFromViews(project=p){
    const navigation=afterViewApproval(project);if(!navigation)return;
    setShowSetReview(false);setStudioGroup(navigation.studioGroup);setStage(navigation.stage);
  }
  async function selectViews(group,views){await action(async()=>{setP(await request(`/projects/${p.id}/view-selection`,{method:'POST',body:{group,views}}));setShowSetReview(false);});}
  async function selectModel(group,modelId){
    const projectId=p.id,replacing=!!p.groups[group].selectedModelId;
    await action(async()=>{
      const next=await request(`/projects/${projectId}/select-model`,{method:'POST',body:{group,modelId}});
      if(next.groups[group].selectedModelId!==modelId)throw new Error('Model choice could not be confirmed. Please try again.');
      if(selected.current!==projectId)return;
      setP(next);setModelId(modelId);
      if(group==='head'&&!replacing){const navigation=afterHeadChoice(next);setStage(navigation.stage);setViewGroup('body');setStudioGroup('body');setShowSetReview(false);setNotice(t('Head selected. Next: prepare the body.'));}
      else setNotice(t('Model choice saved. All other candidates remain available.'));
    });
  }
  async function confirmSet(reportId){await action(async()=>{setP(await request(`/projects/${p.id}/review-view-set`,{method:'POST',body:{reportId,approved:true}}));await reloadList();});}
  async function approve(g, value) {
    await action(async () => {
      setP(
        await request(`/projects/${p.id}/approve`, {
          method: "POST",
          body: { group: g, approved: value },
        }),
      );
      await reloadList();
    });
  }
  async function prepare(type, group, view) {
    await action(async () => {
      const q = await request(`/projects/${p.id}/quote`, {
        method: "POST",
        body: { type, group, view },
      });
      setQuote(q);
      setPaid(false);
      setModal("quote");
    });
  }
  async function generate() {
    await action(async () => {
      setP(
        await request(`/projects/${p.id}/generate`, {
          method: "POST",
          body: { quoteId: quote.id, confirmPaid: paid },
        }),
      );
      setModal(null);
    });
  }
  async function saveNotes() {
    if (notes === p.notes) return true;
    return await action(async () => {
      setP(
        await request(`/projects/${p.id}`, {
          method: "PATCH",
          body: { notes },
        }),
      );
      setNotice(t("Notes saved."));
      return true;
    });
  }
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [stage, p?.id]);
  const referenceConfirmed =
    p?.referenceState?.status === "ready" &&
    p.referenceState.referenceId === p.reference?.id;
  const currentModels = localPreviewModels(p);
  const previousModels = p?.models.filter((m) => !m.current) || [];
  const model =
    currentModels.find((m) => m.id === candidatePreviewId(p,modelId));
  useEffect(()=>{if(p)setModelId(id=>candidatePreviewId(p,id));},[p?.id,p?.models,p?.groups.head.selectedModelId,p?.groups.body.selectedModelId]);
  const headChoice=p&&chosenModel(p,'head');
  const extraReferences=p?.extraReferences||[],shownExtra=extraReferences.find(a=>a.id===conceptView)||null;
  useEffect(()=>{setConceptView(null);},[p?.id]);
  async function removeExtra(id){await action(async()=>{const next=await request(`/projects/${p.id}/extra-references/${id}`,{method:'DELETE'});setP(next);if(conceptView===id)setConceptView(null);});}
  useEffect(()=>{
    const pending=referenceNavigation.current;if(!pending)return;
    referenceNavigation.current=null;
    if(stage===0&&referenceConfirmed&&pending.projectId===p?.id&&pending.referenceId===p?.reference?.id)revealReferenceCodex(conceptCodexTarget.current?.querySelector('.codex-handoff'));
  },[p?.id,p?.reference?.id,referenceConfirmed,stage]);
  const bodyContinuation=!!headChoice&&studioGroup==='body';
  const allViewsApproved=!!p&&['head','body'].every(g=>p.groups[g].approved&&p.viewSetReadyByGroup?.[g]);
  const studioPanel=p&&<div className="dual-studio-generation">{['head','body'].map(g=><StudioWorkflow key={p.id+':'+g} group={g} enabled={g==='head'||headCandidatesAvailable(p)} request={request} project={p} onReview={()=>{setViewGroup(g);setShowSetReview(false);setStage(1);}} onProjectChange={next=>{if(selected.current===next.id)setP(next);}} onConnections={()=>setModal('connections')}/>)}</div>;
  async function goHome() {
    if (p && notes !== p.notes) {
      if (!(await saveNotes())) return;
    }
    selected.current = null;
    localStorage.removeItem('lastProject');
    setP(null);
    setStage(0);
    setModal(null);
    await reloadList();
  }
  async function confirmReference() {
    setReferenceValidating(true);
    await action(async () => {
      const next=await confirmReferenceForViews(request,p);
      if(selected.current!==next.id)return;
      referenceNavigation.current={projectId:next.id,referenceId:next.reference.id};
      setP(next);
      await reloadList();
    });
    setReferenceValidating(false);
  }
  const referenceLabel = !p?.reference
    ? t("No reference")
    : referenceValidating || p.referenceState?.status === "validating"
      ? t("Validating file…")
      : referenceConfirmed
        ? t("Ready to generate views")
        : p.referenceState?.status === "invalid"
          ? t("Validation error")
          : t("Uploaded · awaiting confirmation");
  if (boot)
    return (
      <div className="loading-screen">
        <LoaderCircle className="spin" /> {t("Opening your local workshop…")}</div>
    );
  return (
    <div className={"app-shell " + (!p ? "home" : "studio")}>
      {!p && <LobbySky />}
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Layers3 size={24} />
          </span>
          <Brand className="sidebar-logo" onClick={goHome} />
        </div>
        <button className="button new-project" onClick={goHome}>
          <FolderOpen size={17} /> {t("My projects")}</button>
        {p && (
          <div className="studio-context">
            <span className="eyebrow">{t("CURRENT STUDIO")}</span>
            <strong>{p.name}</strong>
            <span className="studio-revision">
              {t("Reference {revision}", {revision: p.referenceRevision || "—"})}
            </span>
            <div className="studio-guide">
              {[
                [ImageIcon, t("Concept")],
                [ScanFace, t("Views")],
                [Box, t("3D form")],
                [Sparkles,t("Textures")],
                [Layers3,t("Placement")],
                [Layers3,t("Rigging")],
                [Download,t("Export")],
              ].map(([Icon, label], i) => (
                <button
                  key={label}
                  className={stage === i ? "active" : ""}
                  onClick={() => setStage(i)}
                >
                  <Icon size={18} />
                  <span>{label}</span>
                  {stage === i && <span className="active-dot" />}
                </button>
              ))}
            </div>
            <div className="studio-tip">
              <HelpLink topic="workflow" label={t("Help")} />
            </div>
          </div>
        )}
        <div className="sidebar-bottom">
          <button onClick={() => setModal("connections")}>
            <Plug size={17} /> {t("Connections")}
          </button>
          <button onClick={() => setModal("settings")}>
            <Settings2 size={17} /> {t("Workshop settings")}</button>
          <div className="local-foot">
            <span className="status-dot" />
            <span>{t("On your computer only")}</span>
            <small>v0.1</small>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          {!p && <Brand onClick={goHome} />}
          {!p ? (
            <div className="creator-credit">
              <span>{t("Made by")}</span>
              <a href={CREATOR.url} target="_blank" rel="noopener noreferrer" title={CREATOR.name}>
                <span className="creator-logo" aria-hidden="true">{CREATOR.logo ? <img src={CREATOR.logo} alt="" /> : CREATOR.name.slice(0, 1)}</span>
                <strong>{CREATOR.name}</strong>
              </a>
            </div>
          ) : (
          <div className="breadcrumb">
            <FolderOpen size={16} />
            <button className="breadcrumb-home" onClick={goHome}>{t("Projects")}</button>
            <ChevronRight size={14} />
            <strong>{p?.name || t("Local library")}</strong>
            {p && (
              <button
                className="icon-button"
                title={t("Rename project")}
                disabled={working}
                onClick={() => {
                  setNewName(p.name);
                  setModal("rename");
                }}
              >
                <Pencil size={13} />
              </button>
            )}
          </div>
          )}
          <div className="topbar-right">
            {!p&&<button className="button secondary compact" onClick={()=>setModal('updates')}>{language==='es'?'Actualizaciones':language==='ja'?'更新':'Updates'}</button>}
            <select className="language-select" aria-label={t("Language")} value={language} onChange={e => setLanguage(e.target.value)}>
              <option value="en" lang="en">English</option>
              <option value="es" lang="es">Español</option>
              <option value="ja" lang="ja">日本語</option>
            </select>
            {p && (
              <button
                className="button subtle compact"
                onClick={() => setModal("activity")}
              >
                <Activity size={15} /> {t("Activity")}</button>
            )}
            <span className="save-status">
              {busy ? (
                <LoaderCircle size={13} className="spin" />
              ) : (
                <Check size={13} />
              )}{" "}
              {busy
                ? t("Saving…")
                : p && notes !== p.notes
                  ? t("Unsaved notes")
                  : t("Saved locally")}
            </span>
            <button
              className="button secondary compact"
              onClick={() => setModal("connections")}
            >
              <Plug size={14} /> {t("Connections")}</button>
          </div>
        </header>
        {error && (
          <div className="alert error" role="alert">
            <TriangleAlert size={17} />
            <span>{message(error)}</span>
            <button aria-label={t("Dismiss error")} onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="toast" role="status">
            <Check size={15} />
            {message(notice)}
          </div>
        )}
        {!p ? (
          <main className="projects-home">
            <header className="library-header">
              <div>
                <div className="eyebrow">{t("YOUR CREATIVE SPACE / LOCAL")}</div>
                <h1>{t("Your characters.")}<br />
                  <span>{t("Your next project.")}</span>
                </h1>
                <p>{t("Pick up where you left off, or start with a new idea.")}</p>
              </div>
              <div className="library-actions">
              <button
                className="button primary large rgb-accent"
                onClick={() => {
                  setNewName(t("New character"));
                  setModal("new");
                }}
              >
                <Plus size={19} /> {t("Create project")}</button>
              <button className="button secondary large" disabled={archive.busy} onClick={archive.open}>
                <FolderOpen size={18} /> {t("Open project")}</button>
              {archive.picker}
              </div>
            </header>
            {archive.status}
            <div className="library-toolbar">
              <h2>{t("Saved projects")}<span>{projects.length}</span>
              </h2>
              <span>
                <HardDrive size={13} /> {t("On this computer")}
                <button className="space-link" disabled={archive.busy} onClick={() => setModal("cleanup")}>{t("Free up space")}</button></span>
            </div>
            <section
              className="project-gallery"
              aria-label={t("Saved projects")}
            >
              {projects.map((pr, i) => (
                <ProjectCard key={pr.id} project={pr} index={i} busy={busy} onOpen={() => chooseProject(pr.id)} onDelete={() => setModal({deleteProject: pr})} onSave={archive.busy?null:() => archive.save(pr)} />
              ))}
              {!projects.length && (
                <div className="library-empty">
                  <FolderOpen size={30} />
                  <h3>{t("Your collection starts here.")}</h3>
                  <p>{t("Create your first project to upload a reference.")}</p>
                </div>
              )}
            </section>
            <div className="library-footer">
              <button className="button subtle trash-link" disabled={busy} onClick={openTrash}><Trash2 size={14}/>{t("Trash")}</button>
            </div>
            <div className="demo-entry">
              <div>
                <FlaskConical size={20} />
                <span>
                  <strong>{t("Try the workflow without an account")}</strong>
                  <small>{t("Optional demo with drawings and a procedural mannequin. No AI or credits used.")}</small>
                </span>
              </div>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => create(true)}
              >{t("Explore demo")}<ArrowRight size={15} />
              </button>
            </div>
          </main>
        ) : (
          <>
            <nav className="stage-nav" aria-label={t("Project stages")}>
              {[
                [t("Reference"), ImageIcon, referenceConfirmed],
                [t("Views & review"), Layers3, reviewedPartReady],
                [t("3D model"), Box, !!currentModels.length],
                [t("Textures"),Sparkles,false],
                [t("Placement"),Layers3,false],
                [t("Rigging"),Layers3,false],
                [t("Export"),Download,false],
              ].map(([label, Icon, done], i) => (
                <button
                  key={label}
                  className={stage === i ? "current" : ""}
                  onClick={() => setStage(i)}
                >
                  <span className="stage-number">
                    {done ? (
                      <Check size={14} />
                    ) : (
                      String(i + 1).padStart(2, "0")
                    )}
                  </span>
                  <Icon size={17} />
                  <span>{label}</span>
                  {i < 6 && <ChevronRight className="step-arrow" size={15} />}
                </button>
              ))}
            </nav>
            <ArtistWorkspace key={p.id+':'+stage} onContinue={stage===1&&allViewsApproved?()=>continueFromViews():undefined} continueLabel="Continue to 3D form" locked={stage<(p.workflowStage||0)&&!(stage===2&&candidateSelectionEditable(p))} onReopen={async()=>{await action(async()=>{const next=await request('/projects/'+p.id+'/rewind',{method:'POST',body:{stage,confirm:true,expectedRevision:p.revision}});setP(next);setShowSetReview(false);});}}>
              <main className="work-area" key={stage}>
                <div className="section-title">
                  <div>
                    <div className="eyebrow">
                      {stage === 0
                        ? t("01 / VISUAL DIRECTION")
                        : stage === 1
                          ? t("02 / CHARACTER CONSISTENCY")
                          : stage===3?t("Textures"):stage===4?t("Placement"):stage===5?t("Rigging"):stage===6?t("Export"):t("03 / EXPLORING THE FORM")}
                    </div>
                    <h1>
                      {stage === 0
                        ? t("Choose your reference.")
                        : stage === 1
                          ? t("Review one group at a time.")
                          : stage===3?t("Textures"):stage===4?t("Placement"):stage===5?t("Rigging"):stage===6?t("Export"):t("Your character in 3D.")}
                    </h1>
                    <HelpLink topic={["concept","views","model","textures","placement","rigging","export"][stage]} />
                  </div>
                  {p.demo && (
                    <Pill tone="amber">
                      <FlaskConical size={13} /> {t("DEMO · NO AI")}</Pill>
                  )}
                </div>
                {latest &&
                  ["queued", "running", "paused", "failed"].includes(
                    latest.status,
                  ) && (
                    <div className="operation-banner" role="status">
                      {["queued", "running"].includes(latest.status) ? (
                        <LoaderCircle size={17} className="spin" />
                      ) : (
                        <TriangleAlert size={17} />
                      )}
                      <div>
                        <strong>
                          {latest.status === "failed"
                            ? t("Operation failed")
                            : latest.status === "paused"
                              ? t("Operation paused")
                              : t("Operation in progress")}
                        </strong>
                        <p>{message(latest.message)}</p>
                        {latest.taskId && <code>{latest.taskId}</code>}
                      </div>
                      {latest.status === "paused" && (
                        <div className="job-buttons">
                          {latest.taskId && (
                            <button
                              className="button secondary"
                              disabled={busy || !connections.tripo?.verifiedAt}
                              onClick={() =>
                                action(async () =>
                                  setP(
                                    await request(
                                      `/projects/${p.id}/jobs/${latest.id}/resume`,
                                      { method: "POST" },
                                    ),
                                  ),
                                )
                              }
                            >{t("Resume status check")}</button>
                          )}
                          <button
                            className="link-button"
                            onClick={() => setModal("dismiss")}
                          >{t("Stop tracking")}</button>
                        </div>
                      )}
                    </div>
                  )}
                {stage === 0 && (
                  <div className="reference-stage">
                    <ArtistCanvas title={t('Reference concept')} subtitle={shownExtra?t("Extra image"):p.name} strip={p.reference&&<div className="concept-strip">
                      <button className={'asset-thumb'+(!shownExtra?' active':'')} aria-pressed={!shownExtra} onClick={()=>setConceptView(null)}><img src={p.reference.url} alt=""/><span>{t("Main concept")}</span></button>
                      {extraReferences.map((a,i)=><div key={a.id} className="concept-extra"><button className={'asset-thumb'+(shownExtra?.id===a.id?' active':'')} aria-pressed={shownExtra?.id===a.id} title={a.label} onClick={()=>setConceptView(a.id)}><img src={a.url} alt=""/><span>{t("Extra image")} {i+1}</span></button><button className="concept-extra-remove" aria-label={t("Remove image")} title={t("Remove image")} disabled={busy||working} onClick={()=>removeExtra(a.id)}><X size={12}/></button></div>)}
                      {extraReferences.length<4&&<FileButton className="button subtle concept-add" disabled={busy||working} title={t("Other angles or details of the same character help Codex. The main concept still decides.")} onFile={(f)=>upload(f,"extra-reference")}>{t("More images?")}</FileButton>}
                    </div>}><div
                      className={
                        "reference-drop " + (p.reference ? "has-image" : "")
                      }
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (working) return;
                        if (e.dataTransfer.files[0]) {
                          if (p.reference) {
                            setModal({ replace: e.dataTransfer.files[0] });
                          } else upload(e.dataTransfer.files[0], "reference");
                        }
                      }}
                    >
                      {p.reference ? (
                        <>
                          <ImageCanvas url={shownExtra?shownExtra.url:p.reference.url} alt={t('Reference concept')}/>
                          <div className="reference-tag">
                            <Source asset={p.reference} />
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="upload-symbol">
                            <ImageIcon size={38} strokeWidth={1.2} />
                            <Plus size={17} />
                          </div>
                          <h2>{t("Bring your character into the workshop")}</h2>
                          <p>{t("Drop your image here or choose one from your computer.")}</p>
                          <FileButton
                            className="button primary"
                            disabled={busy || working}
                            onFile={(f) => upload(f, "reference")}
                          >{t("Choose image")}</FileButton>
                          <small>{t("PNG, JPG or WebP · Up to 20 MB")}</small>
                          <div className="concept-tips">
                            <strong>{t("Recommendations")}</strong>
                            <ul>
                              <li><Rotate3d size={15} />{t("A three-quarter view usually gives the best results.")}</li>
                              <li><UserRound size={15} />{t("Ideally, show the whole character, head to toe.")}</li>
                            </ul>
                          </div>
                          <p className="concept-scope"><Sparkles size={15} />{t("For now FITA creates anime-style characters only.")}</p>
                        </>
                      )}
                    </div></ArtistCanvas>
                    <section className="notes-card">
                      <header>
                        <label htmlFor="notes">{t("Design notes")}</label>
                        <Pill>{t("Optional")}</Pill>
                      </header>
                      <textarea
                        id="notes"
                        rows={3}
                        disabled={working}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        maxLength={3000}
                        placeholder={t("e.g. slim build, symmetrical face, straight fringe, no freckles…")}
                      />
                      <div className="notes-footer">
                        <small>{t("Added to the Codex prompt as low-priority details.")} · {notes.length}/3000</small>
                        <button
                          className="button secondary compact"
                          disabled={busy || working || notes === p.notes}
                          onClick={saveNotes}
                        >{t("Save notes")}</button>
                      </div>
                    </section>
                    {p.reference && (
                      <section className="reference-confirmation">
                        {!referenceConfirmed&&<><div className="reference-step-label">{t("YOUR DECISION")}</div><h2>{t("Use this image?")}</h2></>}
                        {p.referenceState?.status==='invalid'&&<p className="error-text" role="alert">{t('Validation error')}</p>}
                        {!referenceConfirmed && (
                          <button
                            className="button primary large rgb-accent"
                            disabled={busy || referenceValidating || working}
                            onClick={confirmReference}
                          >
                            {referenceValidating ? (
                              <LoaderCircle className="spin" size={17} />
                            ) : (
                              <ShieldCheck size={17} />
                            )}{" "}
                            {referenceValidating
                              ? t("Validating…")
                              : t("Confirm & validate")}
                          </button>
                        )}
                        <div className="reference-actions">
                          <FileButton
                            disabled={busy || working || referenceValidating}
                            onFile={(f) => setModal({ replace: f })}
                          >{t("Choose another image")}</FileButton>
                          <a
                            className="button subtle"
                            href={p.reference.url}
                            download
                          >
                            <Download size={14} /> {t("Save image")}</a>
                        </div>
                      </section>
                    )}
                    {p.reference&&<div ref={conceptCodexTarget}><CodexHandoff key={p.id} project={p} request={request} disabled={busy||working} notesDirty={notes!==p.notes} onImport={importCodex} locked={!referenceConfirmed} lockReason="Unlocks after you confirm the reference."/></div>}
                  </div>
                )}

                {stage===2&&chosenModel(p,'head')&&chosenModel(p,'body')&&<button className="button primary" onClick={()=>setStage(3)}>{t('Continue to textures')}</button>}
                {stage===3&&<Textures key={p.id} project={p} request={request} onProject={setP} onContinue={()=>setStage(4)} onConnections={()=>setModal('connections')}/>}
                {stage===4&&<Placement key={p.id} readOnly={stage<(p.workflowStage||0)} project={p} request={request} onProject={setP} onContinue={()=>setStage(5)}/>}
                {stage===5&&<Rigging key={p.id} project={p} request={request} onProject={setP} onContinue={()=>setStage(6)}/>}
                {stage===6&&<AvatarDelivery key={p.id} project={p} request={request} mode="export" onProject={setP}/>}
                {stage === 1 && (
                  <>
                    <div
                      className="group-tabs"
                      role="tablist"
                      aria-label={t("View group")}
                    >
                      {["head", "body"].map((g, i) => (
                        <button
                          role="tab"
                          aria-selected={viewGroup === g}
                          className={viewGroup === g ? "active" : ""}
                          key={g}
                          onClick={() => setViewGroup(g)}
                        >
                          <span>0{i + 1}</span>
                          {groupNames[g]}
                          {p.groups[g].approved ? (
                            <Check size={16} />
                          ) : (
                            <span className="tab-state">{t("Pending")}</span>
                          )}
                        </button>
                      ))}
                    </div>
                    {!referenceConfirmed && (
                      <div className="info-strip">
                        <ShieldCheck size={17} />
                        <span>{t("Reference not confirmed.")}</span>
                        <button onClick={() => setStage(0)}>{t("Confirm reference")}<ArrowRight size={14} />
                        </button>
                      </div>
                    )}
                    {p.reference&&<details className="codex-in-views"><summary>{t('Codex · Import views and placement guides')}</summary><CodexHandoff key={p.id} project={p} request={request} disabled={busy||working} notesDirty={notes!==p.notes} onImport={importCodex}/></details>}
                    <ViewGroup g={viewGroup} p={p} referenceConfirmed={referenceConfirmed} connections={connections} working={working} busy={busy} setZoom={setZoom} upload={upload} prepare={prepare} approve={approve} uploadStates={uploadStates} selectViews={selectViews} />
                    <div className="stage-footer">
                      <span>{t('{count} selected · {loaded}/4 images loaded',{count:selectionFor(p,viewGroup).length,loaded:views.filter(v=>p.groups[viewGroup].views[v]).length})}</span>
                      <div className="joint-view-actions"><button className={'button '+(allViewsApproved?'secondary':'primary')} disabled={busy||working||!referenceConfirmed||!['head','body'].every(g=>selectionFor(p,g).length)} onClick={()=>reviewViews(!allViewsApproved)}>{allViewsApproved?<Pencil size={15}/>:<Check size={15}/>} {t(allViewsApproved?'Reopen review':'Approve and continue')}</button></div>
                    </div>
                  </>
                )}
                {stage === 2 && (
                  <>
                    {!p.viewSetReadyByGroup?.[studioGroup]&&<div className="info-strip"><span>{t('Validate the selected views and complete the visual review for this part.')}</span><button onClick={()=>{setViewGroup(studioGroup);setShowSetReview(false);setStage(1);}}>{t('Back to views')}</button></div>}
                    {bodyContinuation&&!model&&studioPanel}
                    <ModelCandidates project={p} previewId={model?.id||''} onPreview={setModelId} onSelect={selectModel} busy={busy}/>
                    <div className="model-topline">
                      {model && <><Source asset={model}/><Pill tone={p.groups[model.group]?.selectedModelId===model.id?'green':''}>{p.groups[model.group]?.selectedModelId===model.id?t('Chosen model'):t('Preview only')}</Pill></>}
                    </div>
                    {model ? (
                      <ArtistCanvas title={groupNames[model.group]||t('3D model')} subtitle={p.groups[model.group]?.selectedModelId===model.id?t('Chosen model'):t('Preview only')} strip={currentModels.map(m=><button key={m.id} className={'asset-thumb model-thumb'+(model.id===m.id?' active':'')} aria-pressed={model.id===m.id} onClick={()=>setModelId(m.id)}><Box size={21}/><span>{groupNames[m.group]}<br/>{Number.isInteger(m.candidateIndex)?t('Candidate {number}',{number:m.candidateIndex+1}):t('Preview model')}</span>{p.groups[m.group]?.selectedModelId===m.id&&<Check size={12}/>}</button>)}><Viewer url={model.url} facetedGeometry /></ArtistCanvas>
                    ) : (
                      <ArtistCanvas title={t('3D model')}><div className="canvas-empty"><Box size={48} strokeWidth={1}/><p>{t("Generate your model in Studio after reviewing your selected views.")}</p></div></ArtistCanvas>
                    )}
                    <div className="model-actions">
                      {model&&['head','body'].includes(model.group)&&<button className="button primary" disabled={busy||p.groups[model.group].selectedModelId===model.id} onClick={()=>selectModel(model.group,model.id)}><Check size={15}/>{t('Use this model')}</button>}
                      {previousModels.length > 0 && (
                        <button
                          className="button subtle"
                          onClick={() => {
                            setHistoricalModel(previousModels.at(-1));
                            setModal("history");
                          }}
                        >
                          <Clock3 size={15} /> {t("Previous results ({count})", {count:previousModels.length})}
                        </button>
                      )}
                      {model && (
                        <a
                          className="button primary"
                          download={model.sourceTopology?'character.fbx':'character.glb'}
                          href={model.sourceTopology?.asset?.url||model.url}
                        >
                          <Download size={16} /> {t("Download model")}</a>
                      )}
                      {model?.sourceTopology?.asset&&<><p>{model.sourceTopology.quads.toLocaleString(language)} quads · FBX</p><a className="button secondary" href={model.url} download><Download size={16}/>{t('Download GLB')}</a></>}
                      <a
                        className="button subtle"
                        href={`/api/projects/${p.id}/manifest`}
                        download
                      >
                        <Download size={15} /> {t("Project record")}</a>
                    </div>
                    {(!bodyContinuation||model)&&studioPanel}
                    <details className="advanced-api">
                    <summary>{t("Advanced: Tripo API")}</summary>
                    <section className="generation-panel">
                      <div>
                        <h2>
                          <Sparkles size={19} /> {t("Generate with Tripo")}</h2>
                        <p>{t("Three approved views per model · H v3.1 · PBR textures · Polygon targets vary by candidate")}</p>
                        <small>{t("Head and body are generated as separate files. Assembly is a later step.")}</small>
                      </div>
                      <div className="generation-buttons">
                        {["head", "body"].map((g) => (
                          <button
                            key={g}
                            className="button primary"
                            disabled={
                              busy ||
                              working ||
                              !apiReady(p,g) ||
                              p.demo ||
                              !connections.tripo?.verifiedAt
                            }
                            title={
                              p.demo
                                ? t("The demo does not generate models.")
                                : !apiReady(p,g)
                                  ? t("Advanced Tripo API requires approved front, right profile and back views. Studio selection remains flexible.")
                                  : !connections.tripo?.verifiedAt
                                    ? t("Connect Tripo API.")
                                    : t("Review request and cost")
                            }
                            onClick={() => prepare("mesh", g)}
                          >
                            <Box size={16} /> {t("Generate with Tripo · {group}", {group:groupNames[g]})}
                          </button>
                        ))}
                      </div>
                      {!p.viewSetReady && (
                        <div className="muted">
                          {t("Still to approve: {groups}.", {groups: ["head", "body"]
                            .filter((g) => !p.groups[g].approved)
                            .map((g) => groupNames[g])
                            .join(" · ")})}
                        </div>
                      )}
                      {!connections.tripo?.verifiedAt && (
                        <button
                          className="link-button"
                          onClick={() => setModal("connections")}
                        >{t("Connect Tripo API")}<ArrowRight size={14} />
                        </button>
                      )}
                    </section>
                    </details>
                  </>
                )}
              </main>
            </ArtistWorkspace>
          </>
        )}
      </div>
      {modal === "activity" && p && (
        <Modal title={t("Activity & status")} onClose={() => setModal(null)}>
          <div className="state-list">
            {[
              [referenceLabel, referenceConfirmed],
              [
                p.groups.head.approved
                  ? t("Head: approved by you")
                  : t("Head: awaiting approval"),
                p.groups.head.approved,
              ],
              [
                p.groups.body.approved
                  ? t("Body: approved by you")
                  : t("Body: awaiting approval"),
                p.groups.body.approved,
              ],
              [
                currentModels.length
                  ? t("Model available for this revision")
                  : t("No current model"),
                currentModels.length > 0,
              ],
            ].map(([label, yes]) => (
              <div key={label}>
                <span className={yes ? "check-circle done" : "check-circle"}>
                  {yes && <Check size={11} />}
                </span>
                {label}
              </div>
            ))}
          </div>
          <div className="activity-list">
            {p.events
              .slice()
              .reverse()
              .map((e) => (
                <div className={"activity-item " + e.level} key={e.id}>
                  <span className="activity-dot" />
                  <p>
                    {message(e.message)}
                    <time>{new Date(e.at).toLocaleString(language)}</time>
                  </p>
                </div>
              ))}
          </div>
        </Modal>
      )}
      {modal === "history" && p && (
        <Modal
          title={t("Previous results & examples")}
          wide
          onClose={() => setModal(null)}
        >
          <p>{t("These files are preserved but do not belong to the current reference revision. They do not count as completed models.")}</p>
          <select
            aria-label={t("Previous result")}
            value={historicalModel?.id || ""}
            onChange={(e) =>
              setHistoricalModel(
                previousModels.find((m) => m.id === e.target.value),
              )
            }
          >
            {previousModels.map((m) => (
              <option value={m.id} key={m.id}>
                {m.source === "importado" ? m.label : message(m.label)} · {message(m.source)}
              </option>
            ))}
          </select>
          {historicalModel && (
            <>
              <p className="history-reason">
                {message(historicalModel.obsoleteReason) ||
                  t("Different reference or revision; not applicable to this stage.")}
              </p>
              <Viewer url={historicalModel.url} />
              <a
                className="button secondary"
                download
                href={historicalModel.url}
              >
                <Download size={15} /> {t("Download previous file")}</a>
            </>
          )}
        </Modal>
      )}
      {toolsIntro && p && <ToolsIntro onClose={() => setToolsIntro(false)} onConnections={() => {setToolsIntro(false);setModal("connections");}} />}
      {modal?.deleteProject&&<Modal title={t('Move project to trash?')} onClose={()=>!busy&&setModal(null)}>
        <h3>{modal.deleteProject.name}</h3><p>{t('Images, views and models stay together in the trash. You can restore this project later.')}</p>
        <div className="modal-actions"><button className="button secondary" disabled={busy} onClick={()=>setModal(null)}>{t('Cancel')}</button><button className="button primary" disabled={busy} onClick={()=>deleteProject(modal.deleteProject)}><Trash2 size={16}/>{t('Move to trash')}</button></div>
      </Modal>}
      {modal==='cleanup'&&<Modal wide title={t('Free up space')} onClose={()=>setModal(null)}>
        <SpaceCleanup request={request} t={t} message={message} onDone={reloadList} />
      </Modal>}
      {modal==='trash'&&<Modal title={t('Trash')} onClose={()=>setModal(null)}>
        {!trashedProjects.length&&<p>{t('The trash is empty.')}</p>}
        {trashedProjects.map(pr=><div className="trash-project" key={pr.id}><div><strong>{pr.name}</strong><small>{new Date(pr.deletedAt).toLocaleString()}</small>{pr.deletionPending&&<small>{t('Deletion incomplete. Retry to finish.')}</small>}</div><div className="view-actions"><button className="button secondary" disabled={busy||pr.deletionPending} onClick={()=>restoreProject(pr.id)}>{t('Restore project')}</button><button className="button subtle" disabled={busy} onClick={()=>setModal({purgeProject:pr})}>{t('Delete permanently')}</button></div></div>)}
      </Modal>}
      {modal?.purgeProject&&<Modal title={t('Delete permanently?')} onClose={()=>!busy&&setModal('trash')}><h3>{modal.purgeProject.name}</h3><p>{t('This cannot be undone.')}</p><div className="modal-actions"><button className="button secondary" disabled={busy} onClick={()=>setModal('trash')}>{t('Cancel')}</button><button className="button primary" disabled={busy} onClick={()=>purgeProject(modal.purgeProject)}>{t('Delete permanently')}</button></div></Modal>}
      {(modal === "new" || modal === "rename") && (
        <Modal
          title={modal === "new" ? t("New project") : t("Rename project")}
          onClose={() => setModal(null)}
        >
          <p>{t("A dedicated workspace for your character.")}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (modal === "new") create();
              else
                action(async () => {
                  setP(
                    await request(`/projects/${p.id}`, {
                      method: "PATCH",
                      body: { name: newName },
                    }),
                  );
                  await reloadList();
                  setModal(null);
                });
            }}
          >
            <label className="field-label" htmlFor="project-name">{t("Project name")}</label>
            <input
              id="project-name"
              autoFocus
              maxLength={80}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
            />
            <div className="modal-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setModal(null)}
              >{t("Cancel")}</button>
              <button
                className="button primary"
                disabled={busy || !newName.trim()}
              >
                {modal === "new" ? t("Create project") : t("Save name")}
                <ArrowRight size={15} />
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal==='updates'&&<Modal title={language==='es'?'Actualizaciones de FITA':language==='ja'?'FITAの更新':'FITA updates'} onClose={()=>setModal(null)}><DistributionUpdates request={request}/></Modal>}
      {modal === "connections" && (
        <Modal
          title={t("Generation connections")}
          onClose={() => setModal(null)}
          wide
        >
          <StudioConnection request={request}/>
          <p>{t("Keys are verified with the provider and kept only in server memory. Reconnect after restarting the server.")}</p>
          <div className="siwc-card">
            <div>
              <strong>Sign in with ChatGPT</strong>
              <Pill tone="amber">{t("Not available for images")}</Pill>
            </div>
            <p>{message(connections.siwc?.reason)}</p>
            <a href={connections.siwc?.docs} target="_blank" rel="noreferrer">{t("Read official limitation")}<ExternalLink size={13} />
            </a>
          </div>
          {["openai", "tripo"].map((k) => (
            <AdvancedConnection key={k} advanced={k === "tripo"}>
            <section className="connection-card">
              <header>
                <span className="connector-icon">
                  {k === "openai" ? <Sparkles size={22} /> : <Box size={23} />}
                </span>
                <div>
                  <h3>{k === "openai" ? "OpenAI API" : "Tripo API"}</h3>
                  <p>
                    {k === "openai"
                      ? t("Reference images · billed separately from ChatGPT")
                      : t("3D generation · API account credits")}
                  </p>
                </div>
                <Pill tone={connections[k]?.verifiedAt ? "green" : ""}>
                  {connections[k]?.verifiedAt ? t("Verified") : t("Not connected")}
                </Pill>
              </header>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  action(async () => {
                    try {
                      setConnections(
                        await request("/connections/" + k, {
                          method: "POST",
                          body: { key: keys[k] },
                        }),
                      );
                      setKeys((prev) => ({ ...prev, [k]: "" }));
                      setNotice(t("Connection verified without generating content."));
                    } finally {
                      setConnections(await request("/connections"));
                    }
                  });
                }}
              >
                <label className="field-label" htmlFor={"key-" + k}>{t("API key")}</label>
                <div className="key-row">
                  <input
                    id={"key-" + k}
                    type="password"
                    autoComplete="off"
                    value={keys[k]}
                    placeholder={t("Enter your key on this computer")}
                    onChange={(e) => setKeys({ ...keys, [k]: e.target.value })}
                  />
                  <button
                    className="button primary"
                    disabled={busy || !keys[k]}
                  >{t("Verify")}</button>
                </div>
              </form>
              {connections[k]?.message && (
                <p className="connection-detail">
                  {message(connections[k].message)}
                  {k === "tripo" && (
                    <>
                      {" "}
                      {t("Available: {balance} · Reserved: {frozen} credits.", {balance:connections[k].balance, frozen:connections[k].frozen})}
                    </>
                  )}
                </p>
              )}
              {connections[k]?.error && (
                <p className="error-text">{message(connections[k].error)}</p>
              )}
              <footer>
                <a
                  target="_blank"
                  rel="noreferrer"
                  href={
                    k === "openai"
                      ? "https://platform.openai.com/api-keys"
                      : "https://platform.tripo3d.ai"
                  }
                >{t("Open official console")}<ExternalLink size={13} />
                </a>
                {connections[k]?.configured && (
                  <button
                    className="link-button"
                    disabled={busy || working}
                    onClick={() =>
                      action(async () =>
                        setConnections(
                          await request("/connections/" + k, {
                            method: "DELETE",
                          }),
                        ),
                      )
                    }
                  >{t("Disconnect")}</button>
                )}
              </footer>
            </section>
            </AdvancedConnection>
          ))}
          <div className="scope-note">
            <ShieldCheck size={16} />
            <p>{t("Verifying does not generate content. Each generation shows the provider and asks you to confirm charges. No Codex credentials or accounts from other projects are used.")}</p>
          </div>
        </Modal>
      )}
      {modal === "quote" && quote && (
        <Modal title={t("Review generation")} onClose={() => setModal(null)}>
          <Pill tone="amber">{t("PAID OPERATION")}</Pill>
          <h3>{message(quote.summary)}</h3>
          <div className="quote-detail">
            <span>{t("Provider")}</span>
            <strong>
              {quote.provider === "openai" ? "OpenAI API" : "Tripo API"}
            </strong>
            <span>{t("Model")}</span>
            <strong>{quote.model}</strong>
          </div>
          <p className="cost-note">{message(quote.cost)}</p>
          <a
            className="external-text"
            href={
              quote.provider === "openai"
                ? "https://developers.openai.com/api/docs/pricing"
                : "https://developers.tripo3d.ai/en/pricing"
            }
            target="_blank"
            rel="noreferrer"
          >{t("Check official pricing")}<ExternalLink size={13} />
          </a>
          <label className="consent">
            <input
              type="checkbox"
              checked={paid}
              onChange={(e) => setPaid(e.target.checked)}
            />
            <span>{t("I authorize sending these images to the provider and using my account balance.")}</span>
          </label>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setModal(null)}>{t("Go back")}</button>
            <button
              className="button primary"
              disabled={busy || !paid}
              onClick={generate}
            >
              <Sparkles size={15} /> {t("Confirm & generate")}</button>
          </div>
        </Modal>
      )}
      {modal === "settings" && (
        <Modal title={t("Workshop settings")} onClose={() => setModal(null)}>
          <label className="effects-toggle">
            <input type="checkbox" checked={effects} onChange={(e) => { setEffectsEnabled(e.target.checked); setEffects(e.target.checked); }} />
            <span>{t("Visual effects")} · {t("Particles and animated borders")}<small>{t("Turned off automatically if your system reduces motion.")}</small></span>
          </label>
          <div className="siwc-card">
            <strong>{t("Local and private by default")}</strong>
            <p>{t("Nothing is published or synced to GitHub. Providers receive images only when you authorize generation.")}</p>
            <p>{t("A distributed local app can be inspected. A private repository restricts source access but cannot prevent copying. Distribution licensing is undecided.")}</p>
          </div>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => create(true)}
          >
            <FlaskConical size={16} /> {t("Create demo project")}</button>
        </Modal>
      )}
      {typeof modal === "object" && modal?.replace && (
        <Modal title={t("Replace concept")} onClose={() => setModal(null)}>
          <p>{t("Replacing the image starts a new revision and revokes reference confirmation and view approvals. Previous references, views and models stay in history; they are not current results.")}</p>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setModal(null)}>{t("Cancel")}</button>
            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                const f = modal.replace;
                setModal(null);
                await upload(f, "reference");
              }}
            >{t("Replace reference")}</button>
          </div>
        </Modal>
      )}
      {modal === "dismiss" && (
        <Modal title={t("Stop local tracking")} onClose={() => setModal(null)}>
          <p>{t("This unlocks the project for editing but does not cancel the Tripo task or refund credits. Its ID stays in the record. Check the provider before generating again.")}</p>
          <button
            className="button primary"
            onClick={() =>
              action(async () => {
                setP(
                  await request(`/projects/${p.id}/jobs/${latest.id}/dismiss`, {
                    method: "POST",
                  }),
                );
                setModal(null);
              })
            }
          >{t("Stop tracking")}</button>
        </Modal>
      )}
      {zoom && (
        <Modal title={zoom.title} onClose={() => setZoom(null)} wide>
          <img className="zoom-image" alt={zoom.title} src={zoom.url} />
          <a className="button secondary" download href={zoom.url}>
            <Download size={15} /> {t("Download image")}</a>
        </Modal>
      )}
    </div>
  );
}
installPointerEffects();
createRoot(document.getElementById("root")).render(<I18nProvider><App /></I18nProvider>);
