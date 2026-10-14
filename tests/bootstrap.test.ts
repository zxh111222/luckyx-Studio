import test from 'node:test';
import assert from 'node:assert/strict';
import fsNode, { promises as fs } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createBootstrapManager, assertOfficialDownloadUrl, validateArchiveListing, getPortableLaunchPlan } from '../src/backend/bootstrap';
import { getEngineInstallation } from '../src/backend/engine-installation';
import { getPinnedH3Files } from '../src/backend/h3-downloads';
import { getPinnedEnvironmentFile, CUDA_GPU_PROBE_SCRIPT } from '../src/backend/cuda-runtime';
import type { BootstrapHardware } from '../src/shared/bootstrap';
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
const hardware = { gpuName:'NVIDIA GeForce RTX 4080',vramMb:16384,ramGb:32,driver:'580.88',cudaVersion:'13.0' };
const names = ['diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors','text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors','vae/minimax_h3_video_vae_int8_convrot.safetensors','vae/minimax_h3_audio_vae_fp32.safetensors','loras/minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors'];
async function fixture(t:any, overrides:{body?:(url:string,init?:RequestInit)=>Promise<Response>,free?:()=>number,cuda?:boolean,computed?:boolean,probeCuda?:string,probeError?:boolean,unsafeListing?:boolean,getHardware?:()=>BootstrapHardware,renameEnvironmentDirectory?:typeof fs.rename}={}) {
 const root=await temporary(t);const requests:Array<{url:string,range:string|null}>=[];const runs:string[][]=[];
 const fetcher = async (input:any,init?:RequestInit) => {
  const url=String(input);requests.push({url,range:new Headers(init?.headers).get('range')});
  if(url.includes('api.github.com/')) return Response.json({assets:['cu130','cu126'].map(id=>{const file=getPinnedEnvironmentFile(id as 'cu130'|'cu126');return{name:file.name,size:archive.length,digest:'sha256:'+digest(archive),browser_download_url:file.url};})});
  if(url.includes('/api/models/')) return Response.json({sha:'a'.repeat(40),siblings:names.map(rfilename=>({rfilename,lfs:{size:archive.length,sha256:digest(archive)}}))});
  return overrides.body ? overrides.body(url,init) : new Response(archive);
 };
 const modelFiles=(tier:Parameters<typeof getPinnedH3Files>[0])=>getPinnedH3Files(tier).map(file=>({...file,sizeBytes:archive.length,sha256:digest(archive)}));
 const options={dataDir:path.join(root,'data'),sevenZipPath:'mock-7za.exe',fetch:fetcher as typeof fetch,getFreeBytes:async()=>overrides.free?.()??1024**4,getModelFiles:modelFiles,getEnvironmentFile:(id:Parameters<typeof getPinnedEnvironmentFile>[0])=>({...getPinnedEnvironmentFile(id),sizeBytes:archive.length,sha256:digest(archive)}),getHardware:async()=>overrides.getHardware?.()??hardware,renameEnvironmentDirectory:overrides.renameEnvironmentDirectory,
  runner:async(exe:string,args:string[])=>{runs.push([exe,...args]);const node=getPinnedH3Files('lite').find(file=>file.kind==='node'&&args.includes(path.join(root,'.luckyx-bootstrap/nodes',file.name)));
   if(args[0]==='l')return{stdout:overrides.unsafeListing?'Path = ../escape':node?'----------\nPath = '+node.archiveRoot+'/__init__.py':'----------\nPath = ComfyUI_windows_portable/python_embeded/python.exe\nPath = ComfyUI_windows_portable/ComfyUI/main.py'};
   if(args[0]==='x'){const extracted=args.find(a=>a.startsWith('-o'))!.slice(2);if(node)await put(extracted,node.archiveRoot+'/__init__.py');else{await put(extracted,'ComfyUI_windows_portable/python_embeded/python.exe');await put(extracted,'ComfyUI_windows_portable/ComfyUI/main.py');}return{stdout:''};}
   assert.ok(exe.endsWith('python.exe'));assert.equal(args[2],CUDA_GPU_PROBE_SCRIPT);if(overrides.probeError)throw new Error('mock runtime crashed');return{stdout:JSON.stringify({cuda:overrides.probeCuda??'13.0',available:overrides.cuda!==false,computed:overrides.computed!==false})};}};
 const manager=createBootstrapManager(options);
 t.after(()=>manager.dispose());return{root,manager,requests,runs,options};
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
test('RTX4080实际16376MiB/31GB使用官方均衡，8GB起使用社区Lite而非仅放宽阈值',async t=>{
 const f=await fixture(t);for(const vramMb of [16376,16000]){const p=await f.manager.plan({rootPath:f.root,hardware:{...hardware,vramMb,ramGb:31}});assert.deepEqual(p.hardwareIssues,[]);}
 const low=await f.manager.plan({rootPath:f.root,hardware:{...hardware,vramMb:8192,ramGb:16}});assert.deepEqual(low.hardwareIssues,[]);assert.equal(low.recommendation.tier,'lite');assert.equal(low.files.filter(file=>file.kind==='model').length,4);assert.equal(low.files.filter(file=>file.kind==='node').length,2);assert.equal(low.recommendation.defaults.audio,false);assert.ok(low.files.some(file=>file.name.includes('w4a8')));
});
test('8GB可选Lite音画实验档，安装追加音频VAE并持久恢复为原档位',async t=>{
 const low={...hardware,vramMb:8192,ramGb:16};const f=await fixture(t,{getHardware:()=>low});
 const p=await f.manager.plan({rootPath:f.root,hardware:low,profile:'h3-lite-audio'});
 assert.equal(p.profile,'h3-lite-audio');assert.equal(p.recommendation.tier,'lite-audio');assert.equal(p.recommendation.defaults.audio,true);
 assert.equal(p.files.filter(file=>file.kind==='model').length,5);assert.equal(p.files.filter(file=>file.kind==='node').length,2);
 assert.equal(p.files.filter(file=>file.name==='minimax_h3_audio_vae_fp32.safetensors').length,1);
 assert.ok(p.files.some(file=>file.name.includes('w4a8')));assert.ok(!p.files.some(file=>/32b|turbo/.test(file.name)));
 const done=await f.manager.start(p);assert.equal(done.status,'completed');assert.equal(done.completedFiles,8);
 const marker=JSON.parse(await fs.readFile(path.join(p.targetPath,'luckyx-managed.json'),'utf8'));assert.equal(marker.installationTier,'lite-audio');assert.equal(marker.defaults.audio,true);assert.equal(marker.models.length,5);assert.equal(marker.nodes.length,2);
 await f.manager.dispose();const restored=createBootstrapManager(f.options);t.after(()=>restored.dispose());await restored.ready;
 const state=restored.snapshot();assert.equal(state.status,'completed');assert.equal(state.plan!.profile,'h3-lite-audio');assert.equal(state.plan!.recommendation.tier,'lite-audio');assert.equal(state.plan!.recommendation.defaults.audio,true);
});
test('受管理Lite环境增量升级只下载音频VAE，不重下环境、已有模型或节点',async t=>{
 const low={...hardware,vramMb:8192,ramGb:16};const f=await fixture(t,{getHardware:()=>low});
 const lite=await f.manager.plan({rootPath:f.root,hardware:low,profile:'h3'});assert.equal((await f.manager.start(lite)).status,'completed');
 const markerPath=path.join(lite.targetPath,'luckyx-managed.json'),before=JSON.parse(await fs.readFile(markerPath,'utf8'));assert.equal(before.installationTier,'lite');
 const requestsBefore=f.requests.length,runsBefore=f.runs.length;
 const upgrade=await f.manager.plan({rootPath:f.root,hardware:low,profile:'h3-lite-audio'});
 assert.equal(upgrade.incrementalFromTier,'lite');assert.equal(upgrade.files.length,1);assert.equal(upgrade.files[0].name,'minimax_h3_audio_vae_fp32.safetensors');assert.equal(upgrade.targetPath,lite.targetPath);
 const completed=await f.manager.start(upgrade);assert.equal(completed.status,'completed');assert.equal(completed.completedFiles,1);
 const downloads=f.requests.slice(requestsBefore).filter(request=>!request.url.includes('api.github.com/'));
 assert.deepEqual(downloads.map(request=>request.url),[upgrade.files[0].url]);assert.equal(f.runs.length,runsBefore,'增量升级不得解压环境、节点或重跑Python');
 for(const file of getPinnedH3Files('lite').map(file=>({...file,sizeBytes:archive.length,sha256:digest(archive)}))) {
  const stat=await fs.stat(path.join(lite.targetPath,file.relativePath));assert.ok(file.kind==='node'?stat.isDirectory():stat.isFile(),file.name);
 }
 const marker=JSON.parse(await fs.readFile(markerPath,'utf8'));assert.equal(marker.installationTier,'lite-audio');assert.equal(marker.defaults.audio,true);assert.equal(marker.models.length,5);assert.equal(marker.nodes.length,2);
 await f.manager.dispose();const restored=createBootstrapManager(f.options);t.after(()=>restored.dispose());await restored.ready;
 assert.equal(restored.snapshot().status,'completed');assert.equal(restored.snapshot().plan!.recommendation.tier,'lite-audio');assert.equal(restored.snapshot().plan!.recommendation.defaults.audio,true);
});
test('Lite音画增量下载校验失败保留原Lite环境和marker',async t=>{
 const low={...hardware,vramMb:8192,ramGb:16};let corruptAudio=false;
 const f=await fixture(t,{getHardware:()=>low,body:async url=>new Response(corruptAudio&&url.includes('audio_vae')?Buffer.alloc(archive.length,1):archive)});
 const lite=await f.manager.plan({rootPath:f.root,hardware:low,profile:'h3'});assert.equal((await f.manager.start(lite)).status,'completed');
 const markerPath=path.join(lite.targetPath,'luckyx-managed.json'),markerBefore=await fs.readFile(markerPath,'utf8');
 const baseline=await Promise.all(lite.files.filter(file=>file.kind==='model').map(async file=>[file.relativePath,digest(await fs.readFile(path.join(lite.targetPath,file.relativePath)))] as const));
 corruptAudio=true;const upgrade=await f.manager.plan({rootPath:f.root,hardware:low,profile:'h3-lite-audio'});const failed=await f.manager.start(upgrade);
 assert.equal(failed.status,'error');assert.match(failed.error!,/SHA256/);assert.equal(await fs.readFile(markerPath,'utf8'),markerBefore);
 assert.equal(JSON.parse(markerBefore).installationTier,'lite');await assert.rejects(fs.stat(path.join(lite.targetPath,upgrade.files[0].relativePath)),{code:'ENOENT'});
 for(const [relative,expected] of baseline)assert.equal(digest(await fs.readFile(path.join(lite.targetPath,relative))),expected);
});
test('既有venv环境仍复用启动适配脚本，缺入口或空Python不可启动',async t=>{
 const root=await temporary(t);await put(root,'venv/Scripts/python.exe');await put(root,'ComfyUI/main.py');await put(root,'launch_comfy.py');
 const plan=await getEngineInstallation(root);assert.equal(plan.python,path.join(root,'venv/Scripts/python.exe'));assert.equal(plan.launcher,path.join(root,'launch_comfy.py'));assert.deepEqual(plan.args,[path.join(root,'launch_comfy.py'),'--fast-disk']);
 await fs.writeFile(plan.python,'');await assert.rejects(getEngineInstallation(root),/完整的已有环境/);
});
test('Lite自动校验四模型，两个节点ZIP安全解压到custom_nodes并写持久档位',async t=>{
 const f=await fixture(t);const p=await f.manager.plan({rootPath:f.root,hardware:{...hardware,vramMb:8192,ramGb:16}});const state=await f.manager.start(p);assert.equal(state.status,'completed');assert.equal(state.completedFiles,7);
 for(const file of p.files.filter(file=>file.kind==='model'))assert.equal(digest(await fs.readFile(path.join(p.targetPath,file.relativePath))),file.sha256);
 for(const file of p.files.filter(file=>file.kind==='node')){assert.ok((await fs.stat(path.join(p.targetPath,file.relativePath,'__init__.py'))).isFile());assert.equal(JSON.parse(await fs.readFile(path.join(p.targetPath,file.relativePath,'.luckyx-source.json'),'utf8')).sha256,file.sha256);}
 const marker=JSON.parse(await fs.readFile(path.join(p.targetPath,'luckyx-managed.json'),'utf8'));assert.equal(marker.installationTier,'lite');assert.equal(marker.models.length,4);assert.equal(marker.nodes.length,2);assert.equal(marker.defaults.audio,false);
});
test('重新打开恢复下载片段和计划，只读识别，不自动下载；保存JSON无法替换来源',async t=>{
 const f=await fixture(t);const p=await f.manager.plan({rootPath:f.root,hardware,profile:'environment'});
 await put(f.root,'.luckyx-bootstrap/owner.json',JSON.stringify({app:'luckyx. Studio',target:p.targetPath,version:p.version}));await put(f.root,'.luckyx-bootstrap/portable.7z.part','part');await f.manager.dispose();
 const record=JSON.parse(await fs.readFile(path.join(f.root,'data/bootstrap-progress.json'),'utf8'));record.files=[{url:'https://evil.test/weight'}];await put(f.root,'data/bootstrap-progress.json',JSON.stringify(record));
 const calls=f.requests.length;const restored=createBootstrapManager(f.options);t.after(()=>restored.dispose());await restored.ready;const state=restored.snapshot();assert.equal(state.status,'cancelled');assert.equal(state.resumable,true);assert.equal(state.receivedBytes,4);assert.equal(state.plan!.rootPath,p.rootPath);assert.equal(state.plan!.files[0].url,officialUrl);assert.ok(!f.requests.slice(calls).some(r=>r.url===officialUrl||r.url.includes('evil.test')));
});
test('恢复区分环境包已下载未解压、已解压模型未完整，完成后无需再次安装',async t=>{
 for(const extracted of [false,true]){const f=await fixture(t);const p=await f.manager.plan({rootPath:f.root,hardware,profile:'environment'});await put(f.root,'.luckyx-bootstrap/owner.json',JSON.stringify({app:'luckyx. Studio',target:p.targetPath,version:p.version}));await fs.writeFile(path.join(f.root,'.luckyx-bootstrap/portable.7z'),archive);if(extracted){await put(f.root,'.luckyx-bootstrap/unpacked/ComfyUI_windows_portable/python_embeded/python.exe');await put(f.root,'.luckyx-bootstrap/unpacked/ComfyUI_windows_portable/ComfyUI/main.py');}await f.manager.dispose();const restored=createBootstrapManager(f.options);await restored.ready;assert.equal(restored.snapshot().phase,extracted?'文件已准备，等待环境配置':'环境包已下载，等待解压');await restored.dispose();}
 const f=await fixture(t);const p=await f.manager.plan({rootPath:f.root,hardware});await f.manager.start(p);await f.manager.dispose();const restored=createBootstrapManager(f.options);t.after(()=>restored.dispose());await restored.ready;assert.equal(restored.snapshot().status,'completed');assert.equal(restored.snapshot().installationPath,p.targetPath);assert.equal(restored.snapshot().resumable,false);
});
test('磁盘与硬件联合选择：大显存空间不够时降均衡或Lite，空间不足仍不下载',async t=>{
 const f=await fixture(t);const bytes=(tier:Parameters<typeof getPinnedH3Files>[0])=>getPinnedH3Files(tier).reduce((sum,file)=>sum+file.sizeBytes,0)+5*1024**3+archive.length*5;
 for(const [free,tier] of [[bytes('standard')+1,'standard'],[bytes('balanced')+1,'balanced'],[bytes('lite')+1,'lite']] as const){const manager=createBootstrapManager({...f.options,getModelFiles:getPinnedH3Files,getFreeBytes:async()=>free});await manager.ready;const plan=await manager.plan({rootPath:f.root,hardware:{...hardware,vramMb:32768,ramGb:64}});assert.equal(plan.recommendation.tier,tier);assert.ok(plan.requiredFreeBytes<=plan.freeBytes);if(tier!=='standard')assert.match(plan.recommendation.reason,/磁盘空间/);await manager.dispose();}
 const manager=createBootstrapManager({...f.options,getModelFiles:getPinnedH3Files,getFreeBytes:async()=>1024**3});await manager.ready;const plan=await manager.plan({rootPath:f.root,hardware});const result=await manager.start(plan);assert.equal(result.status,'error');assert.match(result.error!,/磁盘空间/);await manager.dispose();
});
test('恢复不接受已安装节点或模型缺失，不重新覆盖环境；未知marker档位保守处理',async t=>{
 const f=await fixture(t);const plan=await f.manager.plan({rootPath:f.root,hardware});await f.manager.start(plan);await f.manager.dispose();const model=plan.files.find(file=>file.kind==='model')!;await fs.writeFile(path.join(plan.targetPath,model.relativePath),'');
 const restored=createBootstrapManager(f.options);await restored.ready;assert.equal(restored.snapshot().status,'error');assert.match(restored.snapshot().phase,/资源不完整/);assert.equal(restored.snapshot().resumable,false);await restored.dispose();assert.equal((await fs.stat(path.join(plan.targetPath,model.relativePath))).size,0);
});

test('临时fetch连接失败自动重试，完成前进度不重复累计',async t=>{
 let attempt=0;const f=await fixture(t,{body:async()=>{if(++attempt===1)throw new TypeError('fetch failed');return new Response(archive);}});
 const p=await f.manager.plan({rootPath:f.root,hardware,profile:'environment'});const progress:number[]=[];const unsub=f.manager.subscribe(s=>progress.push(s.receivedBytes));
 const state=await f.manager.start(p);unsub();assert.equal(state.status,'completed');assert.equal(attempt,2);assert.equal(state.receivedBytes,archive.length);assert.ok(progress.every(bytes=>bytes<=archive.length));
});

test('读取中断从已落盘Range继续，提前EOF保留片段而非清空',async t=>{
 for(const streamError of [true,false]){
  let attempt=0;const f=await fixture(t,{body:async(_url,init)=>{if(++attempt===1){if(!streamError)return new Response(archive.subarray(0,8));let first=true;return new Response(new ReadableStream({pull(controller){if(first){first=false;controller.enqueue(archive.subarray(0,8));}else controller.error(new TypeError('terminated'));}}));}assert.equal(new Headers(init?.headers).get('range'),'bytes=8-');return new Response(archive.subarray(8),{status:206,headers:{'content-range':`bytes 8-${archive.length-1}/${archive.length}`}});}});
  const p=await f.manager.plan({rootPath:f.root,hardware,profile:'environment'});const values:number[]=[];f.manager.subscribe(s=>values.push(s.receivedBytes));const state=await f.manager.start(p);
  assert.equal(state.status,'completed');assert.equal(attempt,2);assert.equal(state.receivedBytes,archive.length);assert.ok(values.every(n=>n<=archive.length));assert.equal(digest(await fs.readFile(path.join(f.root,'.luckyx-bootstrap/portable.7z'))),digest(archive));
 }
});

test('服务器忽略Range时只重写当前片段，模型前已完成文件计数保留',async t=>{
 let first=true;const f=await fixture(t,{body:async url=>{if(url!==officialUrl&&first){first=false;return new Response(archive.subarray(0,8));}return new Response(archive);}});
 const p=await f.manager.plan({rootPath:f.root,hardware});const values:number[]=[];f.manager.subscribe(s=>values.push(s.receivedBytes));const result=await f.manager.start(p);
 assert.equal(result.status,'completed');assert.equal(result.completedFiles,p.files.length);assert.equal(result.receivedBytes,p.downloadBytes);assert.ok(values.every(n=>n<=p.downloadBytes));assert.ok(f.requests.some(r=>r.range==='bytes=8-'));
});

test('临时HTTP503会重试，永久HTTP404立即停止且提示来源和保留进度',async t=>{
 let attempt=0;const f=await fixture(t,{body:async()=>++attempt===1?new Response(null,{status:503,headers:{'retry-after':'0'}}):new Response(archive)});
 const p=await f.manager.plan({rootPath:f.root,hardware,profile:'environment'});assert.equal((await f.manager.start(p)).status,'completed');assert.equal(attempt,2);
 const missing=await fixture(t,{body:async()=>new Response(null,{status:404})});const q=await missing.manager.plan({rootPath:missing.root,hardware,profile:'environment'});const state=await missing.manager.start(q);assert.equal(state.status,'error');assert.match(state.error!,/GitHub.*HTTP 404.*系统代理.*保留/);assert.equal(missing.requests.filter(r=>r.url===officialUrl).length,1);
});

test('全部连接失败有限重试后给出可操作提示，不暴露原始异常或签名URL',async t=>{
 let attempt=0;const f=await fixture(t,{body:async()=>{attempt++;throw new TypeError('fetch failed https://cdn.test?token=secret');}});
 const p=await f.manager.plan({rootPath:f.root,hardware,profile:'environment'});const result=await f.manager.start(p);assert.equal(result.status,'error');assert.equal(attempt,4);assert.equal(result.resumable,true);assert.match(result.error!,/GitHub.*自动重试 3 次.*进度已保留.*系统代理/);assert.doesNotMatch(result.error!,/fetch failed|secret|cdn.test/);assert.equal(f.runs.length,0);
});

test('自动重试等待期间可立即取消，不发起新请求且保留已写入部分',async t=>{
 const f=await fixture(t,{body:async()=>new Response(archive.subarray(0,8))});const p=await f.manager.plan({rootPath:f.root,hardware,profile:'environment'});
 f.manager.subscribe(s=>{if(s.phase==='连接中断，自动重试')f.manager.cancel();});const state=await f.manager.start(p);
 assert.equal(state.status,'cancelled');assert.equal(f.requests.filter(r=>r.url===officialUrl).length,1);assert.equal((await fs.stat(path.join(f.root,'.luckyx-bootstrap/portable.7z.part'))).size,8);assert.equal(state.receivedBytes,8);
});

test('206范围终点与Content-Length不符拒绝且保留断点，不触发网络重试',async t=>{
 for(const headers of [{'content-range':`bytes 4-${archive.length}/${archive.length}`},{'content-range':`bytes 4-${archive.length-1}/${archive.length}`,'content-length':'999'}] as Record<string,string>[]){
  const f=await fixture(t,{body:async()=>new Response(archive.subarray(4),{status:206,headers})});const p=await f.manager.plan({rootPath:f.root,hardware,profile:'environment'});
  await put(f.root,'.luckyx-bootstrap/owner.json',JSON.stringify({app:'luckyx. Studio',target:p.targetPath,version:p.version}));await put(f.root,'.luckyx-bootstrap/portable.7z.part','part');const state=await f.manager.start(p);
  assert.equal(state.status,'error');assert.match(state.error!,/断点响应无效|文件大小与清单不符/);assert.equal(f.requests.filter(r=>r.url===officialUrl).length,1);assert.equal(await fs.readFile(path.join(f.root,'.luckyx-bootstrap/portable.7z.part'),'utf8'),'part');
 }
});

test('断流重试重新访问固定原始地址并重新核对CDN重定向',async t=>{
 let original=0;const cdn='https://release-assets.githubusercontent.com/fixture/archive';const f=await fixture(t,{body:async(url,init)=>{
  if(url===officialUrl){original++;return new Response(null,{status:302,headers:{location:cdn+'?attempt='+original}});}
  if(original===1)return new Response(archive.subarray(0,8));
  assert.equal(new Headers(init?.headers).get('range'),'bytes=8-');return new Response(archive.subarray(8),{status:206,headers:{'content-range':`bytes 8-${archive.length-1}/${archive.length}`}});
 }});const p=await f.manager.plan({rootPath:f.root,hardware,profile:'environment'});assert.equal((await f.manager.start(p)).status,'completed');assert.equal(original,2);assert.ok(f.requests.some(r=>r.url===cdn+'?attempt=2'));
});

test('RTX3070驱动546.30与CUDA12.3在任何资源下载前阻止，计划仍保留Lite模型清单',async t=>{
 const old={gpuName:'NVIDIA GeForce RTX 3070',vramMb:8192,ramGb:32,driver:'546.30',cudaVersion:'12.3'};const f=await fixture(t,{getHardware:()=>old});
 const p=await f.manager.plan({rootPath:f.root,hardware:old});assert.equal(p.runtime!.id,'cu130');assert.equal(p.runtime!.compatibility,'driver-update-required');assert.equal(p.recommendation.tier,'lite');assert.equal(p.files.filter(file=>file.kind==='model').length,4);
 const result=await f.manager.start(p);assert.equal(result.status,'error');assert.match(result.error!,/546\.30.*580.*保留/);assert.equal(f.runs.length,0);assert.ok(!f.requests.some(r=>r.url===officialUrl||r.url.includes('/resolve/')));await assert.rejects(fs.stat(path.join(f.root,'.luckyx-bootstrap')),{code:'ENOENT'});
});

test('点击安装时重新读取实际驱动，旧计划不可绕过退回旧驱动后的阻止',async t=>{
 let actual:BootstrapHardware={...hardware};const f=await fixture(t,{getHardware:()=>actual});const p=await f.manager.plan({rootPath:f.root,hardware,profile:'environment'});actual={...hardware,driver:'546.30',cudaVersion:'12.3'};
 const result=await f.manager.start(p);assert.equal(result.status,'error');assert.match(result.error!,/580/);assert.ok(!f.requests.some(r=>r.url===officialUrl));assert.equal(f.runs.length,0);
});

test('GPU实际运算失败或探针进程崩溃均在模型下载前停止，已验证环境包保留',async t=>{
 for(const override of [{computed:false},{cuda:false},{probeError:true},{probeCuda:'12.6'}]){
  const f=await fixture(t,override);const p=await f.manager.plan({rootPath:f.root,hardware});const state=await f.manager.start(p);assert.equal(state.status,'error');assert.match(state.error!,/GPU|运行包与计划/);assert.equal(state.resumable,true);assert.ok(!f.requests.some(r=>r.url.includes('/resolve/')));assert.equal(digest(await fs.readFile(path.join(f.root,'.luckyx-bootstrap/portable.7z'))),digest(archive));await assert.rejects(fs.stat(p.targetPath),{code:'ENOENT'});
 }
});

test('旧GTX基础环境使用官方cu126独立缓存并实际运算，已有cu13包和模型完整保留',async t=>{
 const legacy={gpuName:'NVIDIA GeForce GTX 1080',vramMb:8192,ramGb:16,driver:'546.30',cudaVersion:'12.3'};const f=await fixture(t,{getHardware:()=>legacy,probeCuda:'12.6'});const p=await f.manager.plan({rootPath:f.root,hardware:legacy,profile:'environment'});
 assert.deepEqual(p.hardwareIssues,[]);assert.equal(p.runtime!.id,'cu126');assert.equal(p.files.length,1);assert.match(p.files[0].url,/_cu126\.7z$/);
 await put(f.root,'.luckyx-bootstrap/owner.json',JSON.stringify({app:'luckyx. Studio',target:p.targetPath,version:p.version}));await put(f.root,'.luckyx-bootstrap/portable.7z','keep old cu13');await put(f.root,'.luckyx-bootstrap/unpacked/ComfyUI_windows_portable/ComfyUI/models/user.safetensors','keep existing model');
 const state=await f.manager.start(p);assert.equal(state.status,'completed');assert.equal(await fs.readFile(path.join(f.root,'.luckyx-bootstrap/portable.7z'),'utf8'),'keep old cu13');assert.equal(await fs.readFile(path.join(f.root,'.luckyx-bootstrap/unpacked/ComfyUI_windows_portable/ComfyUI/models/user.safetensors'),'utf8'),'keep existing model');assert.equal(digest(await fs.readFile(path.join(f.root,'.luckyx-bootstrap/portable-cu126.7z'))),digest(archive));assert.equal(f.runs.filter(r=>r[0].endsWith('python.exe')).length,2);assert.equal(JSON.parse(await fs.readFile(path.join(p.targetPath,'luckyx-managed.json'),'utf8')).runtimeId,'cu126');
});

test('旧驱动恢复已下载H3模型显示保留，升级重新检查后直接校验无需重下模型',async t=>{
 let actual:BootstrapHardware={...hardware};const f=await fixture(t,{getHardware:()=>actual});const p=await f.manager.plan({rootPath:f.root,hardware});await put(f.root,'.luckyx-bootstrap/owner.json',JSON.stringify({app:'luckyx. Studio',target:p.targetPath,version:p.version}));await fs.writeFile(path.join(f.root,'.luckyx-bootstrap/portable.7z'),archive);
 await put(f.root,'.luckyx-bootstrap/unpacked/ComfyUI_windows_portable/python_embeded/python.exe');await put(f.root,'.luckyx-bootstrap/unpacked/ComfyUI_windows_portable/ComfyUI/main.py');for(const file of p.files.slice(1)){const destination=path.join(f.root,'.luckyx-bootstrap/unpacked/ComfyUI_windows_portable',file.relativePath);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,archive);}
 await f.manager.dispose();actual={...hardware,driver:'546.30',cudaVersion:'12.3'};const restored=createBootstrapManager(f.options);t.after(()=>restored.dispose());await restored.ready;let state=restored.snapshot();assert.equal(state.status,'cancelled');assert.equal(state.resumable,true);assert.equal(state.receivedBytes,p.downloadBytes);assert.equal(state.plan!.cachedBytes,p.downloadBytes);assert.equal(state.phase,'文件已准备，等待环境配置');assert.ok(state.plan!.hardwareIssues.length>0);assert.match(state.message,/保留.*重新检查/);
 actual={...hardware};const resumed=await restored.plan({rootPath:f.root,hardware:actual});assert.equal(resumed.cachedBytes,p.downloadBytes);assert.equal(restored.snapshot().receivedBytes,p.downloadBytes);const before=f.requests.length;state=await restored.start(resumed);assert.equal(state.status,'completed');assert.equal(state.receivedBytes,p.downloadBytes);assert.equal(f.requests.length,before);for(const file of resumed.files.filter(file=>file.kind==='model'))assert.equal(digest(await fs.readFile(path.join(p.targetPath,file.relativePath))),digest(archive));
});

