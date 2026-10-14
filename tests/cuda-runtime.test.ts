import test from 'node:test'
import assert from 'node:assert/strict'
import { NVIDIA_DRIVER_URL, parseNvidiaCudaVersion, selectCudaRuntime } from '../src/shared/cuda-runtime'
import { CUDA_GPU_PROBE_SCRIPT, environmentCachePaths, getPinnedEnvironmentFile, validateGpuProbe } from '../src/backend/cuda-runtime'

const base = { gpuName: 'NVIDIA GeForce RTX 4060', vramMb: 8192, ramGb: 32, driver: '580.88', cudaVersion: '13.0' }
test('读取 nvidia-smi 最大 CUDA 能力，缺失和 N/A 不伪造版本', () => {
  assert.equal(parseNvidiaCudaVersion('| NVIDIA-SMI 546.30 Driver Version: 546.30 CUDA Version: 12.3 |'), '12.3')
  assert.equal(parseNvidiaCudaVersion('| Driver Version: 580.88   CUDA Version: 13.0 |'), '13.0')
  for (const text of ['', 'CUDA Version: N/A', 'Driver Version: 546.30', 'No devices were found']) assert.equal(parseNvidiaCudaVersion(text), undefined)
})

test('RTX20/30/40/50与工作站RTX均坚持官方cu130，旧驱动前置要求更新', () => {
  const devices = ['NVIDIA GeForce RTX 2080', 'NVIDIA GeForce RTX 3060', 'NVIDIA GeForce RTX 4060', 'NVIDIA GeForce RTX 5090', 'NVIDIA RTX A4000', 'NVIDIA RTX PRO 6000 Blackwell']
  const drivers = [
    ['546.30', '12.3', 'driver-update-required'],
    ['560.94', '12.6', 'driver-update-required'],
    ['572.83', '12.8', 'driver-update-required'],
    ['580.88', '13.0', 'supported'],
    ['590.01', '13.1', 'supported'],
    ['未知', undefined, 'unknown'],
  ] as const
  for (const gpuName of devices) for (const [driver, cudaVersion, compatibility] of drivers) {
    const result = selectCudaRuntime({ ...base, gpuName, driver, cudaVersion })
    assert.equal(result.runtime.id, 'cu130', `${gpuName} / ${driver}不能降至cu126`)
    assert.equal(result.runtime.compatibility, compatibility, `${gpuName} / ${driver}`)
    assert.equal(result.hardwareIssues.length, compatibility === 'supported' ? 0 : 1)
    if (compatibility === 'driver-update-required') assert.match(result.runtime.reason, /已下载模型保留/)
    assert.equal(result.runtime.driverUrl, NVIDIA_DRIVER_URL)
  }
})

test('驱动数字与最大 CUDA 能力冲突时不能仅凭其中一项放行', () => {
  for (const patch of [
    { driver: '580.88', cudaVersion: '12.3' },
    { driver: '590.01', cudaVersion: '12.8' },
    { driver: '546.30', cudaVersion: '13.0' },
    { driver: '579.99', cudaVersion: '13.0' },
  ]) assert.equal(selectCudaRuntime({ ...base, ...patch }).runtime.compatibility, 'driver-update-required')
  assert.equal(selectCudaRuntime({ ...base, driver: '未知', cudaVersion: '13.0' }).runtime.compatibility, 'unknown')
  assert.equal(selectCudaRuntime({ ...base, driver: '580.88', cudaVersion: undefined }).runtime.compatibility, 'supported')
})

test('GTX9/10与Quadro旧卡仅选择cu126基础包，Windows兼容边界528.33不误当560.76', () => {
  const devices = ['NVIDIA GeForce GTX 980', 'NVIDIA GeForce GTX 1080 Ti', 'NVIDIA Quadro P4000', 'NVIDIA Quadro M2000']
  const drivers = [
    ['528.32', '12.0', 'driver-update-required'],
    ['528.33', '12.0', 'conditional'],
    ['546.30', '12.3', 'conditional'],
    ['560.75', '12.6', 'conditional'],
    ['560.76', '12.6', 'supported'],
    ['580.88', '13.0', 'supported'],
  ] as const
  for (const gpuName of devices) for (const [driver, cudaVersion, compatibility] of drivers) {
    const result = selectCudaRuntime({ ...base, gpuName, driver, cudaVersion })
    assert.equal(result.runtime.id, 'cu126'); assert.equal(result.runtime.cudaVersion, '12.6')
    assert.equal(result.runtime.compatibility, compatibility, `${gpuName} / ${driver}`)
    assert.equal(result.hardwareIssues.length, compatibility === 'driver-update-required' ? 1 : 0)
    assert.match(result.runtime.label, /基础环境/)
    assert.match(result.runtime.reason, /H3|驱动/)
    if (compatibility === 'conditional') assert.ok(result.runtime.warnings.some(text => text.includes('GPU 计算检查')))
  }
  assert.equal(selectCudaRuntime({ ...base, gpuName: devices[0], cudaVersion: '11.8' }).runtime.compatibility, 'driver-update-required')
  assert.equal(selectCudaRuntime({ ...base, gpuName: devices[0], driver: '560.76', cudaVersion: '12.3' }).runtime.compatibility, 'conditional')
})

