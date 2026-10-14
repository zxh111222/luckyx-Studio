import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import { createWorkflowEditorManager, buildEditorLoadScript, buildEditorSaveScript, isAllowedEditorNavigation, sanitizeWorkflowFilename } from '../src/main/workflow-editor';

function sandbox(app?:any){return {window:app?{comfyAPI:{app:{app}}}:{},atob,TextDecoder,TextEncoder,Uint8Array,setTimeout,clearTimeout,Date,JSON,Error,console};}
const ui={version:0.4,nodes:[{id:1,type:'Text',widgets_values:['中文提示词']}],links:[]};
const api={'1':{class_type:'Text',inputs:{text:'中文提示词'}}};
test('桥接将UI与API图交给正确加载方法，不排队或执行生成',async()=>{
 for(const [format,graph] of [['ui',ui],['api',api]] as const){
  const calls:{method:string;graph:any}[]=[];let queues=0;const app={canvas:{},graph:{},loadGraphData:async(value:any)=>{calls.push({method:'ui',graph:value});},loadApiJson:async(value:any)=>{calls.push({method:'api',graph:value});},queuePrompt:()=>{queues++;throw new Error('加载不能执行生成')}};
  const result=await runInNewContext(buildEditorLoadScript(JSON.stringify(graph),format,50),sandbox(app));assert.equal(result.loaded,true);assert.equal(result.format,format);assert.equal(calls.length,1);assert.equal(calls[0].method,format);assert.deepEqual(calls[0].graph,graph);assert.equal(queues,0);
 }
});
test('原生加载带文件名登记工作流，兼容新版前端的path读取并保留安全中文名称',async()=>{
 for(const [format,graph] of [['ui',ui],['api',api]] as const){
  let loaded:any;let registered:any;let uiFlags:any;let queues=0;
  // Mirrors the native registration branch: undefined is taken as a workflow
  // object, while a filename string creates a temporary workflow with a path.
  const register=(filename:any)=>{const workflow=typeof filename==='string'?{path:filename}:filename;registered=workflow.path;};
  const app={canvas:{},graph:{},loadGraphData:async(value:any,clear:any,restore:any,filename:any)=>{register(filename);loaded=value;uiFlags=[clear,restore];},loadApiJson:async(value:any,filename:any)=>{register(filename);loaded=value;},queuePrompt:()=>{queues++;}};
  const context:any=sandbox(app);
  const filename='我的流程 </script>"; globalThis.__filenameInjected=true; //';
  const result=await runInNewContext(buildEditorLoadScript(JSON.stringify(graph),format,50,filename),context);
  assert.equal(result.loaded,true);assert.deepEqual(loaded,graph);assert.equal(registered,sanitizeWorkflowFilename(filename));assert.ok(registered.startsWith('我的流程'));assert.equal(context.__filenameInjected,undefined);assert.equal(queues,0);
  if(format==='ui')assert.deepEqual(uiFlags,[true,true]);
  registered=undefined;await runInNewContext(buildEditorLoadScript(JSON.stringify(graph),format,50),context);assert.equal(registered,'workflow.json');
 }
});
test('UTF8提示词与脚本形文本按数据加载，不注入编辑器运行环境',async()=>{
 const graph={version:0.4,nodes:[{id:1,type:'Text',widgets_values:['中文😀 </script>"; globalThis.__injected = true; //\n` ${process.env.SECRET}']}],links:[]};let loaded:any;
 const context:any=sandbox({canvas:{},graph:{},loadGraphData:async(value:any)=>{loaded=value;}});await runInNewContext(buildEditorLoadScript(JSON.stringify(graph),'ui',50),context);
 assert.deepEqual(loaded,graph);assert.equal(context.__injected,undefined);
});
test('保存仅serialize当前画布，保留编辑结果而不生成任务',async()=>{
 let calls=0;let queues=0;const graph={...ui,nodes:[{id:1,type:'Text',widgets_values:['修改后的提示词']}]};
 const result=await runInNewContext(buildEditorSaveScript(50),sandbox({canvas:{},graph:{serialize:()=>{calls++;return graph;}},queuePrompt:()=>{queues++;}}));assert.equal(typeof result,'string');assert.deepEqual(JSON.parse(result),graph);assert.equal(calls,1);assert.equal(queues,0);
});
test('编辑器未就绪时超时返回明确错误，超大图不能写入桥接',async()=>{
 await assert.rejects(Promise.resolve(runInNewContext(buildEditorLoadScript(JSON.stringify(ui),'ui',20),sandbox())),Error);
 await assert.rejects(Promise.resolve(runInNewContext(buildEditorSaveScript(20),sandbox())),Error);
 assert.throws(()=>buildEditorLoadScript(' '.repeat(5*1024*1024+1),'ui'),Error);
 const large={version:0.4,nodes:[],links:[],extra:{text:'图'.repeat(2*1024*1024)}};
 await assert.rejects(Promise.resolve(runInNewContext(buildEditorSaveScript(50),sandbox({canvas:{},graph:{serialize:()=>large}}))),Error);
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
 const app={canvas:{},graph:{serialize:()=>new Promise(()=>{})},loadGraphData:()=>new Promise(()=>{})};
 await assert.rejects(Promise.resolve(runInNewContext(buildEditorLoadScript(JSON.stringify(ui),'ui',20),sandbox(app))),/编辑器未就绪/);
 await assert.rejects(Promise.resolve(runInNewContext(buildEditorSaveScript(20),sandbox(app))),/编辑器未就绪/);
});
test('UI或API加载器明确返回false时拒绝成功响应，旧版undefined返回仍兼容',async()=>{
 for(const [format,graph] of [['ui',ui],['api',api]] as const){
  const rejected={canvas:{},graph:{},loadGraphData:async()=>false,loadApiJson:async()=>false};await assert.rejects(Promise.resolve(runInNewContext(buildEditorLoadScript(JSON.stringify(graph),format,50),sandbox(rejected))),Error);
  const compatible={canvas:{},graph:{},loadGraphData:async()=>undefined,loadApiJson:async()=>undefined};assert.equal((await runInNewContext(buildEditorLoadScript(JSON.stringify(graph),format,50),sandbox(compatible))).loaded,true);
 }
});

