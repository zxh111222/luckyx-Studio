import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { createStudioService } from '../src/backend/service';
import originalH3 from '../src/backend/workflows/h3-i2v.json';
import styleGraph from '../src/backend/workflows/h3-video-style.json';
import characterGraph from '../src/backend/workflows/h3-video-inpaint.json';
import backgroundGraph from '../src/backend/workflows/h3-video-background.json';
import { videoRecipeDefinitions } from '../src/shared/video-recipes';
import { parseWorkflowJson } from '../src/shared/workflow-library';
import { validateReferenceUrl } from '../src/shared/reference-url';
const graphs:Record<string,any>={'h3-video-style':styleGraph,'h3-video-character':characterGraph,'h3-video-background':backgroundGraph};
const patch='minimax_h3_fun_controlnet_union_pruned_int8_convrot.safetensors';
function nodeAt(graph:any,connection:any){assert.ok(Array.isArray(connection)&&connection.length===2);assert.ok(graph[connection[0]],'连接指向不存在的节点');return graph[connection[0]];}
function nodesOf(graph:any,type:string){return Object.values(graph).filter((node:any)=>node.class_type===type) as any[];}

test('三编辑模板使用真实FunControl与原视频，20步不复用4步Turbo LoRA',()=>{
 for(const graph of Object.values(graphs)){
  assert.equal(parseWorkflowJson(JSON.stringify(graph)).format,'api');assert.equal(nodesOf(graph,'MiniMaxH3FunControlNetApply').length,1);assert.equal(nodesOf(graph,'LoraLoaderModelOnly').length,0);
  const apply=nodesOf(graph,'MiniMaxH3FunControlNetApply')[0];assert.equal(nodeAt(graph,apply.inputs.model).class_type,'UNETLoader');assert.equal(nodeAt(graph,apply.inputs.model_patch).class_type,'ModelPatchLoader');assert.equal(nodeAt(graph,apply.inputs.model_patch).inputs.name,patch);
  const source=nodeAt(graph,apply.inputs.source_video);assert.equal(source.class_type,'GetVideoComponents');assert.equal(nodeAt(graph,source.inputs.video).class_type,'LoadVideo');
  const scheduler=nodesOf(graph,'BasicScheduler')[0];assert.equal(scheduler.inputs.steps,20);assert.equal(nodeAt(graph,scheduler.inputs.model),apply);assert.equal(nodeAt(graph,nodesOf(graph,'BasicGuider')[0].inputs.model),apply);
  const video=nodesOf(graph,'CreateVideo')[0];assert.equal(nodeAt(graph,video.inputs.audio),source);assert.equal(video.inputs.audio[1],1);assert.equal(video.inputs.fps,24);
  for(const node of Object.values(graph) as any[])for(const value of Object.values(node.inputs))if(Array.isArray(value)&&value.length===2&&typeof value[0]==='string'&&typeof value[1]==='number')assert.ok(graph[value[0]],'节点连线不得悬空');
 }
});
test('风格模板沿原视频提取Canny并全幅重绘，局部编辑沿独立遮罩视频处理',()=>{
 const style=nodesOf(styleGraph,'MiniMaxH3FunControlNetApply')[0];const canny=nodeAt(styleGraph,style.inputs.control_video);assert.equal(canny.class_type,'Canny');assert.deepEqual(canny.inputs.image,style.inputs.source_video);
 const white=nodeAt(styleGraph,style.inputs.mask);assert.equal(white.class_type,'SolidMask');assert.equal(white.inputs.value,1);assert.equal(white.inputs.width,styleGraph['6'].inputs.width);assert.equal(white.inputs.height,styleGraph['6'].inputs.height);
 for(const graph of [characterGraph,backgroundGraph]){
  const apply=nodesOf(graph,'MiniMaxH3FunControlNetApply')[0];assert.equal(nodesOf(graph,'Canny').length,0);assert.equal(apply.inputs.control_video,undefined);
  const mask=nodeAt(graph,apply.inputs.mask);assert.equal(mask.class_type,'ImageToMask');assert.equal(mask.inputs.channel,'red');const components=nodeAt(graph,mask.inputs.image);assert.equal(components.class_type,'GetVideoComponents');
  const maskVideo=nodeAt(graph,components.inputs.video);assert.equal(maskVideo.class_type,'LoadVideo');const source=nodeAt(graph,apply.inputs.source_video);assert.notDeepEqual(components.inputs.video,source.inputs.video,'蒙版不能误用原视频');
 }
 assert.notEqual(characterGraph['6'].inputs.prompt,backgroundGraph['6'].inputs.prompt);
});

