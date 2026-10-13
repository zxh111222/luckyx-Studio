import test from 'node:test';
import assert from 'node:assert/strict';
import { getWindowBounds } from '../src/shared/window-bounds';

test('大工作区采用1440×1024默认窗口和1200×720最小窗口',()=>{
 assert.deepEqual(getWindowBounds({width:1920,height:1080}),{width:1440,height:1024,minWidth:1200,minHeight:720});
 assert.deepEqual(getWindowBounds({width:3840,height:2160}),{width:1440,height:1024,minWidth:1200,minHeight:720});
});
test('普通笔记本按可用工作区收缩初始窗口，仍保留易用下限',()=>{
 assert.deepEqual(getWindowBounds({width:1366,height:728}),{width:1366,height:728,minWidth:1200,minHeight:720});
 assert.deepEqual(getWindowBounds({width:1280,height:800}),{width:1280,height:800,minWidth:1200,minHeight:720});
});
test('高DPI小工作区允许最小窗口随工作区收缩，不超出屏幕',()=>{
 assert.deepEqual(getWindowBounds({width:1024,height:640}),{width:1024,height:640,minWidth:1024,minHeight:640});
 assert.deepEqual(getWindowBounds({width:1600,height:680}),{width:1440,height:680,minWidth:1200,minHeight:680});
 assert.deepEqual(getWindowBounds({width:1000,height:900}),{width:1000,height:900,minWidth:1000,minHeight:720});
});
test('分数逻辑像素向下取整，并保持最小窗口不超过初始窗口或工作区',()=>{
 assert.deepEqual(getWindowBounds({width:1199.5,height:719.5}),{width:1199,height:719,minWidth:1199,minHeight:719});
 for(const width of [640,1024,1200,1366,1440,2560])for(const height of [480,640,720,800,1024,1440]){
  const area={width,height};const result=getWindowBounds(area);
  assert.ok(result.width<=width&&result.height<=height);
  assert.ok(result.minWidth<=result.width&&result.minHeight<=result.height);
  assert.equal(result.minWidth,Math.min(width,1200));assert.equal(result.minHeight,Math.min(height,720));
  assert.deepEqual(area,{width,height});
 }
});
test('拒绝无效工作区，避免生成无限大或负尺寸窗口',()=>{
 for(const value of [0,-1,NaN,Infinity,0.5]){
  assert.throws(()=>getWindowBounds({width:value,height:800}),RangeError);
  assert.throws(()=>getWindowBounds({width:1280,height:value}),RangeError);
 }
});
