export interface BootstrapHardware {
    gpuName: string;
    vramMb: number;
    ramGb: number;
    driver: string;
}
export interface BootstrapFile {
    id: string;
    name: string;
    url: string;
    sizeBytes: number;
    sha256: string;
    kind: 'environment' | 'model';
    relativePath: string;
}
export interface BootstrapPlan {
    profile: 'environment' | 'h3';
    id: string;
    version: string;
    rootPath: string;
    targetPath: string;
    downloadBytes: number;
    requiredFreeBytes: number;
    freeBytes: number;
    hardwareIssues: string[];
    files: BootstrapFile[];
    tutorialUrl: string;
}
export type BootstrapStatus = 'idle' | 'planning' | 'downloading' | 'verifying' | 'extracting' | 'completed' | 'cancelled' | 'error';
export interface BootstrapState {
    status: BootstrapStatus;
    phase: string;
    message: string;
    receivedBytes: number;
    totalBytes: number;
    completedFiles: number;
    currentFile?: string;
    installationPath?: string;
    error?: string;
    tutorialUrl: string;
}