test('模板清单对应实际图与官方来源，模型依赖包含FunUnion而不含Turbo LoRA',()=>{
 assert.deepEqual(videoRecipeDefinitions.map(recipe=>recipe.id).sort(),Object.keys(graphs).sort());
 for(const recipe of videoRecipeDefinitions){
  assert.deepEqual(recipe.graph,graphs[recipe.id]);assert.equal(validateReferenceUrl(recipe.sourceUrl),recipe.sourceUrl);assert.ok(recipe.inputs.length>=2);assert.ok(recipe.steps.length>=4);
  assert.equal(recipe.models.length,5);assert.ok(recipe.models.some(model=>model.folder==='model_patches'&&model.name===patch));assert.ok(recipe.models.every(model=>model.folder!=='loras'));
  for(const model of recipe.models){assert.doesNotMatch(model.folder,/\.\.|[\\/:\x00]/);assert.doesNotMatch(model.name,/[\\/:\x00]/);assert.equal(validateReferenceUrl(model.url),model.url);}
 }
});
async function fixture(t:any){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luckyx-video-recipes-'));const dataDir=path.join(dir,'data');const installationPath=path.join(dir,'engine');const modelPath=path.join(installationPath,'ComfyUI/models');await fs.mkdir(dataDir,{recursive:true});
 const existing=[['diffusion_models',originalH3['1'].inputs.unet_name],['text_encoders',originalH3['2'].inputs.clip_name],['vae',originalH3['3'].inputs.vae_name],['vae',originalH3['4'].inputs.vae_name],['loras',originalH3['5'].inputs.lora_name]];
 for(const [folder,name] of existing){await fs.mkdir(path.join(modelPath,folder),{recursive:true});await fs.writeFile(path.join(modelPath,folder,name),'mock-existing-h3-weight');}
 await fs.mkdir(path.join(installationPath,'venv/Scripts'),{recursive:true});await fs.writeFile(path.join(installationPath,'venv/Scripts/python.exe'),'mock');await fs.writeFile(path.join(installationPath,'ComfyUI/main.py'),'# mock');await fs.writeFile(path.join(installationPath,'launch_comfy.py'),'# mock');
 const info:any=Object.fromEntries([originalH3,...Object.values(graphs)].flatMap(graph=>Object.values(graph).map((node:any)=>[node.class_type,{input:{required:{}}}])));
 const enumeration=(type:string,field:string,names:string[])=>{info[type].input.required[field]=[names];};
 enumeration('UNETLoader','unet_name',[existing[0][1]]);enumeration('CLIPLoader','clip_name',[existing[1][1]]);enumeration('VAELoader','vae_name',[existing[2][1],existing[3][1]]);enumeration('LoraLoaderModelOnly','lora_name',[existing[4][1]]);enumeration('ModelPatchLoader','name',[patch]);
 const state={info,invalidStats:false,calls:[] as {method:string;url:string}[]};
 const server=createServer(async(req,res)=>{for await(const _ of req){}state.calls.push({method:req.method!,url:req.url!});res.setHeader('Content-Type','application/json');if(req.method!=='GET'){res.statusCode=500;res.end('{"error":"模板管理不能提交生成"}');}else if(req.url==='/system_stats')res.end(JSON.stringify(state.invalidStats?{other:true}:{system:{},devices:[]}));else if(req.url==='/object_info')res.end(JSON.stringify(state.info));else if(req.url==='/queue')res.end('{"queue_running":[],"queue_pending":[]}');else res.end('{}');});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));server.on('upgrade',(_req,socket)=>socket.destroy());
 const require=createRequire(import.meta.url);const SQL=await initSqlJs({locateFile:()=>require.resolve('sql.js/dist/sql-wasm.wasm')});const db=new SQL.Database();db.run('CREATE TABLE state (key TEXT PRIMARY KEY,value TEXT NOT NULL)');db.run('INSERT INTO state(key,value) VALUES(?,?)',['settings',JSON.stringify({installationPath,modelPath,inputPath:path.join(dir,'input'),outputPath:path.join(dir,'output'),engineUrl:`http://127.0.0.1:${(server.address() as any).port}`,initialized:false})]);await fs.writeFile(path.join(dataDir,'studio.sqlite'),db.export());db.close();
 let service=await createStudioService({dataDir});t.after(async()=>{await service.dispose();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await fs.rm(dir,{recursive:true,force:true});});
 return {get service(){return service},state,modelPath,async patchFile(content='mock-fun-union'){await fs.mkdir(path.join(modelPath,'model_patches'),{recursive:true});await fs.writeFile(path.join(modelPath,'model_patches',patch),content);},async reopen(){await service.dispose();service=await createStudioService({dataDir});},recipes:()=>service.invoke('workflow.recipes') as Promise<any[]>};
}
test('普通H3检查通过不能让缺FunUnion的三编辑模板误报可用',async t=>{
 const f=await fixture(t);assert.equal((await f.service.invoke('template.validate') as any).ready,true);
 const recipes=await f.recipes();assert.equal(recipes.length,3);for(const recipe of recipes){assert.equal(recipe.status,'missing');assert.deepEqual(recipe.missingNodes,[]);assert.deepEqual(recipe.missingModels,[patch]);assert.ok(recipe.issues.length>0);}
});
test('非空文件、ModelPatchLoader.name枚举和全部依赖节点齐备才可用',async t=>{
 const f=await fixture(t);await f.patchFile();assert.ok((await f.recipes()).every(recipe=>recipe.status==='available'));
 f.state.info.ModelPatchLoader.input.required.name=[[]];assert.ok((await f.recipes()).every(recipe=>recipe.status==='missing'&&recipe.missingModels.includes(patch)));
 f.state.info.ModelPatchLoader.input.required.name=['STRING',{}];assert.ok((await f.recipes()).every(recipe=>recipe.status==='missing'));
 delete f.state.info.ModelPatchLoader.input.required.name;assert.ok((await f.recipes()).every(recipe=>recipe.status==='missing'));
 f.state.info.ModelPatchLoader.input.required.name=[[patch]];await f.patchFile('');assert.ok((await f.recipes()).every(recipe=>recipe.status==='missing'&&recipe.missingModels.includes(patch)));
});
test('按各图实际检查节点，不让风格Canny与局部蒙版错误共用条件',async t=>{
 const f=await fixture(t);await f.patchFile();const canny=f.state.info.Canny;delete f.state.info.Canny;
 let recipes=await f.recipes();assert.equal(recipes.find(recipe=>recipe.id==='h3-video-style').status,'missing');assert.ok(recipes.find(recipe=>recipe.id==='h3-video-style').missingNodes.includes('Canny'));assert.ok(recipes.filter(recipe=>recipe.id!=='h3-video-style').every(recipe=>recipe.status==='available'));
 f.state.info.Canny=canny;delete f.state.info.ImageToMask;recipes=await f.recipes();assert.equal(recipes.find(recipe=>recipe.id==='h3-video-style').status,'available');assert.ok(recipes.filter(recipe=>recipe.id!=='h3-video-style').every(recipe=>recipe.status==='missing'&&recipe.missingNodes.includes('ImageToMask')));
});
test('离线或端口不是ComfyUI时不能把文件齐备解释为可运行',async t=>{
 const f=await fixture(t);await f.patchFile();f.state.invalidStats=true;assert.ok((await f.recipes()).every(recipe=>recipe.status==='offline'&&recipe.issues.length>0));
});
test('模板导入幂等、不覆盖用户编辑，删除后可重建且SQLite重启保留recipeId',async t=>{
 const f=await fixture(t);const [first,concurrent]:any[]=await Promise.all([f.service.invoke('workflow.recipeImport',{id:'h3-video-style'}),f.service.invoke('workflow.recipeImport',{id:'h3-video-style'})]);assert.equal(first.id,concurrent.id);assert.equal(first.recipeId,'h3-video-style');assert.equal(first.format,'api');
 const original:any=await f.service.invoke('workflow.get',{id:first.id});assert.deepEqual(JSON.parse(original.json),styleGraph);
 const edited=structuredClone(styleGraph);edited['6'].inputs.prompt='用户自己的电影风格';await f.service.invoke('workflow.update',{id:first.id,json:JSON.stringify(edited)});await f.service.invoke('workflow.rename',{id:first.id,name:'我的风格版本'});
 const repeated:any=await f.service.invoke('workflow.recipeImport',{id:'h3-video-style'});assert.equal(repeated.id,first.id);assert.equal(repeated.name,'我的风格版本');assert.equal(JSON.parse((await f.service.invoke('workflow.get',{id:first.id}) as any).json)['6'].inputs.prompt,'用户自己的电影风格');
 await f.reopen();const restored:any=await f.service.invoke('workflow.recipeImport',{id:'h3-video-style'});assert.equal(restored.id,first.id);assert.equal(restored.recipeId,'h3-video-style');assert.equal(JSON.parse((await f.service.invoke('workflow.get',{id:first.id}) as any).json)['6'].inputs.prompt,'用户自己的电影风格');
 await f.service.invoke('workflow.remove',{id:first.id});const rebuilt:any=await f.service.invoke('workflow.recipeImport',{id:'h3-video-style'});assert.notEqual(rebuilt.id,first.id);assert.equal(rebuilt.recipeId,'h3-video-style');assert.deepEqual(JSON.parse((await f.service.invoke('workflow.get',{id:rebuilt.id}) as any).json),styleGraph);
 assert.equal((await f.service.invoke('snapshot') as any).tasks.length,0);assert.ok(f.state.calls.every(call=>call.method==='GET'));await assert.rejects(fs.stat(path.join(f.modelPath,'model_patches',patch)),Error);
});
test('缺依赖可以保存编辑副本，但未知模板ID不能触发模型拷贝或任务',async t=>{
 const f=await fixture(t);for(const id of Object.keys(graphs)){const saved:any=await f.service.invoke('workflow.recipeImport',{id});assert.equal(saved.recipeId,id);}
 for(const id of ['unknown','../../escape.json','__proto__',null])await assert.rejects(f.service.invoke('workflow.recipeImport',{id}),Error);
 assert.ok((await f.recipes()).every(recipe=>recipe.status==='missing'));assert.equal((await f.service.invoke('workflow.list') as any[]).length,3);assert.equal((await f.service.invoke('snapshot') as any).tasks.length,0);assert.ok(f.state.calls.every(call=>call.method==='GET'));
});