test('CUDA12.6基础环境完成后硬件变为RTX，恢复仍保留原runtime且不替换原文件',async t=>{
 let actual:BootstrapHardware={gpuName:'NVIDIA GeForce GTX 1080',vramMb:8192,ramGb:16,driver:'580.88',cudaVersion:'13.0'};const f=await fixture(t,{getHardware:()=>actual,probeCuda:'12.6'});const p=await f.manager.plan({rootPath:f.root,hardware:actual,profile:'environment'});assert.equal((await f.manager.start(p)).status,'completed');await f.manager.dispose();actual={...hardware};const restored=createBootstrapManager(f.options);t.after(()=>restored.dispose());await restored.ready;const state=restored.snapshot();assert.equal(state.status,'completed');assert.equal(state.plan!.runtime!.id,'cu126');assert.match(state.plan!.files[0].url,/_cu126\.7z$/);assert.equal(await restored.completedInstallation(),p.targetPath);
});

test('计划缓存仅计选中runtime资源和有限大小片段，不计其他runtime或解压Python文件',async t=>{
 const legacy={gpuName:'NVIDIA GeForce GTX 1080',vramMb:8192,ramGb:16,driver:'580.88',cudaVersion:'13.0'};const f=await fixture(t,{getHardware:()=>legacy,probeCuda:'12.6'});const p=await f.manager.plan({rootPath:f.root,hardware:legacy,profile:'environment'});
 await put(f.root,'.luckyx-bootstrap/owner.json',JSON.stringify({app:'luckyx. Studio',target:p.targetPath,version:p.version}));await put(f.root,'.luckyx-bootstrap/portable.7z','ignore other runtime');await put(f.root,'.luckyx-bootstrap/unpacked-cu126/ComfyUI_windows_portable/python_embeded/python.exe','ignore extracted Python bytes');
 let replanned=await f.manager.plan({rootPath:f.root,hardware:legacy,profile:'environment'});assert.equal(replanned.cachedBytes,0);assert.equal(f.manager.snapshot().receivedBytes,0);
 await put(f.root,'.luckyx-bootstrap/portable-cu126.7z.part','part');replanned=await f.manager.plan({rootPath:f.root,hardware:legacy,profile:'environment'});assert.equal(replanned.cachedBytes,4);assert.equal(f.manager.snapshot().receivedBytes,4);
 await fs.writeFile(path.join(f.root,'.luckyx-bootstrap/portable-cu126.7z.part'),Buffer.alloc(archive.length+100));replanned=await f.manager.plan({rootPath:f.root,hardware:legacy,profile:'environment'});assert.equal(replanned.cachedBytes,archive.length);assert.ok(replanned.cachedBytes!<=replanned.downloadBytes);
});

