import { dialog, nativeImage, protocol, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { Room } from '../backend/room.js'
import { Attachments } from '../backend/attachments.js'
import { object, string, uuid } from '../backend/storage.js'
import {
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  type ImageAttachment,
} from '../shared/contracts.js'

export function importImage(store: Attachments, value: unknown) {
  const v = object(value)
  const name = string(v.name, 'image name')
  if (
    !(v.bytes instanceof Uint8Array) ||
    !v.bytes.length ||
    v.bytes.length > MAX_IMAGE_BYTES
  )
    throw new Error('Choose an image smaller than 10 MB.')
  const bytes = Buffer.from(v.bytes)
  const png = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  const webp =
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  if (!png && !jpeg && !webp)
    throw new Error('Choose a PNG, JPEG or WebP image.')
  const decoded = nativeImage.createFromBuffer(bytes)
  const { width, height } = decoded.getSize()
  if (decoded.isEmpty() || width * height > 40_000_000)
    throw new Error(
      'That image cannot be opened, or is too large. Try a smaller screenshot.',
    )
  return store.save(decoded.toPNG(), name)
}

export function registerImageHandlers(
  room: Room,
  window: BrowserWindow,
  handle: (channel: string, fn: (payload: unknown) => unknown) => void,
) {
  const store = new Attachments(room.directory)
  protocol.handle('crew-image', (request) => {
    try {
      const url = new URL(request.url)
      if (
        request.method !== 'GET' ||
        url.host !== 'image' ||
        url.search ||
        url.hash
      )
        return new Response(null, { status: 400 })
      const file = store.file(url.pathname.slice(1))
      return new Response(new Uint8Array(fs.readFileSync(file)), {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
      })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
  handle('room:image-import', (value) => importImage(store, value))
  handle('room:image-pick', async () => {
    const result = await dialog.showOpenDialog(window, {
      title: 'Attach images',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    })
    if (result.canceled) return []
    if (result.filePaths.length > MAX_IMAGES)
      throw new Error(`Choose up to ${MAX_IMAGES} images.`)
    const images: ImageAttachment[] = []
    try {
      for (const file of result.filePaths) {
        if (fs.statSync(file).size > MAX_IMAGE_BYTES)
          throw new Error('Choose an image smaller than 10 MB.')
        images.push(
          importImage(store, {
            name: path.basename(file),
            bytes: fs.readFileSync(file),
          }),
        )
      }
      return images
    } catch (error) {
      images.forEach((image) => store.remove(image.id))
      throw error
    }
  })
  handle('room:image-remove', (value) => {
    const id = uuid(value)
    if (
      !room.state.messages.some((m) => m.attachments?.some((a) => a.id === id))
    )
      store.remove(id)
  })
}
