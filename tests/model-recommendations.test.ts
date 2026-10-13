import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import sharp from 'sharp';
import { modelRecommendations, rankModelRecommendations } from '../src/shared/model-recommendations';
import { validateReferenceUrl } from '../src/shared/reference-url';
const byId=(vram:number,ram:number)=>Object.fromEntries(rankModelRecommendations(vram,ram).map(m=>[m.id,m]));

test('硬件容量未知或无效时全部标为信息不足，不硬推荐',()=>{
 for(const [vram,ram] of [[0,32],[16376,0],[-1,32],[NaN,32],[16376,Infinity]]) assert.ok(rankModelRecommendations(vram,ram).every(m=>m.level==='unknown'&&m.levelLabel==='硬件信息不足'));
});
test('8GB档位仅给offload路线有条件试用，不把Wan1.3B视为8GB保证',()=>{
 const models=byId(8192,32);assert.equal(models['wan22-ti2v-5b'].level,'conditional');assert.equal(models['minimax-h3-existing'].level,'not-recommended');assert.equal(models['wan21-t2v-13b'].level,'not-recommended');
});
test('24GB/64GB档位可优先试用，但标签保留实测要求',()=>{
 const models=rankModelRecommendations(24576,64);assert.ok(models.every(m=>m.level==='recommended'));assert.ok(models.every(m=>m.levelLabel.includes('仍需实测')));
});
test('模型用途和证据区分历史记录、官方兼容性与已接入模板',()=>{
 const h3=modelRecommendations.find(m=>m.id==='minimax-h3-existing')!;assert.equal(h3.evidence,'local-history');assert.equal(h3.supportedInLauncher,true);assert.match(h3.sourceNote,/历史/);assert.match(h3.initial.note,/仍需检查/);
 const wan=modelRecommendations.find(m=>m.id==='wan21-t2v-13b')!;assert.match(wan.name,/T2V/);assert.match(wan.purpose,/不是图生视频/);assert.ok(wan.downloads.some(d=>d.name==='wan2.1_t2v_1.3B_fp16.safetensors'));assert.equal(wan.evidence,'official-compatibility');
 assert.ok(modelRecommendations.filter(m=>m.id!==h3.id).every(m=>m.supportedInLauncher===false));
});
test('模型清单完整且参考链接均通过官方HTTPS校验',()=>{
 assert.equal(new Set(modelRecommendations.map(m=>m.id)).size,modelRecommendations.length);
 for(const model of modelRecommendations){assert.ok(model.steps.length>=3);assert.ok(model.conditions.length>=2);assert.ok(model.downloads.length>=2);assert.ok(model.screenshotPath.startsWith('/model-guides/'));for(const link of [model.tutorialUrl,model.repositoryUrl,...model.downloads.map(d=>d.url)])assert.equal(validateReferenceUrl(link),link);}
});
test('推荐计算不改变原始清单或把建议变成可运行模板',()=>{
 const before=JSON.stringify(modelRecommendations);rankModelRecommendations(24576,64);rankModelRecommendations(8192,16);assert.equal(JSON.stringify(modelRecommendations),before);
});
test('两张新增配图为可解码WebP，单张不超过200KB',async()=>{
 for(const name of ['camera-studio.webp','coast-inspiration.webp']){
  const file=new URL(`../src/renderer/public/${name}`,import.meta.url);const stat=await fs.stat(file);assert.ok(stat.size>0&&stat.size<=200*1024,`${name} 体积超限`);
  const bytes=await fs.readFile(file);assert.equal(bytes.subarray(0,4).toString(),'RIFF');assert.equal(bytes.subarray(8,12).toString(),'WEBP');
  const image=sharp(bytes);const metadata=await image.metadata();assert.equal(metadata.format,'webp');assert.ok(metadata.width!>=800&&metadata.height!>=450);await image.raw().toBuffer();
 }
});
test('本机4080的容量保留差额不误降档，低容量不能借容差升档',()=>{
 const local=byId(16376,31);assert.equal(local['minimax-h3-existing'].level,'recommended');assert.equal(local['wan22-ti2v-5b'].level,'recommended');assert.match(local['minimax-h3-existing'].levelLabel,/仍需实测/);
 assert.equal(byId(14336,31)['wan22-ti2v-5b'].level,'conditional');assert.equal(byId(16376,16)['wan22-ti2v-5b'].level,'not-recommended');
});
