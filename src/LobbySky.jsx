import React from 'react';

// Lobby night sky (DIS-002 v06): tiny stars that fade in and out, and a rare comet. Pure CSS animation, no JS per frame.
// Layout is pseudo-random but fixed (same sky on every visit). Kept faint so the project cards stay the focus.
const rnd=(i,k)=>{const v=Math.sin(i*12.9898+k*78.233)*43758.5453;return v-Math.floor(v);};
const stars=Array.from({length:70},(_,i)=>({
  x:(rnd(i,1)*100).toFixed(1)+'%',y:(rnd(i,2)*100).toFixed(1)+'%',z:(.8+rnd(i,3)*1.1).toFixed(1)+'px',
  t:(4+rnd(i,4)*6).toFixed(1)+'s',w:(-rnd(i,5)*10).toFixed(1)+'s',o:(.25+rnd(i,6)*.5).toFixed(2),spark:rnd(i,7)>.93,
}));
// Each comet crosses in ~1 s once per cycle; long, different cycles keep them rare and out of step.
const comets=[
  {x:'72%',y:'6%', a:'152deg',t:'23s',w:'-4s', len:'46vmax'},
  {x:'38%',y:'-2%',a:'128deg',t:'31s',w:'-17s',len:'40vmax'},
  {x:'96%',y:'34%',a:'166deg',t:'41s',w:'-29s',len:'52vmax'},
];

export default function LobbySky(){
  return <div className="lobby-sky" aria-hidden="true">
    {stars.map((s,i)=><i key={i} className={'sky-star'+(s.spark?' spark':'')} style={{'--x':s.x,'--y':s.y,'--z':s.z,'--t':s.t,'--w':s.w,'--o':s.o}}/>)}
    {comets.map((c,i)=><b key={i} className="sky-comet" style={{'--x':c.x,'--y':c.y,'--a':c.a,'--t':c.t,'--w':c.w,'--len':c.len}}/>)}
  </div>;
}
