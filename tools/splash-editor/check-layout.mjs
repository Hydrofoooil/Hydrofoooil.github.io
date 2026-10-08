// Real dragging in a scaled iframe, persistence, and exact preview/homepage agreement.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink,mkdir} from 'node:fs/promises';
const base=process.env.EDITOR_URL||'http://127.0.0.1:8765/';
const files=['index.html','styles.css','assets/contour-splash-mask.svg','assets/splash-settings.json','assets/homepage-layout.css','assets/homepage-layout.json'];
const backups=await Promise.all(files.map(file=>readFile(new URL('../../'+file,import.meta.url)).catch(error=>{if(error.code==='ENOENT')return null;throw error;})));
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960},acceptDownloads:true}),ids=[],errors=[];
page.on('pageerror',error=>errors.push(error.message));
const ready=()=>page.waitForFunction(()=>window.artWorkbench?.ready);
async function range(id,value){await page.locator('#'+id).evaluate((node,value)=>{node.value=value;node.dispatchEvent(new Event('input',{bubbles:true}));},String(value));}
async function save(name){
 await page.locator('#preset-name').fill(name);const responsePromise=page.waitForResponse(r=>r.url().endsWith('/api/presets')&&r.request().method()==='POST');await page.locator('#preset-save').click();
 const response=await responsePromise;assert.equal(response.status(),200);const record=(await response.json()).preset;ids.push(record.id);return record.id;
}
async function load(id){await page.locator(`.preset-load[data-id="${id}"]`).click();await page.waitForFunction(id=>document.querySelector('.preset-load.active')?.dataset.id===id&&!document.querySelector('#preset-current').textContent.includes('正在'),id);await ready();}
async function metrics(frame){return frame.evaluate(async()=>{
 await document.fonts.ready;
 const out={};for(const selector of ['.name-en','.name-zh']){const node=document.querySelector(selector),s=getComputedStyle(node),r=node.getBoundingClientRect();out[selector]={text:node.textContent,font:s.fontFamily,size:s.fontSize,weight:s.fontWeight,color:s.color,tracking:s.letterSpacing,left:r.left,top:r.top,width:r.width,height:r.height};}
 const links=document.querySelector('.social-links'),ls=getComputedStyle(links),lr=links.getBoundingClientRect();out.links={left:lr.left,top:lr.top,width:lr.width,height:lr.height,font:ls.fontFamily,size:ls.fontSize,gap:ls.gap,style:links.dataset.style,rows:[...links.querySelectorAll('.social-row')].map(row=>[...row.querySelectorAll('[data-link]')].map(node=>node.dataset.link))};
 const photo=document.querySelector('.splash-photo'),r=photo.getBoundingClientRect();out.photo={left:r.left,top:r.top,width:r.width,height:r.height,src:photo.getAttribute('src')};return out;
});}
try{
 await page.goto(base);await ready();await page.locator('#workbench-layout').click();await page.waitForFunction(()=>document.querySelector('#layout-preview-status').textContent.includes('拖动'));
 const frame=page.frames().find(frame=>frame.url().includes('preview=1'));
 const oldMask=await page.evaluate(()=>artWorkbench.mask.toDataURL());
 await page.locator('#layout-device').selectOption('1440x900');
 // Link styling and destinations travel with the same layout and saved preset.
 await page.locator('#text-layer').selectOption('links');await page.locator('#links-style').selectOption('underline');
 await range('links-size',15);await range('links-gap',14);await range('links-offset',30);
 await page.locator('#link-email').fill('qa@example.com');await page.locator('#link-email').dispatchEvent('change');
 await page.locator('#link-scholar').fill('https://scholar.google.com/citations?user=QA');await page.locator('#link-scholar').dispatchEvent('change');
 await page.locator('#link-cv').fill('assets/qa-cv.pdf');await page.locator('#link-cv').dispatchEvent('change');
 assert.equal(await page.evaluate(()=>artWorkbench.settings.layout.links.destinations.email),'qa@example.com');
 await frame.waitForFunction(()=>document.querySelector('[data-link="cv"]')?.getAttribute('href')==='assets/qa-cv.pdf');
 const linksBox=await frame.locator('.social-links').boundingBox(),linksViewport=await page.locator('#layout-frame').boundingBox(),linksStart=await frame.locator('.social-links').evaluate(node=>({left:node.getBoundingClientRect().left,top:node.getBoundingClientRect().top}));
 await page.mouse.move(linksBox.x+15,linksBox.y+10);await page.mouse.down();await page.mouse.move(linksBox.x+55,linksBox.y+22,{steps:6});await page.mouse.up();
 await page.waitForFunction(()=>artWorkbench.settings.layout.links.followName===false);
 const movedLinks=await page.evaluate(()=>artWorkbench.settings.layout.links);
 assert.equal(movedLinks.followName,false);assert(Math.abs(movedLinks.x-linksStart.left/1440*100-40/linksViewport.width*100)<.03);assert(Math.abs(movedLinks.y-linksStart.top/900*100-12/linksViewport.height*100)<.03);
 await page.locator('#links-followName').check();
 await page.locator('#text-layer').selectOption('english');
 await page.locator('#layout-font').selectOption('georgia');await range('layout-size',52);await page.locator('#layout-weight').selectOption('700');await range('layout-tracking',1.3);await range('layout-color','#a53b56');
 // Pointer coordinates inside a transformed iframe must map to the full virtual viewport.
 const before=await page.evaluate(()=>artWorkbench.settings.layout),box=await frame.locator('.name-en').boundingBox(),viewport=await page.locator('#layout-frame').boundingBox();
 await page.mouse.move(box.x+10,box.y+10);await page.mouse.down();await page.mouse.move(box.x+140,box.y+85,{steps:12});await page.mouse.up();
 const dragged=await page.evaluate(()=>artWorkbench.settings.layout);
 assert(Math.abs(dragged.english.x-before.english.x-130/viewport.width*100)<.03);
 assert(Math.abs(dragged.english.y-before.english.y-75/viewport.height*100)<.03);assert.deepEqual(dragged.chinese,before.chinese);
 // Clicking Chinese changes the sidebar selection; keyboard positioning stays independent.
 await frame.locator('.name-zh').click();await page.waitForFunction(()=>document.querySelector('#text-layer').value==='chinese');
 await frame.locator('.name-zh').press('Shift+ArrowRight');await page.locator('#layout-font').selectOption('times');await range('layout-size',28);await range('layout-color','#1c708b');await range('layout-y',19);
 const layout=await page.evaluate(()=>artWorkbench.settings.layout);assert.equal(layout.chinese.font,'times');assert.equal(layout.english.size,52);assert.equal(layout.english.color,'#a53b56');
 assert.equal(await page.evaluate(()=>artWorkbench.mask.toDataURL()),oldMask,'Typography must not regenerate the art');assert(await page.locator('#apply').isEnabled());
 const a=await save('QA 排版 A');await range('layout-size',39);const bLayout=await page.evaluate(()=>artWorkbench.settings.layout),b=await save('QA 排版 B');
 await load(a);assert.deepEqual(await page.evaluate(()=>artWorkbench.settings.layout),layout);await load(b);assert.deepEqual(await page.evaluate(()=>artWorkbench.settings.layout),bLayout);
 await page.reload();await ready();await page.locator('#workbench-layout').click();await page.waitForFunction(()=>document.querySelector('#layout-preview-status').textContent.includes('拖动'));await load(a);
 const currentFrame=page.frames().find(frame=>frame.url().includes('preview=1'));
 await page.locator('#layout-device').selectOption('1440x900');
 const preview=await metrics(currentFrame);
 const applyResponse=page.waitForResponse(r=>r.url().endsWith('/api/apply')&&r.request().method()==='POST');await page.locator('#apply').click();assert.equal((await applyResponse).status(),200);
 const actual=await browser.newPage({viewport:{width:1440,height:900}});await actual.goto(new URL('/homepage/',base).href);await actual.locator('.splash-photo').evaluate(im=>im.decode());
 assert.equal(await actual.locator('[data-link="email"]').getAttribute('href'),'mailto:qa@example.com');
 assert.equal(await actual.locator('[data-link="cv"]').getAttribute('href'),'assets/qa-cv.pdf');
 assert.equal(await actual.locator('.social-links').getAttribute('data-style'),'underline');
 await actual.locator('[data-link="wechat"]').click();await actual.waitForFunction(()=>document.querySelector('#wechat-contact').matches(':popover-open'));await actual.locator('.wechat-card img').evaluate(im=>im.decode());
 await actual.keyboard.press('Escape');assert.equal(await actual.locator('.wechat-card').isVisible(),false);
 const published=await metrics(actual);
 for(const name of ['.name-en','.name-zh'])assert.deepEqual(published[name],preview[name],name+' typography must match exactly');
 assert.deepEqual(published.links,preview.links,'Links match preview exactly');assert.deepEqual(published.links.rows,[['email','scholar'],['github','wechat','cv']]);
 for(const key of ['left','top','width','height'])assert(Math.abs(published.photo[key]-preview.photo[key])<.1,'Photo placement must match: '+key);
 const scripts=await actual.locator('script[src]').evaluateAll(nodes=>nodes.map(node=>new URL(node.src).pathname));
 assert(scripts.every(path=>path.startsWith('/homepage/assets/')),'Homepage enhancements use local assets and exclude workbench scripts');
 assert.deepEqual(JSON.parse(await readFile(new URL('../../assets/homepage-layout.json',import.meta.url))),layout);
 // Phone preview uses the same percentages, fonts and pixel sizes as the real phone page.
 await page.locator('#layout-device').selectOption('390x844');await actual.setViewportSize({width:390,height:844});
 await page.waitForFunction(()=>document.querySelector('#layout-frame').style.width==='390px');
 const phonePreview=await metrics(currentFrame),phoneActual=await metrics(actual);
 for(const name of ['.name-en','.name-zh'])assert.deepEqual(phoneActual[name],phonePreview[name]);
 assert.deepEqual(phoneActual.links,phonePreview.links);
 // Untrusted text is escaped, and arbitrary font/CSS injection is rejected.
 const state=await page.evaluate(()=>artWorkbench.settings),mask=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=artWorkbench.settings.width;c.height=artWorkbench.settings.height;c.getContext('2d').drawImage(artWorkbench.mask,0,0,c.width,c.height);return c.toDataURL();});
 const malicious=structuredClone(state);malicious.layout.english.font='bad; background:url(https://example.com)';assert.equal((await page.request.post(new URL('/api/apply',base).href,{data:{settings:malicious,mask}})).status(),400);
 const badLink=structuredClone(state);badLink.layout.links.destinations.github='javascript:alert(1)';assert.equal((await page.request.post(new URL('/api/apply',base).href,{data:{settings:badLink,mask}})).status(),400);
 const escaped=structuredClone(state);escaped.layout.english.text='<img src=x onerror=alert(1)>';
 assert.equal((await page.request.post(new URL('/api/apply',base).href,{data:{settings:escaped,mask}})).status(),200);
 await actual.reload();assert.equal(await actual.locator('.name-en').textContent(),escaped.layout.english.text);assert.equal(await actual.locator('.splash-photo').count(),1);
 await actual.close();
 // JSON export/import includes both text layers; mobile controls stay in the viewport.
 const downloadPromise=page.waitForEvent('download');await page.locator('#save-settings').click();const file=await (await downloadPromise).path();await range('layout-size',25);await page.locator('#import-file').setInputFiles(file);await page.waitForFunction(expected=>JSON.stringify(artWorkbench.settings.layout)===JSON.stringify(expected),layout);await ready();
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await mkdir('/tmp/hydrofoooil-art-qa',{recursive:true});await page.screenshot({path:'/tmp/hydrofoooil-art-qa/layout-mobile.png',fullPage:true});await page.setViewportSize({width:1440,height:960});await page.screenshot({path:'/tmp/hydrofoooil-art-qa/layout-desktop.png'});
 assert.deepEqual(errors,[]);console.log('PASS real drag/keyboard positioning, typography and link controls, unchanged mask, presets/reload/JSON, desktop/mobile exact homepage agreement, QR popover, URL validation and local homepage enhancements');
}finally{
 for(const id of ids)await page.request.delete(new URL('/api/presets/'+id,base).href).catch(()=>{});
 await browser.close();
 for(let index=0;index<files.length;index++){const target=new URL('../../'+files[index],import.meta.url);if(backups[index]===null)await unlink(target).catch(error=>{if(error.code!=='ENOENT')throw error;});else await writeFile(target,backups[index]);}
}
