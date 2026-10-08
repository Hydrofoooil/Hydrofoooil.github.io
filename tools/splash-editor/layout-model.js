import schema from './layout-schema.json';
export const FONTS=schema.fonts,DEFAULT_LAYOUT=schema.default;
export const LINK_ITEMS=schema.linkItems;
function linkUrl(value,relative=false){
 if(typeof value!=='string'||value.length>2048||/[\u0000-\u0020\u007f\\]/.test(value))throw new Error('链接地址不能包含空格或控制字符');
 if(!value)return '';
 if(relative&&/^(?:\.\/)?assets\//.test(value)&&!value.split('/').includes('..')&&!value.includes(':'))return value.replace(/^\.\//,'');
 try{const url=new URL(value);if(['https:','http:'].includes(url.protocol)&&url.hostname)return value;}catch{}
 throw new Error(relative?'请输入 http(s) 网址或 assets/ 下的文件路径':'请输入完整的 http(s) 网址');
}
export function normalizeLinks(input=DEFAULT_LAYOUT.links){
 const value={...DEFAULT_LAYOUT.links,...input,destinations:{...DEFAULT_LAYOUT.links.destinations,...input?.destinations}};
 if(!['outline','underline','soft'].includes(value.style)||!FONTS.some(font=>font.id===value.font)||typeof value.followName!=='boolean')throw new Error('链接样式无效');
 if(typeof value.color!=='string'||!/^#[\da-f]{6}$/i.test(value.color))throw new Error('链接颜色格式无效');
 for(const [key,[min,max]]of Object.entries(schema.linkLimits))if(typeof value[key]!=='number'||!Number.isFinite(value[key])||value[key]<min||value[key]>max)throw new Error('链接排版参数超出范围');
 const destinations={};
 for(const {id}of LINK_ITEMS){
  const raw=value.destinations[id];if(typeof raw!=='string')throw new Error('链接地址无效');const text=raw.trim();
  if(id==='email'){const email=text.replace(/^mailto:/i,'');if(email&&(!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)||email.length>200))throw new Error('Email 地址无效');destinations[id]=email;}
  else if(id==='wechat'&&text&&!/^https?:\/\//i.test(text)){if(text.length>80||/[\s<>"\\:\u0000-\u001f\u007f]/.test(text))throw new Error('请输入微信号或完整网址');destinations[id]=text;}
  else destinations[id]=linkUrl(text,id==='cv');
 }
 if(typeof value.wechatQr!=='string')throw new Error('微信二维码地址无效');
 return {style:value.style,font:value.font,size:value.size,gap:value.gap,color:value.color.toLowerCase(),followName:value.followName,offset:value.offset,x:value.x,y:value.y,destinations,wechatQr:linkUrl(value.wechatQr.trim(),true)};
}
export function normalizeLayout(input=DEFAULT_LAYOUT){
 const result={};
 for(const layer of ['english','chinese']){
  const source=input?.[layer];if(!source||typeof source.text!=='string'||source.text.length>80)throw new Error('姓名文字最多 80 个字符');
  if(!FONTS.some(font=>font.id===source.font))throw new Error('未知文字字体');
  if(typeof source.color!=='string'||!/^#[\da-f]{6}$/i.test(source.color))throw new Error('文字颜色格式无效');
  const value={text:source.text,font:source.font,size:source.size,weight:source.weight,color:source.color.toLowerCase(),tracking:source.tracking,x:source.x,y:source.y};
  for(const [key,[min,max]]of Object.entries(schema.limits))if(typeof value[key]!=='number'||!Number.isFinite(value[key])||value[key]<min||value[key]>max)throw new Error('文字参数超出范围');
  result[layer]=value;
 }
 result.links=normalizeLinks(input?.links);
 return result;
}
export function linkPosition(layout){const links=layout.links;return links.followName?{left:layout.chinese.x+'%',top:`calc(${layout.chinese.y}% + ${layout.chinese.size*1.5+links.offset}px)`}:{left:links.x+'%',top:links.y+'%'};}
const escaped=value=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#x27;'}[char]));
export function linksMarkup(links){
 const items=LINK_ITEMS.map(({id,label,icon})=>{
  const iconMarkup=`<svg class="social-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>`;
  const content=`${iconMarkup}<span>${label}</span><span class="social-arrow" aria-hidden="true">↗</span>`;
  const destination=links.destinations[id],contact=id==='wechat'&&(destination&&!/^https?:\/\//i.test(destination)||links.wechatQr);
  if(contact)return `<button type="button" class="social-link" data-link="wechat" popovertarget="wechat-contact">${content}</button><div class="wechat-card" id="wechat-contact" popover="auto" aria-labelledby="wechat-heading"><div class="wechat-heading"><span id="wechat-heading">WeChat</span><button type="button" popovertarget="wechat-contact" popovertargetaction="hide" aria-label="关闭微信二维码">×</button></div>${links.wechatQr?`<a href="${escaped(links.wechatQr)}" target="_blank" rel="noopener noreferrer"><img src="${escaped(links.wechatQr)}" alt="毛挺的微信二维码" loading="lazy"></a>`:''}${destination&&!/^https?:\/\//i.test(destination)?`<p>微信号 <strong>${escaped(destination)}</strong></p>`:''}${/^https?:\/\//i.test(destination)?`<a href="${escaped(destination)}" target="_blank" rel="noopener noreferrer">打开微信链接 ↗</a>`:''}</div>`;
  const href=id==='email'&&destination?'mailto:'+destination:destination;
  return `<a class="social-link" data-link="${id}" ${href?`href="${escaped(href)}"${id==='email'?'':' target="_blank" rel="noopener noreferrer"'}`:'role="link" aria-disabled="true" title="尚未填写链接地址"'}>${content}</a>`;
 });
 return `<div class="social-row">${items.slice(0,2).join('\n')}</div>\n<div class="social-row">${items.slice(2).join('\n')}</div>`;
}
export function applyLayout(layout){
 for(const [layer,selector]of [['english','.name-en'],['chinese','.name-zh']]){
  const value=layout[layer],node=document.querySelector(selector);node.textContent=value.text;
  Object.assign(node.style,{fontFamily:FONTS.find(font=>font.id===value.font).css,fontSize:value.size+'px',fontWeight:String(value.weight),color:value.color,letterSpacing:value.tracking+'px',left:value.x+'%',top:value.y+'%'});
 }
 const links=layout.links,node=document.querySelector('.social-links');if(!node)return;
 Object.assign(node.style,{...linkPosition(layout),fontFamily:FONTS.find(font=>font.id===links.font).css,fontSize:links.size+'px',color:links.color});
 node.style.setProperty('--link-gap',links.gap+'px');node.style.setProperty('--link-left',linkPosition(layout).left);node.dataset.style=links.style;
 const html=linksMarkup(links);if(node._linksMarkup!==html){node.innerHTML=html;node._linksMarkup=html;}
}
