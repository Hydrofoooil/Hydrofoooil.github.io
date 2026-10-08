// Focused integration checks; remove only records created by this test.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
const base=process.env.EDITOR_URL||'http://127.0.0.1:8765/';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:960},acceptDownloads:true}),ids=[],errors=[];
page.on('pageerror',error=>errors.push(error.message));
const ready=()=>page.waitForFunction(()=>window.artWorkbench?.ready,null,{timeout:30000});
const capture=()=>page.evaluate(()=>({settings:artWorkbench.settings,mask:artWorkbench.mask.toDataURL(),preview:document.querySelector('#preview').src}));
// PNG decode can round RGB at almost transparent pixels; compare visible premultiplied colors.
async function assertCapture(actual,expected){
 assert.deepEqual(actual.settings,expected.settings);assert.equal(actual.mask===expected.mask,true,'Saved mask must remain byte-for-byte identical');
 if(actual.preview===expected.preview)return;
 const difference=await page.evaluate(async({a,b})=>{
  async function pixels(url){const image=new Image();image.src=url;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);return ctx.getImageData(0,0,c.width,c.height).data;}
  const x=await pixels(a),y=await pixels(b);if(x.length!==y.length)return {max:Infinity,mean:Infinity};let max=0,total=0;
  for(let i=0;i<x.length;i+=4){const alpha=Math.abs(x[i+3]-y[i+3]);max=Math.max(max,alpha);total+=alpha;for(let j=0;j<3;j++){const delta=Math.abs(x[i+j]*x[i+3]/255-y[i+j]*y[i+3]/255);max=Math.max(max,delta);total+=delta;}}
  return {max,mean:total/x.length};
 },{a:actual.preview,b:expected.preview});
 assert(difference.max<=2&&difference.mean<.1,'Preview changed beyond canvas rounding: '+JSON.stringify(difference));
}
async function save(name,overwrite=false){
 await page.locator('#preset-name').fill(name);
 const responsePromise=page.waitForResponse(r=>r.url().endsWith('/api/presets')&&r.request().method()==='POST');
 await page.locator(overwrite?'#preset-overwrite':'#preset-save').click();
 const response=await responsePromise;assert.equal(response.status(),200);const {preset}=await response.json();
 if(!overwrite)ids.push(preset.id);
 await page.waitForFunction(id=>document.querySelector(`.preset-load[data-id="${id}"]`)?.getAttribute('aria-pressed')==='true',preset.id);
 return preset;
}
async function load(id){
 await page.locator(`.preset-load[data-id="${id}"]`).click();
 await page.waitForFunction(id=>document.querySelector(`.preset-load[data-id="${id}"]`)?.getAttribute('aria-pressed')==='true'&&!document.querySelector('#preset-current').textContent.includes('正在'),id);
 await ready();
}
const homepageFiles=['index.html','styles.css','assets/contour-splash-mask.svg','assets/splash-settings.json'];
const homeBefore=await Promise.all(homepageFiles.map(file=>readFile(new URL('../../'+file,import.meta.url)).catch(error=>{if(error.code==='ENOENT')return null;throw error;})));
try{
 await page.goto(base);await ready();await page.waitForFunction(()=>!document.querySelector('#preset-save').disabled);
 await page.locator('#preset-save').click();assert(await page.locator('#toast').textContent().then(s=>s.includes('填写方案名称')));
 // A contains edited per-library settings, contour, quality and feather.
 await page.evaluate(()=>{artWorkbench.choose('ink');artWorkbench.update({width:12,splatter:.6});artWorkbench.setPoints([[.2,.2],[.65,.15],[.83,.55],[.6,.84],[.17,.67]]);});
 await page.locator('#quality').selectOption('700');await ready();
 await page.locator('#show-outline').uncheck();
 const a=await capture(),pa=await save('测试 A · 原图细墨');
 // B has another image and a nondeterministic native spray mask.
 await page.locator('#photo-select').selectOption('alternate');await page.locator('[data-engine="fabric"]').click();
 await page.evaluate(()=>{artWorkbench.update({variant:'SprayBrush',density:12});artWorkbench.setPoints([[.13,.3],[.45,.13],[.83,.3],[.8,.76],[.28,.85]]);});
 await page.locator('#interior').uncheck();await page.locator('#quality').selectOption('1000');await ready();
 const b=await capture(),pb=await save('测试 B · 备选喷点');
 await load(pa.id);await assertCapture(await capture(),a);assert.equal(await page.locator('#show-outline').isChecked(),false);
 await load(pb.id);await assertCapture(await capture(),b);
 // Reload persisted groups; a fresh browser origin/context has no local storage.
 await page.reload();await ready();await load(pb.id);await assertCapture(await capture(),b);
 const fresh=await browser.newPage();await fresh.goto(base.replace('127.0.0.1','localhost'));await fresh.waitForFunction(()=>window.artWorkbench?.ready);
 assert.equal(await fresh.locator(`.preset-load[data-id="${pa.id}"]`).count(),1);await fresh.locator(`.preset-load[data-id="${pa.id}"]`).click();
 await fresh.waitForFunction(()=>document.querySelector('#status').textContent.includes('已恢复保存的蒙版'));
 assert.deepEqual(await fresh.evaluate(()=>artWorkbench.settings),a.settings);assert.equal(await fresh.evaluate(()=>artWorkbench.mask.toDataURL()),a.mask);await fresh.close();
 console.log('PASS named groups, all settings/photos/contours, exact random-mask restoration, refresh and changed origin');
 // Pending native generation must not overwrite a loaded mask, even with identical parameters.
 await page.locator('#render').click();await load(pa.id);await assertCapture(await capture(),a);
 await page.locator('[data-engine="washes"]').click();await page.waitForFunction(()=>!document.querySelector('#loading').hidden);await load(pa.id);await assertCapture(await capture(),a);
 // Quickly choose two groups with the older request deliberately delayed.
 await page.route('**/api/presets/'+pa.id,async route=>{await new Promise(resolve=>setTimeout(resolve,350));await route.continue();});
 await page.locator(`.preset-load[data-id="${pa.id}"]`).click();await page.locator(`.preset-load[data-id="${pb.id}"]`).click();await ready();
 await page.waitForFunction(id=>document.querySelector('.preset-load.active')?.dataset.id===id,pb.id);
 await page.waitForTimeout(450);await assertCapture(await capture(),b);await page.unroute('**/api/presets/'+pa.id);
 // Modify B, overwrite/rename it, and ensure A is untouched.
 await page.evaluate(()=>artWorkbench.update({density:24}));await ready();assert((await page.locator('#preset-current').textContent()).includes('已修改'));
 const b2=await capture();await save('测试 B2 · 密喷点',true);
 await load(pa.id);await assertCapture(await capture(),a);await load(pb.id);await assertCapture(await capture(),b2);
 const forbidden=await page.request.post(new URL('/api/presets',base).href,{headers:{Origin:'https://example.com'},data:{}});assert.equal(forbidden.status(),403);
 const bad=await page.request.post(new URL('/api/presets',base).href,{data:{name:'错误蒙版',settings:a.settings,mask:b.mask}});assert.equal(bad.status(),400);
 const badDelete=await page.request.delete(new URL('/api/presets/'+pb.id,base).href,{headers:{Origin:'https://example.com'}});assert.equal(badDelete.status(),403);
 // Drawing disables saves; JSON export/import and PNG export still work after a load.
 await page.locator('#draw').click();assert(await page.locator('#preset-save').isDisabled());await page.locator('#cancel-draw').click();await ready();
 const jsonDownload=page.waitForEvent('download');await page.locator('#save-settings').click();const file=await (await jsonDownload).path();
 await load(pa.id);await page.locator('#import-file').setInputFiles(file);await page.waitForFunction(expected=>JSON.stringify(artWorkbench.settings)===JSON.stringify(expected)&&artWorkbench.ready,b2.settings);assert.deepEqual((await capture()).settings,b2.settings);
 await load(pb.id);const pngDownload=page.waitForEvent('download');await page.locator('#export-mask').click();const png=await readFile(await (await pngDownload).path());assert(png.length>1000);
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await mkdir('/tmp/hydrofoooil-art-qa',{recursive:true});await page.screenshot({path:'/tmp/hydrofoooil-art-qa/presets-mobile.png',fullPage:true});
 await page.setViewportSize({width:1440,height:960});await page.screenshot({path:'/tmp/hydrofoooil-art-qa/presets-desktop.png'});
 await page.locator(`.preset-load[data-id="${pb.id}"]`).locator('..').locator('.preset-delete').click();
 await page.waitForFunction(id=>!document.querySelector(`.preset-load[data-id="${id}"]`),pb.id);await assertCapture(await capture(),b2);
 assert.deepEqual(errors,[]);
 const homeAfter=await Promise.all(homepageFiles.map(file=>readFile(new URL('../../'+file,import.meta.url)).catch(error=>{if(error.code==='ENOENT')return null;throw error;})));assert.deepEqual(homeAfter,homeBefore);
 console.log('PASS overwrite isolation, rename/delete, concurrent load, stale render, validation, drawing/export/import, mobile layout and unchanged homepage');
}finally{
 for(const id of ids)await page.request.delete(new URL('/api/presets/'+id,base).href).catch(()=>{});
 await browser.close();
}