test('等待canvas、位置转换与默认画布初始化完成，且仅加载一次不生成',async()=>{
 for(const delayed of ['canvas','positionConversion','spinner'] as const){
  let loads=0;let queues=0;const app:any={graph:{},canvas:delayed==='canvas'?null:{},loadGraphData:async()=>{loads++;assert.ok(app.canvas);if(delayed==='positionConversion')assert.ok(app.positionConversion);if(delayed==='spinner')assert.equal(app.extensionManager.spinner,false);},queuePrompt:()=>{queues++;}};
  if(delayed==='positionConversion')app.positionConversion=undefined;
  if(delayed==='spinner'){app.positionConversion={};app.extensionManager={spinner:true};}
  const loading=runInNewContext(buildEditorLoadScript(JSON.stringify(ui),'ui',500),sandbox(app));
  assert.equal(loads,0);
  const timer=setTimeout(()=>{if(delayed==='canvas')app.canvas={};else if(delayed==='spinner')app.extensionManager.spinner=false;else app.positionConversion={};},10);
  try{assert.equal((await loading).loaded,true);assert.equal(loads,1);assert.equal(queues,0);}finally{clearTimeout(timer);}
 }
});

test('canvas或新版位置转换始终未完成时不调用加载器，等待预算结束给兼容错误',async()=>{
 for(const incomplete of [{graph:{},canvas:null},{graph:{},canvas:{},positionConversion:null},{graph:{},canvas:{},positionConversion:{},extensionManager:{spinner:true}}]){
  let loads=0;const app={...incomplete,loadGraphData:async()=>{loads++;}};
  await assert.rejects(Promise.resolve(runInNewContext(buildEditorLoadScript(JSON.stringify(ui),'ui',30),sandbox(app))),/编辑器未就绪/);
  assert.equal(loads,0);
 }
});

