import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createBootstrapManager, assertOfficialDownloadUrl, validateArchiveListing, getPortableLaunchPlan } from '../src/backend/bootstrap';
import { getEngineInstallation } from '../src/backend/engine-installation';
async function temporary(t:any){const root=await fs.mkdtemp(path.join(os.tmpdir(),'luckyx-bootstrap-tests-'));t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('luckyx-bootstrap-tests-'));await fs.rm(root,{recursive:true,force:true});});return root;}
async function put(root:string,relative:string,content='mock-file'){const target=path.join(root,relative);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,content);}
test('便携环境使用python_embeded和standalone参数，中文空格路径保持独立参数',async t=>{
 const temp=await temporary(t);const root=path.join(temp,'便携 创作环境');await put(root,'python_embeded/python.exe');await put(root,'ComfyUI/main.py');
 const plan=await getEngineInstallation(root);assert.equal(plan.python,path.join(root,'python_embeded/python.exe'));assert.equal(plan.launcher,path.join(root,'ComfyUI/main.py'));assert.equal(plan.cwd,root);assert.deepEqual(plan.args,['-s','ComfyUI/main.py','--windows-standalone-build']);
 assert.ok(!plan.args.some(arg=>arg.includes('launch_comfy.py')));
});

const archive = Buffer.from('small verified official archive fixture');
const digest = (data:Buffer) => createHash('sha256').update(data).digest('hex');
const officialUrl = 'https://github.com/Comfy-Org/ComfyUI/releases/download/v0.39.0/ComfyUI_windows_portable_nvidia.7z';
const hardware = { gpuName:'NVIDIA GeForce RTX 4080',vramMb:16384,ramGb:32,driver:'fixture' };
const names = ['diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors','text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors','vae/minimax_h3_video_vae_int8_convrot.safetensors','vae/minimax_h3_audio_vae_fp32.safetensors','loras/minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors'];
async function fixture(t:any, overrides:{body?:(url:string,init?:RequestInit)=>Promise<Response>,free?:()=>number,cuda?:boolean,unsafeListing?:boolean}={}) {
 const root=await temporary(t);const requests:Array<{url:string,range:string|null}>=[];const runs:string[][]=[];
 const fetcher = async (input:any,init?:RequestInit) => {
  const url=String(input);requests.push({url,range:new Headers(init?.headers).get('range')});
  if(url.includes('api.github.com/')) return Response.json({assets:[{name:'ComfyUI_windows_portable_nvidia.7z',size:archive.length,digest:'sha256:'+digest(archive),browser_download_url:officialUrl}]});
  if(url.includes('/api/models/')) return Response.json({sha:'a'.repeat(40),siblings:names.map(rfilename=>({rfilename,lfs:{size:archive.length,sha256:digest(archive)}}))});
  return overrides.body ? overrides.body(url,init) : new Response(archive);
 };
 const manager=createBootstrapManager({dataDir:path.join(root,'data'),sevenZipPath:'mock-7za.exe',fetch:fetcher as typeof fetch,getFreeBytes:async()=>overrides.free?.()??1024**4,
  runner:async(exe,args)=>{runs.push([exe,...args]);if(args[0]==='l')return{stdout:overrides.unsafeListing?'Path = ../escape':'----------\nPath = ComfyUI_windows_portable/python_embeded/python.exe\nPath = ComfyUI_windows_portable/ComfyUI/main.py'};
   if(args[0]==='x'){const extracted=args.find(a=>a.startsWith('-o'))!.slice(2);await put(extracted,'ComfyUI_windows_portable/python_embeded/python.exe');await put(extracted,'ComfyUI_windows_portable/ComfyUI/main.py');return{stdout:''};}
   assert.ok(exe.endsWith('python.exe'));return{stdout:JSON.stringify({cuda:'13.0',available:overrides.cuda!==false})};}});
 t.after(()=>manager.dispose());return{root,manager,requests,runs};
}
test('官方来源只允许指定HTTPS仓库和CDN，伪域认证其他仓库及非标准端口拒绝',()=>{
 assert.equal(assertOfficialDownloadUrl(officialUrl),officialUrl);
 assert.ok(assertOfficialDownloadUrl('https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/model.safetensors'));
 for(const url of ['http://github.com/Comfy-Org/ComfyUI/releases/download/a/b','https://github.com.evil.test/Comfy-Org/ComfyUI/releases/download/a/b','https://user@github.com/Comfy-Org/ComfyUI/releases/download/a/b','https://github.com/other/repo/releases/download/a/b','https://huggingface.co/other/model/resolve/main/a','https://github.com:8443/Comfy-Org/ComfyUI/releases/download/a/b'])assert.throws(()=>assertOfficialDownloadUrl(url));
});
test('解压前路径清单拒绝穿越、绝对路径、盘符和链接',()=>{
 validateArchiveListing('----------\nPath = ComfyUI_windows_portable/ComfyUI/main.py');
 for(const listing of ['','Path = ../escape','Path = folder\\..\\escape','Path = /root/file','Path = C:\\file','Path = good\nSymbolic Link = outside','Path = good\nHard Link = outside'])assert.throws(()=>validateArchiveListing(listing));
});
test('基础环境计划不含模型，H3计划五模型拥有哈希，RTX硬件判定和portable路径正确',async t=>{
 const f=await fixture(t);const p=await f.manager.plan({rootPath:f.root,hardware,profile:'environment'});
 assert.equal(p.files.length,1);assert.equal(p.targetPath,path.join(f.root,'luckyx-environment'));assert.deepEqual(p.hardwareIssues,[]);assert.equal(p.files[0].sha256,digest(archive));assert.ok(p.requiredFreeBytes>p.downloadBytes);
 assert.ok(!f.requests.some(r=>r.url.includes('/api/models/')));
 const full=await f.manager.plan({rootPath:f.root,hardware});assert.equal(full.files.length,6);assert.deepEqual(full.hardwareIssues,[]);for(const file of full.files){assert.match(file.sha256,/^[a-f0-9]{64}$/);assertOfficialDownloadUrl(file.url);}
 const unknown=await f.manager.plan({rootPath:f.root,hardware:{...hardware,gpuName:'',vramMb:0,ramGb:0}});assert.ok(unknown.hardwareIssues.length>=3);
});
test('已有目标目录在计划和启动时均不覆盖，原文件保持完整',async t=>{
 const f=await fixture(t);const p=await f.manager.plan({rootPath:f.root,hardware,profile:'environment'});await put(p.targetPath,'user-model.safetensors','keep');
 const state=await f.manager.start(p);assert.equal(state.status,'error');assert.match(state.error!,/目标目录已存在/);assert.equal(await fs.readFile(path.join(p.targetPath,'user-model.safetensors'),'utf8'),'keep');assert.equal(f.runs.length,0);
 await assert.rejects(f.manager.plan({rootPath:f.root,hardware}),/目标环境目录已存在/);
});
test('启动重新检查磁盘空间，不足时不会下载或创建环境',async t=>{
 let free=1024**4;const f=await fixture(t,{free:()=>free});const p=await f.manager.plan({rootPath:f.root,hardware,profile:'environment'});free=0;
 const state=await f.manager.start(p);assert.equal(state.status,'error');assert.match(state.error!,/磁盘空间不足/);assert.equal(f.requests.filter(r=>r.url===officialUrl).length,0);await assert.rejects(fs.stat(p.targetPath),{code:'ENOENT'});
});
test('SHA不匹配不能解压或标完成，失败片段清空供重试',async t=>{
 const f=await fixture(t,{body:async()=>new Response(Buffer.alloc(archive.length,120))});const p=await f.manager.plan({rootPath:f.root,hardware,profile:'environment'});
 const state=await f.manager.start(p);assert.equal(state.status,'error');assert.match(state.error!,/SHA256/);assert.equal(state.installationPath,undefined);assert.equal(f.runs.length,0);assert.equal((await fs.stat(path.join(f.root,'.luckyx-bootstrap/portable.7z.part'))).size,0);
});
test('下载重定向到非官方来源被阻止',async t=>{
 const f=await fixture(t,{body:async()=>new Response(null,{status:302,headers:{location:'https://evil.test/archive'}})});const p=await f.manager.plan({rootPath:f.root,hardware,profile:'environment'});
 const state=await f.manager.start(p);assert.equal(state.status,'error');assert.match(state.error!,/官方 HTTPS/);assert.ok(!f.requests.some(r=>r.url.includes('evil.test')));assert.equal(f.runs.length,0);
});
test('取消保留断点，再次启动校验Range并完成portable环境；外部计划篡改无效',async t=>{
 let first=true;const f=await fixture(t,{body:async(_url,init)=>{if(first){first=false;return new Response(new ReadableStream({start(controller){controller.enqueue(archive.subarray(0,8));},cancel(){}}));}assert.equal(new Headers(init?.headers).get('range'),'bytes=8-');return new Response(archive.subarray(8),{status:206,headers:{'content-range':`bytes 8-${archive.length-1}/${archive.length}`}});}});
 const p=await f.manager.plan({rootPath:f.root,hardware,profile:'environment'});const unsub=f.manager.subscribe(s=>{if(s.status==='downloading'&&s.receivedBytes===8)f.manager.cancel();});
 const cancelled=await f.manager.start(p);unsub();assert.equal(cancelled.status,'cancelled');assert.equal((await fs.stat(path.join(f.root,'.luckyx-bootstrap/portable.7z.part'))).size,8);
 const caller=structuredClone(p);caller.targetPath=path.join(f.root,'attacker-target');caller.files[0].url='https://evil.test/file';caller.files[0].sha256='0'.repeat(64);
 const completed=await f.manager.start(caller);assert.equal(completed.status,'completed');assert.equal(completed.installationPath,p.targetPath);assert.ok(!f.requests.some(r=>r.url.includes('evil.test')));await assert.rejects(fs.stat(caller.targetPath),{code:'ENOENT'});
 const launch=await getPortableLaunchPlan(p.targetPath);assert.equal(launch.python,path.join(p.targetPath,'python_embeded/python.exe'));assert.equal(launch.args[1],path.join(p.targetPath,'ComfyUI/main.py'));assert.ok(launch.args.includes('--windows-standalone-build'));assert.ok(f.runs.some(a=>a[0].endsWith('python.exe')));
});
test('不安全压缩清单与CUDA检查失败不会发布安装目录',async t=>{
 for(const config of [{unsafeListing:true},{cuda:false}]){const f=await fixture(t,config);const p=await f.manager.plan({rootPath:f.root,hardware,profile:'environment'});const state=await f.manager.start(p);assert.equal(state.status,'error');await assert.rejects(fs.stat(p.targetPath),{code:'ENOENT'});assert.equal(state.installationPath,undefined);}
});
test('错误断点响应保留原片段，不误标完成；非自有暂存目录不覆盖',async t=>{
 const f=await fixture(t,{body:async()=>new Response(archive,{status:206,headers:{'content-range':`bytes 0-${archive.length-1}/${archive.length}`}})});const p=await f.manager.plan({rootPath:f.root,hardware,profile:'environment'});
 await put(f.root,'.luckyx-bootstrap/owner.json',JSON.stringify({app:'luckyx. Studio',target:p.targetPath,version:p.version}));await put(f.root,'.luckyx-bootstrap/portable.7z.part','part');
 const state=await f.manager.start(p);assert.equal(state.status,'error');assert.match(state.error!,/断点响应无效/);assert.equal(await fs.readFile(path.join(f.root,'.luckyx-bootstrap/portable.7z.part'),'utf8'),'part');
 await put(f.root,'.luckyx-bootstrap/owner.json',JSON.stringify({app:'other-app',target:p.targetPath,version:p.version}));const refused=await f.manager.start(p);assert.match(refused.error!,/不属于本次安装/);assert.equal(f.runs.length,0);
});
test('H3小资源模拟完成逐一核验五权重，基础环境不会隐式下载模型',async t=>{
 const f=await fixture(t);const p=await f.manager.plan({rootPath:f.root,hardware});const state=await f.manager.start(p);assert.equal(state.status,'completed');assert.equal(state.completedFiles,6);
 for(const file of p.files.slice(1)){const bytes=await fs.readFile(path.join(p.targetPath,file.relativePath));assert.equal(digest(bytes),file.sha256);}
 const managed=JSON.parse(await fs.readFile(path.join(p.targetPath,'luckyx-managed.json'),'utf8'));assert.equal(managed.models.length,5);assert.ok(f.requests.filter(r=>r.url.includes('/resolve/')).length===5);
});
test('模型校验失败保留已验证环境下载，但不发布半成品',async t=>{
 const f=await fixture(t,{body:async url=>new Response(url===officialUrl?archive:Buffer.alloc(archive.length,1))});const p=await f.manager.plan({rootPath:f.root,hardware});const state=await f.manager.start(p);
 assert.equal(state.status,'error');assert.match(state.error!,/SHA256/);assert.equal(digest(await fs.readFile(path.join(f.root,'.luckyx-bootstrap/portable.7z'))),digest(archive));await assert.rejects(fs.stat(p.targetPath),{code:'ENOENT'});
});
test('未知硬件无法启动安装，失败的新计划使旧计划失效',async t=>{
 const f=await fixture(t);const p=await f.manager.plan({rootPath:f.root,hardware:{...hardware,gpuName:'Unknown'},profile:'environment'});const state=await f.manager.start(p);assert.equal(state.status,'error');assert.equal(f.runs.length,0);assert.ok(!f.requests.some(r=>r.url===officialUrl));
 await assert.rejects(f.manager.plan({rootPath:'relative-path',hardware}),/绝对安装目录/);await assert.rejects(f.manager.start(p),/重新检查安装条件/);
});
test('新安装目录计划只读不创建，确认启动后才创建并完成portable环境',async t=>{
 const f=await fixture(t);const freshRoot=path.join(f.root,'新安装位置','尚未创建');const p=await f.manager.plan({rootPath:freshRoot,hardware,profile:'environment'});
 await assert.rejects(fs.stat(path.join(f.root,'新安装位置')),{code:'ENOENT'});assert.equal(p.rootPath,freshRoot);assert.deepEqual(p.hardwareIssues,[]);
 const state=await f.manager.start(p);assert.equal(state.status,'completed');assert.equal(state.installationPath,path.join(freshRoot,'luckyx-environment'));const launch=await getPortableLaunchPlan(state.installationPath!);assert.equal(launch.cwd,state.installationPath);
});
test('RTX4080实际16376MiB允许H3条件安装，低于16000MiB仍明确阻止',async t=>{
 const f=await fixture(t);for(const vramMb of [16376,16000]){const p=await f.manager.plan({rootPath:f.root,hardware:{...hardware,vramMb,ramGb:31}});assert.deepEqual(p.hardwareIssues,[]);}
 const low=await f.manager.plan({rootPath:f.root,hardware:{...hardware,vramMb:15999}});assert.ok(low.hardwareIssues.some(issue=>issue.includes('显存')));const state=await f.manager.start(low);assert.equal(state.status,'error');assert.ok(!f.requests.some(r=>r.url===officialUrl));
});
test('既有venv环境仍复用启动适配脚本，缺入口或空Python不可启动',async t=>{
 const root=await temporary(t);await put(root,'venv/Scripts/python.exe');await put(root,'ComfyUI/main.py');await put(root,'launch_comfy.py');
 const plan=await getEngineInstallation(root);assert.equal(plan.python,path.join(root,'venv/Scripts/python.exe'));assert.equal(plan.launcher,path.join(root,'launch_comfy.py'));assert.deepEqual(plan.args,[path.join(root,'launch_comfy.py'),'--fast-disk']);
 await fs.writeFile(plan.python,'');await assert.rejects(getEngineInstallation(root),/完整的已有环境/);
});
