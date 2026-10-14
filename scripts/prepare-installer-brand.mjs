import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'build')
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
const logoSource = path.join(root, 'assets/brand/png/app-256.png')
const logo = await sharp(logoSource).flatten({ background: '#f6f7f8' }).removeAlpha().raw().toBuffer()
await fs.writeFile(path.join(out, 'installer-logo.bmp'), bitmap(logo, 256, 256))
// Remove retired fixed assets so electron-builder cannot automatically discover them.
for (const name of ['installerHeader', 'installerSidebar', 'uninstallerSidebar']) {
  for (const extension of ['bmp', 'png']) {
    const target = path.resolve(out, name + '.' + extension)
    if (path.dirname(target) !== out) throw new Error('Installer asset path escaped the build directory.')
    await fs.unlink(target).catch(error => { if (error.code !== 'ENOENT') throw error })
  }
}
const dataLogo = 'data:image/png;base64,' + (await fs.readFile(logoSource)).toString('base64')
const pages = [
  { key: 'welcome', label: '欢迎安装', caption: '安装应用', subtitle: '连接你的本地创作空间', title: '灵感，在这里开始。', intro: '安装视频工作流启动器，开始你的本地创作。', note: '升级保留设置、历史记录与工作流。<br>ComfyUI 与模型将在应用内按设备配置准备。', kind: 'welcome', action: '继续' },
  { key: 'directory', label: '安装目录', caption: '安装位置', subtitle: '为 luckyx. Studio 选择一个位置', title: '为创作，留一个位置。', intro: '这里只安装启动器。模型与作品目录可稍后在应用内选择。', note: '更新替换程序文件，保留你的设置和创作记录。', kind: 'directory', action: '安装' },
  { key: 'progress', label: '安装进度', caption: 'luckyx. Studio', subtitle: '正在安装应用，请稍候。', title: '正在安装应用', intro: '正在解压程序文件…', note: 'NSIS 引擎显示真实执行进度，安装期间请稍候。', kind: 'progress', action: '下一步' },
  { key: 'finish', label: '安装完成', caption: '安装完成', subtitle: '创作，从一个灵感开始', title: '准备好，开始创作。', intro: 'luckyx. Studio 已安装完成。', note: '首次打开可按电脑配置准备环境，<br>也可以连接已有的 ComfyUI。', kind: 'finish', action: '完成' },
  { key: 'uninstall', label: '卸载选择', caption: '卸载应用', subtitle: '默认保留你的创作记录', title: '暂别，创作依然在。', intro: '卸载启动器，默认保留设置、历史记录和工作流副本。<br>重新安装后，可以继续使用这些记录。', note: '勾选后，应用记录无法恢复。<br>视频、原图、模型、下载缓存与 ComfyUI 环境始终保留。', kind: 'uninstall', action: '卸载' },
  { key: 'uninstall-progress', label: '卸载进度', caption: 'luckyx. Studio', subtitle: '正在卸载应用，请稍候。', title: '正在卸载应用', intro: '正在移除程序文件…', note: '仅卸载程序；应用记录按你在上一页的选择处理。', kind: 'progress', action: '下一步' },
  { key: 'uninstall-finish', label: '卸载完成', caption: '卸载完成', subtitle: '感谢使用 luckyx. Studio', title: '创作，下次再见。', intro: 'luckyx. Studio 已从电脑移除。', note: '设置、历史记录和工作流副本保留。<br>重新安装后，继续你的创作。', kind: 'uninstall-finish', action: '完成' },
]
const panels = pages.map((page, index) => {
  let body = ''
  if (['welcome', 'finish', 'uninstall-finish'].includes(page.kind)) body += '<div class="brand"><img alt="" src="' + dataLogo + '"><strong>luckyx. Studio</strong></div>'
  body += '<h1>' + page.title + '</h1><p class="intro">' + page.intro + '</p>'
  if (page.kind === 'welcome') body += '<p class="features">简洁的工作台 · 自由导入工作流 · 管理每一次创作</p>'
  if (page.kind === 'directory') body += '<label class="path-label">应用安装目录</label><div class="path"><input readonly value="C:\\Users\\你\\AppData\\Local\\Programs\\luckyx. Studio"><button disabled>浏览…</button></div>'
  if (page.kind === 'progress') body += '<progress value="61" max="100" aria-label="示意进度"></progress><span class="progress-note">预览示意进度 61% · 实际安装由 NSIS 引擎反馈</span>'
  if (page.kind === 'uninstall') body += '<label class="check-row"><input type="checkbox" disabled>同时删除设置、历史记录、工作流副本和应用缓存</label>'
  body += '<p class="note">' + page.note + '</p>'
  if (page.kind === 'finish') body += '<label class="check-row"><input type="checkbox" checked disabled>现在打开 luckyx. Studio</label>'
  return '<article class="window" data-page="' + index + '"' + (index ? ' hidden' : '') + '><header><span>' + page.caption + '</span><small>' + page.subtitle + '</small></header><main>' + body + '</main><footer><small>luckyx. Studio</small><div><button disabled>上一步</button><button class="primary" disabled>' + page.action + '</button><button disabled>取消</button></div></footer></article>'
}).join('\n')
const picker = pages.map((page, index) => '<button data-index="' + index + '" aria-pressed="' + (index === 0) + '">' + page.label + '</button>').join('')
const html = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>luckyx. Studio 安装与卸载布局预览</title><style>' +
':root{font:14px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei UI",sans-serif;color:#1d2327;background:#e8edef}*{box-sizing:border-box}body{margin:0;min-height:100vh;padding:40px 20px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:24px}h1,p{margin:0}.preview-label{font-size:13px;color:#59686f;text-align:center}.window{width:min(680px,100%);border:1px solid #cdd7da;background:#f6f7f8;border-radius:12px;overflow:hidden;box-shadow:0 20px 70px #192b3520}.window[hidden]{display:none}.window>header{padding:22px 32px;background:#fff;border-bottom:1px solid #e1e7e8}.window>header>span{display:block;font-weight:600;font-size:15px}.window>header small{display:block;color:#657079;font-size:12px;margin-top:4px}.window>main{padding:30px 40px;min-height:370px}.brand{display:flex;align-items:center;gap:14px;margin-bottom:22px}.brand img{width:44px;height:44px}.brand strong{font-size:24px;font-weight:650;letter-spacing:-.6px}h1{font-size:30px;line-height:1.4;font-weight:600;letter-spacing:-.8px}.intro{font-size:15px;line-height:1.9;margin-top:13px}.features{font-size:14px;margin-top:23px}.note{font-size:13px;color:#657079;line-height:1.9;margin-top:25px}.window>footer{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:17px 24px;border-top:1px solid #dfe6e7}.window>footer>small{font-size:12px;color:#8c989e}.window>footer>div{display:flex;gap:8px}button{font:inherit;min-height:38px;border:1px solid #cdd6da;background:#fff;color:#445057;border-radius:8px;padding:0 16px}.primary{background:#253239;color:#fff;border-color:#253239}.path-label{display:block;margin-top:25px;font-size:13px}.path{display:flex;gap:12px;margin-top:8px}.path input{flex:1;min-width:0;min-height:44px;padding:10px 12px;border:1px solid #c7d2d7;border-radius:7px;background:#fff;color:#35444a;font:13px/1.6 inherit}.check-row{display:flex;align-items:center;gap:10px;margin-top:27px;font-size:14px;line-height:1.8}.check-row input{width:17px;height:17px;flex:none;accent-color:#218365}.picker{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;max-width:850px}.picker button{cursor:pointer;font-size:13px;min-height:40px;padding:6px 13px}.picker button[aria-pressed=true]{background:#253239;color:white;border-color:#253239}.picker button:focus-visible{outline:2px solid #218365;outline-offset:3px}progress{display:block;width:100%;height:9px;margin:28px 0 14px;accent-color:#57d8b3}.progress-note{font-size:12px;color:#75828a}@media(max-width:600px){body{padding:20px 14px}.window>header{padding:19px 22px}.window>main{padding:24px 22px;min-height:390px}.window>footer{align-items:flex-start;flex-direction:column;padding:17px 20px}.window>footer>div{width:100%}.window>footer>div>button{flex:1;padding:0 10px}h1{font-size:26px}.brand strong{font-size:23px}.path{flex-direction:column}.picker{gap:6px}}</style><p class="preview-label">安装与卸载向导布局预览 · 非原生截图 · 不执行安装或卸载</p>' + panels + '<nav class="picker" aria-label="比较向导页面">' + picker + '</nav><script>document.querySelectorAll("[data-index]").forEach(button=>button.addEventListener("click",()=>{document.querySelectorAll("[data-page]").forEach(panel=>panel.hidden=panel.dataset.page!==button.dataset.index);document.querySelectorAll("[data-index]").forEach(item=>item.setAttribute("aria-pressed",String(item===button)))}));</script></html>'
await fs.writeFile(path.join(out, 'installer-ui-preview.html'), html)
console.log('Prepared installer-logo.bmp and seven-page layout preview. Retired sidebar assets removed.')
