export type InstallableResourceCategory = 'lora' | 'diffusion-model' | 'vae' | 'text-encoder' | 'custom-node';

export interface InstallableResourceSummary {
    id: string;
    name: string;
    category: InstallableResourceCategory;
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