test('全模型下载后目录EPERM会自动重试，配置成功时不误显示正在下载单个模型',async t=>{
 let attempts=0;const f=await fixture(t,{renameEnvironmentDirectory:async(source,target)=>{if(++attempts===1)throw Object.assign(new Error('rename busy'),{code:'EPERM'});await fs.rename(source,target);}});const p=await f.manager.plan({rootPath:f.root,hardware});const messages:string[]=[];f.manager.subscribe(s=>{if(s.phase==='完成环境配置'){assert.equal(s.currentFile,undefined);messages.push(s.message);}});
 const state=await f.manager.start(p);assert.equal(state.status,'completed');assert.equal(attempts,2);assert.ok(messages.some(message=>message.includes('第 2 / 6 次配置')));assert.equal(state.currentFile,undefined);assert.equal(state.receivedBytes,p.downloadBytes);assert.equal(f.requests.filter(r=>r.url.includes('/resolve/')).length,5);
});

test('全部文件下载后目录权限错误保留模型，关闭占用再继续只配置不重新下载',async t=>{
 let locked=true,attempts=0;const f=await fixture(t,{renameEnvironmentDirectory:async(source,target)=>{attempts++;if(locked)throw Object.assign(new Error('EPERM raw model path'),{code:'EACCES'});await fs.rename(source,target);}});const p=await f.manager.plan({rootPath:f.root,hardware});let state=await f.manager.start(p);
 assert.equal(state.status,'error');assert.equal(state.phase,'文件已准备，目录配置未完成');assert.equal(state.currentFile,undefined);assert.match(state.error!,/占用.*权限.*保留全部下载和模型.*继续配置环境/);assert.doesNotMatch(state.error!,/raw model path|CUDA|驱动/);assert.equal(state.resumable,true);assert.equal(state.receivedBytes,p.downloadBytes);assert.equal(attempts,6);
 for(const file of p.files.filter(file=>file.kind==='model'))assert.equal(digest(await fs.readFile(path.join(f.root,'.luckyx-bootstrap/unpacked/ComfyUI_windows_portable',file.relativePath))),file.sha256);
 locked=false;const resumed=await f.manager.plan({rootPath:f.root,hardware});assert.equal(resumed.cachedBytes,p.downloadBytes);const before=f.requests.length;state=await f.manager.start(resumed);assert.equal(state.status,'completed');assert.equal(f.requests.length,before);assert.equal(attempts,7);assert.equal(state.receivedBytes,p.downloadBytes);
});

