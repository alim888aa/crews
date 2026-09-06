import { invalidRequest } from './errors.js'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  type ImageAttachment,
} from '../shared/contracts.js'
import { atomicWrite, readJSON, uuid } from './storage.js'
import { decodeImage } from './schema.js'

export function validateImageIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_IMAGES)
    throw invalidRequest(`Attach up to ${MAX_IMAGES} images per message.`)
  const ids = value.map(uuid)
  if (new Set(ids).size !== ids.length)
    throw invalidRequest('An image was attached twice.')
  return ids
}

/** Owns normalized PNG files. Renderer and message payloads only carry IDs. */
export class Attachments {
  readonly directory: string
  constructor(directory: string) {
    this.directory = path.join(directory, 'attachments')
  }
  file(id: string) {
    const file = path.join(this.directory, uuid(id) + '.png')
    const info = fs.lstatSync(file)
    if (!info.isFile() || info.size > MAX_IMAGE_BYTES)
      throw invalidRequest('Image is unavailable. Attach it again.')
    return file
  }
  resolve(value: unknown): ImageAttachment[] {
    return validateImageIds(value).map((id) => {
      const metadata = path.join(this.directory, id + '.json')
      if (!fs.lstatSync(metadata).isFile())
        throw invalidRequest('Invalid image metadata.')
      const image = decodeImage(readJSON(metadata))
      if (image.id !== id || fs.statSync(this.file(id)).size !== image.size)
        throw invalidRequest('Image is unavailable. Attach it again.')
      return { ...image }
    })
  }
  save(png: Buffer, name: string): ImageAttachment {
    if (
      png.length < 24 ||
      png.length > MAX_IMAGE_BYTES ||
      !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      throw invalidRequest('Choose an image smaller than 10 MB.')
    const image: ImageAttachment = {
      id: randomUUID(),
      name: path.basename(name).slice(0, 200) || 'Screenshot.png',
      mime: 'image/png',
      size: png.length,
      width: png.readUInt32BE(16),
      height: png.readUInt32BE(20),
    }
    decodeImage(image)
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    const file = path.join(this.directory, image.id + '.png')
    try {
      fs.writeFileSync(file, png, { flag: 'wx', mode: 0o600 })
      atomicWrite(path.join(this.directory, image.id + '.json'), image)
      return image
    } catch (error) {
      this.remove(image.id)
      throw error
    }
  }
  remove(id: string) {
    for (const extension of ['png', 'json'])
      fs.rmSync(path.join(this.directory, uuid(id) + '.' + extension), {
        force: true,
      })
  }
}
