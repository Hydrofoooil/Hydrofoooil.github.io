import {geometry,canvas,random,perimeterPoints} from './geometry.js';
import {INK_TRACE_PRESETS} from '@ink-trace/core';
const range=(key,label,min,max,value,step=1)=>({key,label,min,max,value,step});
const select=(key,label,values,value)=>({key,label,values,value:value||values[0]});
export const ENGINES=[
 {id:'ink',name:'Ink Trace',kind:'墨迹 · 飞溅 · 钢笔',url:'https://www.npmjs.com/package/@ink-trace/core',seed:true,edge:true,controls:[select('preset','原生笔刷',['brushPen','fountainPen','fineliner','dipPen','ballpoint','marker','calligraphy','sketch']),range('width','笔锋宽度',.2,80,4.5,.1),range('roughness','边缘毛糙',0,2,.35,.01),range('splatter','飞溅强度',0,2,.4,.01),range('density','飞溅密度',0,4,.5,.05),range('spread','飞溅距离倍率',0,8,1.3,.1)]},
 {id:'p5',name:'p5.brush',kind:'水彩晕染 · 干笔 · 铅笔',url:'https://github.com/acamposuribe/p5.brush',seed:true,edge:false,controls:[select('variant','绘制方式',['水彩填充','marker','HB','charcoal','spray','2B','cpencil','pen']),range('width','笔刷重量',.2,8,2,.1),range('bleed','向外渗色',0,1,.3,.01),range('texture','纸张纹理',0,1,.5,.01),range('border','边缘纹理',0,1,.65,.01),range('opacity','水彩浓度',20,255,160)]},
 {id:'watercolor',name:'Watercolorizer',kind:'多层水彩 · 可变轮廓',url:'https://github.com/32bitkid/watercolorizer',seed:true,edge:false,controls:[range('weight','轮廓扩散',0,2,.5,.05),range('evolutions','扩散迭代',1,5,3),range('layers','叠染层数',1,15,7),range('opacity','每层浓度',.03,1,.2,.01)]},
 {id:'washes',name:'Washes',kind:'水与颜料模拟 · 干刷 · 盐析',url:'https://github.com/castavridis/washes-js',edge:false,controls:[select('variant','原生笔刷',['wet','dryBrush','crayon','salt','splatter']),select('wetness','纸张湿度',['wetOnWet','damp','dryBrush','boneDry','flooded'],'damp'),range('width','笔刷尺寸',.005,.09,.025,.005),range('paint','颜料负载',.1,2,1,.1),range('water','水量',.2,2,.6,.05),range('frames','模拟帧数',1,60,12)]},
 {id:'hokusai',name:'Hokusai / MyPaint',kind:'炭笔 · 毛笔 · 书法笔',url:'https://github.com/reearth/hokusai',edge:true,controls:[select('variant','MyPaint 原生笔刷',['charcoal','calligraphy','brush','marker_fat']),range('radius','笔刷半径倍率',.25,5,1.5,.05),range('pressure','压感',.1,1,.65,.01),range('tilt','笔倾角',0,1,.2,.05)]},
 {id:'easy',name:'Easy-Brush',kind:'散点笔刷 · 尺寸动态',url:'https://github.com/DQLean/Easy-Brush',edge:true,controls:[range('width','笔刷大小',1,100,20),range('spread','散布范围倍率',0,5,1.7,.1),range('count','每次盖印数量',1,10,3),range('jitter','尺寸抖动',0,1,.7,.01),range('roundness','笔尖圆度',.1,1,.65,.01),range('spacing','盖印间距',.05,1,.25,.05)]},
 {id:'rough',name:'Rough.js',kind:'手绘线条 · 排线 · 点描',url:'https://roughjs.com/',seed:true,edge:false,controls:[select('fill','原生填充',['solid','hachure','cross-hatch','dots','zigzag','dashed','zigzag-line'],'hachure'),range('roughness','手绘粗糙度',0,8,2,.1),range('width','轮廓线宽',.5,20,4,.5),range('gap','排线间距',2,25,5),range('angle','排线角度',-90,90,-41),range('weight','排线粗细',.5,15,3,.5)]},
 {id:'freehand',name:'Perfect Freehand',kind:'压感笔锋 · 平滑轮廓',url:'https://github.com/steveruizok/perfect-freehand',edge:true,controls:[range('width','笔锋宽度',1,120,32),range('thinning','压感变细',-1,1,.6,.05),range('smoothing','笔锋平滑',0,1,.5,.05),range('streamline','路径稳定',0,1,.5,.05),range('pressure','压感',.05,1,.55,.05)]},
 {id:'fabric',name:'Fabric.js Brushes',kind:'喷点 · 圆点 · 铅笔',url:'https://fabricjs.com/',edge:true,controls:[select('variant','原生笔刷',['SprayBrush','CircleBrush','PencilBrush']),range('width','喷笔宽度',2,130,50),range('density','每笔喷点数',1,50,15),range('dot','墨点大小',1,15,2),range('variance','墨点大小变化',0,10,2),select('opacity','墨点透明度',['固定','随机'],'随机')]},
 {id:'aquarelle',name:'Aquarelle',kind:'原生水彩噪声着色器',url:'https://github.com/Ramotion/aquarelle',edge:false,controls:[range('offset','原生轮廓扩展',-25,50,0)]},
];
// These bindings document the adapter; slider ranges are workbench choices.
const origin=(type,api)=>({type,api});
const native=api=>origin('native',api),converted=api=>origin('converted',api),adapter=api=>origin('adapter',api);
const origins={
 ink:{preset:native('preset / INK_TRACE_PRESETS'),width:converted('settings.nib.width · 随分辨率缩放'),roughness:native('settings.jitter.edgeRoughness'),splatter:native('settings.splatter.intensity'),density:native('settings.splatter.density'),spread:native('settings.splatter.spread')},
 p5:{variant:converted('fill() / set() · 工作台组合选择'),width:converted('set(name, color, weight) · 随分辨率缩放'),bleed:native('fillBleed(strength)'),texture:native('fillTexture(textureStrength)'),border:native('fillTexture(_, borderIntensity)'),opacity:native('fill(color, opacity)')},
 watercolor:{weight:converted('vertexWeights · 统一应用于所有顶点'),evolutions:native('evolutions'),layers:native('layersPerEvolution'),opacity:adapter('CanvasRenderingContext2D.globalAlpha · 每层绘制透明度')},
 washes:{variant:converted('brushMode() · salt 先绘制湿底再调用盐笔刷'),wetness:native('paperWetness()'),width:native('brushSize() · 短边比例'),paint:native('paintLoad()'),water:native('waterLoad()'),frames:adapter('onFrame() · 工作台计数后暂停模拟')},
 hokusai:{variant:native('官方示例 .myb 笔刷'),radius:converted('setRadiusLog(base + log2(multiplier × scale))'),pressure:converted('strokeTo(pressure) · 全路径固定输入'),tilt:converted('strokeTo(xtilt, ytilt) · x 固定、y=0')},
 easy:{width:converted('Brush.size · 随分辨率缩放'),spread:native('SpreadModule.spreadRange'),count:native('SpreadModule.count'),jitter:native('DynamicShapeModule.sizeJitter'),roundness:native('Brush.roundness'),spacing:native('Brush.spacing')},
 rough:{fill:native('fillStyle'),roughness:native('roughness'),width:converted('strokeWidth · 随分辨率缩放'),gap:converted('hachureGap · 随分辨率缩放'),angle:native('hachureAngle'),weight:converted('fillWeight · 随分辨率缩放')},
 freehand:{width:converted('getStroke.size · 随分辨率缩放'),thinning:native('getStroke.thinning'),smoothing:native('getStroke.smoothing'),streamline:native('getStroke.streamline'),pressure:converted('每点 pressure 固定输入，simulatePressure=false')},
 fabric:{variant:native('SprayBrush / CircleBrush / PencilBrush'),width:converted('brush.width · 随分辨率缩放'),density:native('SprayBrush.density'),dot:converted('SprayBrush.dotWidth · 随分辨率缩放'),variance:converted('SprayBrush.dotWidthVariance · 随分辨率缩放'),opacity:native('SprayBrush.randomOpacity')},
 aquarelle:{offset:converted('mask.offset / renderMask() · 随分辨率缩放')},
};
export const ORIGIN_LABELS={native:'库原生 API',converted:'原生 API 的换算／组合',adapter:'工作台自定义'};
for(const engine of ENGINES)for(const control of engine.controls){control.origin=origins[engine.id][control.key];if(!control.origin)throw new Error('缺少参数来源：'+engine.id+'/'+control.key);}
export function inkPresetValues(preset){const p=INK_TRACE_PRESETS[preset];return {preset,width:p.nib.width,roughness:p.jitter.edgeRoughness,splatter:p.splatter.intensity,density:p.splatter.density,spread:p.splatter.spread};}
export const defaults=id=>Object.fromEntries(ENGINES.find(e=>e.id===id).controls.map(s=>[s.key,s.value]));
let p5,hokusaiInit,threeReady;
const scaleValue=(n,w)=>n*w/1000;
const paintPolygon=(ctx,p)=>{ctx.beginPath();p.forEach(([x,y],i)=>ctx[i?'lineTo':'moveTo'](x,y));ctx.closePath();ctx.fill();};
const scripts=async urls=>{for(const src of urls)await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>reject(new Error('无法载入 '+src));document.head.append(s);});};
const implementations={
 async ink(c,g,o,s){const {createInkTrace}=await import('@ink-trace/core');const ink=createInkTrace(c,{preset:o.preset,width:c.width,height:c.height,viewBox:`0 0 ${c.width} ${c.height}`,seed:s.seed,paths:[{d:g.d,closed:true,fill:false}],settings:{nib:{width:scaleValue(o.width,c.width)},jitter:{edgeRoughness:o.roughness},splatter:{intensity:o.splatter,density:o.density,spread:o.spread},ink:{color:'#000000'}}});ink.render();},
 async p5(c,g,o,s){
  const brush=await import('p5.brush/standalone');
  if(!p5||p5.width!==c.width||p5.height!==c.height){if(p5){const gl=p5.getContext('webgl2');gl?.getExtension('WEBGL_lose_context')?.loseContext();p5.remove();}p5=canvas(c.width,c.height);brush.load(p5);}
  brush.clear();brush.seed(s.seed);brush.noiseSeed(s.seed);brush.push();brush.translate(-c.width/2,-c.height/2);
  if(o.variant==='水彩填充'){brush.noStroke();brush.fill('#000000',o.opacity);brush.fillBleed(o.bleed,'out');brush.fillTexture(o.texture,o.border,true);}
  else{brush.noFill();brush.set(o.variant,'#000000',o.width*c.width/1000);}
  brush.beginShape(0);g.samples.filter((_,i)=>i%5===0).forEach(([x,y])=>brush.vertex(x,y));brush.endShape(true);brush.pop();brush.render();c.getContext('2d').drawImage(p5,0,0);
 },
 async watercolor(c,g,o,s){const {watercolorize}=await import('@watercolorizer/watercolorizer');const ctx=c.getContext('2d');ctx.fillStyle='#000';ctx.globalAlpha=o.opacity;const pts=perimeterPoints(g.samples,48);for(const p of watercolorize(pts,{preEvolutions:1,evolutions:o.evolutions,layersPerEvolution:o.layers,layerEvolutions:1,vertexWeights:pts.map(()=>o.weight),random:random(s.seed),simplifyEachEvolution:1,simplifyAfterPreEvolution:1})){paintPolygon(ctx,p);}ctx.globalAlpha=1;},
 async washes(c,g,o){
  await import('./vendor/washes.js');const w=400,h=Math.round(c.height/c.width*w),wg=geometry(g.normalized,w,h,g.smooth,5);
  const wc=globalThis.Washes.createHeadless({width:w,height:h,transparent:true});
  try{wc.pause({acceptInput:true});wc.transparent(true).brushMode(o.variant==='salt'?'wet':o.variant).paperWetness(o.wetness).brushSize(o.width).paintLoad(o.paint).waterLoad(o.water).pigment('blue');
   const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><path d="${wg.d}" fill="blue" stroke="blue"/></svg>`;
   const trace={instant:true,fillInstant:true,fillShapes:true,pigment:'blue',triggerColors:false,bounds:{x:0,y:0,w:wc.grid.size().gridWidth,h:wc.grid.size().gridHeight}};
   wc.traceSVG(svg,trace);if(o.variant==='salt'){wc.brushMode('salt');wc.traceSVG(svg,trace);}
   await new Promise((resolve,reject)=>{let n=0;const timer=setTimeout(()=>{off();reject(new Error('水彩模拟超时'));},15000);const off=wc.onFrame(()=>{if(++n>=o.frames){off();clearTimeout(timer);wc.pause();resolve();}});wc.resume();});
   const url=wc.exportImage({transparent:true});const im=new Image();im.src=await url;await im.decode();c.getContext('2d').drawImage(im,0,0,c.width,c.height);
  }finally{wc.destroy();}
 },
 async hokusai(c,g,o){
  const moduleUrl='/vendor/hokusai/hokusai_wasm.js';hokusaiInit??=import(moduleUrl).then(async m=>{await m.default('/vendor/hokusai/hokusai_wasm_bg.wasm');return m;});const m=await hokusaiInit;
  const spec=await fetch(`/vendor/hokusai/${o.variant}.myb`).then(r=>r.text()),brush=new m.HokusaiBrush(spec),surface=new m.HokusaiCanvas(c.width,c.height);
  try{brush.setColorHsv(0,0,0);brush.setRadiusLog(brush.radiusLog()+Math.log2(o.radius*c.width/1000));surface.resetStroke();for(const [x,y] of g.samples)surface.strokeTo(brush,x,y,o.pressure,o.tilt,0,1/60);surface.finishStroke(brush);const pixels=new Uint8ClampedArray(surface.pixels());c.getContext('2d').putImageData(new ImageData(pixels,c.width,c.height),0,0);}finally{brush.free();surface.free();}
 },
 async easy(c,g,o){const {default:{Brush,SpreadModule,DynamicShapeModule}}=await import('easy-brush');const b=new Brush(c,{size:scaleValue(o.width,c.width),opacity:1,flow:1,color:'#000',roundness:o.roundness,spacing:o.spacing});b.useModule(new SpreadModule({spreadRange:o.spread,count:o.count}));b.useModule(new DynamicShapeModule({sizeJitter:o.jitter,minDiameter:.1}));for(const [x,y] of g.samples)b.putPoint(x,y,.6);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('笔刷渲染超时')),15000);b.finalizeStroke(()=>{clearTimeout(timer);resolve();});b.render();});},
 async rough(c,g,o,s){const {default:rough}=await import('roughjs');rough.canvas(c).path(g.d,{seed:s.seed,roughness:o.roughness,stroke:'#000',strokeWidth:scaleValue(o.width,c.width),fill:'#000',fillStyle:o.fill,hachureGap:scaleValue(o.gap,c.width),hachureAngle:o.angle,fillWeight:scaleValue(o.weight,c.width)});},
 async freehand(c,g,o){const {getStroke}=await import('perfect-freehand');const p=getStroke(g.samples.map(([x,y])=>[x,y,o.pressure]),{size:scaleValue(o.width,c.width),thinning:o.thinning,smoothing:o.smoothing,streamline:o.streamline,simulatePressure:false});const ctx=c.getContext('2d');ctx.fillStyle='#000';paintPolygon(ctx,p);},
 async fabric(c,g,o){const m=await import('fabric');const fc=new m.Canvas(document.createElement('canvas'),{width:c.width,height:c.height,enableRetinaScaling:false,renderOnAddRemove:false});try{const b=new m[o.variant](fc);Object.assign(b,{color:'#000',width:scaleValue(o.width,c.width),density:o.density,dotWidth:scaleValue(o.dot,c.width),dotWidthVariance:scaleValue(o.variance,c.width),randomOpacity:o.opacity==='随机'});const opts={e:{isPrimary:true,button:0,type:'mousedown'}};b.onMouseDown(new m.Point(...g.samples[0]),opts);for(const p of g.samples.slice(1))b.onMouseMove(new m.Point(...p),opts);b.onMouseUp(opts);fc.renderAll();c.getContext('2d').drawImage(fc.lowerCanvasEl,0,0);}finally{await fc.dispose();}},
 async aquarelle(c,g,o){
  threeReady??=scripts(['/vendor/three/three.min.js','/vendor/three/EffectComposer.js','/vendor/three/CopyShader.js','/vendor/three/ShaderPass.js','/vendor/AquarellePass.js','/vendor/Aquarelle.js']);await threeReady;const T=window.THREE;
  const mc=canvas(c.width,c.height),ctx=mc.getContext('2d');ctx.fillStyle='#000';ctx.strokeStyle='#000';const shim={mask:{canvas:mc,ctx,points:g.samples,offset:scaleValue(o.offset,c.width)},pathPoints:window.Aquarelle.prototype.pathPoints};window.Aquarelle.prototype.renderMask.call(shim);
  const white=canvas(2,2);white.getContext('2d').fillRect(0,0,2,2);const tex=new T.Texture(white),mask=new T.Texture(mc);tex.needsUpdate=mask.needsUpdate=true;tex.minFilter=mask.minFilter=T.LinearFilter;
  // The upstream shader uses its own fixed noise scales.

  const renderer=new T.WebGLRenderer({alpha:true,preserveDrawingBuffer:true});renderer.setSize(c.width,c.height);renderer.setClearColor(0x000000,0);const pass=new T.AquarellePass(tex,mask);
  try{pass.render(renderer,null,null);c.getContext('2d').drawImage(renderer.domElement,0,0);}finally{pass.material.dispose();pass.quad.geometry.dispose();tex.dispose();mask.dispose();renderer.dispose();renderer.forceContextLoss();}
 },
};
export async function renderEngine(settings,width=1000,height=698){
 const def=ENGINES.find(e=>e.id===settings.engine);if(!def)throw new Error('未知效果库');
 const c=canvas(width,height),g=geometry(settings.points,width,height,settings.smooth,def.id==='hokusai'?2:4);g.normalized=settings.points;g.smooth=settings.smooth;
 await implementations[def.id](c,g,{...defaults(def.id),...settings.options[def.id]},settings);
 // These native runtimes encode pigment density in RGB on white paper.
 // Convert the library's ink density into alpha before photo compositing.
 if(def.id==='p5'||def.id==='hokusai'){const ctx=c.getContext('2d'),pixels=ctx.getImageData(0,0,width,height);for(let i=0;i<pixels.data.length;i+=4){pixels.data[i+3]=Math.round(pixels.data[i+3]*(1-(pixels.data[i]+pixels.data[i+1]+pixels.data[i+2])/765));pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=0;}ctx.putImageData(pixels,0,0);}
 if(settings.interior){const ctx=c.getContext('2d');ctx.globalCompositeOperation='destination-over';ctx.fillStyle='#000';ctx.fill(g.path);ctx.globalCompositeOperation='source-over';}
 let output=c;if(settings.feather>0){output=canvas(width,height);const ctx=output.getContext('2d');ctx.filter=`blur(${scaleValue(settings.feather,width)}px)`;ctx.drawImage(c,0,0);}
 const ctx=output.getContext('2d'),data=ctx.getImageData(0,0,width,height);for(let i=0;i<data.data.length;i+=4){data.data[i]=data.data[i+1]=data.data[i+2]=255;}ctx.putImageData(data,0,0);
 return output;
}
