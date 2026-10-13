import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'build')
const symbol = `data:image/svg+xml;base64,${(await fs.readFile(path.join(root, 'assets/brand/luckyx-symbol.svg'))).toString('base64')}`
const svg = (width, height, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><style>text{font-family:'Microsoft YaHei','Segoe UI',sans-serif}</style>${body}</svg>`)
function bitmap(rgb, width, height) {
  const stride = (width * 3 + 3) & ~3
  const bytes = Buffer.alloc(54 + stride * height)
  bytes.write('BM'); bytes.writeUInt32LE(bytes.length, 2); bytes.writeUInt32LE(54, 10)
  bytes.writeUInt32LE(40, 14); bytes.writeInt32LE(width, 18); bytes.writeInt32LE(height, 22)
  bytes.writeUInt16LE(1, 26); bytes.writeUInt16LE(24, 28); bytes.writeUInt32LE(stride * height, 34)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const src = (y * width + x) * 3, dst = 54 + (height - 1 - y) * stride + x * 3
    bytes[dst] = rgb[src + 2]; bytes[dst + 1] = rgb[src + 1]; bytes[dst + 2] = rgb[src]
  }
  return bytes
}
const cards = [
  {name:'installerHeader',width:150,height:57,body:`<rect width="150" height="57" fill="#ffffff"/><text x="4" y="34" font-size="21" font-weight="600" fill="#101315">luckyx.</text><rect x="94" y="3" width="52" height="52" rx="12" fill="#101315"/><image href="${symbol}" x="94" y="3" width="52" height="52"/>`},
  {name:'installerSidebar',width:164,height:314,body:`<rect width="164" height="314" fill="#101315"/><image href="${symbol}" x="12" y="25" width="140" height="140"/><text x="22" y="177" fill="#e8efec" font-size="21" font-weight="600">luckyx.</text><text x="23" y="200" fill="#a7b8b0" font-size="12">Studio</text><rect x="22" y="225" width="28" height="3" rx="1.5" fill="#5EE0B5"/><text x="22" y="251" fill="#e8efec" font-size="14">本地创作</text><text x="22" y="275" fill="#a7b8b0" font-size="12">从这里开始</text>`},
  {name:'uninstallerSidebar',width:164,height:314,body:`<rect width="164" height="314" fill="#101315"/><image href="${symbol}" x="12" y="25" width="140" height="140"/><text x="22" y="177" fill="#e8efec" font-size="21" font-weight="600">luckyx.</text><text x="23" y="200" fill="#a7b8b0" font-size="12">Studio</text><rect x="22" y="225" width="28" height="3" rx="1.5" fill="#5EE0B5"/><text x="22" y="251" fill="#e8efec" font-size="14">暂别，创作仍在</text><text x="22" y="275" fill="#a7b8b0" font-size="12">默认保留你的记录</text>`},
]
const previewImages=[]
for(const card of cards){
  const source=svg(card.width,card.height,card.body)
  const rgb=await sharp(source).flatten({background:'#ffffff'}).removeAlpha().raw().toBuffer()
  await fs.writeFile(path.join(out,card.name+'.bmp'),bitmap(rgb,card.width,card.height))
  const png=await sharp(source).png().toBuffer()
  await fs.writeFile(path.join(out,card.name+'.png'),png)
  previewImages.push(`data:image/png;base64,${png.toString('base64')}`)
}
const board=svg(1100,790,`<rect width="1100" height="790" fill="#e8eeec"/><text x="48" y="52" font-size="26" font-weight="600" fill="#101315">luckyx. 安装与卸载向导品牌资源</text><text x="48" y="83" font-size="15" fill="#5a6963">标准 Windows 控件 + 品牌侧栏 / 页眉；图片以 2 倍尺寸展示。</text><image href="${previewImages[1]}" x="48" y="123" width="328" height="628"/><image href="${previewImages[2]}" x="408" y="123" width="328" height="628"/><image href="${previewImages[0]}" x="774" y="160" width="300" height="114"/><text x="774" y="310" font-size="16" fill="#101315">页眉 150 × 57 px</text><text x="774" y="354" font-size="14" fill="#5a6963">安装侧栏 164 × 314 px</text><text x="774" y="384" font-size="14" fill="#5a6963">卸载侧栏 164 × 314 px</text><text x="774" y="436" font-size="14" fill="#5a6963">薄荷 #5EE0B5</text><text x="774" y="466" font-size="14" fill="#5a6963">石墨 #101315</text><text x="774" y="522" font-size="14" fill="#5a6963">24 位未压缩 BMP</text><text x="774" y="552" font-size="14" fill="#5a6963">支持原生 NSIS 向导</text>`)
await sharp(board).png().toFile(path.join(out,'nsis-brand-preview.png'))
console.log('NSIS brand BMP/PNG/header/sidebar prepared.')
