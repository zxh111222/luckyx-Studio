import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const documents = [
  'docs/08-视频模型推荐与安装指南.md',
  'docs/09-界面与教程验收.md',
  'docs/10-Logo审核稿.md',
  'docs/截图教程/README.md',
];
const officialNames = [
  'ltx-video-2b-095-official.jpg', 'minimax-h3-existing-official.jpg',
  'wan21-t2v-13b-official.jpg', 'wan22-ti2v-5b-official.jpg',
];
const tutorialNames = [
  '01-设备与模型推荐.jpg', '02-文件清单与目录.jpg',
  '官方文件页-下载入口.jpg', '原生工作流-缺失模型清单.jpg',
  '原生模板库-Wan5B.jpg', 'H3-作品预览与导出.jpg',
  'wan22-操作步骤.jpg', ...officialNames,
];
const linkPattern = /!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+[^)]*)?\)/g;
let linkCount = 0;
for (const relative of documents) {
  try {
    const absolute = path.join(root, relative);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(await fs.readFile(absolute));
    if (!text.trim()) throw new Error('文档为空');
    let count = 0;
    for (const match of text.matchAll(linkPattern)) {
      const target = match[1] || match[2];
      if (target.startsWith('#') || /^https?:\/\//i.test(target)) continue;
      // These documents use relative file/image links; ignore other external schemes.
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !path.win32.isAbsolute(target)) continue;
      const filename = decodeURIComponent(target.split('#', 1)[0].split('?', 1)[0]);
      if (!filename) continue;
      const resolved = path.resolve(path.dirname(absolute), filename);
      await fs.access(resolved);
      count++;
    }
    linkCount += count;
    console.log(`OK UTF-8与本地链接: ${relative} (${count})`);
  } catch (error) {
    failures.push(`${relative}: ${error.message}`);
  }
}

let imageCount = 0;
async function validateImage(relative, expectedFormat) {
  try {
    const bytes = await fs.readFile(path.join(root, relative));
    const image = sharp(bytes, { failOn: 'warning' });
    const metadata = await image.metadata();
    if (metadata.format !== expectedFormat || !metadata.width || !metadata.height) throw new Error('图像格式或尺寸无效');
    await image.raw().toBuffer();
    imageCount++;
    console.log(`OK 完整解码: ${relative} (${metadata.width}×${metadata.height}, ${bytes.length} bytes)`);
  } catch (error) {
    failures.push(`${relative}: ${error.message}`);
  }
}
const tutorialDirectory = path.join(root, 'docs/截图教程');
let actualTutorials = [];
try {
  actualTutorials = (await fs.readdir(tutorialDirectory)).filter(name => /\.jpe?g$/i.test(name));
  for (const name of tutorialNames) if (!actualTutorials.includes(name)) failures.push(`缺少教程截图: ${name}`);
} catch (error) {
  failures.push(`docs/截图教程: ${error.message}`);
}
for (const name of actualTutorials) await validateImage(`docs/截图教程/${name}`, 'jpeg');
for (const name of officialNames) await validateImage(`src/renderer/public/model-guides/${name}`, 'jpeg');
await validateImage('docs/品牌/luckyx-logo-审核稿.png', 'png');
await validateImage('docs/品牌/luckyx-logo-审核稿-v2.png', 'png');
console.log('Logo只检查文件完整性，审核稿未应用；此脚本不判断视觉质量或模型运行效果。');
if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  console.error(`FAILED: ${failures.length} 项问题`);
  process.exitCode = 1;
} else {
  console.log(`PASS: ${documents.length} 份文档、${linkCount} 个本地链接、${imageCount} 张图像验证通过。`);
}
