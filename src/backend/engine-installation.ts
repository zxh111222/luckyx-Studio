import path from 'node:path'
import { promises as fs } from 'node:fs'
export async function getEngineInstallation(root: string): Promise<{ python: string; launcher: string; args: string[]; cwd: string }> {
  const native = { python: path.join(root, 'python_embeded/python.exe'), launcher: path.join(root, 'ComfyUI/main.py'), args: ['-s', 'ComfyUI/main.py', '--windows-standalone-build'], cwd: root }
  const legacy = { python: path.join(root, 'venv/Scripts/python.exe'), launcher: path.join(root, 'launch_comfy.py'), args: [path.join(root, 'launch_comfy.py'), '--fast-disk'], cwd: root }
  for (const spec of [native, legacy]) {
    try { const entries = await Promise.all([spec.python, spec.launcher, path.join(root, 'ComfyUI/main.py')].map(file => fs.stat(file))); if (entries.every(st => st.isFile() && st.size > 0)) return spec } catch {}
  }
  throw new Error('未找到可启动的 ComfyUI 环境，请一键安装或选择完整的已有环境。')
}
