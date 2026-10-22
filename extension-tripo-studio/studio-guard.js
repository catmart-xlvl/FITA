// "Glass wall" shown over the authorized Studio tab while FITA works.
// Runs in the extension's isolated world. Its UI lives in a closed shadow root
// without role="dialog", so the adapters never see it as Tripo controls.
// Only trusted (real user) input is stopped; the adapters' synthetic clicks
// and keys are untrusted and pass through. Pause/Continue go to the worker.
export function studioWorkGuard({state='hidden',step=null}={}){
 if(location.origin!=='https://studio.tripo3d.ai')return {adapterError:'STUDIO_ORIGIN_CHANGED'};
 const g=globalThis.__fitaWorkGuardV1 ||= {state:'hidden',host:null,root:null,block:null};
 const lang=(document.documentElement.lang||navigator.language||'en').slice(0,2);
 const dict={
  es:{working:'FITA está trabajando',paused:'FITA en pausa',pause:'Pausar',resume:'Continuar',hint:'No toques Tripo hasta que termine.',steps:{configure:'Ajustando Tripo',prepare:'Preparando la generación',generate:'Enviando la generación',monitor:'Esperando el resultado',export:'Descargando el modelo',texture:'Texturizando',rig:'Riggeando',segment:'Procesando piezas',navigate:'Volviendo a su sitio'}},
  ja:{working:'FITA が作業中です',paused:'FITA 一時停止中',pause:'一時停止',resume:'再開',hint:'完了するまで Tripo を操作しないでください。',steps:{configure:'Tripo を設定中',prepare:'生成を準備中',generate:'生成を送信中',monitor:'結果を待機中',export:'モデルをダウンロード中',texture:'テクスチャ作成中',rig:'リグ作成中',segment:'パーツを処理中',navigate:'元の画面に戻しています'}},
  en:{working:'FITA is working',paused:'FITA paused',pause:'Pause',resume:'Continue',hint:"Please don't touch Tripo until it finishes.",steps:{configure:'Setting up Tripo',prepare:'Preparing the generation',generate:'Sending the generation',monitor:'Waiting for the result',export:'Downloading the model',texture:'Texturing',rig:'Rigging',segment:'Processing parts',navigate:'Returning to its place'}},
 };
 const words=dict[lang]||dict.en;
 const send=action=>{try{chrome.runtime.sendMessage({type:'fita-guard',action});}catch{}};
 if(!g.host||!g.host.isConnected){
  g.host=document.createElement('fita-work-guard');
  g.host.style.cssText='all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:block';
  g.root=g.host.attachShadow({mode:'closed'});
  g.root.innerHTML=`<style>
   :host{all:initial}[hidden]{display:none!important}
   .wall{position:fixed;inset:0;background:rgba(8,14,28,.38);backdrop-filter:blur(1.5px);pointer-events:auto;cursor:progress;display:flex;align-items:flex-end;justify-content:center;padding:0 16px 28px;box-sizing:border-box;font:500 14px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;color:#fff;opacity:0;transition:opacity .18s ease}
   .wall.on{opacity:1}
   .card{display:flex;align-items:center;gap:14px;max-width:520px;width:100%;box-sizing:border-box;padding:12px 14px 12px 16px;border-radius:14px;background:rgba(14,24,44,.92);border:1px solid rgba(92,200,255,.45);box-shadow:0 10px 30px rgba(0,0,0,.35),0 0 0 4px rgba(92,200,255,.08);cursor:default}
   .dot{flex:none;width:10px;height:10px;border-radius:50%;background:#5cc8ff;box-shadow:0 0 10px #5cc8ff;animation:pulse 1.2s ease-in-out infinite}
   .text{flex:1;min-width:0}.title{font-weight:700}.sub{color:#b9c4d6;font-size:12.5px;margin-top:2px}
   button{flex:none;font:600 13px system-ui,-apple-system,"Segoe UI",sans-serif;color:#06121f;background:#9be0ff;border:0;border-radius:999px;padding:8px 16px;cursor:pointer}
   button:hover{background:#c4ecff}button:focus-visible{outline:2px solid #fff;outline-offset:2px}
   .pill{position:fixed;left:50%;top:64px;transform:translateX(-50%);pointer-events:auto;display:flex;align-items:center;gap:12px;padding:8px 8px 8px 16px;border-radius:999px;background:rgba(14,24,44,.94);border:1px solid rgba(92,200,255,.45);font:600 13px system-ui,-apple-system,"Segoe UI",sans-serif;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.35)}
   .pill .dot{animation:none;background:#9be0ff;box-shadow:none}
   @keyframes pulse{50%{opacity:.35}}
   @media (prefers-reduced-motion:reduce){.dot{animation:none}.wall{transition:none}}
  </style><div class="wall" part="wall"><div class="card"><span class="dot"></span><div class="text"><div class="title"></div><div class="sub"></div></div><button type="button" data-act="pause"></button></div></div><div class="pill" hidden><span class="dot"></span><span class="ptitle"></span><button type="button" data-act="resume"></button></div>`;
  const wall=g.root.querySelector('.wall'),pill=g.root.querySelector('.pill');
  for(const button of g.root.querySelectorAll('button'))button.addEventListener('click',event=>{if(event.isTrusted)send(button.dataset.act);});
  // Swallow the user's input on the wall itself (pointer, wheel, drops).
  for(const type of ['pointerdown','pointerup','mousedown','mouseup','click','dblclick','contextmenu','wheel','dragover','drop','touchstart'])
   wall.addEventListener(type,event=>{if(event.isTrusted&&!event.composedPath().some(n=>n?.tagName==='BUTTON')){event.preventDefault();event.stopPropagation();}},{passive:false});
  // Keyboard reaches the page's focused control, not the wall: stop trusted
  // keys at window capture while working, except on the wall's own button.
  g.block=event=>{if(g.state==='working'&&event.isTrusted&&event.target!==g.host){event.preventDefault();event.stopImmediatePropagation();}};
  for(const type of ['keydown','keypress','keyup','paste','drop'])window.addEventListener(type,g.block,true);
  (document.body||document.documentElement).appendChild(g.host);
  g.wall=wall;g.pill=pill;
 }
 g.state=state;g.seenAt=Date.now();
 const {wall,pill,root}=g;
 // The worker renews the wall while it works. If it stops (worker suspended,
 // extension reloaded), the wall removes itself so Tripo is never left locked.
 g.expiry ||= setInterval(()=>{if(g.state!=='hidden'&&Date.now()-g.seenAt>60000){g.state='hidden';g.wall.classList.remove('on');g.wall.hidden=true;g.pill.hidden=true;}},5000);
 if(state==='working'){
  root.querySelector('.title').textContent=words.working;
  root.querySelector('.sub').textContent=words.steps[step]||words.hint;
  root.querySelector('[data-act="pause"]').textContent=words.pause;
  wall.hidden=false;pill.hidden=true;void wall.offsetWidth;wall.classList.add('on');
  // A focused Tripo field would still receive typing; move focus off it.
  if(document.activeElement&&document.activeElement!==document.body&&document.activeElement!==g.host)document.activeElement.blur?.();
 }else if(state==='paused'){
  root.querySelector('.ptitle').textContent=words.paused;
  root.querySelector('[data-act="resume"]').textContent=words.resume;
  wall.classList.remove('on');wall.hidden=true;pill.hidden=false;
 }else{
  wall.classList.remove('on');wall.hidden=true;pill.hidden=true;
 }
 return {guard:state};
}