test('原生加载失败保留原始原因并恢复报告方法及其this，不误报加载成功',async()=>{
 for(const [format,graph] of [['ui',ui],['api',api]] as const){
  const reason=new Error('Unknown node type: MiniMaxH3Video');let reports=0;let queues=0;
  const original=function(this:any,error:Error){assert.equal(this,app);assert.equal(error,reason);reports++;};
  const fail=async function(this:any){await this.reportGraphLoadFailure(reason);return false;};
  const app:any={canvas:{},graph:{},reportGraphLoadFailure:original,loadGraphData:fail,loadApiJson:fail,queuePrompt:()=>{queues++;}};
  await assert.rejects(Promise.resolve(runInNewContext(buildEditorLoadScript(JSON.stringify(graph),format,100),sandbox(app))),/原因：Unknown node type: MiniMaxH3Video/);
  assert.equal(app.reportGraphLoadFailure,original);assert.equal(reports,1);assert.equal(queues,0);
 }
});

test('加载抛错或超时也恢复原报告方法，保留原生抛错',async()=>{
 for(const behavior of ['throw','timeout'] as const){
  const original=()=>{};const app:any={canvas:{},graph:{},reportGraphLoadFailure:original,loadGraphData:async()=>{if(behavior==='throw')throw new Error('节点扩展初始化失败');return await new Promise(()=>{});}};
  await assert.rejects(Promise.resolve(runInNewContext(buildEditorLoadScript(JSON.stringify(ui),'ui',30),sandbox(app))),behavior==='throw'?/节点扩展初始化失败/:/编辑器未就绪/);
  assert.equal(app.reportGraphLoadFailure,original);
 }
});


