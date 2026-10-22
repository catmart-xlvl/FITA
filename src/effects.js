// Presentation-only effects: click ripple and celebration bursts. No dependencies.
// Disabled by the "Visual effects" setting or by prefers-reduced-motion.
export const effectsKey='fitaEffects';
export const palette=['#3bb5ff','#5db7ff','#4598e0','#6b83ff','#5ce6ff'];
// Lobby (DIS-002): sky blue + white, used while html.in-lobby is set.
export const lobbyPalette=['#5cc8ff','#9be0ff','#2fa8ec','#e8f6ff','#8fa8ff'];

// Portal warp: a short light ring from the click point when entering a project. One element, removed after use.
export function warpFrom(x,y){
  if(!effectsEnabled())return;
  const el=document.createElement('div');el.className='portal-warp';el.setAttribute('aria-hidden','true');
  el.style.setProperty('--x',x+'px');el.style.setProperty('--y',y+'px');
  document.body.appendChild(el);setTimeout(()=>el.remove(),900);
}
const reduced=()=>globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
export function effectsEnabled(){
  try{if((localStorage.getItem(effectsKey)??localStorage.getItem('workbenchEffects'))==='off')return false;}catch{}
  return !reduced();
}
export function setEffectsEnabled(on){
  try{localStorage.setItem(effectsKey,on?'on':'off');}catch{}
  document.documentElement.classList.toggle('effects-off',!on);
  window.dispatchEvent(new Event('wb-effects'));
}

// Ripple: sets the press origin on the element itself; CSS draws it. No DOM is injected into React nodes.
const pressable='.button,.studio-guide button,.asset-thumb,.help-link,.icon-button,.part-switch>button,.group-tabs>button,.project-cover,.canvas-focus';
export function installPointerEffects(){
  document.documentElement.classList.toggle('effects-off',!effectsEnabled());
  document.addEventListener('pointerdown',event=>{
    const el=event.target.closest?.(pressable);
    if(!el||el.matches(':disabled,.disabled')||!effectsEnabled())return;
    const box=el.getBoundingClientRect();
    el.style.setProperty('--press-x',(event.clientX-box.left)+'px');
    el.style.setProperty('--press-y',(event.clientY-box.top)+'px');
    el.classList.remove('is-pressed');void el.offsetWidth;el.classList.add('is-pressed');
    clearTimeout(el._pressTimer);el._pressTimer=setTimeout(()=>el.classList.remove('is-pressed'),650);
  },{passive:true});
}

// Burst: short spark shower on a fixed overlay canvas, created on demand and idle afterwards.
let layer=null,ctx=null,sparks=[],running=false;
function frame(){
  const w=layer.width/devicePixelRatio,h=layer.height/devicePixelRatio;
  ctx.clearRect(0,0,w,h);
  sparks=sparks.filter(s=>(s.life-=1)>0);
  for(const s of sparks){
    s.vy+=0.05;s.vx*=0.985;s.x+=s.vx;s.y+=s.vy;
    ctx.globalAlpha=Math.min(1,s.life/28);ctx.fillStyle=s.color;
    ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,Math.PI*2);ctx.fill();
  }
  if(sparks.length)requestAnimationFrame(frame);else{running=false;ctx.clearRect(0,0,w,h);}
}
export function burst(x,y,count=26){
  if(!effectsEnabled())return;
  if(!layer){
    layer=document.createElement('canvas');layer.className='burst-layer';layer.setAttribute('aria-hidden','true');
    document.body.appendChild(layer);ctx=layer.getContext('2d');
  }
  const ratio=devicePixelRatio||1;
  if(layer.width!==innerWidth*ratio||layer.height!==innerHeight*ratio){layer.width=innerWidth*ratio;layer.height=innerHeight*ratio;ctx.setTransform(ratio,0,0,ratio,0,0);}
  const colors=document.documentElement.classList.contains('in-lobby')?lobbyPalette:palette;
  for(let i=0;i<count;i++){
    const angle=Math.random()*Math.PI*2,speed=1.5+Math.random()*3.2;
    sparks.push({x,y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed-1.6,r:1+Math.random()*2,life:40+Math.random()*30,color:colors[i%colors.length]});
  }
  if(!running){running=true;requestAnimationFrame(frame);}
}
export function burstFrom(element){
  if(!element)return;
  const box=element.getBoundingClientRect();
  burst(box.left+Math.min(28,box.width/2),box.top+box.height/2);
}
