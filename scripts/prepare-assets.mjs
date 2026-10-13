import sharp from 'sharp'
import { resolve } from 'node:path'
import { writeFile } from 'node:fs/promises'

const folder = resolve('src/renderer/public')
const result = await sharp(resolve('assets/forest-preview.png'))
  .resize(1280, 720, { fit: 'inside', withoutEnlargement: true })
  .webp({ quality: 82, effort: 6 }).toBuffer()
await writeFile(resolve(folder, 'forest-preview.webp'), result)
console.log(`模板示例图：${(result.length / 1024).toFixed(1)} KB`)
for (const name of ['coast-inspiration', 'camera-studio']) {
  const image = await sharp(resolve(`assets/${name}.png`))
    .resize(1120, 630, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80, effort: 6 }).toBuffer()
  await writeFile(resolve(folder, `${name}.webp`), image)
  console.log(`${name}：${(image.length / 1024).toFixed(1)} KB`)
}
