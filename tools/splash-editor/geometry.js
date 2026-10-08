// Shared user-authored geometry. Artistic processing is delegated to libraries.
export function ellipse(){return Array.from({length:12},(_,i)=>{const a=i*Math.PI/6;return [.68+.205*Math.cos(a),.51+.43*Math.sin(a)];});}
export function pathData(points,w,h,smooth=75){
 const p=points.map(([x,y])=>[x*w,y*h]),n=p.length,t=smooth/100/6;
 let d=`M ${p[0].join(' ')}`;
 for(let i=0;i<n;i++){const a=p[(i+n-1)%n],b=p[i],c=p[(i+1)%n],e=p[(i+2)%n];d+=` C ${b[0]+(c[0]-a[0])*t} ${b[1]+(c[1]-a[1])*t} ${c[0]-(e[0]-b[0])*t} ${c[1]-(e[1]-b[1])*t} ${c.join(' ')}`;}
 return d+' Z';
}
export function geometry(points,w,h,smooth=75,spacing=3){
 const d=pathData(points,w,h,smooth),p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d',d);
 const len=p.getTotalLength(),count=Math.min(1800,Math.max(40,Math.ceil(len/spacing))),samples=Array.from({length:count+1},(_,i)=>{const v=p.getPointAtLength(len*i/count);return [v.x,v.y];});
 return {d,samples,path:new Path2D(d)};
}
// Uniformly sample the entire perimeter, excluding the duplicated closing point.
export function perimeterPoints(samples,count=48){const length=samples.length-1;count=Math.min(count,length);return Array.from({length:count},(_,i)=>samples[Math.floor(i*length/count)]);}
export function random(seed){let n=seed>>>0;return ()=>{n+=0x6D2B79F5;let t=n;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};}
export function canvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
