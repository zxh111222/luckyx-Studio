import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
const icoSizes = sizes.filter(size => size <= 256)
const sourceDir = path.join(root, 'assets/brand')
const pngDir = path.join(sourceDir, 'png')
const publicDir = path.join(root, 'src/renderer/public/brand')
const buildDir = path.join(root, 'build')
const docsDir = path.join(root, 'docs/品牌')
await Promise.all([pngDir, publicDir, buildDir, docsDir].map(dir => fs.mkdir(dir, { recursive: true })))

// All derivatives use the reviewed vector. Resize from 1024px to keep small edges smooth.
for (const [kind, filename] of [['symbol', 'luckyx-symbol.svg'], ['app', 'luckyx-app.svg']]) {
  const svg = await fs.readFile(path.join(sourceDir, filename))
  for (const size of sizes) await sharp(svg, { density: 96 }).resize(size, size).png().toFile(path.join(pngDir, `${kind}-${size}.png`))
  await fs.copyFile(path.join(sourceDir, filename), path.join(publicDir, filename))
}
await fs.copyFile(path.join(pngDir, 'app-512.png'), path.join(buildDir, 'icon.png'))
await fs.copyFile(path.join(pngDir, 'app-32.png'), path.join(publicDir, 'icon-32.png'))
await fs.copyFile(path.join(pngDir, 'app-256.png'), path.join(publicDir, 'icon-256.png'))

// Windows ICO supports PNG payloads. Zero in the one-byte width/height denotes 256px.
const pngs = await Promise.all(icoSizes.map(size => fs.readFile(path.join(pngDir, `app-${size}.png`))))
const directory = Buffer.alloc(6 + icoSizes.length * 16)
directory.writeUInt16LE(1, 2)
directory.writeUInt16LE(icoSizes.length, 4)
let offset = directory.length
for (let i = 0; i < icoSizes.length; i++) {
  const entry = 6 + i * 16
  directory[entry] = icoSizes[i] === 256 ? 0 : icoSizes[i]
  directory[entry + 1] = directory[entry]
  directory.writeUInt16LE(1, entry + 4)
  directory.writeUInt16LE(32, entry + 6)
  directory.writeUInt32LE(pngs[i].length, entry + 8)
  directory.writeUInt32LE(offset, entry + 12)
  offset += pngs[i].length
}
await fs.writeFile(path.join(buildDir, 'icon.ico'), Buffer.concat([directory, ...pngs]))

const pngData = async (kind, size) => `data:image/png;base64,${(await fs.readFile(path.join(pngDir, `${kind}-${size}.png`))).toString('base64')}`
const appLarge = await pngData('app', 512)
const symbolLarge = await pngData('symbol', 512)
const samples = []
for (let i = 0; i < 6; i++) {
  const size = sizes[i]
  const x = 82 + i * 240
  const app = await pngData('app', size)
  const symbol = await pngData('symbol', size)
  samples.push(`<rect x="${x}" y="704" width="216" height="334" rx="12" fill="#171d20" stroke="#2a343a"/><text x="${x + 108}" y="741" text-anchor="middle" class="sample-label">${size} × ${size} px</text><image href="${app}" x="${x + (216 - size) / 2}" y="${790 + (128 - size) / 2}" width="${size}" height="${size}"/><rect x="${x + 22}" y="934" width="172" height="78" rx="8" fill="#e8eeec"/><image href="${symbol}" x="${x + (216 - Math.min(size,64)) / 2}" y="${941 + (64 - Math.min(size,64)) / 2}" width="${Math.min(size,64)}" height="${Math.min(size,64)}"/>`)
}
const previewSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1140" viewBox="0 0 1600 1140"><style>text{font-family:'Microsoft YaHei','Segoe UI',sans-serif;fill:#e7eeeb}.muted{fill:#9baaa4;font-size:20px}.sample-label{font-size:20px;fill:#cbd6d1}</style><rect width="1600" height="1140" fill="#101315"/><text x="82" y="90" font-size="40" font-weight="600">luckyx. 应用图标</text><text x="82" y="132" class="muted">已认可第二版 · 平面矢量优化 · 透明符号与桌面图标</text><image href="${appLarge}" x="104" y="188" width="384" height="384"/><rect x="620" y="188" width="384" height="384" rx="28" fill="#e8eeec"/><image href="${symbolLarge}" x="620" y="188" width="384" height="384"/><text x="296" y="620" text-anchor="middle" class="muted">深灰圆角应用图标</text><text x="812" y="620" text-anchor="middle" class="muted">透明符号 · 浅底展示</text><rect x="1110" y="246" width="54" height="54" rx="12" fill="#5EE0B5"/><text x="1184" y="281" font-size="22">#5EE0B5</text><rect x="1110" y="330" width="54" height="54" rx="12" fill="#101315" stroke="#394744"/><text x="1184" y="365" font-size="22">#101315</text><text x="1110" y="440" class="muted">播放三角：真实负空间</text><text x="1110" y="482" class="muted">独立圆点：主体宽约 12%</text><text x="1110" y="524" class="muted">图标中不放英文或细线</text><text x="82" y="677" font-size="22">应用图标原尺寸对照</text>${samples.join('')}<text x="82" y="1090" class="muted">上排为原尺寸应用图标；下排为浅底符号（128px 缩至 64px 展示）。另提供 256 / 512 / 1024px 文件。</text></svg>`
await sharp(Buffer.from(previewSvg)).png().toFile(path.join(docsDir, '应用图标-预览.png'))
console.log('Brand assets prepared: 18 PNGs, two SVGs, seven-resolution ICO, preview board.')

