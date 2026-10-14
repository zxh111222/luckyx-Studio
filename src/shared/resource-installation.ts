export type InstallableResourceCategory = 'diffusion-model' | 'text-encoder' | 'vae' | 'lora' | 'clip-projection' | 'model-patch' | 'custom-node';

export interface InstallableResourceSummary {
    id: string;
    name: string;
    displayName: string;
    category: InstallableResourceCategory;
    relativeTarget: string;
    purpose: string;
    source: string;
    compatibility: string;
    sizeBytes: number;
    status: 'missing' | 'installed';
}

export interface ResourceInstallProgress {
    id: string;
    status: 'idle' | 'downloading' | 'verifying' | 'extracting' | 'completed' | 'cancelled' | 'error';
    receivedBytes: number;
    totalBytes: number;
    message: string;
    error?: string;
}
