import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { getStressSnapshot, readStressMode, stressUrl, createStressInvoker, STRESS_NOTES } from '../src/renderer/src/ui-stress'
import type { Snapshot } from '../src/shared/contracts'
import { validateWorkflowName } from '../src/shared/workflow-library'
import { validateGenerationParams } from '../src/shared/workflow'

const real: Snapshot = {
  settings: { installationPath:'C:/real',modelPath:'C:/real/models',inputPath:'C:/real/input',outputPath:'C:/real/output',engineUrl:'http://127.0.0.1:8188',initialized:true },
  hardware: { gpuName:'NVIDIA RTX 4080',vramMb:16376,ramGb:31,driver:'real' },
  engine: { status:'ready',managed:true,queue:0,message:'real' },
  templates: [{ id:'h3-i2v',name:'H3',description:'real',ready:true,issues:[],models:[],resolutions:[],defaultSteps:4,frames:124,fps:24 }],
  tasks:[],userWorkflows:[],resources:[],presets:[],logs:[]
}
test('压力模式URL持久化保留其他参数与锚点，未知值回到真实Demo',()=>{
 assert.equal(readStressMode('?data=worst'),'worst');assert.equal(readStressMode('?data=attacker'),'demo');
 const url=stressUrl('http://localhost:5173/?page=tasks#library','many');assert.equal(readStressMode(new URL(url).search),'many');assert.equal(new URL(url).hash,'#library');assert.equal(new URL(url).searchParams.get('page'),'tasks');assert.equal(new URL(stressUrl(url,'demo')).searchParams.has('data'),false);
});
test('fixture独立复制，切回Demo不污染真实设备、任务和目录',()=>{
 const before=structuredClone(real);const worst=getStressSnapshot(real,'worst');worst.settings.modelPath='changed';worst.templates[0].models.push('changed');assert.deepEqual(real,before);
 const demo=getStressSnapshot(real,'demo');assert.deepEqual(demo,real);assert.notEqual(demo,real);assert.equal(demo.hardware.gpuName,'NVIDIA RTX 4080');
});
test('Empty、One、1000行稳定覆盖各列表且ID唯一，进度越界仅显示防御',()=>{
 for(const [mode,count] of [['empty',0],['one',1],['many',1000]] as const){const value=getStressSnapshot(real,mode);assert.equal(value.tasks.length,count);assert.equal(value.userWorkflows.length,count);assert.equal(new Set(value.tasks.map(t=>t.id)).size,count);assert.equal(new Set(value.userWorkflows.map(w=>w.id)).size,count);}
 const worst=getStressSnapshot(real,'worst');assert.ok(worst.tasks.some(t=>t.progress?.value===142));assert.ok(worst.tasks.some(t=>t.progress?.value===-3));assert.ok(Number.isNaN(worst.hardware.vramMb));assert.equal(worst.engine.queue,1024);assert.equal(worst.engine.status,'offline');assert.ok(worst.tasks.every(t=>t.outputs.length===0));assert.ok(STRESS_NOTES.some(note=>note.includes('显示防御')));
});
test('名称和提示词遵守真实后端schema，路径边界和多语言数据可复现',()=>{
 const worst=getStressSnapshot(real,'worst');for(const workflow of worst.userWorkflows)assert.equal(validateWorkflowName(workflow.name),workflow.name);for(const task of worst.tasks)validateGenerationParams(task.params);
 assert.equal(worst.tasks[0].params.prompt.length,10000);assert.ok(worst.settings.outputPath.length<=260);assert.ok(worst.settings.outputPath.length>240);assert.ok(worst.tasks.some(t=>t.title==='J'));assert.ok(worst.tasks.some(t=>t.title.includes('👩🏽‍💻')));assert.ok(worst.tasks.some(t=>t.title.includes('<script>')));
});
test('只读gate不转发任何变更、安装或原生操作，fixture读取不访问后台',async()=>{
 let mode:'demo'|'worst'='worst';const calls:string[]=[];const invoke=createStressInvoker(()=>mode,()=>real,async command=>{calls.push(command);return 'real-result'});
 for(const command of ['settings.save','task.submit','task.retry','task.cancel','engine.start','engine.stop','preset.save','workflow.import','workflow.update','workflow.remove','workflow.recipeImport','bootstrap.plan','bootstrap.start','bootstrap.cancel','native.openWorkflowEditor','native.export','native.openEngine','native.openReference','unrecognized.command'])await assert.rejects(invoke(command,{}),/只读/);
 assert.equal((await invoke('snapshot') as Snapshot).tasks.length,8);assert.equal((await invoke('workflow.list') as unknown[]).length,8);assert.deepEqual(await invoke('workflow.recipes'),[]);assert.equal((await invoke('bootstrap.status') as {status:string}).status,'idle');assert.deepEqual(calls,[]);
 mode='demo';assert.equal(await invoke('settings.save',{}),'real-result');assert.deepEqual(calls,['settings.save']);
});
async function apiHarness(dev:boolean,browser=false){
 const bundled=await build({entryPoints:[fileURLToPath(new URL('../src/renderer/src/api.ts',import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs',define:{'import.meta.env.DEV':String(dev)}});
 let timer:(()=>Promise<void>)|undefined;let calls=0;const exports={};const context={module:{exports},exports,URL,AbortSignal,document:{hidden:false},window:{luckyx:browser?undefined:{desktop:true,invoke:async()=>{calls++;return real}},setInterval:(fn:()=>Promise<void>)=>{timer=fn;return 1},clearInterval:()=>{}},fetch:async()=>{calls++;return{ok:true,json:async()=>({ok:true,value:real})}}};vm.runInNewContext(bundled.outputFiles[0].text,context);
 return{api:context.module.exports as {invoke:(c:string)=>Promise<unknown>;setUiStressInterceptor:(fn:unknown,active?:()=>boolean)=>void;subscribe:(cb:unknown)=>()=>void},getCalls:()=>calls,poll:async()=>timer?.()};
}
test('开发API gate在桌面桥前拦截，生产构建不接受拦截器',async()=>{
 for(const dev of [true,false]){const h=await apiHarness(dev);h.api.setUiStressInterceptor(async()=>{throw new Error('blocked fixture')},()=>true);if(dev)await assert.rejects(h.api.invoke('task.submit'),/blocked fixture/);else await h.api.invoke('task.submit');assert.equal(h.getCalls(),dev?0:1);}
});
test('浏览器示例模式停止后台轮询，恢复Demo后正常读取真实数据',async()=>{
 const h=await apiHarness(true,true);let active=true;let received=0;h.api.setUiStressInterceptor(async(_c:unknown,_p:unknown,next:(c:string)=>Promise<unknown>)=>next('snapshot'),()=>active);const stop=h.api.subscribe(()=>received++);await h.poll();assert.equal(h.getCalls(),0);assert.equal(received,0);active=false;await h.poll();assert.equal(h.getCalls(),1);assert.equal(received,1);stop();await h.poll();assert.equal(h.getCalls(),1);
});
