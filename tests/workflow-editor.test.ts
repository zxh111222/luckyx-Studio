import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { buildEditorLoadScript, buildEditorSaveScript, isAllowedEditorNavigation, sanitizeWorkflowFilename } from '../src/main/workflow-editor';

function sandbox(app?:any){return {window:app?{comfyAPI:{app:{app}}}:{},atob,TextDecoder,TextEncoder,Uint8Array,setTimeout,clearTimeout,Date,JSON,Error,console};}
const ui={version:0.4,nodes:[{id:1,type:'Text',widgets_values:['中文提示词']}],links:[]};
const api={'1':{class_type:'Text',inputs:{text:'中文提示词'}}};
test('桥接将UI与API图交给正确加载方法，不排队或执行生成',async()=>{
 for(const [format,graph] of [['ui',ui],['api',api]] as const){
  const calls:{method:string;graph:any}[]=[];let queues=0;const app={graph:{},loadGraphData:async(value:any)=>{calls.push({method:'ui',graph:value});},loadApiJson:async(value:any)=>{calls.push({method:'api',graph:value});},queuePrompt:()=>{queues++;throw new Error('加载不能执行生成')}};
  const result=await runInNewContext(buildEditorLoadScript(JSON.stringify(graph),format,50),sandbox(app));assert.equal(result.loaded,true);assert.equal(result.format,format);assert.equal(calls.length,1);assert.equal(calls[0].method,format);assert.deepEqual(calls[0].graph,graph);assert.equal(queues,0);
 }
});
test('UTF8提示词与脚本形文本按数据加载，不注入编辑器运行环境',async()=>{
 const graph={version:0.4,nodes:[{id:1,type:'Text',widgets_values:['中文😀 </script>"; globalThis.__injected = true; //\n` ${process.env.SECRET}']}],links:[]};let loaded:any;
 const context:any=sandbox({graph:{},loadGraphData:async(value:any)=>{loaded=value;}});await runInNewContext(buildEditorLoadScript(JSON.stringify(graph),'ui',50),context);
 assert.deepEqual(loaded,graph);assert.equal(context.__injected,undefined);
});
test('保存仅serialize当前画布，保留编辑结果而不生成任务',async()=>{
 let calls=0;let queues=0;const graph={...ui,nodes:[{id:1,type:'Text',widgets_values:['修改后的提示词']}]};
 const result=await runInNewContext(buildEditorSaveScript(50),sandbox({graph:{serialize:()=>{calls++;return graph;}},queuePrompt:()=>{queues++;}}));assert.equal(typeof result,'string');assert.deepEqual(JSON.parse(result),graph);assert.equal(calls,1);assert.equal(queues,0);
});
test('编辑器未就绪时超时返回明确错误，超大图不能写入桥接',async()=>{
 await assert.rejects(Promise.resolve(runInNewContext(buildEditorLoadScript(JSON.stringify(ui),'ui',20),sandbox())),Error);
 await assert.rejects(Promise.resolve(runInNewContext(buildEditorSaveScript(20),sandbox())),Error);
 assert.throws(()=>buildEditorLoadScript(' '.repeat(5*1024*1024+1),'ui'),Error);
 const large={version:0.4,nodes:[],links:[],extra:{text:'图'.repeat(2*1024*1024)}};
 await assert.rejects(Promise.resolve(runInNewContext(buildEditorSaveScript(50),sandbox({graph:{serialize:()=>large}}))),Error);
});
test('原生编辑器仅允许既定本机HTTP来源，拒绝跨端口、外域和无协议地址',()=>{
 const engine='http://127.0.0.1:8188';for(const url of [engine+'/',engine+'/workflow?name=中文#node'])assert.equal(isAllowedEditorNavigation(url,engine),true);
 for(const url of ['https://127.0.0.1:8188/','http://127.0.0.1:8190/','http://localhost:8188/','https://evil.test/','http://127.0.0.1.evil.test:8188/','http://user:secret@127.0.0.1:8188/','file:///C:/index.html','javascript:alert(1)','//127.0.0.1:8188/','127.0.0.1:8188','/workflow'])assert.equal(isAllowedEditorNavigation(url,engine),false,url);
});
test('导出文件名保留中文并清除Windows非法字符及路径逃逸',()=>{
 assert.equal(sanitizeWorkflowFilename('我的工作流'),'我的工作流.json');assert.equal(sanitizeWorkflowFilename('我的工作流.json'),'我的工作流.json');
 for(const value of ['../../危险<>:"/\\|?*.json','CON','PRN','NUL','AUX','COM1','LPT1','x\0\nfile',null,42,'x'.repeat(500)]){
  const filename=sanitizeWorkflowFilename(value);assert.ok(filename.endsWith('.json'));assert.ok(filename.length<=255);assert.doesNotMatch(filename,/[<>:"/\\|?*\x00-\x1f]/);assert.doesNotMatch(filename,/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i);assert.notEqual(filename,'.json');
 }
});

test('格式记录和图结构不一致或等待预算无效时拒绝生成桥接脚本',()=>{
 assert.throws(()=>buildEditorLoadScript(JSON.stringify(ui),'api'),/格式与记录不一致/);
 assert.throws(()=>buildEditorLoadScript(JSON.stringify(api),'ui'),/格式与记录不一致/);
 for(const timeout of [0,-1,0.5,30001,NaN]){assert.throws(()=>buildEditorLoadScript(JSON.stringify(ui),'ui',timeout),/等待时间无效/);assert.throws(()=>buildEditorSaveScript(timeout),/等待时间无效/);}
});
test('加载或serialize卡住时仍按等待预算退出，不无限阻塞',async()=>{
 const app={graph:{serialize:()=>new Promise(()=>{})},loadGraphData:()=>new Promise(()=>{})};
 await assert.rejects(Promise.resolve(runInNewContext(buildEditorLoadScript(JSON.stringify(ui),'ui',20),sandbox(app))),/编辑器未就绪/);
 await assert.rejects(Promise.resolve(runInNewContext(buildEditorSaveScript(20),sandbox(app))),/编辑器未就绪/);
});
