import test from 'node:test'
import assert from 'node:assert/strict'
import { rootAssetBindings } from '../scripts/renderer-asset-audit.mjs'

const assets = ['forest-preview.webp', 'coast-inspiration.webp', 'brand/luckyx-symbol.svg']
test('打包审计拒绝直接、条件和数组数据绑定的磁盘根目录图片', () => {
  for (const source of [
    'const view = { src: "/forest-preview.webp" }',
    'const view = { src: mode === "image" ? "/coast-inspiration.webp" : "/forest-preview.webp" }',
    'const cards = [{ image: "/forest-preview.webp" }]; const view = { src: item.image }',
    'const image = "/forest-preview.webp"; const view = { src: image }',
    'const images = { forest: "/forest-preview.webp" }; const view = { src: images[id] }',
    'const view = { poster: "/forest-preview.webp" }',
  ]) assert.equal(rootAssetBindings(source, assets).length, 1, source)
})

test('打包审计允许解析后的路径和用户动态输出，不错误拦截模型下载地址', () => {
  const source = `
    const cards = [{ image: "/forest-preview.webp" }];
    const view = { src: assetUrl(item.image) };
    const cover = { src: assetUrl(mode ? "/forest-preview.webp" : "/coast-inspiration.webp") };
    const imported = { src: new URL("../coast-inspiration.webp", import.meta.url).href };
    const video = { src: mediaUrl(output) };
    const userImage = { src: uploadedPreview };
    const download = { url: "https://huggingface.co/model/file" };
  `
  assert.deepEqual(rootAssetBindings(source, assets), [])
})
