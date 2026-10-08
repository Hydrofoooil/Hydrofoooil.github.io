// Loaded only in the workbench iframe, never on the published homepage.
import {normalizeLayout,applyLayout} from './layout-model.js';
const layers={english:document.querySelector('.name-en'),chinese:document.querySelector('.name-zh'),links:document.querySelector('.social-links')};
let layout,drag,selected='english',artRevision=0,editVersion=0;
const send=data=>parent.postMessage(data,location.origin);
const style=document.createElement('style');style.textContent='.name-en,.name-zh,.social-links{cursor:grab;touch-action:none;user-select:none}.social-links>*{pointer-events:none}.name-en:hover,.name-zh:hover,.social-links:hover,[data-selected="true"]{outline:1px dashed #287da4;outline-offset:6px}';document.head.append(style);
// Keep the first screen stationary while positioning elements in the workbench.
style.textContent+='body{overflow:hidden}.second-page{display:none}.scroll-cue{pointer-events:none}';
document.querySelector('.scroll-cue')?.setAttribute('tabindex','-1');
function select(layer){selected=layer;for(const [key,node]of Object.entries(layers))node.dataset.selected=String(key===layer);send({type:'layout-select',layer});}
function move(layer,x,y){layout[layer].x=Math.round(Math.max(0,Math.min(100,x))*1000)/1000;layout[layer].y=Math.round(Math.max(0,Math.min(100,y))*1000)/1000;if(layer==='links')layout.links.followName=false;applyLayout(layout);send({type:'layout-move',layer,x:layout[layer].x,y:layout[layer].y,editVersion});}
for(const [layer,node]of Object.entries(layers)){
 node.tabIndex=0;node.setAttribute('aria-label',layer==='english'?'拖动英文名':layer==='chinese'?'拖动中文名':'拖动个人链接');
 node.onpointerdown=event=>{if(event.button!==0||!layout)return;event.preventDefault();node.focus({preventScroll:true});node.setPointerCapture(event.pointerId);select(layer);const box=node.getBoundingClientRect();drag={layer,x:event.clientX,y:event.clientY,startX:box.left/innerWidth*100,startY:box.top/innerHeight*100,maxX:Math.max(0,100-box.width/innerWidth*100),maxY:Math.max(0,100-box.height/innerHeight*100)};};
 node.onpointermove=event=>{if(drag?.layer!==layer)return;move(layer,Math.min(drag.maxX,drag.startX+(event.clientX-drag.x)/innerWidth*100),Math.min(drag.maxY,drag.startY+(event.clientY-drag.y)/innerHeight*100));};
 node.onpointerup=node.onpointercancel=()=>drag=null;
 node.onkeydown=event=>{if(!layout||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();select(layer);const step=event.shiftKey?10:1,box=node.getBoundingClientRect();move(layer,(box.left+({'ArrowLeft':-step,'ArrowRight':step}[event.key]||0))/innerWidth*100,(box.top+({'ArrowUp':-step,'ArrowDown':step}[event.key]||0))/innerHeight*100);};
}
window.addEventListener('message',event=>{
 if(event.source!==parent||event.origin!==location.origin||event.data?.type!=='layout-preview')return;
 const message=event.data;if(message.editVersion!==editVersion)drag=null;editVersion=message.editVersion;layout=normalizeLayout(message.layout);applyLayout(layout);
 if(message.selected){selected=message.selected;for(const [key,node]of Object.entries(layers))node.dataset.selected=String(key===selected);}
 if(message.artwork){
  const artwork=message.artwork,im=document.querySelector('.splash-photo');im.src=artwork.photoUrl;im.width=artwork.width;im.height=artwork.height;im.style.aspectRatio=`${artwork.width} / ${artwork.height}`;
  for(const [key,value]of Object.entries(artwork.dimensions))im.style.setProperty('--'+key,String(value));
  im.style.maskImage=im.style.webkitMaskImage=`url("${artwork.mask}")`;
  const revision=++artRevision;im.decode().then(()=>{if(revision===artRevision)send({type:'layout-art-ready'});}).catch(()=>{});
 }
});
send({type:'layout-preview-ready'});