test('已安装环境恢复不访问网络、不遍历Python树，仍检查模型大小并保持恢复记录只读',async t=>{
 const f=await fixture(t);const p=await f.manager.plan({rootPath:f.root,hardware});await f.manager.start(p);await f.manager.dispose();const record=await fs.readFile(path.join(f.root,'data/bootstrap-progress.json'),'utf8');const before=f.requests.length;
 const readDirectory=t.mock.method(fs,'readdir',async()=>{throw new Error('startup must not traverse environment tree');});
 let restored:ReturnType<typeof createBootstrapManager>|undefined;
 try{restored=createBootstrapManager({...f.options,getHardware:async()=>{throw new Error('startup must not wait for hardware probe');}});await restored.ready;const state=restored.snapshot();assert.equal(state.status,'completed');assert.equal(state.installationPath,p.targetPath);assert.equal(f.requests.length,before);assert.equal(readDirectory.mock.calls.length,0);assert.equal(await fs.readFile(path.join(f.root,'data/bootstrap-progress.json'),'utf8'),record);}
 finally{readDirectory.mock.restore();await restored?.dispose();}
});

test('缓存恢复不整包计算SHA、读取权重或遍历目录；显式继续仍执行完整SHA验证',async t=>{
 const f=await fixture(t);const p=await f.manager.plan({rootPath:f.root,hardware,profile:'environment'});await put(f.root,'.luckyx-bootstrap/owner.json',JSON.stringify({app:'luckyx. Studio',target:p.targetPath,version:p.version}));await fs.writeFile(path.join(f.root,'.luckyx-bootstrap/portable.7z'),Buffer.alloc(archive.length,120));await f.manager.dispose();const before=f.requests.length;
 const readDirectory=t.mock.method(fs,'readdir',async()=>{throw new Error('startup must not traverse cache tree');});const stream=t.mock.method(fsNode,'createReadStream',()=>{throw new Error('startup must not read archive bytes');});syncBuiltinESMExports();
 let restored:ReturnType<typeof createBootstrapManager>|undefined;
 try{restored=createBootstrapManager(f.options);await restored.ready;const state=restored.snapshot();assert.equal(state.status,'cancelled');assert.equal(state.phase,'环境包已下载，等待解压');assert.equal(state.receivedBytes,archive.length);assert.equal(f.requests.length,before);assert.equal(readDirectory.mock.calls.length,0);assert.equal(stream.mock.calls.length,0);}
 finally{readDirectory.mock.restore();stream.mock.restore();syncBuiltinESMExports();}
 try{const checked=await restored!.plan({rootPath:f.root,hardware,profile:'environment'});const state=await restored!.start(checked);assert.equal(state.status,'error');assert.match(state.error!,/完整性不符/);assert.equal(f.runs.length,0);}
 finally{await restored?.dispose();}
});

