import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import sharp from 'sharp';

const sizes=[16,24,32,48,64,128,256,512,1024];
const file=(relative:string)=>new URL(`../${relative}`,import.meta.url);
async function pixels(relative:string){const {data,info}=await sharp(await fs.readFile(file(relative))).ensureAlpha().raw().toBuffer({resolveWithObject:true});return {data,info};}
const isMint=(data:Buffer,index:number)=>data[index+3]>=128&&Math.abs(data[index]-94)<=12&&Math.abs(data[index+1]-224)<=12&&Math.abs(data[index+2]-181)<=12;

test('符号和应用PNG覆盖约定尺寸，透明符号边缘不被裁切',async()=>{
 for(const size of sizes)for(const kind of ['symbol','app']){
  const relative=`assets/brand/png/${kind}-${size}.png`;const bytes=await fs.readFile(file(relative));const meta=await sharp(bytes).metadata();assert.equal(meta.format,'png');assert.equal(meta.width,size);assert.equal(meta.height,size);assert.equal(meta.hasAlpha,true);
  const {data,info}=await pixels(relative);assert.equal(info.channels,4);
  let visible=0;for(let offset=0;offset<data.length;offset+=4)if(data[offset+3]>0)visible++;
  assert.ok(visible>size*size*0.1,`${relative} 内容为空或过小`);
  if(kind==='symbol'){
   assert.ok(visible<size*size*0.8,'符号背景应透明');
   for(let p=0;p<size;p++)for(const index of [p,(size-1)*size+p,p*size,p*size+size-1])assert.equal(data[index*4+3],0,`${relative} 边缘裁切`);
  }
 }
 const icon=await sharp(await fs.readFile(file('build/icon.png'))).metadata();assert.equal(icon.width,512);assert.equal(icon.height,512);assert.deepEqual(await fs.readFile(file('build/icon.png')),await fs.readFile(file('assets/brand/png/app-512.png')));
});
test('32px图标保留播放负空间、独立圆点和品牌色，应用底色可辨',async()=>{
 const symbol=await pixels('assets/brand/png/symbol-32.png');const app=await pixels('assets/brand/png/app-32.png');
 // The middle of the play cutout stays clear at small icon size.
 const play=(15*32+15)*4;assert.equal(symbol.data[play+3],0,'播放负空间被填满');
 assert.ok(app.data[play+3]>=250);for(const [channel,value] of [16,19,21].entries())assert.ok(Math.abs(app.data[play+channel]-value)<=2,'播放负空间应显出石墨底色');
 let markerPixels=0;for(let y=21;y<=24;y++)for(let x=25;x<=28;x++)if(isMint(symbol.data,(y*32+x)*4))markerPixels++;
 assert.ok(markerPixels>=2,'32px品牌圆点消失或无法辨认');
 // A distinct small component in the lower right proves the dot is not joined to the X.
 const mask=Array.from({length:32*32},(_,i)=>isMint(symbol.data,i*4));const visited=new Set<number>();const components:number[][]=[];
 for(let start=0;start<mask.length;start++){
  if(!mask[start]||visited.has(start))continue;const component:number[]=[];const stack=[start];visited.add(start);
  while(stack.length){const item=stack.pop()!;component.push(item);const x=item%32,y=Math.floor(item/32);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=x+dx,ny=y+dy;if(nx<0||nx>=32||ny<0||ny>=32)continue;const next=ny*32+nx;if(mask[next]&&!visited.has(next)){visited.add(next);stack.push(next);}}}
  components.push(component);
 }
 assert.ok(components.some(component=>component.length>=2&&component.length<=12&&component.every(p=>p%32>=25&&p%32<=28&&Math.floor(p/32)>=21&&Math.floor(p/32)<=24)),'右下圆点应独立于X主体');
 assert.ok(components.some(component=>component.length>=80),'32px X主体应仍有清晰品牌色面积');
});
test('ICO头、尺寸目录与嵌入PNG一致，数据范围有效且不重叠',async()=>{
 const ico=await fs.readFile(file('build/icon.ico'));assert.equal(ico.readUInt16LE(0),0);assert.equal(ico.readUInt16LE(2),1);const count=ico.readUInt16LE(4);assert.equal(count,7);
 const directoryEnd=6+count*16;const entries:{size:number;offset:number;length:number}[]=[];
 for(let i=0;i<count;i++){
  const at=6+i*16;const width=ico[at]||256,height=ico[at+1]||256;assert.equal(width,height);assert.equal(ico[at+2],0);assert.equal(ico[at+3],0);assert.equal(ico.readUInt16LE(at+4),1);assert.equal(ico.readUInt16LE(at+6),32);
  const length=ico.readUInt32LE(at+8),offset=ico.readUInt32LE(at+12);assert.ok(offset>=directoryEnd&&length>0&&offset+length<=ico.length);
  const png=ico.subarray(offset,offset+length);assert.deepEqual(png.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));assert.deepEqual(png,await fs.readFile(file(`assets/brand/png/app-${width}.png`)));
  const image=sharp(png);const meta=await image.metadata();assert.equal(meta.width,width);assert.equal(meta.height,height);await image.raw().toBuffer();entries.push({size:width,offset,length});
 }
 assert.deepEqual(entries.map(e=>e.size).sort((a,b)=>a-b),[16,24,32,48,64,128,256]);
 const sorted=entries.sort((a,b)=>a.offset-b.offset);for(let i=1;i<sorted.length;i++)assert.ok(sorted[i].offset>=sorted[i-1].offset+sorted[i-1].length,'ICO图像区重叠');assert.equal(sorted.at(-1)!.offset+sorted.at(-1)!.length,ico.length);
});
test('前端公开SVG与品牌源一致，公开32px图标使用应用版本',async()=>{
 for(const name of ['luckyx-symbol.svg','luckyx-app.svg']){
  const source=await fs.readFile(file(`assets/brand/${name}`));assert.deepEqual(await fs.readFile(file(`src/renderer/public/brand/${name}`)),source);assert.match(source.toString('utf8'),/<svg[\s>]/);
 }
 for(const size of [32,256])assert.deepEqual(await fs.readFile(file(`src/renderer/public/brand/icon-${size}.png`)),await fs.readFile(file(`assets/brand/png/app-${size}.png`)));
});

