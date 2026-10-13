export interface Settings {
    installationPath: string;
    modelPath: string;
    outputPath: string;
    inputPath: string;
    engineUrl: string;
    initialized: boolean;
}
export interface EngineState {
    status: 'offline' | 'starting' | 'ready' | 'busy' | 'error';
    managed: boolean;
    queue: number;
    message: string;
    version?: string;
    pid?: number;
}
export interface Hardware {
    gpuName: string;
    vramMb: number;
    ramGb: number;
    driver: string;
}
export interface GenerationParams {
    prompt: string;
    width: number;
    height: number;
    frames: number;
    steps: number;
    seed: number;
    templateId: string;
    image?: {
        name: string;
        dataBase64: string;
    };
}
export interface WorkflowTemplate {
    id: string;
    name: string;
    description: string;
    ready: boolean;
    issues: string[];
    models: string[];
    resolutions: {
        label: string;
        width: number;
        height: number;
    }[];
    defaultSteps: number;
    frames: number;
    fps: number;
}
export interface OutputFile {
    filename: string;
    subfolder: string;
    type: string;
    url: string;
}
export type TaskStatus = 'submitting' | 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'unknown';
export interface TaskRecord {
    id: string;
    promptId?: string;
    title: string;
    status: TaskStatus;
    createdAt: string;
    updatedAt: string;
    params: GenerationParams;
    stage: string;
    error?: string;
    progress?: {
        value: number;
        max: number;
        node?: string;
    };
    outputs: OutputFile[];
    inputImage?: string;
}
export interface Resource {
    id: string;
    name: string;
    path: string;
    sizeBytes: number;
    status: 'installed' | 'missing';
    kind: 'model' | 'environment' | 'node';
}
export interface LogEntry {
    at: string;
    level: 'info' | 'warn' | 'error';
    message: string;
}
export interface Preset {
    id: string;
    name: string;
    params: GenerationParams;
}
export interface Snapshot {
    settings: Settings;
    engine: EngineState;
    hardware: Hardware;
    templates: WorkflowTemplate[];
    tasks: TaskRecord[];
    resources: Resource[];
    logs: LogEntry[];
    presets: Preset[];
}
export interface StudioService {
    invoke(command: string, payload?: unknown): Promise<unknown>;
    subscribe(listener: (snapshot: Snapshot) => void): () => void;
    resolveMedia(taskId: string, index: number): Promise<{
        url: string;
        filename: string;
    }>;
    dispose(): Promise<void>;
}