test('Lite完成环境快速恢复仍拒绝缺少节点源码标识或模型大小不符',async t=>{
 const f=await fixture(t);const p=await f.manager.plan({rootPath:f.root,hardware:{...hardware,vramMb:8192,ramGb:16}});await f.manager.start(p);await f.manager.dispose();const node=p.files.find(file=>file.kind==='node')!;await fs.writeFile(path.join(p.targetPath,node.relativePath,'.luckyx-source.json'),JSON.stringify({app:'other',sha256:node.sha256,url:node.url}));const before=f.requests.length;
 const restored=createBootstrapManager(f.options);t.after(()=>restored.dispose());await restored.ready;assert.equal(restored.snapshot().status,'error');assert.match(restored.snapshot().phase,/资源不完整/);assert.equal(f.requests.length,before);
});

test('快速缓存恢复不遍历Python但仍拒绝必要资源路径上的junction',async t=>{
 const f=await fixture(t);const p=await f.manager.plan({rootPath:f.root,hardware,profile:'environment'});await put(f.root,'.luckyx-bootstrap/owner.json',JSON.stringify({app:'luckyx. Studio',target:p.targetPath,version:p.version}));const external=path.join(f.root,'external-environment');await fs.mkdir(external);await fs.symlink(external,path.join(f.root,'.luckyx-bootstrap/unpacked'),'junction');await f.manager.dispose();const before=f.requests.length;
 const restored=createBootstrapManager(f.options);t.after(()=>restored.dispose());await restored.ready;assert.equal(restored.snapshot().status,'error');assert.match(restored.snapshot().error!,/目录链接/);assert.equal(f.requests.length,before);
});

