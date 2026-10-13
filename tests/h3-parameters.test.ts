import test from 'node:test';
import assert from 'node:assert/strict';
import { h3FramesForSeconds, isVerifiedH3Configuration, H3_RESOLUTIONS, H3_DURATIONS, H3_MAX_PIXELS } from '../src/shared/h3-parameters';
import { validateGenerationParams, buildWorkflow } from '../src/shared/workflow';
const base={mode:'image' as const,templateId:'h3-i2v',prompt:'镜头移动',width:864,height:480,frames:124,steps:4,seed:42};
test('横屏、竖屏、方形及自定义尺寸遵守32网格和总像素限制',()=>{
 for(const resolution of [...H3_RESOLUTIONS,{width:256,height:2048},{width:2048,height:256}])for(const frames of H3_DURATIONS){const value={...base,width:resolution.width,height:resolution.height,frames};assert.deepEqual(validateGenerationParams(value),value);assert.ok(resolution.width*resolution.height<=H3_MAX_PIXELS);}
 for(const patch of [{width:255},{width:257},{width:2080},{height:NaN},{height:480.5},{width:2048,height:512},{width:1344,height:800},{frames:4},{frames:363},{frames:124.5},{frames:125},{frames:6},{steps:8}])assert.throws(()=>validateGenerationParams({...base,...patch}),Error);
 assert.equal(validateGenerationParams({...base,frames:5}).frames,5);
});
test('秒数向上量化到17n+5，边界准确且不产生超限帧数',()=>{
 assert.equal(h3FramesForSeconds(5/24),5);assert.equal(h3FramesForSeconds(362/24),362);
 for(const [seconds,frames] of [[2,56],[5,124],[10,243],[15,362]])assert.equal(h3FramesForSeconds(seconds),frames);
 for(const frames of H3_DURATIONS)assert.equal(h3FramesForSeconds(frames/24),frames);
 let previous=0;for(let i=0;i<=1000;i++){const seconds=5/24+(362/24-5/24)*i/1000;const frames=h3FramesForSeconds(seconds);assert.ok(frames>=5&&frames<=362);assert.equal((frames-5)%17,0);assert.ok(frames/24+1e-12>=seconds);assert.ok(frames>=previous);previous=frames;}
 for(const seconds of [0,5/24-1e-8,362/24+1e-8,NaN,Infinity,-1])assert.throws(()=>h3FramesForSeconds(seconds),Error);
});
test('可编辑规格不等于实机验证，已验证标识仅属于原默认配置',()=>{
 assert.equal(isVerifiedH3Configuration(864,480,124),true);assert.equal(isVerifiedH3Configuration(864,480,124,'text'),false);
 for(const values of [[480,864,124],[864,480,243],[1344,768,124],[832,480,124]])assert.equal(isVerifiedH3Configuration(values[0],values[1],values[2]),false);
});
test('自定义宽高与量化帧数绑定到工作流，固定24fps与4步不被改变',()=>{
 const value={...base,width:480,height:864,frames:h3FramesForSeconds(10)};const workflow=buildWorkflow(value,'uploaded.png','custom');
 assert.equal(workflow['6'].inputs.width,480);assert.equal(workflow['6'].inputs.height,864);assert.equal(workflow['6'].inputs.length,243);assert.equal(workflow['10'].inputs.steps,4);assert.equal(workflow['14'].inputs.fps,24);
});