test('AMD、未知GPU与不可解析驱动保留手动路线，不宣称可安装H3', () => {
  for (const gpuName of ['未知', 'AMD Radeon RX 7900 XTX', 'Intel Arc A770', 'NVIDIA GeForce GTX 1660']) {
    const result = selectCudaRuntime({ ...base, gpuName })
    assert.equal(result.runtime.compatibility, 'unsupported'); assert.ok(result.hardwareIssues.length)
    assert.match(result.runtime.reason, /手动教程/)
  }
  for (const driver of ['', '未知', 'N/A', '546,30']) {
    const result = selectCudaRuntime({ ...base, driver })
    assert.equal(result.runtime.compatibility, 'unknown'); assert.match(result.runtime.reason, /暂不下载大型模型/)
  }
})

test('运行包选择不修改硬件对象，明确CUDA Toolkit与驱动能力的区别', () => {
  const before = JSON.stringify(base)
  const result = selectCudaRuntime(base)
  assert.equal(JSON.stringify(base), before)
  assert.ok(result.runtime.warnings.some(text => text.includes('无需另装 CUDA Toolkit') && text.includes('nvidia-smi')))
  assert.equal(new URL(result.runtime.driverUrl).hostname, 'www.nvidia.com')
})

test('固定官方环境清单及缓存按运行包隔离，cu130历史归档与模型位置保持可复用', () => {
  const current = getPinnedEnvironmentFile('cu130'), legacy = getPinnedEnvironmentFile('cu126')
  assert.equal(current.sizeBytes, 2003629308); assert.equal(legacy.sizeBytes, 1895335518)
  assert.equal(current.sha256, '3dca347842ed1c6c833105fafb1669284685a3e54df41578d5f94bcc898ae039')
  assert.equal(legacy.sha256, 'c42e7d5f6a5e931f6551dcf102d739a55c5f4a4df921f748e1de9de9f648d6a2')
  assert.deepEqual(environmentCachePaths(current), { archiveName: 'portable.7z', extractedName: 'unpacked' })
  assert.deepEqual(environmentCachePaths(legacy), { archiveName: 'portable-cu126.7z', extractedName: 'unpacked-cu126' })
  for (const file of [current, legacy]) {
    assert.equal(file.kind, 'environment'); assert.equal(new URL(file.url).hostname, 'github.com')
    assert.match(new URL(file.url).pathname, /^\/Comfy-Org\/ComfyUI\/releases\/download\/v0\.39\.0\//)
  }
  current.url = 'https://example.test/tamper'
  assert.notEqual(getPinnedEnvironmentFile('cu130').url, current.url, '调用者不可改变全局固定清单')
})

test('GPU检查必须真正计算成功且CUDA与选定包一致，cu126合法旧卡无需伪装13', () => {
  for (const hardware of [base, { ...base, gpuName: 'NVIDIA GTX 1080', driver: '560.76', cudaVersion: '12.6' }]) {
    const { runtime } = selectCudaRuntime(hardware)
    const report = { cuda: runtime.cudaVersion, available: true, computed: true }
    assert.doesNotThrow(() => validateGpuProbe('torch startup\r\n' + JSON.stringify(report), runtime))
    for (const patch of [{ available: false }, { computed: false }, { available: 'true' }, { computed: 'true' }]) {
      assert.throws(() => validateGpuProbe(JSON.stringify({ ...report, ...patch }), runtime), /GPU 运算检查未通过.*保留/)
    }
    assert.throws(() => validateGpuProbe(JSON.stringify({ ...report, cuda: runtime.id === 'cu130' ? '12.6' : '13.0' }), runtime), /运行包与计划不一致.*保留/)
  }
})

test('GPU检查的无效输出返回可继续安装说明，不泄漏解析器异常', () => {
  const { runtime } = selectCudaRuntime(base)
  for (const output of ['not json', 'null', '[]', '{}', '', '{"available":true,"computed":true}']) {
    assert.throws(() => validateGpuProbe(output, runtime), /已保留|保留安装进度/, output)
  }
})

test('GPU探针执行小型矩阵运算、等待GPU完成并验证结果，不仅检查is_available', () => {
  assert.match(CUDA_GPU_PROBE_SCRIPT, /torch\.ones\(\(2, 2\), device="cuda", dtype=torch\.float32\)/)
  assert.match(CUDA_GPU_PROBE_SCRIPT, /b = a @ a/)
  assert.match(CUDA_GPU_PROBE_SCRIPT, /torch\.cuda\.synchronize\(\)/)
  assert.match(CUDA_GPU_PROBE_SCRIPT, /torch\.isfinite\(b\)/)
  assert.match(CUDA_GPU_PROBE_SCRIPT, /b == 2/)
  assert.doesNotMatch(CUDA_GPU_PROBE_SCRIPT, /pip install|subprocess|load_file|safetensors/)
})
