import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { createStudioService } from '../src/backend/service';
import { parseWorkflowJson, validateWorkflowName } from '../src/shared/workflow-library';

const api={ '1':{class_type:'LoadImage',inputs:{image:'first.png'}},'2':{class_type:'SaveImage',inputs:{images:['1',0],filename_prefix:'example'}} };
const ui={version:0.4,last_node_id:2,last_link_id:1,nodes:[{id:1,type:'LoadImage',pos:[0,0],size:[200,150],widgets_values:['first.png']},{id:2,type:'SaveImage',pos:[300,0],size:[200,150],widgets_values:['example']}],links:[[1,1,0,2,0,'IMAGE']],groups:[],config:{},extra:{}};

test('识别画布UI与执行API图，不把格式解析当作可运行证明',()=>{
 const parsedUi=parseWorkflowJson(JSON.stringify(ui));assert.equal(parsedUi.format,'ui');assert.equal(parsedUi.nodeCount,2);assert.deepEqual(parsedUi.graph,ui);
 const parsedApi=parseWorkflowJson(JSON.stringify(api));assert.equal(parsedApi.format,'api');assert.equal(parsedApi.nodeCount,2);assert.deepEqual(parsedApi.graph,api);
 assert.equal(parseWorkflowJson(JSON.stringify({version:0.4,nodes:[],links:[]})).nodeCount,0);
 const v1={version:1,nodes:[{id:1,type:'LoadImage'},{id:2,type:'SaveImage'}],links:[{id:1,origin_id:1,origin_slot:0,target_id:2,target_slot:0,type:'IMAGE'}]};assert.equal(parseWorkflowJson(JSON.stringify(v1)).format,'ui');
});
test('拒绝JSON语法错误、未知结构和损坏节点格式',()=>{
 for(const value of ['', '{','null','[]','{}','42','{"nodes":{}}','{"1":{"inputs":{}}}','{"1":{"class_type":"LoadImage","inputs":[]}}','{"nodes":[{"id":1}],"links":[]}'])assert.throws(()=>parseWorkflowJson(value),Error,value);
});
test('导入大小、节点数量和嵌套深度有上限',()=>{
 assert.throws(()=>parseWorkflowJson(' '.repeat(5*1024*1024+1)),Error);
 const many={version:0.4,nodes:Array.from({length:2001},(_,i)=>({id:i+1,type:'LoadImage'})),links:[]};assert.throws(()=>parseWorkflowJson(JSON.stringify(many)),Error);
 let nested:any='end';for(let i=0;i<66;i++)nested={inner:nested};assert.throws(()=>parseWorkflowJson(JSON.stringify({'1':{class_type:'Text',inputs:{nested}}})),Error);
 const oversizedUtf8=JSON.stringify({'1':{class_type:'Text',inputs:{text:'图'.repeat(2*1024*1024)}}});assert.ok(oversizedUtf8.length<5*1024*1024);assert.throws(()=>parseWorkflowJson(oversizedUtf8),Error,'大小按UTF8字节而非字符计算');
});
test('危险对象键和控制字符名称不能进入库，合法名称只去首尾空白',()=>{
 for(const key of ['__proto__','prototype','constructor'])assert.throws(()=>parseWorkflowJson(`{"1":{"class_type":"Text","inputs":{"${key}":{}}}}`),Error);
 assert.equal(({} as any).polluted,undefined);
 assert.equal(validateWorkflowName('  自定义短片  '),'自定义短片');
 for(const value of ['', ' ',null,42,'x'.repeat(81),'bad\0name','bad\nname','bad\tname'])assert.throws(()=>validateWorkflowName(value),Error);
});

