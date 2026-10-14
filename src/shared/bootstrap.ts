export interface BootstrapHardware {
    gpuName: string;
    vramMb: number;
    ramGb: number;
    driver: string;
    cudaVersion?: string;
}
export interface BootstrapFile {
    id: string;
    name: string;
    url: string;
    sizeBytes: number;
    sha256: string;
    kind: 'environment' | 'model' | 'node';
    relativePath: string;
    archiveRoot?: string;
}
export type H3InstallationTier = 'lite' | 'balanced' | 'standard' | 'environment';
export interface H3InstallationRecommendation {
    tier: H3InstallationTier;
    label: string;
    source: 'official' | 'community';
    reason: string;
    warnings: string[];
    modelNames: string[];
    requiredNodes: string[];
    launchArgs: string[];
    defaults: { width: number; height: number; frames: number; steps: number; fps: number; audio: boolean };
}
export interface BootstrapPlan {
    profile: 'environment' | 'h3';
    id: string;
    version: string;
    rootPath: string;
    targetPath: string;
    downloadBytes: number;
    cachedBytes?: number;
    requiredFreeBytes: number;
    freeBytes: number;
    hardwareIssues: string[];
    recommendation: H3InstallationRecommendation;
    files: BootstrapFile[];
    tutorialUrl: string;
    runtime?: BootstrapRuntime;
}
export interface BootstrapRuntime {
    id: 'cu130' | 'cu126';
    label: string;
    cudaVersion: '13.0' | '12.6';
    compatibility: 'supported' | 'conditional' | 'driver-update-required' | 'unknown' | 'unsupported';
    reason: string;
    warnings: string[];
    driverUrl: string;
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
    plan?: BootstrapPlan;
    resumable?: boolean;
}
