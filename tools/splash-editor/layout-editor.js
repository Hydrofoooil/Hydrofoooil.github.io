import {DEFAULT_LAYOUT,FONTS,normalizeLayout} from './layout-model.js';
const $=selector=>document.querySelector(selector),copy=value=>structuredClone(value);
export function createLayoutEditor({readState,artwork,onChange,toast}){
 const frame=$('#layout-frame');let selected='english',visible=false,frameReady=false,lastMask,lastPhoto,cachedArtwork,editVersion=0;
 let viewport={width:innerWidth,height:innerHeight};
 function post(extra={}){if(frameReady)frame.contentWindow.postMessage({type:'layout-preview',layout:readState().layout,selected,editVersion,...extra},location.origin);}
 function sync(bump=true){
  if(bump)editVersion++;
  const value=readState().layout[selected],links=selected==='links';$('#text-layer').value=selected;
  $('#name-controls').hidden=links;$('#links-controls').hidden=!links;
  for(const key of links?['style','font','size','color','gap','offset','x','y','wechatQr']:['text','font','size','weight','color','tracking','x','y']){
   const input=$((links?'#links-':'#layout-')+key);if(document.activeElement!==input)input.value=value[key];
   const output=document.querySelector(`[data-${links?'links':'layout'}-output="${key}"]`);if(output)output.textContent=value[key];
  }
  if(links){$('#links-followName').checked=value.followName;$('#links-offset-field').hidden=!value.followName;$('#links-position-controls').hidden=value.followName;for(const [id,url]of Object.entries(value.destinations))if(document.activeElement!==$('#link-'+id))$('#link-'+id).value=url;}
  post();
 }
 function commitLayout(next){const value=normalizeLayout(next);if(JSON.stringify(value)===JSON.stringify(readState().layout))return;editVersion++;onChange(value);sync(false);}
 function change(key,value){try{const next=copy(readState().layout);next[selected][key]=value;commitLayout(next);}catch(error){toast(error.message);}}
 function changeLinks(key,value,destination=false){try{const next=copy(readState().layout);if(destination)next.links.destinations[key]=value;else next.links[key]=value;commitLayout(next);}catch(error){toast(error.message);}}
 function fit(){
  if(!visible)return;const rect=$('#layout-board').getBoundingClientRect(),scale=Math.min(1,(rect.width-24)/viewport.width,(rect.height-24)/viewport.height);
  Object.assign($('#layout-frame-shell').style,{width:viewport.width*scale+'px',height:viewport.height*scale+'px'});
  Object.assign(frame.style,{width:viewport.width+'px',height:viewport.height+'px',transform:`scale(${scale})`});
  $('#layout-scale').textContent=`${viewport.width} × ${viewport.height} · 预览 ${Math.round(scale*100)}%`;
 }
 function dimensions(){viewport={width:Math.max(280,Math.min(3840,Math.round(+$('#layout-width').value)||1440)),height:Math.max(240,Math.min(2160,Math.round(+$('#layout-height').value)||900))};$('#layout-width').value=viewport.width;$('#layout-height').value=viewport.height;fit();}
 function syncArtwork(force=false){
  if(!visible||!frameReady)return;const current=artwork();if(!current)return;
  if(current.mask!==lastMask||current.entry.id!==lastPhoto){
   const {mask,photo,entry}=current,w=photo.width,h=photo.height;
   const full=document.createElement('canvas');full.width=w;full.height=h;const ctx=full.getContext('2d',{willReadFrequently:true});ctx.drawImage(mask,0,0,w,h);
   const alpha=ctx.getImageData(0,0,w,h).data,maskUrl=full.toDataURL();ctx.clearRect(0,0,w,h);ctx.drawImage(photo,0,0);const original=ctx.getImageData(0,0,w,h).data;
   let left=w,top=h,right=0,bottom=0;
   for(let y=0;y<h;y++)for(let x=0;x<w;x++){const index=(y*w+x)*4+3;if(Math.floor(original[index]*alpha[index]/255)>0){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1);}}
   if(right<=left||bottom<=top){left=0;top=0;right=w;bottom=h;}
   cachedArtwork={photoUrl:entry.url,mask:maskUrl,width:w,height:h,dimensions:{'photo-width':w,'photo-height':h,'crop-width':right-left,'crop-height':bottom-top,'crop-center-x':(left+right)/2,'crop-right':right,'crop-bottom-padding':h-bottom}};
   lastMask=mask;lastPhoto=entry.id;force=true;
  }
  if(force){$('#layout-preview-status').textContent='正在更新首页预览…';post({artwork:cachedArtwork});}
 }
 function show(active){
  visible=active;$('#art-view').hidden=active;$('#homepage-view').hidden=!active;$('#art-controls-panel').hidden=active;$('#layout-controls-panel').hidden=!active;
  $('#workbench-art').classList.toggle('active',!active);$('#workbench-layout').classList.toggle('active',active);
  $('#workbench-art').setAttribute('aria-pressed',String(!active));$('#workbench-layout').setAttribute('aria-pressed',String(active));
  if(active){fit();sync(false);syncArtwork(true);}
 }
 $('#workbench-art').onclick=()=>show(false);$('#workbench-layout').onclick=()=>show(true);
 $('#text-layer').onchange=event=>{selected=event.target.value;sync(false);};
 const fontGroups=new Map();
 for(const font of FONTS){
  const label=font.group||'其他字体';let group=fontGroups.get(label);
  if(!group){group=document.createElement('optgroup');group.label=label;fontGroups.set(label,group);$('#layout-font').append(group);}
  const option=document.createElement('option');option.value=font.id;option.textContent=font.label;group.append(option);
 }
 $('#links-font').append(...[...$('#layout-font').children].map(node=>node.cloneNode(true)));
 for(const key of ['text','font','size','weight','color','tracking','x','y'])$('#layout-'+key).addEventListener(['font','weight'].includes(key)?'change':'input',event=>change(key,['size','weight','tracking','x','y'].includes(key)?+event.target.value:event.target.value));
 for(const key of ['style','font','size','color','gap','offset','x','y','wechatQr'])$('#links-'+key).addEventListener(['style','font','wechatQr'].includes(key)?'change':'input',event=>changeLinks(key,['size','gap','offset','x','y'].includes(key)?+event.target.value:event.target.value));
 $('#links-followName').onchange=event=>changeLinks('followName',event.target.checked);
 for(const id of ['email','scholar','github','wechat','cv'])$('#link-'+id).onchange=event=>changeLinks(id,event.target.value,true);
 $('#layout-reset').onclick=()=>{editVersion++;onChange(copy(DEFAULT_LAYOUT));sync(false);};
 $('#layout-device').onchange=event=>{
  const size=event.target.value==='window'?[innerWidth,innerHeight]:event.target.value.split('x').map(Number);
  if(size.length===2&&size.every(Number.isFinite)){$('#layout-width').value=size[0];$('#layout-height').value=size[1];dimensions();}
 };
 for(const id of ['layout-width','layout-height'])$('#'+id).onchange=()=>{$('#layout-device').value='custom';dimensions();};
 $('#layout-width').value=viewport.width;$('#layout-height').value=viewport.height;
 new ResizeObserver(fit).observe($('#layout-board'));
 window.addEventListener('resize',()=>{if($('#layout-device').value==='window'){$('#layout-width').value=innerWidth;$('#layout-height').value=innerHeight;dimensions();}else fit();});
 window.addEventListener('message',event=>{
  if(event.source!==frame.contentWindow||event.origin!==location.origin)return;const data=event.data;
  if(data?.type==='layout-preview-ready'){frameReady=true;sync(false);syncArtwork(true);}
  if(data?.type==='layout-art-ready')$('#layout-preview-status').textContent='拖动姓名或整组链接摆放位置；设置与首页同步使用。';
  if(data?.type==='layout-select'&&['english','chinese','links'].includes(data.layer)){selected=data.layer;sync(false);}
  if(data?.type==='layout-move'&&data.editVersion===editVersion&&['english','chinese','links'].includes(data.layer)){try{const next=copy(readState().layout);next[data.layer].x=data.x;next[data.layer].y=data.y;if(data.layer==='links')next.links.followName=false;onChange(normalizeLayout(next));sync(false);}catch(error){toast(error.message);}}
 });
 frame.src='/homepage/?preview=1';sync();
 return {sync,syncArtwork,show};
}
