export const directions = ['静谧工作室', '银灰画廊', '专业控制台'] as const
export const STORAGE_KEY = 'luckyx.prototype.home.v1'
export type Draft = { id: string; title: string; prompt: string; mode: string; resolution: string; duration: string; createdAt: string }
export type ImportedWorkflow = { name: string; nodes: number; format: string }
export type PrototypeData = { drafts: Draft[]; imports: ImportedWorkflow[] }
export function selectedVariant(search: string): number {
  const value = Number(new URLSearchParams(search).get('v'))
  return Number.isInteger(value) && value >= 1 && value <= directions.length ? value - 1 : 0
}
export function readPrototypeData(json: string | null): PrototypeData {
  try {
    const data = JSON.parse(json || '{}')
    return {
      drafts: Array.isArray(data.drafts) ? data.drafts.filter((d: Draft) => d && typeof d.id === 'string' && typeof d.title === 'string' && typeof d.prompt === 'string' && typeof d.createdAt === 'string').slice(0, 30) : [],
      imports: Array.isArray(data.imports) ? data.imports.filter((d: ImportedWorkflow) => d && typeof d.name === 'string' && Number.isInteger(d.nodes) && d.nodes >= 0 && typeof d.format === 'string').slice(0, 30) : []
    }
  } catch { return { drafts: [], imports: [] } }
}
