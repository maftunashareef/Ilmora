'use client'
import { api, isApiError } from '../lib/api'

/**
 * Studio file uploads: the API signs a PUT address in object storage, the browser sends the file there and saves the
 * returned public URL with the item. Without storage the API answers `storage_unavailable` (503; avatars still say
 * `storage_not_configured`), and the upload controls hide themselves.
 */
export type UploadKind = 'course-image' | 'video-thumbnail' | 'banner' | 'avatar' | 'resource-file'

export interface UploadResult {
  publicUrl: string
  key: string
  name: string
  size: number
  mime: string
}

export interface UploadRules {
  /** API route that signs the upload. */
  path: string
  /** Accepted MIME types (the API enforces the same list). */
  types: readonly string[]
  /** Shown to the person as the accepted kinds. */
  extensions: readonly string[]
  maxBytes: number
  preview: 'image' | 'file'
}

const MB = 1024 * 1024
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const RESOURCE_FILE_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'application/x-zip-compressed',
] as const
const IMAGE_EXTENSIONS = ['jpg', 'png', 'webp'] as const

/** Limits mirror the API schemas (ImageUploadUrlInput, ResourceFileUploadUrlInput, AvatarUploadUrlInput). */
export const UPLOAD_RULES: Record<UploadKind, UploadRules> = {
  'course-image': { path: '/manage/uploads/course-image/upload-url', types: IMAGE_TYPES, extensions: IMAGE_EXTENSIONS, maxBytes: 8 * MB, preview: 'image' },
  'video-thumbnail': { path: '/manage/uploads/video-thumbnail/upload-url', types: IMAGE_TYPES, extensions: IMAGE_EXTENSIONS, maxBytes: 8 * MB, preview: 'image' },
  banner: { path: '/manage/uploads/banner/upload-url', types: IMAGE_TYPES, extensions: IMAGE_EXTENSIONS, maxBytes: 8 * MB, preview: 'image' },
  avatar: { path: '/manage/profile/avatar/upload-url', types: IMAGE_TYPES, extensions: IMAGE_EXTENSIONS, maxBytes: 2 * MB, preview: 'image' },
  'resource-file': { path: '/manage/uploads/resource-file/upload-url', types: RESOURCE_FILE_TYPES, extensions: ['pdf', 'docx', 'pptx', 'xlsx', 'zip'], maxBytes: 50 * MB, preview: 'file' },
}

/** The API has no object storage in this environment. */
export const isStorageUnavailable = (err: unknown): boolean => isApiError(err) && (err.code === 'storage_unavailable' || err.code === 'storage_not_configured')

/** Whether files can be uploaded at all (asked once per session, by the first upload control that renders). */
export async function fetchStorageStatus(): Promise<boolean> {
  const r = await api<{ configured: boolean }>('/manage/uploads/status')
  return !!r?.configured
}

/** Signs, uploads and returns the public address; throws the API error (see isStorageUnavailable) or an Error for a failed PUT. */
export async function uploadToStorage(kind: UploadKind, file: File): Promise<UploadResult> {
  const { uploadUrl, publicUrl, key } = await api<{ uploadUrl: string; publicUrl: string; key: string }>(UPLOAD_RULES[kind].path, {
    method: 'POST',
    body: { fileName: file.name, contentType: file.type, fileSize: file.size },
  })
  const put = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'content-type': file.type } })
  if (!put.ok) throw new Error(`upload ${put.status}`)
  return { publicUrl, key, name: file.name, size: file.size, mime: file.type }
}

/** `blob:` addresses exist only in the browser that created them. */
export const isBlobUrl = (url: string | null | undefined): boolean => typeof url === 'string' && /^blob:/i.test(url)

/** A URL the API may store: a real address or null, never a browser-only preview. */
export const storableUrl = (url: string | null | undefined): string | null => (url && !isBlobUrl(url) ? url : null)