async function fixture(t:any){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luckyx-workflow-library-'));const dataDir=path.join(dir,'data');await fs.mkdir(dataDir,{recursive:true});
 const calls:{method:string;url:string}[]=[];
 const server=createServer(async(req,res)=>{for await(const _ of req){}calls.push({method:req.method!,url:req.url!});res.setHeader('Content-Type','application/json');if(req.method!=='GET'){res.statusCode=500;res.end('{"error":"导入不能发起引擎写操作"}');}else if(req.url==='/system_stats')res.end('{"system":{},"devices":[]}');else if(req.url==='/queue')res.end('{"queue_running":[],"queue_pending":[]}');else res.end('{}');});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));server.on('upgrade',(_req,socket)=>socket.destroy());
 const require=createRequire(import.meta.url);const SQL=await initSqlJs({locateFile:()=>require.resolve('sql.js/dist/sql-wasm.wasm')});const db=new SQL.Database();
 db.run('CREATE TABLE state (key TEXT PRIMARY KEY,value TEXT NOT NULL)');db.run('INSERT INTO state(key,value) VALUES(?,?)',['settings',JSON.stringify({installationPath:path.join(dir,'engine'),modelPath:path.join(dir,'models'),inputPath:path.join(dir,'input'),outputPath:path.join(dir,'output'),engineUrl:`http://127.0.0.1:${(server.address() as any).port}`,initialized:false})]);await fs.writeFile(path.join(dataDir,'studio.sqlite'),db.export());db.close();
 let service=await createStudioService({dataDir});t.after(async()=>{await service.dispose();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await fs.rm(dir,{recursive:true,force:true});});
 return {get service(){return service},calls,dataDir,async reopen(){await service.dispose();service=await createStudioService({dataDir});return service}};
}
test('导入只保存记录：保留JSON原文，不上传素材、不提交或中断任务',async t=>{
 const f=await fixture(t);const json=JSON.stringify(ui,null,2);const imported:any=await f.service.invoke('workflow.import',{name:'我的工作流',json});assert.equal(imported.name,'我的工作流');assert.equal(imported.format,'ui');assert.equal(imported.nodeCount,2);
 const saved:any=await f.service.invoke('workflow.get',{id:imported.id});assert.equal(saved.json,json);assert.equal(saved.metadata.id,imported.id);
 const snapshot:any=await f.service.invoke('snapshot');assert.equal(snapshot.tasks.length,0);assert.equal((await f.service.invoke('workflow.list') as any[]).length,1);assert.ok(f.calls.every(c=>c.method==='GET'));assert.ok(f.calls.every(c=>!['/prompt','/upload/image','/interrupt'].includes(c.url)));
});
test('重命名、更新和删除持久化；重启不自动运行导入工作流',async t=>{
 const f=await fixture(t);const imported:any=await f.service.invoke('workflow.import',{name:'原名称',json:JSON.stringify(api)});
 await f.service.invoke('workflow.rename',{id:imported.id,name:' 修改名称 '});const json=JSON.stringify(ui,null,1);await f.service.invoke('workflow.update',{id:imported.id,json});
 await f.reopen();const saved:any=await f.service.invoke('workflow.get',{id:imported.id});assert.equal(saved.metadata.name,'修改名称');assert.equal(saved.metadata.format,'ui');assert.equal(saved.metadata.nodeCount,2);assert.equal(saved.json,json);
 await assert.rejects(f.service.invoke('workflow.update',{id:imported.id,json:'invalid'}),Error);assert.equal((await f.service.invoke('workflow.get',{id:imported.id}) as any).json,json,'非法更新不可覆盖已有原文');
 await f.service.invoke('workflow.remove',{id:imported.id});await f.reopen();assert.deepEqual(await f.service.invoke('workflow.list'),[]);await assert.rejects(f.service.invoke('workflow.get',{id:imported.id}),Error);
 assert.equal((await f.service.invoke('snapshot') as any).tasks.length,0);assert.ok(f.calls.every(c=>c.method==='GET'));
});
test('空白工作流可以创建，未知ID或恶意JSON不能变成任务或文件操作',async t=>{
 const f=await fixture(t);const created:any=await f.service.invoke('workflow.create',{name:'空白创作'});assert.equal(created.nodeCount,0);assert.equal(created.format,'ui');assert.equal((await f.service.invoke('workflow.get',{id:created.id}) as any).metadata.name,'空白创作');
 for(const command of ['workflow.get','workflow.rename','workflow.update','workflow.remove'])await assert.rejects(f.service.invoke(command,{id:'../../outside.json',name:'x',json:JSON.stringify(api)}),Error);
 await assert.rejects(f.service.invoke('workflow.import',{name:'恶意',json:'{"__proto__":{"polluted":true}}'}),Error);
 const list:any=await f.service.invoke('workflow.list');assert.equal(list.length,1);assert.equal((await f.service.invoke('snapshot') as any).tasks.length,0);assert.ok(f.calls.every(c=>c.method==='GET'));
});
test('少量节点也不能绕过结构元素总量限制',()=>{
 const json=JSON.stringify({'1':{class_type:'LargeInput',inputs:{values:Array(100001).fill(0)}}});assert.ok(Buffer.byteLength(json,'utf8')<5*1024*1024);assert.throws(()=>parseWorkflowJson(json),Error);
});
test('原生图拒绝重复编号、悬空连接及非法槽位，防止损坏图进入编辑器',()=>{
 const duplicate={...ui,nodes:[{id:1,type:'LoadImage'},{id:1,type:'SaveImage'}]};assert.throws(()=>parseWorkflowJson(JSON.stringify(duplicate)),/编号不能重复/);
 const dangling={...ui,links:[[1,1,0,999,0,'IMAGE']]};assert.throws(()=>parseWorkflowJson(JSON.stringify(dangling)),/不存在的节点/);
 for(const link of [[1,1,-1,2,0,'IMAGE'],[1,1,0,2,0.5,'IMAGE'],[1,1,0,2,0]])assert.throws(()=>parseWorkflowJson(JSON.stringify({...ui,links:[link]})),Error);
 assert.throws(()=>parseWorkflowJson(JSON.stringify({...ui,links:[ui.links[0],ui.links[0]]})),/编号不能重复/);
 assert.throws(()=>parseWorkflowJson('{"1":{"class_type":"Text","inputs":{"number":1e309}}}'),/无效数字/);
});
