// Browser integration checks: real native library output, editable outline, exports and persistence.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const targets=['assets/contour-splash-mask.svg','assets/splash-settings.json','index.html','styles.css','assets/homepage-layout.css','assets/homepage-layout.json'];
const backups=await Promise.all(targets.map(async name=>{try{return await readFile(root+name);}catch(e){if(e.code==='ENOENT')return null;throw e;}}));
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:960},acceptDownloads:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const ready=()=>page.waitForFunction(()=>window.artWorkbench?.ready,{timeout:30000});
try{
 await page.goto(process.env.EDITOR_URL||'http://127.0.0.1:8765/');await ready();
 assert.equal(await page.locator('.engine-card').count(),10);
 const initial=await page.evaluate(()=>artWorkbench.settings.points);
 const results=await page.evaluate(async()=>{
  const s=artWorkbench.settings;const out=[];
  function stats(c){const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let mass=0,mx=0,count=0,hash=2166136261;for(let i=3;i<d.length;i+=4){const a=d[i];mass+=a;mx+=a*((i-3)/4%c.width);if(a)count++;hash=Math.imul(hash^a,16777619);}return {mass,center:mx/mass,count,hash:hash>>>0,pixels:c.width*c.height};}
  for(const engine of artWorkbench.engines){const settings=structuredClone(s);settings.engine=engine;settings.interior=false;const a=stats(await artWorkbench.renderRaw(settings,700));settings.points=[[.15,.15],[.43,.2],[.43,.75],[.12,.7]];const b=stats(await artWorkbench.renderRaw(settings,700));out.push({engine,a,b});}
  return out;
 });
 for(const {engine,a,b}of results){assert(a.mass>1000,engine+' native output is empty');assert(a.count<a.pixels*.95,engine+' returned an opaque rectangle');assert(b.mass>1000,engine+' custom outline is empty');assert(Math.abs(a.center-b.center)>90,engine+' did not follow a changed outline '+JSON.stringify({a,b}));console.log('PASS native engine + custom outline:',engine);}
 assert.equal(new Set(results.map(r=>r.a.hash)).size,10,'Native engine outputs must be distinct');
 // Exercise every offered native brush/fill preset, not just the default branch.
 const variants=await page.evaluate(async()=>{
  const s=artWorkbench.settings;
  const choices={ink:{preset:['brushPen','fountainPen','fineliner','dipPen','ballpoint','marker','calligraphy','sketch']},p5:{variant:['水彩填充','marker','HB','charcoal','spray','2B','cpencil','pen']},washes:{variant:['wet','dryBrush','crayon','salt','splatter']},hokusai:{variant:['charcoal','calligraphy','brush','marker_fat']},rough:{fill:['solid','hachure','cross-hatch','dots','zigzag','dashed','zigzag-line']},fabric:{variant:['SprayBrush','CircleBrush','PencilBrush']}};
  const result=[];for(const [engine,options]of Object.entries(choices))for(const [key,values]of Object.entries(options))for(const value of values){const settings=structuredClone(s);settings.engine=engine;settings.interior=false;settings.options[engine][key]=value;const c=await artWorkbench.renderRaw(settings,700),data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let sum=0;for(let i=3;i<data.length;i+=4)sum+=data[i];result.push({engine,value,sum});}return result;
 });
 for(const v of variants)assert(v.sum>1000,`${v.engine}/${v.value} is empty`);
 console.log('PASS all 35 native brush/fill choices');
 const changes=await page.evaluate(async()=>{
  const s=artWorkbench.settings,map={ink:{splatter:0,spread:0,width:60},p5:{bleed:.9,texture:.9,opacity:60},watercolor:{weight:1.2},washes:{width:.08,water:1.8,paint:2},hokusai:{radius:4},easy:{width:70,spread:4},rough:{gap:20},freehand:{width:100},fabric:{width:120,density:40},aquarelle:{offset:40}};const out=[];
  for(const engine of artWorkbench.engines){const a=structuredClone(s);a.engine=engine;a.interior=false;const ca=await artWorkbench.renderRaw(a,700);Object.assign(a.options[engine],map[engine]);const cb=await artWorkbench.renderRaw(a,700);out.push({engine,changed:ca.toDataURL()!==cb.toDataURL()});}return out;
 });for(const c of changes)assert(c.changed,c.engine+' parameters did not change output');
 console.log('PASS meaningful native parameter changes');
 // GUI: actual drag, undo/redo, library switching retains outline.
 const point=page.locator('#outline circle').first(),box=await point.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2-50,box.y+box.height/2+22,{steps:5});await page.mouse.up();await ready();
 const moved=await page.evaluate(()=>artWorkbench.settings.points);assert.notDeepEqual(moved,initial);await page.locator('#undo').click();await ready();assert.deepEqual(await page.evaluate(()=>artWorkbench.settings.points),initial);await page.locator('#redo').click();await ready();assert.deepEqual(await page.evaluate(()=>artWorkbench.settings.points),moved);
 await page.locator('[data-engine="rough"]').click();await ready();assert.deepEqual(await page.evaluate(()=>artWorkbench.settings.points),moved);
 await page.locator('#draw').click();const svgBox=await page.locator('#outline').boundingBox();await page.mouse.move(svgBox.x+svgBox.width*.52,svgBox.y+svgBox.height*.25);await page.mouse.down();for(const [x,y]of [[.7,.15],[.83,.35],[.8,.7],[.65,.8],[.48,.6],[.52,.25]])await page.mouse.move(svgBox.x+svgBox.width*x,svgBox.y+svgBox.height*y,{steps:6});await page.mouse.up();await ready();const custom=await page.evaluate(()=>artWorkbench.settings.points);assert(custom.length>4);assert.notDeepEqual(custom,moved);
 await page.reload();await ready();assert.deepEqual(await page.evaluate(()=>artWorkbench.settings.points),custom);
 await page.locator('[data-engine="ink"]').click();await ready();
 // Exports reuse current mask. Capture exported photo and verify only alpha changes.
 const [maskDownload]=await Promise.all([page.waitForEvent('download'),page.locator('#export-mask').click()]);const maskBytes=await readFile(await maskDownload.path());
 const [photoDownload]=await Promise.all([page.waitForEvent('download'),page.locator('#export-photo').click()]);const photoBytes=await readFile(await photoDownload.path());
 const exportCheck=await page.evaluate(async({maskData,photoData})=>{
  const maskImage=new Image();maskImage.src=maskData;await maskImage.decode();const exported=new Image();exported.src=photoData;await exported.decode();const source=new Image();source.src='/photo.webp';await source.decode();
  const make=(im)=>{const c=document.createElement('canvas');c.width=source.width;c.height=source.height;c.getContext('2d').drawImage(im,0,0,c.width,c.height);return c;};
  const m=make(maskImage).getContext('2d').getImageData(0,0,source.width,source.height).data,expected=make(artWorkbench.mask).getContext('2d').getImageData(0,0,source.width,source.height).data,o=make(source).getContext('2d').getImageData(0,0,source.width,source.height).data,p=make(exported).getContext('2d').getImageData(0,0,source.width,source.height).data;
  let maskMismatch=0,rgbMismatch=0,transparentMismatch=0,visible=0;for(let i=0;i<m.length;i+=4){if(m[i+3]!==expected[i+3])maskMismatch++;if(o[i+3]===0&&p[i+3]!==0)transparentMismatch++;if(p[i+3]===255){visible++;for(let j=0;j<3;j++)if(o[i+j]!==p[i+j])rgbMismatch++;}}return {w:exported.width,h:exported.height,maskMismatch,rgbMismatch,transparentMismatch,visible};
 },{maskData:'data:image/png;base64,'+maskBytes.toString('base64'),photoData:'data:image/png;base64,'+photoBytes.toString('base64')});
 assert.equal(exportCheck.w,2528);assert.equal(exportCheck.h,1763);assert.equal(exportCheck.maskMismatch,0);assert.equal(exportCheck.rgbMismatch,0);assert.equal(exportCheck.transparentMismatch,0);assert(exportCheck.visible>1000);
 // Apply saves this exact PNG in the homepage mask (backed up/restored below).
 await page.locator('#apply').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('已应用'));
 const applied=await readFile(root+targets[0],'utf8');assert(applied.includes(maskBytes.toString('base64')));const saved=JSON.parse(await readFile(root+targets[1],'utf8'));assert.deepEqual(saved.points,custom);
 const request=await page.request.post(new URL('/api/apply',page.url()).href,{headers:{Origin:'https://example.com'},data:{}});assert.equal(request.status(),403);
 // Parameter JSON roundtrip and mobile layout.
 const [settingsDownload]=await Promise.all([page.waitForEvent('download'),page.locator('#save-settings').click()]);const settingsFile=await settingsDownload.path();await page.locator('#ellipse').click();await ready();await page.locator('#import-file').setInputFiles(settingsFile);await page.waitForFunction(points=>JSON.stringify(artWorkbench.settings.points)===JSON.stringify(points),custom);await ready();assert.deepEqual(await page.evaluate(()=>artWorkbench.settings.points),custom);
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await mkdir('/tmp/hydrofoooil-art-qa',{recursive:true});await page.screenshot({path:'/tmp/hydrofoooil-art-qa/mobile.png',fullPage:true});await page.setViewportSize({width:1440,height:960});await page.locator('#edit').click();await page.screenshot({path:'/tmp/hydrofoooil-art-qa/desktop.png'});
 assert.deepEqual(errors,[]);console.log('PASS GUI editing, switching, persistence, JSON roundtrip, exports, local apply and mobile layout');
}finally{await browser.close();for(let i=0;i<targets.length;i++){if(backups[i]===null){await unlink(root+targets[i]).catch(e=>{if(e.code!=='ENOENT')throw e;});}else await writeFile(root+targets[i],backups[i]);}}
