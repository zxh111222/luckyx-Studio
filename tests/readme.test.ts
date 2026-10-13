import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

test('README版本与安装包说明同步，本地链接在仓库中可解析', async () => {
  const text = await fs.readFile('README.md', 'utf8')
  const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'))
  assert.ok(text.includes(`v${pkg.version}`))
  assert.ok(text.includes(`luckyx-Studio-Setup-${pkg.version}-x64.exe`))
  assert.ok(!text.includes('\uFFFD'))
  const references = [...text.matchAll(/(?:\]\(|src=")([^\s)"<>]+)(?:\)|")/g)].map(match => match[1])
  for (const reference of references) {
    if (/^https:\/\//.test(reference) || reference.startsWith('#')) continue
    assert.ok(!reference.startsWith('dist/') && !reference.startsWith('docs/'), '公开README不能依赖忽略目录中的图片或下载链接')
    assert.ok((await fs.stat(path.resolve(reference))).isFile(), reference)
  }
})

test('README截图为可完整解码的轻量图片，横幅和教程均无缺失', async () => {
  const text = await fs.readFile('README.md', 'utf8')
  const paths = [...text.matchAll(/(?:\]\(|src=")(assets\/readme\/[^)"<>]+\.webp)(?:\)|")/g)].map(match => match[1])
  assert.ok(paths.length >= 7)
  for (const filename of paths) {
    const bytes = await fs.readFile(filename)
    assert.ok(bytes.length < 350 * 1024, `${filename}过大`)
    const decoded = await sharp(bytes).raw().toBuffer({ resolveWithObject: true })
    assert.equal(decoded.info.width, 1400 + (filename.includes('banner') ? 0 : 40))
    assert.ok(decoded.info.height >= 340)
  }
})
