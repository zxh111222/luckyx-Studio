import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { createStudioService } from '../src/backend/service';
import graph from '../src/backend/workflows/h3-i2v.json';
import type { Snapshot, TaskRecord, GenerationParams, StudioService } from '../src/shared/contracts';
const base:GenerationParams={templateId:'h3-i2v',prompt:'测试镜头',width:864,height:480,frames:124,steps:4,seed:123,image:{name:'first.png',dataBase64:Buffer.from([137,80,78,71,13,10,26,10,0]).toString('base64')}};
async function until(predicate:()=>Promise<boolean>){for(let i=0;i<100;i++){if(await predicate())return;await delay(50);}throw new Error('等待模拟服务状态超时');}
async function fixture(t:any){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luckyx-tests-')); const installationPath=path.join(dir,'engine');
 const modelPath=path.join(installationPath,'ComfyUI/models');
 for(const [folder,name] of [['diffusion_models',graph['1'].inputs.unet_name],['text_encoders',graph['2'].inputs.clip_name],['vae',graph['3'].inputs.vae_name],['vae',graph['4'].inputs.vae_name],['loras',graph['5'].inputs.lora_name]]){await fs.mkdir(path.join(modelPath,folder),{recursive:true});await fs.writeFile(path.join(modelPath,folder,name),'test-model-placeholder');}
 await fs.mkdir(path.join(installationPath,'venv/Scripts'),{recursive:true}); await fs.writeFile(path.join(installationPath,'venv/Scripts/python.exe'),'not-executable');await fs.writeFile(path.join(installationPath,'ComfyUI/main.py'),'# mock');await fs.writeFile(path.join(installationPath,'launch_comfy.py'),'# mock');
 const state={pending:[] as any[],running:[] as any[],history:{} as Record<string,any>,info:Object.fromEntries(Object.values(graph).map(n=>[n.class_type,{input:{required:{}}}])) as Record<string,any>,calls:[] as {url:string;body:any}[],failPrompt:false,dropPromptResponse:false,invalidUpload:false,invalidStats:false,redirectStats:false};
 let serial=0;
 const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;let json:any;try{json=JSON.parse(body)}catch{};const url=req.url!.split('?')[0];state.calls.push({url,body:json});res.setHeader('Content-Type','application/json');
 if(url==='/system_stats'&&state.redirectStats){res.statusCode=302;res.setHeader('Location','http://example.invalid/system_stats');res.end('{}');}else if(url==='/system_stats')res.end(JSON.stringify(state.invalidStats?{hello:'other server'}:{system:{comfyui_version:'mock'},devices:[]}));
 else if(url==='/object_info')res.end(JSON.stringify(state.info));
 else if(url==='/queue'&&req.method==='POST'){state.pending=state.pending.filter(row=>!json.delete.includes(row[1]));res.end('{}');}
 else if(url==='/queue')res.end(JSON.stringify({queue_pending:state.pending,queue_running:state.running}));
 else if(url==='/upload/image')res.end(JSON.stringify({name:state.invalidUpload?'../evil.png':'safe.png',subfolder:'test-input',type:'input'}));
 else if(url==='/prompt'){if(state.failPrompt){res.statusCode=400;res.end(JSON.stringify({error:{message:'模拟节点校验失败'}}));}else{const id='mock-'+(++serial);state.pending.push([serial,id,json.prompt,json.extra_data]);if(state.dropPromptResponse)res.destroy();else res.end(JSON.stringify({prompt_id:id}));}}
 else if(url.startsWith('/history/')){const id=decodeURIComponent(url.slice(9));res.end(JSON.stringify(state.history[id]?{[id]:state.history[id]}:{}));}
 else if(url==='/interrupt')res.end('{}');
 else{res.statusCode=404;res.end('{}');}
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));server.on('upgrade',(_req,socket)=>socket.destroy());
 const engineUrl=`http://127.0.0.1:${(server.address() as any).port}`;let service:StudioService|undefined;
 t.after(async()=>{if(service)await service.dispose();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await fs.rm(dir,{recursive:true,force:true});});
 service=await createStudioService({dataDir:path.join(dir,'data'),defaultInstallationPath:installationPath});
 await until(async()=>((await service!.invoke('snapshot')) as Snapshot).engine.message!=='尚未连接引擎');
 await service.invoke('settings.save',{engineUrl,modelPath});await service.invoke('tasks.refresh');await until(async()=>{await service!.invoke('tasks.refresh');return ((await service!.invoke('snapshot')) as Snapshot).engine.status==='ready';});
 return {service,state,dir,installationPath,modelPath,replace:(next:StudioService)=>{service=next;}};
}
test('本地模拟服务验证模板/资源，快照不可从调用者篡改',async t=>{
 const f=await fixture(t);const template:any=await f.service.invoke('template.validate');assert.equal(template.ready,true);
 const snapshot=await f.service.invoke('snapshot') as Snapshot;assert.equal(snapshot.resources.length,5);assert.ok(snapshot.resources.every(r=>r.status==='installed'));assert.equal(snapshot.engine.managed,false);assert.equal(snapshot.settings.initialized,true);
 snapshot.settings.engineUrl='http://evil.test';assert.notEqual((await f.service.invoke('snapshot') as Snapshot).settings.engineUrl,snapshot.settings.engineUrl);
 await assert.rejects(f.service.invoke('settings.save',{engineUrl:'http://evil.test'}),/本机/);
 await assert.rejects(f.service.invoke('engine.stop'),/外部程序/);
});
test('缺少模型或节点时阻止上传和提交',async t=>{
 const f=await fixture(t);delete f.state.info.MiniMaxH3ImageToVideo;
 await assert.rejects(f.service.invoke('task.submit',base),/缺少节点/);assert.equal(f.state.calls.filter(c=>c.url==='/prompt').length,0);
 f.state.info.MiniMaxH3ImageToVideo={};await fs.rm(path.join(f.modelPath,'vae',graph['3'].inputs.vae_name));
 await assert.rejects(f.service.invoke('task.submit',base),/缺少模型/);assert.equal(f.state.calls.filter(c=>c.url==='/upload/image').length,0);
});
test('提交真实API结构并保存参数；历史只输出合法MP4',async t=>{
 const f=await fixture(t);const task=await f.service.invoke('task.submit',base) as TaskRecord;
 assert.equal(task.status,'queued');assert.ok(task.promptId);assert.equal(task.params.image,undefined);
 const sent=f.state.calls.find(c=>c.url==='/prompt')!.body;assert.equal(sent.prompt['16'].inputs.image,'test-input/safe.png');assert.equal(sent.prompt['6'].inputs.prompt,base.prompt);assert.equal(sent.prompt['7'].inputs.noise_seed,123);
 f.state.pending=[];f.state.history[task.promptId!]={status:{completed:true,status_str:'success',messages:[]},outputs:{15:{images:[{filename:'result.mp4',subfolder:'luckyx',type:'output'},{filename:'../unsafe.mp4',subfolder:'',type:'output'}]}}};
 await f.service.invoke('tasks.refresh');const complete=(await f.service.invoke('snapshot') as Snapshot).tasks[0];assert.equal(complete.status,'completed');assert.equal(complete.outputs.length,1);
 const media=await f.service.resolveMedia(task.id,0);assert.match(media.url,/\/view\?/);assert.equal(new URL(media.url).searchParams.get('filename'),'result.mp4');
 await assert.rejects(f.service.resolveMedia(task.id,-1),/不存在/);await assert.rejects(f.service.resolveMedia('not-a-task',0),/不存在/);
});
test('取消排队任务仅删除该ID；取消运行任务等待确认，拒绝中断其它任务',async t=>{
 const f=await fixture(t);const first=await f.service.invoke('task.submit',base) as TaskRecord;
 await f.service.invoke('task.cancel',{id:first.id});assert.deepEqual(f.state.calls.find(c=>c.url==='/queue'&&c.body)?.body,{delete:[first.promptId]});assert.equal(f.state.calls.filter(c=>c.url==='/interrupt').length,0);
 const second=await f.service.invoke('task.submit',base) as TaskRecord;f.state.pending=[];f.state.running=[[0,'external-task',{}]];
 await assert.rejects(f.service.invoke('task.cancel',{id:second.id}),/无法确认/);assert.equal(f.state.calls.filter(c=>c.url==='/interrupt').length,0);
 f.state.running=[[0,second.promptId,{}]];const cancelling=await f.service.invoke('task.cancel',{id:second.id}) as TaskRecord;assert.match(cancelling.stage,/等待引擎确认/);assert.notEqual(cancelling.status,'interrupted');assert.equal(f.state.calls.filter(c=>c.url==='/interrupt').length,1);
});
test('提交HTTP错误保留失败记录与中文原因，不伪造完成',async t=>{
 const f=await fixture(t);f.state.failPrompt=true;const failed=await f.service.invoke('task.submit',base) as TaskRecord;
 assert.equal(failed.status,'failed');assert.match(failed.error!,/400.*模拟节点校验失败/);assert.equal(failed.outputs.length,0);
 f.state.failPrompt=false;const retry=await f.service.invoke('task.retry',{id:failed.id}) as TaskRecord;assert.equal(retry.status,'queued');assert.notEqual(retry.id,failed.id);assert.equal(f.state.calls.filter(c=>c.url==='/upload/image').length,1);
});
test('无效上传返回路径拒绝提交；非ComfyUI服务不可运行',async t=>{
 const f=await fixture(t);f.state.invalidUpload=true;const failed=await f.service.invoke('task.submit',base) as TaskRecord;assert.equal(failed.status,'failed');assert.match(failed.error!,/无效图片路径/);assert.equal(f.state.calls.filter(c=>c.url==='/prompt').length,0);
 f.state.invalidStats=true;await f.service.invoke('tasks.refresh');await assert.rejects(f.service.invoke('task.submit',base),/先启动引擎/);
});
test('SQLite重启恢复记录和预设，不自动重发任务',async t=>{
 const f=await fixture(t);const task=await f.service.invoke('task.submit',base) as TaskRecord;await f.service.invoke('preset.save',{name:'镜头预设',params:base});
 await f.service.dispose();const count=f.state.calls.filter(c=>c.url==='/prompt').length;
 const restored=await createStudioService({dataDir:path.join(f.dir,'data'),defaultInstallationPath:f.installationPath});f.replace(restored);
 await until(async()=>((await restored.invoke('snapshot')) as Snapshot).engine.message!=='尚未连接引擎');
 const snap=await restored.invoke('snapshot') as Snapshot;assert.equal(snap.tasks[0].id,task.id);assert.equal(snap.tasks[0].promptId,task.promptId);assert.equal(snap.presets[0].name,'镜头预设');assert.equal(snap.presets[0].params.image,undefined);assert.equal(f.state.calls.filter(c=>c.url==='/prompt').length,count);
 await assert.rejects(restored.invoke('settings.save',{outputPath:path.join(f.dir,'new-output')}),/未完成任务/);
});
test('并发重复点击只创建一个任务和一次上传提交',async t=>{
 const f=await fixture(t);const [a,b]=await Promise.all([f.service.invoke('task.submit',base),f.service.invoke('task.submit',structuredClone(base))]) as TaskRecord[];
 assert.equal(a.id,b.id);assert.equal(f.state.calls.filter(c=>c.url==='/prompt').length,1);assert.equal(f.state.calls.filter(c=>c.url==='/upload/image').length,1);assert.equal((await f.service.invoke('snapshot') as Snapshot).tasks.length,1);
});

