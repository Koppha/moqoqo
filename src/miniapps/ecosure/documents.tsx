// Documents for quotes and claims: a photo (camera or library) or a PDF, uploaded straight away so the
// customer sees it worked; the form then refers to the upload id.
import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
import * as ImagePicker from 'expo-image-picker'
import { useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import type { EsUploadBody } from '../../../shared/api'
import { errorCode } from '../../lib/api'
import { useT } from '../../i18n'
import { ecosure } from './api'
import { useEsT, type EsStrings } from './strings'
import { es, esType } from './theme'
import { EsIcon, SmallButton } from './ui'

export const MAX_FILE_BYTES = 10 * 1024 * 1024

interface Picked { fileName: string; contentType: EsUploadBody['contentType']; base64: string; size: number }
type How = 'camera' | 'photos' | 'file'
export type DocState = { status: 'uploading' | 'done' | 'error'; fileName: string; id?: string; error?: string }

/** Opens the camera, photo library or file picker. null = cancelled. Throws a user-facing message. */
async function pick(how: How, t: EsStrings): Promise<Picked | null> {
  if (how === 'file') {
    const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/jpeg', 'image/png'], copyToCacheDirectory: true })
    if (r.canceled) return null
    const a = r.assets[0]
    const file = new File(a.uri)
    if ((a.size ?? file.size) > MAX_FILE_BYTES) throw new Error(t.tooLarge)
    const type = a.mimeType === 'image/png' ? 'image/png' : a.mimeType?.startsWith('image/') ? 'image/jpeg' : 'application/pdf'
    return { fileName: a.name, contentType: type, base64: await file.base64(), size: a.size ?? file.size }
  }
  const perm = how === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!perm.granted) throw new Error(how === 'camera' ? t.cameraDenied : t.photosDenied)
  // Quality 0.6 keeps a phone photo of a page readable at a few hundred KB.
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, base64: true, exif: false }
  const r = how === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts)
  if (r.canceled) return null
  const a = r.assets[0]
  if (!a.base64) return null
  const size = Math.floor((a.base64.length * 3) / 4)
  if (size > MAX_FILE_BYTES) throw new Error(t.tooLarge)
  return { fileName: a.fileName ?? `photo-${Date.now()}.jpg`, contentType: a.mimeType === 'image/png' ? 'image/png' : 'image/jpeg', base64: a.base64, size }
}

/** Upload state per document label, and the add / remove actions. */
export function useDocuments() {
  const t = useEsT()
  const tm = useT()
  const [docs, setDocs] = useState<Record<string, DocState>>({})
  const add = async (label: string, how: How) => {
    let file: Picked | null
    try {
      file = await pick(how, t)
    } catch (e) {
      return setDocs((d) => ({ ...d, [label]: { status: 'error', fileName: '', error: (e as Error).message } }))
    }
    if (!file) return
    const picked = file
    setDocs((d) => ({ ...d, [label]: { status: 'uploading', fileName: picked.fileName } }))
    try {
      const up = await ecosure.upload({ fileName: picked.fileName, contentType: picked.contentType, base64: picked.base64 })
      setDocs((d) => ({ ...d, [label]: { status: 'done', fileName: up.fileName, id: up.id } }))
    } catch (e) {
      setDocs((d) => ({ ...d, [label]: { status: 'error', fileName: picked.fileName, error: tm.errors[errorCode(e)] } }))
    }
  }
  const remove = (label: string) => setDocs(({ [label]: _gone, ...rest }) => rest)
  const busy = Object.values(docs).some((d) => d.status === 'uploading')
  return { docs, add, remove, busy }
}

/** One document: add it by camera, photo library or file; then upload progress, the file, or what went wrong. */
export function DocumentRow({ label, required, doc, onAdd, onRemove }: {
  label: string; required: boolean; doc?: DocState; onAdd: (how: How) => void; onRemove: () => void
}) {
  const t = useEsT()
  const done = doc?.status === 'done'
  return (
    <View style={{ gap: 8, paddingVertical: 10, borderTopWidth: 1, borderTopColor: es.divider }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <EsIcon name={done ? 'check' : 'file'} size={18} color={done ? es.success : es.textMuted} />
        <Text style={{ fontSize: 14, fontWeight: '600', color: es.text, flex: 1 }}>{label}{required ? '' : ` ${t.optional}`}</Text>
      </View>
      {!doc || (doc.status === 'error' && !doc.fileName) ? (
        <>
          {doc?.error ? <Text style={[esType.small, { color: es.danger, paddingLeft: 28 }]}>{doc.error}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', paddingLeft: 28 }}>
            <SmallButton label={t.camera} onPress={() => onAdd('camera')} />
            <SmallButton label={t.photos} onPress={() => onAdd('photos')} />
            <SmallButton label={t.file} onPress={() => onAdd('file')} />
          </View>
        </>
      ) : doc.status === 'uploading' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 28 }}>
          <ActivityIndicator size="small" color={es.primary} />
          <Text style={esType.small}>{t.uploading(doc.fileName)}</Text>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 28 }}>
          <Text style={[esType.small, { flex: 1, color: doc.status === 'error' ? es.danger : es.textMuted }]} numberOfLines={2}>
            {doc.status === 'error' ? doc.error : doc.fileName}
          </Text>
          <SmallButton label={doc.status === 'error' ? t.retry : t.replace} onPress={onRemove} />
        </View>
      )}
    </View>
  )
}