test('旧版无selection的缓存通过固定模型文件名恢复原档位，不等待真实硬件探测',async t=>{
 const f=await fixture(t);const p=await f.manager.plan({rootPath:f.root,hardware});await put(f.root,'.luckyx-bootstrap/owner.json',JSON.stringify({app:'luckyx. Studio',target:p.targetPath,version:p.version}));const diffusion=p.files.find(file=>file.kind==='model')!;const destination=path.join(f.root,'.luckyx-bootstrap/unpacked/ComfyUI_windows_portable',diffusion.relativePath);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,archive);await f.manager.dispose();const saved=JSON.parse(await fs.readFile(path.join(f.root,'data/bootstrap-progress.json'),'utf8'));delete saved.selection;await fs.writeFile(path.join(f.root,'data/bootstrap-progress.json'),JSON.stringify(saved));const before=f.requests.length;
 const restored=createBootstrapManager({...f.options,getHardware:async()=>{throw new Error('startup must not invoke nvidia-smi');}});t.after(()=>restored.dispose());await restored.ready;const state=restored.snapshot();assert.equal(state.status,'cancelled');assert.equal(state.plan!.recommendation.tier,p.recommendation.tier);assert.equal(state.plan!.runtime!.id,p.runtime!.id);assert.equal(state.plan!.runtime!.compatibility,'unknown');assert.equal(state.receivedBytes,archive.length);assert.equal(f.requests.length,before);assert.equal(JSON.parse(await fs.readFile(path.join(f.root,'data/bootstrap-progress.json'),'utf8')).selection,undefined);
});

