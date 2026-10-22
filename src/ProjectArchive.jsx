import React, { useEffect, useRef, useState } from 'react';
import { LoaderCircle, CheckCircle2, TriangleAlert, X } from 'lucide-react';

// Save / open whole projects as .fita files (lobby). The local server opens the
// native Windows dialog and streams the file to or from disk; without that
// dialog it falls back to a browser download or upload.
export const sizeText = n => !n ? '0 MB' : n >= 1024 ** 3 ? (n / 1024 ** 3).toFixed(1) + ' GB' : Math.max(1, Math.round(n / 1024 ** 2)) + ' MB';

export function useProjectArchive({ request, onImported, t, message }) {
  const [job, setJob] = useState(null), [failure, setFailure] = useState(''), input = useRef(null), alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  async function follow(started) {
    let current = started;
    setJob(current);
    while (alive.current && current.status === 'running') {
      await new Promise(resolve => setTimeout(resolve, 500));
      current = (await request('/project-archives/' + current.id)).job;
      setJob(current);
    }
    if (current.status === 'succeeded' && current.kind === 'import') await onImported?.(current.projectId);
    if (current.status === 'failed') setFailure(current.error === 'FITA_NOT_ENOUGH_SPACE' && current.details ? message(current.error) + ' ' + t('Needed: {needed} · free: {free}', { needed: sizeText(current.details.neededBytes), free: sizeText(current.details.freeBytes) }) : current.error);
  }
  async function run(fn) { setFailure(''); try { await fn(); } catch (e) { setFailure(e.message); } }
  const busy = job?.status === 'running';
  const save = project => run(async () => {
    const result = await request('/projects/' + project.id + '/archive', { method: 'POST' });
    if (result.fallback === 'download') { location.href = '/api/projects/' + project.id + '/archive.fita'; return; }
    if (result.job) await follow(result.job);
  });
  const open = () => run(async () => {
    const result = await request('/projects/import', { method: 'POST' });
    if (result.fallback === 'upload') { input.current?.click(); return; }
    if (result.job) await follow(result.job);
  });
  // Browser fallback: the file goes as the raw request body, streamed by the browser.
  const upload = file => run(async () => {
    const token = (await (await fetch('/api/session')).json()).token;
    const response = await fetch('/api/projects/import-upload', { method: 'POST', body: file, headers: { 'x-workbench-token': token, 'Content-Type': 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) } });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'FITA_ARCHIVE_FAILED');
    await follow(data.job);
  });
  const picker = <input ref={input} type="file" accept=".fita" hidden onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void upload(file); }} />;
  const status = (job || failure) && <div className={'archive-status' + (failure ? ' is-error' : '')} role="status" aria-live="polite">
    {failure ? <TriangleAlert size={16} /> : busy ? <LoaderCircle size={16} className="spin" /> : <CheckCircle2 size={16} />}
    <span>
      {failure ? (failure.startsWith('FITA_') || failure.startsWith('STUDIO_') ? message(failure) : failure)
        : busy ? t(job.kind === 'export' ? 'Saving {name}…' : 'Opening {name}…', { name: job.name }) + (job.totalBytes ? ` ${Math.floor(100 * job.bytes / job.totalBytes)}% · ${sizeText(job.bytes)} / ${sizeText(job.totalBytes)}` : '')
          : t(job.kind === 'export' ? 'Saved to {path}' : job.copied ? 'Opened as a copy: {name}' : 'Opened: {name}', { name: job.name, path: job.path })}
    </span>
    {!busy && <button className="archive-close" aria-label={t('Dismiss')} onClick={() => { setJob(null); setFailure(''); }}><X size={14} /></button>}
  </div>;
  return { busy, save, open, picker, status };
}
