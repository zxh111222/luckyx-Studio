import { publicAssetUrl } from '../../shared/public-asset'

/** Keep public images beside index.html when Electron opens it using file://. */
export function assetUrl(path: string): string {
  return publicAssetUrl(path, typeof document === 'undefined' ? 'http://localhost/' : document.baseURI)
}
