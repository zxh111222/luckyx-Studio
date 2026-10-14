import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { H3InstallationTier } from '../shared/bootstrap';
import { h3ModelSpecs, h3TierDefaults, h3TierLaunchArgs } from '../shared/h3-installation';

export async function getH3Runtime(installationPath: string, modelPath: string) {
    let tier: H3InstallationTier = 'standard';
    let marked = false;
    try {
        const markerPath = path.join(installationPath, 'luckyx-managed.json');
        const stat = await fs.lstat(markerPath);
        if (path.resolve(modelPath) === path.resolve(installationPath, 'ComfyUI/models') && stat.isFile() && !stat.isSymbolicLink() && stat.size < 65536) {
            const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
            if (marker.app === 'luckyx. Studio' && ['lite', 'lite-audio', 'balanced', 'standard'].includes(marker.installationTier)) {
                tier = marker.installationTier;
                marked = true;
            }
        }
    } catch { /* Existing environments keep their original INT8 graph. */ }
    if (!marked) {
        const installed = async (file: string) => { try { const stat = await fs.stat(path.join(modelPath, 'diffusion_models', file)); return stat.isFile() && stat.size > 0; } catch { return false; } };
        if (!await installed('minimax_h3_fl2va_pruned_int8_convrot.safetensors')) {
            if (await installed('minimax_h3_fl2va_pruned_w6a8.safetensors')) tier = 'balanced';
            else if (await installed('minimax_h3_fl2va_pruned_w4a8_mixed.safetensors')) tier = 'lite';
        }
    }
    return { tier, modelSpecs: h3ModelSpecs(tier), defaults: h3TierDefaults(tier), launchArgs: h3TierLaunchArgs(tier) };
}
