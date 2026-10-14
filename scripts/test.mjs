import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

// Pass explicit filenames so PowerShell and POSIX run the same complete test suite.
const files = readdirSync('tests').filter(name => name.endsWith('.test.ts')).sort().map(name => resolve('tests', name))
if (!files.length) throw new Error('没有找到回归测试')
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], { stdio: 'inherit', windowsHide: true })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
