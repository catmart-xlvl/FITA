import React,{useEffect,useRef} from 'react';
import {effectsEnabled,palette} from './effects';

// Ambient particles. One canvas, pre-rendered glow sprites, capped count.
// Sleeps when the tab is hidden, the canvas is not visible (opacity 0 / display none) or effects are off.
const sprites=new Map();
function sprite(color){
  if(sprites.has(color))return sprites.get(color);
  const c=document.createElement('canvas');c.width=c.height=32;
  const g=c.getContext('2d'),grad=g.createRadialGradient(16,16,0,16,16,16);
  grad.addColorStop(0,color);grad.addColorStop(.25,color+'aa');grad.addColorStop(1,color+'00');
  g.fillStyle=grad;g.fillRect(0,0,32,32);sprites.set(color,c);return c;
}
export default function Particles({className='',density=1,colors=palette}){
  const ref=useRef();
  useEffect(()=>{
    const canvas=ref.current,ctx=canvas.getContext('2d');
    let width=0,height=0,dots=[],raf=0,sleep=0,alive=true;
    const resize=()=>{
      const ratio=Math.min(devicePixelRatio||1,2),box=canvas.getBoundingClientRect();
      width=box.width;height=box.height;canvas.width=width*ratio;canvas.height=height*ratio;ctx.setTransform(ratio,0,0,ratio,0,0);
      const count=Math.min(60,Math.round(width*height/22000*density));
      dots=Array.from({length:count},()=>spawn(true));
    };
    const spawn=anywhere=>({x:Math.random()*width,y:anywhere?Math.random()*height:height+10,r:4+Math.random()*9,vy:-(.12+Math.random()*.38),vx:(Math.random()-.5)*.18,phase:Math.random()*6.28,img:sprite(colors[Math.floor(Math.random()*colors.length)])});
    const visible=()=>!document.hidden&&canvas.getClientRects().length>0&&getComputedStyle(canvas).opacity!=='0'&&effectsEnabled();
    let frames=0,shown=true;
    const tick=time=>{
      if(!alive)return;
      if(frames++%30===0)shown=visible();
      if(!shown){frames=0;ctx.clearRect(0,0,width,height);sleep=setTimeout(()=>{raf=requestAnimationFrame(tick);},800);return;}
      ctx.clearRect(0,0,width,height);ctx.globalCompositeOperation='lighter';
      for(let i=0;i<dots.length;i++){
        const d=dots[i];d.x+=d.vx+Math.sin(time*.0004+d.phase)*.12;d.y+=d.vy;
        if(d.y<-20||d.x<-20||d.x>width+20)dots[i]=spawn(false);
        ctx.globalAlpha=.25+.35*(.5+.5*Math.sin(time*.0015+d.phase));
        ctx.drawImage(d.img,d.x-d.r,d.y-d.r,d.r*2,d.r*2);
      }
      ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
      raf=requestAnimationFrame(tick);
    };
    const observer=new ResizeObserver(resize);observer.observe(canvas);resize();
    const wake=()=>{cancelAnimationFrame(raf);clearTimeout(sleep);raf=requestAnimationFrame(tick);};
    window.addEventListener('wb-effects',wake);document.addEventListener('visibilitychange',wake);
    raf=requestAnimationFrame(tick);
    return()=>{alive=false;cancelAnimationFrame(raf);clearTimeout(sleep);observer.disconnect();window.removeEventListener('wb-effects',wake);document.removeEventListener('visibilitychange',wake);};
  },[density,colors]);
  return <canvas ref={ref} className={'ambient-particles '+className} aria-hidden="true"/>;
}
