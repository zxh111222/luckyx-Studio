/** Resolve bundled public files in both localhost preview and Electron file URLs. */
export function publicAssetUrl(path: string, documentUrl: string): string {
  if (!/^\/[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(path) || path.split('/').includes('..')) throw new Error('无效的应用资源路径')
  return new URL(path.slice(1), documentUrl).href
}
