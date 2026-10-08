import {pathData} from './geometry.js';
const NS='http://www.w3.org/2000/svg',copy=p=>p.map(v=>[...v]);
export class ContourEditor{
 constructor(svg,read,onChange,onHistory,onDrawing=()=>{}){this.svg=svg;this.read=read;this.onChange=onChange;this.onHistory=onHistory;this.onDrawing=onDrawing;this.history=[];this.future=[];this.enabled=true;this.drawing=false;
 svg.addEventListener('pointerdown',e=>this.down(e));svg.addEventListener('pointermove',e=>this.move(e));svg.addEventListener('pointerup',e=>this.up(e));svg.addEventListener('pointercancel',()=>this.cancelStroke());svg.addEventListener('dblclick',e=>this.double(e));}
 node(tag,attrs){const el=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,v);return el;}
 point(e){const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(this.svg.getScreenCTM().inverse());return [Math.max(0,Math.min(1,p.x/1000)),Math.max(0,Math.min(1,p.y/this.height))];}
 refresh(){const s=this.read();this.height=1000*s.height/s.width;this.svg.setAttribute('viewBox',`0 0 1000 ${this.height}`);this.svg.replaceChildren();
 this.outline=this.node('path',{d:pathData(s.points,1000,this.height,s.smooth),class:'outline',visibility:this.drawing?'hidden':'visible'});this.svg.append(this.outline);
 this.circles=s.points.map(([x,y],i)=>{const el=this.node('circle',{cx:x*1000,cy:y*this.height,r:6,'data-index':i,visibility:this.drawing?'hidden':'visible'});this.svg.append(el);return el;});this.svg.toggleAttribute('hidden',!this.enabled);this.svg.dataset.drawing=String(this.drawing);}
 startDrawing(){this.enabledBeforeDrawing=this.enabled;this.enabled=true;this.drawing=true;this.refresh();this.onDrawing(true);}
 cancelStroke(){if(this.drawPoints){this.drawPoints=null;this.drawPath?.remove();}else if(this.drag){const points=this.drag.points;this.drag=null;this.history.pop();this.onChange(copy(points),true);this.refresh();this.onHistory(this.history.length,this.future.length);}}
 cancelDrawing(){if(!this.drawing)return;this.cancelStroke();this.drawing=false;this.enabled=this.enabledBeforeDrawing;this.refresh();this.onDrawing(false);}
 coordinates(){const s=this.read();this.outline.setAttribute('d',pathData(s.points,1000,this.height,s.smooth));s.points.forEach(([x,y],i)=>{this.circles[i]?.setAttribute('cx',x*1000);this.circles[i]?.setAttribute('cy',y*this.height);});}
 remember(){this.history.push(copy(this.read().points));this.history=this.history.slice(-50);this.future=[];this.onHistory(this.history.length,this.future.length);}
 set(points){this.remember();this.onChange(copy(points),true);this.refresh();}
 undo(){if(!this.history.length)return;this.future.push(copy(this.read().points));this.onChange(this.history.pop(),true);this.refresh();this.onHistory(this.history.length,this.future.length);}
 redo(){if(!this.future.length)return;this.history.push(copy(this.read().points));this.onChange(this.future.pop(),true);this.refresh();this.onHistory(this.history.length,this.future.length);}
 down(e){if(e.button!==0||!this.enabled)return;e.preventDefault();this.svg.setPointerCapture(e.pointerId);const p=this.point(e);if(!this.drawing)this.remember();
 if(this.drawing){this.drawPoints=[p];this.drawPath=this.node('path',{class:'drawing'});this.svg.append(this.drawPath);}
 else{const idx=e.target.getAttribute('data-index');this.drag={index:idx===null?null:Number(idx),start:p,points:copy(this.read().points)};}}
 move(e){if(this.drawPoints){const p=this.point(e),last=this.drawPoints.at(-1);if(Math.hypot(p[0]-last[0],p[1]-last[1])>.005)this.drawPoints.push(p);this.drawPath.setAttribute('d',this.drawPoints.map(([x,y],i)=>`${i?'L':'M'} ${x*1000} ${y*this.height}`).join(' '));return;}
 if(!this.drag)return;const p=this.point(e),{index,start,points}=this.drag;let next=copy(points);
 if(index!==null)next[index]=p;else{const dx=Math.max(-Math.min(...points.map(v=>v[0])),Math.min(1-Math.max(...points.map(v=>v[0])),p[0]-start[0])),dy=Math.max(-Math.min(...points.map(v=>v[1])),Math.min(1-Math.max(...points.map(v=>v[1])),p[1]-start[1]));next=points.map(([x,y])=>[x+dx,y+dy]);}
 this.onChange(next,false);this.coordinates();}
 up(){if(this.drawPoints){let p=this.drawPoints;this.drawPoints=null;this.drawPath.remove();if(p.length<4){this.onDrawing(true,'轨迹太短，请按住鼠标重新画一圈；松开后自动闭合。');return;}const step=Math.max(1,Math.ceil(p.length/60));p=p.filter((_,i)=>i%step===0);this.remember();this.onChange(p,true);this.drawing=false;this.enabled=this.enabledBeforeDrawing;this.refresh();this.onDrawing(false);}
 else if(this.drag){this.drag=null;this.onChange(copy(this.read().points),true);}}
 double(e){if(this.drawing||!this.enabled)return;e.preventDefault();const s=this.read(),p=copy(s.points),idx=e.target.getAttribute('data-index');
 if(idx!==null){if(p.length<=3)return;p.splice(Number(idx),1);}else{if(p.length>=80)return;const v=this.point(e);let best=0,dist=Infinity;for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length],dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((v[0]-a[0])*dx+(v[1]-a[1])*dy)/(dx*dx+dy*dy||1))),d=Math.hypot(v[0]-a[0]-dx*t,v[1]-a[1]-dy*t);if(d<dist){dist=d;best=i+1;}}p.splice(best,0,v);}this.set(p);}
}