function editorManagerFixture(loadError?:Error){
 const instances:any[]=[];const records=new Map<string,any>(['first','second'].map(id=>[id,{metadata:{id,name:id,format:'ui'},json:JSON.stringify(ui)}]));const calls:{command:string;payload:any}[]=[];
 class FakeWindow extends EventEmitter {
  destroyed=false;loadedGraph:any;loadedFilename:any;loadCount=0;focusCount=0;currentUrl='';options:any;webContents:any;
  constructor(options:any){super();this.options=options;instances.push(this);const events=new EventEmitter();const sessionEvents=new EventEmitter();const session:any={on:sessionEvents.on.bind(sessionEvents),clearStorageData:async()=>{},setPermissionRequestHandler:(handler:any)=>{session.permissionRequest=handler;},setPermissionCheckHandler:(handler:any)=>{session.permissionCheck=handler;},webRequest:{onBeforeRequest:(handler:any)=>{session.beforeRequest=handler;}}};
   const app={canvas:{},graph:{serialize:()=>this.loadedGraph},loadGraphData:async(graph:any,_clear:any,_restore:any,filename:any)=>{this.loadedGraph=graph;this.loadedFilename=filename;this.loadCount++;},loadApiJson:async(graph:any,filename:any)=>{this.loadedGraph=graph;this.loadedFilename=filename;this.loadCount++;}};
   this.webContents={session,on:events.on.bind(events),emit:events.emit.bind(events),setWindowOpenHandler:(handler:any)=>{this.webContents.popup=handler;},getURL:()=>this.currentUrl,isDestroyed:()=>this.destroyed,executeJavaScript:async(script:string)=>runInNewContext(script,sandbox(app))};
  }
  async loadURL(url:string){if(loadError)throw loadError;this.currentUrl=url;}isDestroyed(){return this.destroyed;}isMinimized(){return false;}restore(){}show(){}focus(){this.focusCount++;}destroy(){this.destroyed=true;this.emit('closed');}
 }
 const manager=createWorkflowEditorManager({Window:FakeWindow as any,service:{invoke:async(command,payload)=>{calls.push({command,payload});const id=(payload as any)?.id;const document=records.get(id);if(!document)throw new Error('未找到工作流');if(command==='workflow.get')return structuredClone(document);if(command==='workflow.update'){document.json=(payload as any).json;return document.metadata;}throw new Error('禁止执行其它操作');}},getParent:()=>({isDestroyed:()=>false} as any),getBounds:()=>({width:1280,height:800,minWidth:1200,minHeight:720}),iconPath:'test-icon.png'});
 return {manager,instances,records,calls};
}
test('编辑窗口同ID复用保留未保存图，不同ID使用独立会话，保存只更新原ID',async()=>{
 const f=editorManagerFixture();try{
  f.records.get('first').metadata.name='我的工作流';
  await Promise.all([f.manager.open('first','http://127.0.0.1:8188'),f.manager.open('first','http://127.0.0.1:8188')]);assert.equal(f.instances.length,1);const first=f.instances[0];assert.equal(first.loadCount,1);assert.equal(first.loadedFilename,'我的工作流.json');
  first.loadedGraph.nodes[0].widgets_values=['未保存修改'];const reused=await f.manager.open('first','http://127.0.0.1:8188');assert.equal(reused.reused,true);assert.equal(first.loadCount,1);assert.equal(first.loadedGraph.nodes[0].widgets_values[0],'未保存修改');
  await f.manager.open('second','http://127.0.0.1:8188');const second=f.instances[1];assert.equal(f.instances.length,2);assert.notEqual(first.options.webPreferences.partition,second.options.webPreferences.partition);assert.ok(!first.options.webPreferences.partition.startsWith('persist:'));
  await f.manager.save('first');const writes=f.calls.filter(call=>call.command==='workflow.update');assert.equal(writes.length,1);assert.equal(writes[0].payload.id,'first');assert.equal(JSON.parse(writes[0].payload.json).nodes[0].widgets_values[0],'未保存修改');assert.equal(JSON.parse(f.records.get('second').json).nodes[0].widgets_values[0],'中文提示词');assert.ok(f.calls.every(call=>['workflow.get','workflow.update'].includes(call.command)));
  f.manager.dispose();assert.ok(f.instances.every(window=>window.destroyed));await assert.rejects(f.manager.open('first','http://127.0.0.1:8188'),/启动器已关闭/);await assert.rejects(f.manager.save('first'),/启动器已关闭/);
 }finally{f.manager.dispose();}
});
test('编辑子窗口隔离Node、拒绝权限弹窗和外域网络，不允许离开本机引擎',async()=>{
 const f=editorManagerFixture();try{
  await f.manager.open('first','http://127.0.0.1:8188');const editor=f.instances[0];const preferences=editor.options.webPreferences;
  assert.equal(preferences.nodeIntegration,false);assert.equal(preferences.nodeIntegrationInWorker,false);assert.equal(preferences.nodeIntegrationInSubFrames,false);assert.equal(preferences.contextIsolation,true);assert.equal(preferences.sandbox,true);assert.equal(preferences.webSecurity,true);assert.equal(preferences.webviewTag,false);assert.equal(preferences.preload,undefined);
  const contents=editor.webContents;assert.deepEqual(contents.popup({url:'https://example.com'}),{action:'deny'});let permission:any;contents.session.permissionRequest({},'camera',(allowed:any)=>{permission=allowed;});assert.equal(permission,false);assert.equal(contents.session.permissionCheck({},'camera'),false);
  for(const [url,type,cancel] of [['https://example.com/','xhr',true],['http://127.0.0.1:8188/api','xhr',false],['ws://evil.test/','webSocket',true],['ws://127.0.0.1:8188/ws','webSocket',false],['data:text/html,test','mainFrame',true],['data:image/png;base64,AA==','image',false]] as const){let result:any;contents.session.beforeRequest({url,resourceType:type},(decision:any)=>{result=decision;});assert.equal(result.cancel,cancel,url);}
  let prevented=false;contents.emit('will-navigate',{preventDefault:()=>{prevented=true;}},'https://example.com');assert.equal(prevented,true);
  editor.currentUrl='https://example.com/';await assert.rejects(f.manager.save('first'),/离开本地引擎/);assert.equal(f.calls.filter(call=>call.command==='workflow.update').length,0);
 }finally{f.manager.dispose();}
});

test('本机编辑器打开失败时给中文原因并销毁失败窗口，不留下可保存记录',async()=>{
 const f=editorManagerFixture(new Error('ERR_CONNECTION_REFUSED'));try{
  await assert.rejects(f.manager.open('first','http://127.0.0.1:8188'),/本地节点编辑器无法打开/);assert.equal(f.instances.length,1);assert.equal(f.instances[0].destroyed,true);
  await assert.rejects(f.manager.save('first'),/请先打开/);assert.equal(f.calls.filter(call=>call.command==='workflow.update').length,0);
 }finally{f.manager.dispose();}
});