test('引擎已接收但响应丢失时不盲目重试，按任务元数据恢复',async t=>{
 const f=await fixture(t);f.state.dropPromptResponse=true;
 const task=await f.service.invoke('task.submit',base) as TaskRecord;assert.equal(task.status,'unknown');assert.equal(task.promptId,undefined);
 await assert.rejects(f.service.invoke('task.retry',{id:task.id}),/失败或已取消/);
 f.state.dropPromptResponse=false;await f.service.invoke('tasks.refresh');
 const restored=(await f.service.invoke('snapshot') as Snapshot).tasks[0];assert.equal(restored.id,task.id);assert.equal(restored.promptId,'mock-1');assert.equal(restored.status,'queued');assert.equal(f.state.calls.filter(c=>c.url==='/prompt').length,1);
});

test('空模型文件不视为可用，启动入口不完整不视为已安装',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.modelPath,'vae',graph['3'].inputs.vae_name),'');await fs.rm(path.join(f.installationPath,'launch_comfy.py'));
 await f.service.invoke('resource.scan');const snap=await f.service.invoke('snapshot') as Snapshot;assert.equal(snap.settings.initialized,false);assert.equal(snap.resources.find(r=>r.name===graph['3'].inputs.vae_name)!.status,'missing');
 await assert.rejects(f.service.invoke('task.submit',base),/缺少模型/);
});
test('本机端口HTTP重定向被拒绝，不能绕过仅本机引擎限制',async t=>{
 const f=await fixture(t);f.state.redirectStats=true;await f.service.invoke('tasks.refresh');assert.equal((await f.service.invoke('snapshot') as Snapshot).engine.status,'offline');
 await assert.rejects(f.service.invoke('task.submit',base),/先启动引擎/);assert.equal(f.state.calls.filter(c=>c.url==='/prompt').length,0);
});
test('自定义尺寸时长的任务与预设重启恢复后保持一致',async t=>{
 const f=await fixture(t);const custom={...base,width:480,height:864,frames:243};const task=await f.service.invoke('task.submit',custom) as TaskRecord;
 const sent=f.state.calls.find(c=>c.url==='/prompt')!.body.prompt;assert.equal(sent['6'].inputs.width,480);assert.equal(sent['6'].inputs.height,864);assert.equal(sent['6'].inputs.length,243);assert.equal(sent['14'].inputs.fps,24);
 await f.service.invoke('preset.save',{name:'竖屏长短片',params:custom});await f.service.dispose();const restored=await createStudioService({dataDir:path.join(f.dir,'data'),defaultInstallationPath:f.installationPath});f.replace(restored);
 const snapshot=await restored.invoke('snapshot') as Snapshot;const savedTask=snapshot.tasks.find(t=>t.id===task.id)!;
 for(const params of [savedTask.params,snapshot.presets[0].params]){assert.equal(params.width,480);assert.equal(params.height,864);assert.equal(params.frames,243);assert.equal(params.steps,4);assert.equal(params.seed,custom.seed);}
 assert.equal(f.state.calls.filter(c=>c.url==='/prompt').length,1);
});
test('文生视频无需图片、不上传或保留裸图片数据；图生及历史默认仍需首帧',async t=>{
 const f=await fixture(t);const text={...base,mode:'text',image:{name:'ignored.png',dataBase64:'invalid-do-not-store'}};
 const task=await f.service.invoke('task.submit',text) as TaskRecord;assert.equal(task.status,'queued');assert.equal(task.params.mode,'text');assert.equal(task.params.image,undefined);assert.equal(task.inputImage,undefined);
 const graph=f.state.calls.find(c=>c.url==='/prompt')!.body.prompt;assert.equal('16' in graph,false);assert.equal('first_frame' in graph['6'].inputs,false);assert.equal(f.state.calls.filter(c=>c.url==='/upload/image').length,0);
 await assert.rejects(f.service.invoke('task.submit',{...base,image:undefined}),/首帧图片/);await assert.rejects(f.service.invoke('task.submit',{...base,mode:'image',image:undefined}),/首帧图片/);await assert.rejects(f.service.invoke('task.submit',{...base,mode:'unknown'}),Error);
 assert.equal((await f.service.invoke('snapshot') as Snapshot).tasks.length,1);
});
test('文生视频失败可无图片重试，任务与预设的生成方式重启后保留',async t=>{
 const f=await fixture(t);const text={...base,mode:'text',image:undefined};f.state.failPrompt=true;
 const failed=await f.service.invoke('task.submit',text) as TaskRecord;assert.equal(failed.status,'failed');assert.equal(failed.inputImage,undefined);
 f.state.failPrompt=false;const retried=await f.service.invoke('task.retry',{id:failed.id}) as TaskRecord;assert.equal(retried.status,'queued');assert.equal(retried.params.mode,'text');assert.equal(retried.inputImage,undefined);
 await f.service.invoke('preset.save',{name:'文生视频预设',params:text});await f.service.dispose();const restored=await createStudioService({dataDir:path.join(f.dir,'data'),defaultInstallationPath:f.installationPath});f.replace(restored);
 const snapshot=await restored.invoke('snapshot') as Snapshot;assert.equal(snapshot.presets[0].params.mode,'text');assert.equal(snapshot.presets[0].params.image,undefined);assert.ok(snapshot.tasks.every(t=>t.params.mode==='text'&&t.params.image===undefined));assert.equal(f.state.calls.filter(c=>c.url==='/upload/image').length,0);assert.equal(f.state.calls.filter(c=>c.url==='/prompt').length,2);
});
