import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'
import type { Me } from '../../shared/api'
import { api } from './api'

/** Profile pictures are stored at this size: sharp on any avatar, small to send (about 50 KB). */
const SIDE = 512

/**
 * Me › profile picture: take or pick a photo, crop it square, shrink it, and upload it.
 * Returns the updated person; null when cancelled; 'denied' without camera or photos permission.
 */
export async function chooseProfilePhoto(how: 'camera' | 'photos'): Promise<Me | null | 'denied'> {
  const perm = how === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!perm.granted) return 'denied'
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1, exif: false }
  const r = how === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts)
  const a = r.canceled ? undefined : r.assets[0]
  if (!a) return null
  // The editor's crop isn't always square on Android: take the middle square, then shrink it.
  const side = Math.min(a.width, a.height)
  const ctx = ImageManipulator.manipulate(a.uri)
  ctx.crop({ originX: Math.floor((a.width - side) / 2), originY: Math.floor((a.height - side) / 2), width: side, height: side })
  ctx.resize({ width: SIDE, height: SIDE })
  const out = await (await ctx.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true })
  return api<Me>('/v1/me/photo', { method: 'PUT', body: { contentType: 'image/jpeg', base64: out.base64 } })
}

export const removeProfilePhoto = () => api<Me>('/v1/me/photo', { method: 'DELETE' })
