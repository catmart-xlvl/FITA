import test from 'node:test';
import assert from 'node:assert/strict';
import {OrthographicCamera,PerspectiveCamera} from 'three';
import {resizeViewer,watchViewerSize} from '../src/viewer-resize.js';

function emitter(){const events=new Map();return {events,addEventListener(k,f){events.set(k,f);},removeEventListener(k,f){if(events.get(k)===f)events.delete(k);}};}
function renderer(){return {ratio:1,domElement:{style:{}},sizes:[],viewports:[],getPixelRatio(){return this.ratio;},setPixelRatio(v){this.ratio=v;},setSize(...v){this.sizes.push(v);},setViewport(...v){this.viewports.push(v);}};}
test('stage scale animation cannot shrink the canvas and CSS always fills its host',()=>{
 const host={clientWidth:1000,clientHeight:600,getBoundingClientRect(){throw Error('Animated bounds must not size the renderer');}},render=renderer(),camera=new OrthographicCamera(-2,2,2,-2),win={...emitter(),devicePixelRatio:1,visualViewport:emitter()},doc=emitter();let callback,disconnected=false;
 const watch=watchViewerSize(host,render,camera,{window:win,document:doc,ResizeObserver:class{constructor(fn){callback=fn;}observe(){}disconnect(){disconnected=true;}}});
 assert.deepEqual(render.sizes.at(-1),[1000,600,false]);assert.equal(render.domElement.style.width,'100%');assert.equal(render.domElement.style.height,'100%');
 callback([{target:host,contentRect:{width:1000.5,height:600.25}}]);assert.deepEqual(render.sizes.at(-1),[1000.5,600.25,false]);
 assert.equal(camera.aspect,1000.5/600.25);assert.equal(camera.top,2);assert.equal(camera.bottom,-2);
 host.clientWidth=0;host.clientHeight=0;win.events.get('resize')();assert.deepEqual(render.sizes.at(-1),[1000.5,600.25,false]);
 host.clientWidth=1200;host.clientHeight=720;doc.events.get('fullscreenchange')();assert.deepEqual(render.sizes.at(-1),[1200,720,false]);
 watch.dispose();assert(disconnected);assert.equal(win.events.size,0);assert.equal(doc.events.size,0);assert.equal(win.visualViewport.events.size,0);callback([{target:host,contentRect:{width:10,height:10}}]);assert.deepEqual(render.sizes.at(-1),[1200,720,false]);
});
test('zoom and screen pixel-density changes refresh the buffer even when CSS dimensions stay fixed',()=>{
 const host={clientWidth:900,clientHeight:600},render=renderer(),camera=new PerspectiveCamera(35,1,.1,100),win={...emitter(),devicePixelRatio:1,visualViewport:emitter()},doc=emitter();
 camera.position.set(2,3,4);camera.zoom=2;const watch=watchViewerSize(host,render,camera,{window:win,document:doc,ResizeObserver:class{observe(){}disconnect(){}}});
 win.devicePixelRatio=1.25;watch.pixelRatio();assert.equal(render.ratio,1.25);assert.deepEqual(render.viewports.at(-1),[0,0,900,600]);assert.deepEqual(camera.position.toArray(),[2,3,4]);assert.equal(camera.zoom,2);
 const count=render.sizes.length;watch.pixelRatio();assert.equal(render.sizes.length,count);win.devicePixelRatio=3;watch.pixelRatio();assert.equal(render.ratio,2);
 host.clientWidth=720;win.visualViewport.events.get('resize')();assert.equal(camera.aspect,1.2);watch.dispose();
});
test('hidden viewers retain a valid projection until their layout returns',()=>{
 const render=renderer(),camera=new OrthographicCamera(-1,1,2,-2);assert.equal(resizeViewer(render,camera,0,100),false);assert.equal(render.sizes.length,0);assert.equal(resizeViewer(render,camera,800,400,1),true);assert.equal(camera.right-camera.left,8);assert(Number.isFinite(camera.projectionMatrix.elements[0]));
});
