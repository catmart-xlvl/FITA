// Layout measurements must exclude the stage's animated CSS transform.
export function resizeViewer(renderer,camera,width,height,pixelRatio=1){
 if(!(width>0&&height>0))return false;
 const ratio=Number.isFinite(pixelRatio)&&pixelRatio>0?Math.min(pixelRatio,2):1;
 if(renderer.getPixelRatio()!==ratio)renderer.setPixelRatio(ratio);
 renderer.setSize(width,height,false);
 renderer.setViewport(0,0,width,height);
 camera.aspect=width/height;
 if(camera.isOrthographicCamera){const half=(camera.top-camera.bottom)/2,center=(camera.right+camera.left)/2;camera.left=center-half*camera.aspect;camera.right=center+half*camera.aspect;}
 camera.updateProjectionMatrix();return true;
}

export function watchViewerSize(host,renderer,camera,{window:win=globalThis.window,document:doc=globalThis.document,ResizeObserver:Observer=globalThis.ResizeObserver}={}){
 let disposed=false,lastWidth=0,lastHeight=0,lastRatio=0;
 // CSS fills fractional layout bounds as well as integer canvas buffer sizes.
 renderer.domElement.style.width='100%';renderer.domElement.style.height='100%';
 function update(entry){
  if(disposed)return;
  const width=entry?.contentRect?.width??host.clientWidth,height=entry?.contentRect?.height??host.clientHeight,ratio=Math.min(win.devicePixelRatio||1,2);
  if(width===lastWidth&&height===lastHeight&&ratio===lastRatio)return;
  if(resizeViewer(renderer,camera,width,height,ratio)){lastWidth=width;lastHeight=height;lastRatio=ratio;}
 }
 const observer=new Observer(entries=>{const entry=entries.find(e=>e.target===host);if(entry)update(entry);});observer.observe(host);
 const changed=()=>update();win.addEventListener('resize',changed);doc.addEventListener('fullscreenchange',changed);win.visualViewport?.addEventListener('resize',changed);update();
 return {pixelRatio(){if(Math.min(win.devicePixelRatio||1,2)!==lastRatio)update();},dispose(){disposed=true;observer.disconnect();win.removeEventListener('resize',changed);doc.removeEventListener('fullscreenchange',changed);win.visualViewport?.removeEventListener('resize',changed);}};
}
