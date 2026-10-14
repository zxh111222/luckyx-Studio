import test from 'node:test'
import assert from 'node:assert/strict'
import { pages, readPage, parsePreferences } from '../src/renderer/prototypes/luckyx-gallery/design-model'
test('银灰定稿页面路由覆盖八页，无效页回到首页',()=>{
  assert.equal(pages.length,8)
  for(const page of pages)assert.equal(readPage('?p='+page.key),page.key)
  assert.equal(readPage('?p=not-a-page'),'home')
  assert.equal(readPage(''),'home')
})
test('界面偏好预览容忍损坏输入，减少动态与对比度独立',()=>{
  assert.deepEqual(parsePreferences('broken'),{motion:false,contrast:false,solid:false})
  assert.deepEqual(parsePreferences('null'),{motion:false,contrast:false,solid:false})
  assert.deepEqual(parsePreferences('{"motion":"reduce","contrast":"auto","transparency":"solid"}'),{motion:true,contrast:false,solid:true})
})
