import type { Asset, AssetKind } from '../../shared/api'
import { api, API_URL } from './api'

/** Reads a picture the admin picked and uploads it. Throws a readable message for the wrong file type. */
export async function uploadPicture(file: File, kind: AssetKind): Promise<Asset> {
  if (file.type !== 'image/png' && file.type !== 'image/jpeg') throw new Error('Choose a PNG or JPEG picture')
  const base64 = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^;,]+;base64,/, ''))
    r.onerror = () => reject(new Error("Couldn't read the file"))
    r.readAsDataURL(file)
  })
  return api.branding.upload({ kind, contentType: file.type, base64, fileName: file.name })
}

/** Full URL of an asset path (/v1/assets/…) for <img>. */
export const assetUrl = (path: string) => `${API_URL}${path}`
