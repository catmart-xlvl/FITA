import React, { useEffect, useRef, useState } from 'react';
import { LoaderCircle, CheckCircle2, TriangleAlert, Undo2, Trash2, HardDrive } from 'lucide-react';
import { sizeText } from './ProjectArchive';

// "Free up space" (lobby dialog). The server analyses every project, moves what
// nothing uses any more to the FITA cleanup trash and shares identical copies.
// Nothing is deleted until the user empties that trash.
export function SpaceCleanup({ request, t, message, onDone }) {
  const [job, setJob] = useState(null), [trash, setTrash] = useState(null), [failure, setFailure] = useState(''), [confirmEmpty, setConfirmEmpty] = useState(false), [working, setWorking] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const loadTrash = async () => { const data = await request('/cleanup/trash'); if (alive.current) setTrash(data); };
  async function follow(started) {
    let current = started;
    setJob(current);
    while (alive.current && current.status === 'running') {
      await new Promise(resolve => setTimeout(resolve, 600));
      current = (await request('/cleanup/jobs/' + current.id)).job;
      if (alive.current) setJob(current);
    }
    if (current.status === 'failed') setFailure(current.error);
    return current;
  }
  const act = async fn => { setFailure(''); setWorking(true); try { await fn(); } catch (e) { setFailure(e.message); } finally { if (alive.current) setWorking(false); } };
  const analyze = () => act(async () => { await follow((await request('/cleanup/analyze', { method: 'POST', body: {} })).job); });
  useEffect(() => { void act(async () => { await loadTrash(); await follow((await request('/cleanup/analyze', { method: 'POST', body: {} })).job); }); }, []);
  const projects = job?.kind === 'analyze' && job.status === 'succeeded' ? job.projects : [];
  const ready = projects.filter(p => !p.busy && p.totalBytes > p.afterBytes);
  const saving = ready.reduce((n, p) => n + p.totalBytes - p.afterBytes, 0);
  const run = () => act(async () => {
    const done = await follow((await request('/cleanup/run', { method: 'POST', body: { confirm: true, projectIds: ready.map(p => p.projectId) } })).job);
    await loadTrash();
    if (done.status === 'succeeded') onDone?.();
  });
  const trashBytes = (trash?.batches || []).reduce((n, b) => n + b.bytes, 0);
  const restore = id => act(async () => { await request('/cleanup/trash/' + id + '/restore', { method: 'POST' }); await loadTrash(); });
  const empty = () => act(async () => { for (const b of trash.batches) await request('/cleanup/trash/' + b.id, { method: 'DELETE' }); setConfirmEmpty(false); await loadTrash(); });
  const running = job?.status === 'running';
  const cleaned = job?.kind === 'clean' && job.status === 'succeeded' ? job.results : null;
  const freed = cleaned ? cleaned.reduce((n, r) => n + (r.trashedBytes || 0), 0) : 0, linked = cleaned ? cleaned.reduce((n, r) => n + (r.linkedBytes || 0), 0) : 0;

  return <div className="space-cleanup">
    <p className="space-lead">{t('Moves to the FITA trash what no project uses any more. Going back to a stage keeps working.')}</p>
    <details className="space-help"><summary>{t('What is moved?')}</summary><ul>
      <li>{t('Blender backup copies (.blend1).')}</li>
      <li>{t('Files of stages you discarded by going back.')}</li>
      <li>{t('Leftover work files and caches nothing uses.')}</li>
      <li>{t('Identical finished copies are kept once.')}</li>
    </ul></details>
    {running && <div className="space-progress"><LoaderCircle size={16} className="spin" /><span>{t(job.kind === 'clean' ? 'Cleaning {name}…' : 'Analysing {name}…', { name: job.project || '' })} {job.step}/{job.steps}</span></div>}
    {failure && <div className="archive-status is-error" role="alert"><TriangleAlert size={16} /><span>{message(failure)}</span></div>}
    {cleaned && <div className="archive-status" role="status"><CheckCircle2 size={16} /><span>{t('Moved to the trash: {moved}. Shared copies: {linked}. Empty the trash to free the space.', { moved: sizeText(freed), linked: sizeText(linked) })}</span></div>}
    {!!projects.length && <ul className="space-list">
      {projects.map(p => <li key={p.projectId} className={p.busy ? 'is-busy' : ''}>
        <span className="space-name">{p.name}</span>
        {p.busy ? <span className="space-note">{t('In use, skipped')}</span>
          : <span className="space-size">{sizeText(p.totalBytes)} → <strong>{sizeText(p.afterBytes)}</strong></span>}
      </li>)}
    </ul>}
    {job?.kind === 'analyze' && job.status === 'succeeded' && <div className="space-total"><HardDrive size={15} /><span>{t('Can be freed: {size}', { size: sizeText(saving) })}{job.freeBytes != null ? ' · ' + t('free on disk: {size}', { size: sizeText(job.freeBytes) }) : ''}</span></div>}
    <div className="modal-actions">
      {cleaned ? <button className="button secondary" disabled={working} onClick={analyze}>{t('Analyse again')}</button>
        : <button className="button primary" disabled={working || running || !ready.length} onClick={run}>{t('Move to trash ({size})', { size: sizeText(saving) })}</button>}
    </div>
    {!!trash?.batches?.length && <section className="space-trash">
      <h3>{t('FITA cleanup trash')}<span>{sizeText(trashBytes)}</span></h3>
      <ul>{trash.batches.map(b => <li key={b.id}><span className="space-name">{b.name}</span><span className="space-size">{sizeText(b.bytes)}</span>
        <button className="button secondary compact" disabled={working || running} onClick={() => restore(b.id)}><Undo2 size={14} />{t('Restore')}</button></li>)}</ul>
      {confirmEmpty
        ? <div className="space-confirm"><span>{t('This deletes {size} permanently. Continue?', { size: sizeText(trashBytes) })}</span>
          <button className="button secondary compact" disabled={working} onClick={() => setConfirmEmpty(false)}>{t('Cancel')}</button>
          <button className="button primary compact space-danger" disabled={working} onClick={empty}><Trash2 size={14} />{t('Yes, empty')}</button></div>
        : <button className="button secondary compact" disabled={working || running} onClick={() => setConfirmEmpty(true)}><Trash2 size={14} />{t('Empty trash')}</button>}
    </section>}
  </div>;
}
