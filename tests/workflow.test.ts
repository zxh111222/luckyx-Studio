import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEngineUrl, validateGenerationParams, validateImage, buildWorkflow, mapHistoryOutputs, safeOutputPath, isPromptRunning } from '../src/shared/workflow';
import type { GenerationParams } from '../src/shared/contracts';
const params: GenerationParams = { templateId:'h3-i2v',prompt:' 镜头缓缓前移 ',width:864,height:480,frames:124,steps:4,seed:42 };
const png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]).toString('base64');

test('引擎仅接受无认证、无路径的本机 HTTP 地址',()=>{
 for(const url of ['http://127.0.0.1:8188','http://localhost:8188/','http://[::1]:8188']) assert.equal(validateEngineUrl(url),new URL(url).origin);
 for(const url of ['https://localhost:8188','http://example.com','http://127.0.0.1.evil.test','http://user:secret@localhost:8188','http://localhost:8188/api','http://localhost:8188/?token=x','http://localhost/#x','file:///tmp/x','invalid']) assert.throws(()=>validateEngineUrl(url),Error,url);
});
test('首版参数保留合法模板规格并拒绝未验证参数',()=>{
 assert.equal(validateGenerationParams(params).prompt,'镜头缓缓前移');
 assert.equal(validateGenerationParams({...params,width:832}).width,832);
 for(const patch of [{templateId:'unknown'},{prompt:' '},{prompt:'x'.repeat(10001)},{width:1280},{height:720},{frames:125},{steps:8},{seed:-1},{seed:1.1},{seed:Number.MAX_SAFE_INTEGER+1}]) assert.throws(()=>validateGenerationParams({...params,...patch}),Error);
 assert.throws(()=>validateGenerationParams(null),Error);
 assert.equal(params.prompt,' 镜头缓缓前移 ');
});
test('图片根据字节类型命名，忽略不可信原文件名',()=>{
 const image=validateImage({name:'../../evil.exe',dataBase64:`data:image/png;base64,${png}`});
 assert.equal(image.name,'first-frame.png'); assert.equal(image.mime,'image/png'); assert.equal(image.bytes[0],137);
 assert.equal(validateImage({name:'x.png',dataBase64:Buffer.from([255,216,255,0]).toString('base64')}).mime,'image/jpeg');
 assert.equal(validateImage({name:'x.jpg',dataBase64:Buffer.from('RIFF0000WEBP0000').toString('base64')}).name,'first-frame.webp');
 for(const image of [undefined,{name:'x',dataBase64:''},{name:'x',dataBase64:'!!!'},{name:'x.png',dataBase64:Buffer.from('<script>x</script>').toString('base64')},{name:'x',dataBase64:'A'.repeat(14*1024*1024+1)}]) assert.throws(()=>validateImage(image),Error);
});
test('绑定图片和提示词、种子，创建独立工作流且保留模型和节点连接',()=>{
 const first=buildWorkflow(params,'upload/first-frame.png','task-a');
 assert.equal(first['6'].inputs.prompt,'镜头缓缓前移'); assert.equal(first['6'].inputs.width,864);
 assert.equal(first['6'].inputs.length,124); assert.equal(first['7'].inputs.noise_seed,42);
 assert.equal(first['10'].inputs.steps,4); assert.equal(first['16'].inputs.image,'upload/first-frame.png');
 assert.equal(first['15'].inputs.filename_prefix,'luckyx/task-a');
 const original=structuredClone(first);
 first['6'].inputs.prompt='mutation'; first['16'].inputs.image='mutated.png';
 const second=buildWorkflow({...params,seed:99},'second.png','task-b');
 assert.equal(second['6'].inputs.prompt,'镜头缓缓前移'); assert.equal(second['16'].inputs.image,'second.png');
 assert.equal(second['7'].inputs.noise_seed,99);
 for(const id of Object.keys(original).filter(id=>!['6','7','10','15','16'].includes(id))) assert.deepEqual(second[id],original[id]);
});
test('历史只映射安全视频输出，去重并编码任务标识',()=>{
 const outputs=mapHistoryOutputs({outputs:{a:{videos:[{filename:'video.mp4',subfolder:'luckyx',type:'output'},{filename:'../secret.mp4',type:'output'},{filename:'video.mp4',subfolder:'../escape',type:'output'},{filename:'image.png',type:'output'},{filename:'input.mp4',type:'input'}]},b:{images:[{filename:'video.mp4',subfolder:'luckyx',type:'output'},{filename:'other.WEBM',subfolder:'',type:'output'}]}}},'id & 1','http://127.0.0.1:4173');
 assert.equal(outputs.length,2); assert.equal(outputs[0].filename,'video.mp4');
 assert.equal(outputs[0].url,'http://127.0.0.1:4173/api/media?taskId=id%20%26%201&index=0');
 assert.equal(outputs[1].filename,'other.WEBM'); assert.deepEqual(mapHistoryOutputs(undefined,'task'),[]);
 for(const [file,folder] of [['file.mp4','../up'],['file.mp4','C:\\folder'],['file.mp4','/absolute'],['a\\b.mp4',''],['..',''],['a.mp4','x/../y']]) assert.equal(safeOutputPath(file,folder),false);
 assert.equal(safeOutputPath('视频.mp4','luckyx/nested'),true);
});
test('取消判定仅匹配指定运行任务，不把排队或别人的任务当作当前任务',()=>{
 const queue={queue_running:[[0,'someone-else',{},{}]],queue_pending:[[1,'my-task',{},{}]]};
 assert.equal(isPromptRunning(queue,'my-task'),false); assert.equal(isPromptRunning(queue,'someone-else'),true);
 assert.equal(isPromptRunning({queue_running:[[0,'my-task',{},{}]]},'my-task'),true);
 assert.equal(isPromptRunning(undefined,'my-task'),false);
});