test('旧版无selection的Lite视频缓存不会被恢复成Lite音画档',async t=>{
 const liteHardware={...hardware,vramMb:8192,ramGb:16};const f=await fixture(t);const p=await f.manager.plan({rootPath:f.root,hardware:liteHardware});assert.equal(p.recommendation.tier,'lite');await put(f.root,'.luckyx-bootstrap/owner.json',JSON.stringify({app:'luckyx. Studio',target:p.targetPath,version:p.version}));const diffusion=p.files.find(file=>file.kind==='model')!;const destination=path.join(f.root,'.luckyx-bootstrap/unpacked/ComfyUI_windows_portable',diffusion.relativePath);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,archive);await f.manager.dispose();const saved=JSON.parse(await fs.readFile(path.join(f.root,'data/bootstrap-progress.json'),'utf8'));delete saved.selection;await fs.writeFile(path.join(f.root,'data/bootstrap-progress.json'),JSON.stringify(saved));
 const restored=createBootstrapManager({...f.options,getHardware:async()=>{throw new Error('startup must not invoke nvidia-smi');}});t.after(()=>restored.dispose());await restored.ready;assert.equal(restored.snapshot().plan!.recommendation.tier,'lite');
});

test('最终GPU检查失败保留全量下载，但不继续显示最后一个模型文件作为故障对象',async t=>{
 const finalUrl=getPinnedH3Files('balanced').at(-1)!.url;
 const config={computed:true,body:async(url:string)=>{if(url===finalUrl)config.computed=false;return new Response(archive);}};
 const f=await fixture(t,config);const p=await f.manager.plan({rootPath:f.root,hardware});const state=await f.manager.start(p);
 assert.equal(state.status,'error');assert.match(state.error!,/GPU.*运算/);assert.equal(state.currentFile,undefined);assert.equal(state.receivedBytes,p.downloadBytes);
 const again=await f.manager.plan({rootPath:f.root,hardware});assert.equal(again.cachedBytes,p.downloadBytes);
});
