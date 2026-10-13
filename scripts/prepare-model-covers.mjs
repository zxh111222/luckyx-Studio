import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const covers = ['wan22-ti2v-5b', 'wan21-t2v-13b', 'ltx-video-2b-095', 'minimax-h3-existing']
const input = path.join(root, 'assets', 'model-covers')
const output = path.join(root, 'src', 'renderer', 'public', 'model-covers')
await fs.mkdir(output, { recursive: true })
const hashes = new Set()
for (const id of covers) {
  const original = path.join(input, `${id}.webp`)
  const source = await fs.readFile(original)
  const metadata = await sharp(source).metadata()
  let result
  // Default sharp reads just the first page of animated WEBP. No crop, restyle or compositing.
  for (const quality of [82, 72, 62, 52]) {
    result = await sharp(source, { page: 0, pages: 1 }).resize({ width: 960, withoutEnlargement: true }).webp({ quality, effort: 5 }).toBuffer()
    if (result.length < 200_000) break
  }
  if (!result || result.length >= 200_000) throw new Error(`${id}: compressed cover exceeds 200 KB`)
  const finalMetadata = await sharp(result).metadata()
  if (!finalMetadata.width || finalMetadata.width > 960 || (finalMetadata.pages ?? 1) !== 1) throw new Error(`${id}: invalid static cover`)
  const hash = crypto.createHash('sha256').update(result).digest('hex')
  if (hashes.has(hash)) throw new Error(`${id}: duplicate cover`)
  hashes.add(hash)
  await fs.writeFile(path.join(output, `${id}.webp`), result)
  console.log(JSON.stringify({ id, sourceBytes: source.length, sourceWidth: metadata.width, sourceHeight: metadata.pageHeight ?? metadata.height, sourceFrames: metadata.pages ?? 1, width: finalMetadata.width, height: finalMetadata.height, bytes: result.length, sha256: hash }))
}
