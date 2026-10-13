import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as asar from '@electron/asar';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const errors=[];
const unpackedOnly=process.argv.includes('--unpacked-only');
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const distArgument=process.argv.find(arg=>arg.startsWith('--dist='));
const dist=path.resolve(root,distArgument?distArgument.slice(7):pkg.build.directories.output);
const unpacked=path.join(dist,'win-unpacked');
const archive=path.join(unpacked,'resources/app.asar');
const extract=(filename)=>asar.extractFile(archive,filename.replaceAll('/',path.sep));
const check=(condition,message)=>{if(!condition)throw new Error(message);};
async function section(label,action){try{await action();console.log(`OK ${label}`);}catch(error){errors.push(`${label}: ${error.message}`);}}
async function peInfo(filename){
 const bytes=await fs.readFile(filename);check(bytes.length>=64&&bytes.toString('ascii',0,2)==='MZ','不是有效的Windows PE文件');
 const offset=bytes.readUInt32LE(60);check(offset+26<=bytes.length&&bytes.toString('ascii',offset,offset+4)==='PE\0\0','PE头无效');
 return {bytes,machine:bytes.readUInt16LE(offset+4)};
}
await section('NSIS安装配置',async()=>{
 check(pkg.build.win.target==='nsis'||JSON.stringify(pkg.build.win.target).includes('nsis'),'缺少NSIS目标');
 check(pkg.build.nsis.oneClick===false,'需要提供安装向导');
 check(pkg.build.nsis.perMachine===false,'应按当前用户安装');
 check(pkg.build.nsis.allowToChangeInstallationDirectory===true,'需要支持选择安装目录');
 check(pkg.build.asarUnpack.some(pattern=>pattern.includes('sql.js')&&pattern.includes('wasm')),'SQLite WASM必须可从打包目录读取');
 await fs.access(path.join(root,pkg.build.win.icon));
});
await section('解包桌面程序为Windows x64',async()=>{
 const runtime=await peInfo(path.join(unpacked,`${pkg.build.win.executableName}.exe`));check(runtime.machine===0x8664,'桌面运行程序不是x64');
 for(const filename of ['resources/app.asar','icudtl.dat','resources.pak'])check((await fs.stat(path.join(unpacked,filename))).size>0,`${filename}为空`);
});
let inventory;
await section('ASAR主入口、preload和运行依赖',async()=>{
 inventory=new Set(asar.listPackage(archive).map(name=>name.replaceAll('\\','/').replace(/^\//,'')));
 const packaged=JSON.parse(extract('package.json').toString('utf8'));
 check(packaged.version===pkg.version,'ASAR版本与源配置不一致');check(packaged.main===pkg.main,'主入口与源配置不一致');
 for(const filename of [packaged.main,'out/preload/index.cjs','out/renderer/index.html','node_modules/sql.js/dist/sql-wasm.js','node_modules/ws/package.json'])check(inventory.has(filename),`ASAR缺少${filename}`);
 for(const dependency of Object.keys(pkg.dependencies))check(inventory.has(`node_modules/${dependency}/package.json`),`缺少生产依赖${dependency}`);
 check(![...inventory].some(name=>name.startsWith('.runtime/')||name.startsWith('.git/')),'不应打包开发运行记录或Git目录');
 check(![...inventory].some(name=>!name.startsWith('node_modules/')&&(name.startsWith('docs/')||/\\.md$/i.test(name)||/prompt/i.test(path.posix.basename(name)))),'应用不能包含docs、Markdown或提示词文件');
});
await section('渲染HTML资源与全部public资源同步',async()=>{
 check(inventory,'无法读取ASAR');const html=extract('out/renderer/index.html').toString('utf8');
 for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g)){
  const value=match[1];if(/^(?:https?:|data:|#)/.test(value))continue;
  check(!value.startsWith('/'),'HTML资源必须相对于file文档');const filename=path.posix.normalize(path.posix.join('out/renderer',value));check(inventory.has(filename),`HTML引用资源不存在：${filename}`);
 }
 async function walk(directory,prefix=''){
  for(const entry of await fs.readdir(directory,{withFileTypes:true})){
   const relative=path.posix.join(prefix,entry.name);const source=path.join(directory,entry.name);
   if(entry.isDirectory())await walk(source,relative);
   else if(entry.isFile()){const bundled=`out/renderer/${relative}`;check(inventory.has(bundled),`ASAR缺少public资源${relative}`);check((await fs.readFile(source)).equals(extract(bundled)),`打包资源过期或不一致：${relative}`);}
  }
 }
 await walk(path.join(root,'src/renderer/public'));
});
await section('SQLite WASM真实存在且格式正确',async()=>{
 const wasm=await fs.readFile(path.join(unpacked,'resources/app.asar.unpacked/node_modules/sql.js/dist/sql-wasm.wasm'));
 check(wasm.subarray(0,8).equals(Buffer.from([0,97,115,109,1,0,0,0])),'WASM头不正确');
});
if(!unpackedOnly)await section('NSIS安装包存在、PE格式与SHA256',async()=>{
 const names=(await fs.readdir(dist)).filter(name=>name.endsWith('.exe')&&name.includes(pkg.version));check(names.length===1,`应有1个当前版本安装包，实际${names.length}个`);
 const filename=path.join(dist,names[0]);const installer=await peInfo(filename);check(installer.bytes.length>1024*1024,'安装包过小');
 console.log(`安装包：${filename}`);console.log(`大小：${installer.bytes.length} bytes`);console.log(`SHA256：${createHash('sha256').update(installer.bytes).digest('hex')}`);
 // The NSIS bootstrapper can be x86 while installing an x64 Electron application.
 check([0x14c,0x8664].includes(installer.machine),'未知的安装程序架构');
});





// Parse resources directly: do not launch the application or installer.
function resourceLeaves(bytes){
 const pe=bytes.readUInt32LE(60);const optional=pe+24;const magic=bytes.readUInt16LE(optional);const directory=optional+(magic===0x20b?112:96);const rva=bytes.readUInt32LE(directory+16);
 const sectionStart=optional+bytes.readUInt16LE(pe+20),sectionCount=bytes.readUInt16LE(pe+6);
 function rvaOffset(address){for(let i=0;i<sectionCount;i++){const section=sectionStart+i*40;const base=bytes.readUInt32LE(section+12);const span=Math.max(bytes.readUInt32LE(section+8),bytes.readUInt32LE(section+16));if(address>=base&&address<base+span)return bytes.readUInt32LE(section+20)+address-base;}throw new Error('PE资源RVA未映射到文件区');}
 const resourceBase=rvaOffset(rva),leaves=[];
 function visit(relative,ids,depth){check(depth<=4,'PE资源目录层级异常');const at=resourceBase+relative;check(at+16<=bytes.length,'PE资源目录越界');const count=bytes.readUInt16LE(at+12)+bytes.readUInt16LE(at+14);check(at+16+count*8<=bytes.length,'PE资源条目越界');
  for(let i=0;i<count;i++){const entry=at+16+i*8;const id=bytes.readUInt32LE(entry),value=bytes.readUInt32LE(entry+4);const trail=[...ids,id];if(value&0x80000000)visit(value&0x7fffffff,trail,depth+1);else{const dataAt=resourceBase+value;check(dataAt+16<=bytes.length,'PE资源数据条目越界');const offset=rvaOffset(bytes.readUInt32LE(dataAt)),length=bytes.readUInt32LE(dataAt+4);check(offset+length<=bytes.length,'PE资源内容越界');leaves.push({ids:trail,data:bytes.subarray(offset,offset+length)});}}
 }
 visit(0,[],0);return leaves;
}
await section('afterPack实际嵌入256px图标和产品名',async()=>{
 const {bytes}=await peInfo(path.join(unpacked,`${pkg.build.win.executableName}.exe`));const resources=resourceLeaves(bytes);
 const expected=await fs.readFile(path.join(root,'assets/brand/png/app-256.png'));check(resources.some(entry=>entry.ids[0]===3&&entry.data.equals(expected)),'EXE中未找到与品牌源一致的256px图标');
 const key=Buffer.from('ProductName\0','utf16le');let productName;
 for(const entry of resources.filter(entry=>entry.ids[0]===16)){
  const at=entry.data.indexOf(key);if(at<6)continue;const valueLength=entry.data.readUInt16LE(at-4);const valueAt=(at+key.length+3)&~3;productName=entry.data.subarray(valueAt,valueAt+valueLength*2).toString('utf16le').replace(/\0+$/,'');if(productName===pkg.build.productName)break;
 }
 check(productName===pkg.build.productName,`EXE ProductName不匹配：${productName??'缺失'}`);
});

await section('快捷方式独立ICO资源与品牌源一致',async()=>{
 const expected=await fs.readFile(path.join(root,'build/icon.ico'));
 const installed=await fs.readFile(path.join(unpacked,'resources/app-icon.ico'));
 check(installed.equals(expected),'resources/app-icon.ico与品牌ICO不一致或过期');
 check(installed.readUInt16LE(0)===0&&installed.readUInt16LE(2)===1&&installed.readUInt16LE(4)===7,'独立图标不是完整的七尺寸ICO');
});
console.log('本检查未执行安装、卸载或生成任务；不能代替干净电脑安装和实际启动验收。');
if(errors.length){for(const error of errors)console.error(`FAIL ${error}`);process.exitCode=1;}else console.log(`PASS ${unpackedOnly?'解包运行目录':'安装交付'}结构验证通过。`);
