import test from 'node:test'
import assert from 'node:assert/strict'
import { selectedVariant, readPrototypeData, STORAGE_KEY } from '../src/renderer/prototypes/luckyx-home/model'

test('主页比较 URL 支持三个方案，无效选择回到第一个', () => {
  assert.equal(selectedVariant('?v=1'), 0)
  assert.equal(selectedVariant('?v=2'), 1)
  assert.equal(selectedVariant('?v=3'), 2)
  for (const input of ['', '?v=0', '?v=4', '?v=foo', '?v=1.5']) assert.equal(selectedVariant(input), 0)
})
test('原型数据与正式数据隔离，损坏本地数据不会阻止页面加载', () => {
  assert.ok(STORAGE_KEY.startsWith('luckyx.prototype.'))
  assert.deepEqual(readPrototypeData(null), { drafts: [], imports: [] })
  assert.deepEqual(readPrototypeData('broken'), { drafts: [], imports: [] })
  assert.deepEqual(readPrototypeData('{"drafts":[null,1,{}],"imports":[null,{"name":"坏节点","nodes":-1,"format":"api"}]}'), { drafts: [], imports: [] })
  const item = {id:'1',title:'家庭影像',prompt:'森林',createdAt:'2026-10-14',mode:'image',resolution:'864 × 480',duration:'约 5 秒'}
  assert.equal(readPrototypeData(JSON.stringify({drafts:Array(40).fill(item)})).drafts.length,30)
})
