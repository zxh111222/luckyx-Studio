import type { BootstrapFile, BootstrapRuntime } from '../shared/bootstrap';

// Both packages are from the immutable official v0.39.0 release. The cu126
// archive is for legacy GPUs only; selection follows the shared support policy.
const files: Record<BootstrapRuntime['id'], BootstrapFile> = {
    cu130: { id: 'comfyui-portable', name: 'ComfyUI_windows_portable_nvidia.7z', kind: 'environment', relativePath: 'portable.7z', url: 'https://github.com/Comfy-Org/ComfyUI/releases/download/v0.39.0/ComfyUI_windows_portable_nvidia.7z', sizeBytes: 2003629308, sha256: '3dca347842ed1c6c833105fafb1669284685a3e54df41578d5f94bcc898ae039' },
    cu126: { id: 'comfyui-portable-cu126', name: 'ComfyUI_windows_portable_nvidia_cu126.7z', kind: 'environment', relativePath: 'portable-cu126.7z', url: 'https://github.com/Comfy-Org/ComfyUI/releases/download/v0.39.0/ComfyUI_windows_portable_nvidia_cu126.7z', sizeBytes: 1895335518, sha256: 'c42e7d5f6a5e931f6551dcf102d739a55c5f4a4df921f748e1de9de9f648d6a2' }
};

export function getPinnedEnvironmentFile(runtime: BootstrapRuntime['id']): BootstrapFile {
    return structuredClone(files[runtime]);
}

export function environmentCachePaths(file: BootstrapFile) {
    // Legacy cu130 resumes keep their original paths. A different runtime never
    // overwrites that verified archive or the models beside its extracted files.
    return { archiveName: file.id === 'comfyui-portable-cu126' ? 'portable-cu126.7z' : 'portable.7z', extractedName: file.id === 'comfyui-portable-cu126' ? 'unpacked-cu126' : 'unpacked' };
}

export const CUDA_GPU_PROBE_SCRIPT = `import json
result = {"cuda": None, "available": False, "computed": False}
try:
    import torch
    result["cuda"] = torch.version.cuda
    result["available"] = torch.cuda.is_available()
    if result["available"]:
        with torch.inference_mode():
            a = torch.ones((2, 2), device="cuda", dtype=torch.float32)
            b = a @ a
            torch.cuda.synchronize()
            result["computed"] = bool(torch.isfinite(b).all().item() and (b == 2).all().item())
            result["device"] = torch.cuda.get_device_name(0)
except Exception:
    result["computed"] = False
print(json.dumps(result))`;

export function validateGpuProbe(stdout: string, runtime: BootstrapRuntime): void {
    let check: { cuda?: unknown; available?: unknown; computed?: unknown };
    try {
        const parsed: unknown = JSON.parse(stdout.trim().split(/\r?\n/).at(-1) ?? '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid probe');
        check = parsed;
    }
    catch { throw new Error('GPU 检查未返回有效结果，已保留安装进度；请检查显卡驱动后继续安装'); }
    if (check.available !== true || check.computed !== true) throw new Error(`${runtime.label} 的 GPU 运算检查未通过。已保留下载文件和模型，请更新 NVIDIA 驱动后重新检查并继续安装`);
    if (check.cuda !== runtime.cudaVersion) throw new Error(`运行包与计划不一致：需要 CUDA ${runtime.cudaVersion}。已保留安装进度，请重新检查运行环境`);
}
