import type { WorkflowFormat } from './contracts';
export const MAX_WORKFLOW_BYTES = 5 * 1024 * 1024;
export const MAX_WORKFLOW_NODES = 2000;
export interface ParsedWorkflow {
    format: WorkflowFormat;
    nodeCount: number;
    graph: Record<string, unknown>;
}
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function identifier(value: unknown): value is string | number { return typeof value === 'number' ? Number.isSafeInteger(value) && value >= 0 : typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\x00-\x1f]/.test(value); }
function safeStructure(root: unknown) {
    const pending: {
        value: unknown;
        depth: number;
    }[] = [{ value: root, depth: 0 }];
    let visited = 0;
    while (pending.length) {
        const { value, depth } = pending.pop()!;
        if (++visited > 100000)
            throw new Error('工作流结构过于复杂');
        if (depth > 64)
            throw new Error('工作流嵌套不能超过 64 层');
        if (typeof value === 'number' && !Number.isFinite(value))
            throw new Error('工作流包含无效数字');
        if (value !== null && typeof value === 'object') {
            for (const [key, child] of Object.entries(value)) {
                if (forbiddenKeys.has(key))
                    throw new Error('工作流包含不安全的结构字段');
                pending.push({ value: child, depth: depth + 1 });
            }
        }
    }
}
export function validateWorkflowName(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 80 || /[\x00-\x1f\x7f]/.test(value))
        throw new Error('工作流名称须为 1–80 字符，不能包含控制字符');
    return value.trim();
}
export function parseWorkflowJson(json: string): ParsedWorkflow {
    if (typeof json !== 'string' || json.length > MAX_WORKFLOW_BYTES || new TextEncoder().encode(json).byteLength > MAX_WORKFLOW_BYTES)
        throw new Error('工作流 JSON 文件不能超过 5 MiB');
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    }
    catch {
        throw new Error('文件不是有效的 JSON');
    }
    if (!record(parsed))
        throw new Error('工作流根结构必须为 JSON 对象');
    safeStructure(parsed);
    if ('nodes' in parsed || 'links' in parsed) {
        if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.links))
            throw new Error('原生工作流须包含 nodes 和 links 数组');
        if (parsed.version !== undefined && parsed.version !== 0.4 && parsed.version !== 1)
            throw new Error('仅支持 ComfyUI 0.4 或 1 版本的原生工作流');
        if (parsed.nodes.length > MAX_WORKFLOW_NODES)
            throw new Error('工作流不能超过 2000 个节点');
        if (parsed.links.length > 20000)
            throw new Error('工作流连接数量过多');
        const ids = new Set<string>();
        for (const node of parsed.nodes) {
            if (!record(node) || !identifier(node.id) || typeof node.type !== 'string' || !node.type.trim() || node.type.length > 512)
                throw new Error('原生工作流包含无效节点');
            if (ids.has(String(node.id)))
                throw new Error('工作流节点编号不能重复');
            ids.add(String(node.id));
        }
        const linkIds = new Set<string>();
        for (const link of parsed.links) {
            let id: unknown, origin: unknown, target: unknown, originSlot: unknown, targetSlot: unknown;
            if (Array.isArray(link) && link.length === 6)
                [id, origin, originSlot, target, targetSlot] = link;
            else if (record(link)) {
                id = link.id;
                origin = link.origin_id;
                originSlot = link.origin_slot;
                target = link.target_id;
                targetSlot = link.target_slot;
            }
            else
                throw new Error('工作流包含无效连接');
            if (!identifier(id) || !identifier(origin) || !identifier(target) || !Number.isSafeInteger(originSlot) || (originSlot as number) < 0 || !Number.isSafeInteger(targetSlot) || (targetSlot as number) < 0)
                throw new Error('工作流连接编号或槽位无效');
            if (!ids.has(String(origin)) || !ids.has(String(target)))
                throw new Error('工作流连接指向不存在的节点');
            if (linkIds.has(String(id)))
                throw new Error('工作流连接编号不能重复');
            linkIds.add(String(id));
        }
        return { format: 'ui', nodeCount: parsed.nodes.length, graph: parsed };
    }
    const entries = Object.entries(parsed);
    if (!entries.length)
        throw new Error('API 工作流不能为空');
    if (entries.length > MAX_WORKFLOW_NODES)
        throw new Error('工作流不能超过 2000 个节点');
    for (const [id, node] of entries) {
        if (!identifier(id) || !record(node) || typeof node.class_type !== 'string' || !node.class_type.trim() || node.class_type.length > 512 || !record(node.inputs))
            throw new Error('文件不是有效的 ComfyUI 原生或 API 工作流');
    }
    return { format: 'api', nodeCount: entries.length, graph: parsed };
}
export function createEmptyWorkflowJson(): string {
    return JSON.stringify({ last_node_id: 0, last_link_id: 0, nodes: [], links: [], groups: [], config: {}, extra: {}, version: 0.4 }, null, 2);
}
