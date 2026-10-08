// Named, server-persisted settings and exact rendered masks for repeatable comparisons.
import {ENGINES} from './engines.js';
const $=s=>document.querySelector(s);
async function request(path, options){
 const response=await fetch('/api/presets'+path,options),body=await response.json();
 if(!response.ok)throw new Error(body.error||'方案操作失败');
 return body;
}
export function createPresets({current,restore,photos,toast}){
 let records=[],selected=null,selectedState=null,selectedMask=null,mutating=false,loading=false,sequence=0,available=false;
 function sync(){
  const now=current(),blocked=mutating||loading||!available;
  $('#preset-save').disabled=blocked||!now.ready;
  $('#preset-overwrite').disabled=blocked||!now.ready||!selected;
  const dirty=selected&&(JSON.stringify(now.settings)!==selectedState||now.mask!==selectedMask);
  $('#preset-current').textContent=loading?'正在载入方案…':selected?`当前方案：${selected.name}${dirty?'（预览已修改，尚未覆盖）':' · 已载入'}`:available?'尚未选择方案':'正在读取方案列表…';
  document.querySelectorAll('.preset-load').forEach(button=>{const active=button.dataset.id===selected?.id;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));button.disabled=mutating;});
  document.querySelectorAll('.preset-delete').forEach(button=>button.disabled=mutating||loading);
 }
 function render(){
  const list=$('#preset-list');list.replaceChildren();$('#preset-count').textContent=records.length;
  if(!records.length){const p=document.createElement('p');p.className='preset-empty';p.textContent='还没有方案，调好后点击「保存为新方案」。';list.append(p);}
  for(const record of records){
   const row=document.createElement('div');row.className='preset-row';
   const button=document.createElement('button');button.className='preset-load';button.dataset.id=record.id;
   const name=document.createElement('strong'),detail=document.createElement('small');name.textContent=record.name;
   detail.textContent=`${ENGINES.find(e=>e.id===record.engine)?.name||record.engine} · ${photos.find(p=>p.id===record.photoId)?.label||record.photoId}`;
   button.append(name,detail);button.onclick=()=>load(record.id);
   const remove=document.createElement('button');remove.className='preset-delete';remove.textContent='删除';remove.setAttribute('aria-label','删除方案：'+record.name);remove.onclick=()=>erase(record);
   row.append(button,remove);list.append(row);
  }
  sync();
 }
 async function refresh(){records=(await request('')).presets;available=true;render();}
 async function save(overwrite=false){
  if(mutating||loading)return;
  const now=current();if(!now.ready){toast('请等待效果生成完成后保存');return;}
  if(overwrite&&!selected)return;
  const name=$('#preset-name').value.trim();if(!name){toast('请先填写方案名称');$('#preset-name').focus();return;}
  // Capture before awaiting the server; edits during a save stay visibly unsaved.
  const settings=now.settings,mask=now.mask,data=mask.toDataURL('image/png');
  mutating=true;sync();
  try{
   const body=await request('',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,settings,mask:data,...(overwrite?{id:selected.id}:{})})});
   selected=body.preset;selectedState=JSON.stringify(settings);selectedMask=mask;
   records=records.filter(r=>r.id!==selected.id);records.unshift(selected);render();
   toast(overwrite?'已覆盖方案：'+name:'已保存新方案：'+name);
  }catch(error){toast('保存失败：'+error.message);}
  finally{mutating=false;sync();}
 }
 async function load(id){
  if(mutating)return;
  const ticket=++sequence;loading=true;sync();
  try{
   const record=await request('/'+id),image=new Image();image.src=record.mask;await image.decode();
   if(ticket!==sequence)return;
   restore(record.settings,image);
   selected={id:record.id,name:record.name};selectedState=JSON.stringify(current().settings);selectedMask=current().mask;
   $('#preset-name').value=record.name;toast('已载入方案：'+record.name);
  }catch(error){if(ticket===sequence)toast('载入失败：'+error.message);}
  finally{if(ticket===sequence){loading=false;sync();}}
 }
 async function erase(record){
  if(mutating||loading)return;mutating=true;sync();
  try{
   await request('/'+record.id,{method:'DELETE'});records=records.filter(r=>r.id!==record.id);
   if(selected?.id===record.id){selected=null;selectedState=null;selectedMask=null;}
   render();toast('已删除方案，当前预览保留：'+record.name);
  }catch(error){toast('删除失败：'+error.message);}
  finally{mutating=false;sync();}
 }
 $('#preset-save').onclick=()=>save();$('#preset-overwrite').onclick=()=>save(true);
 refresh().catch(error=>{$('#preset-current').textContent='读取方案失败：'+error.message;toast('读取方案失败：'+error.message);});
 return {sync};
}
