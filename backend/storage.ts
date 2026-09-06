import { invalidRequest } from './errors.js'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export function readJSON(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}
export function optionalJSON(file: string): unknown {
  try {
    return readJSON(file)
  } catch (e) {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT')
      return undefined
    throw e
  }
}
export function atomicWrite(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = file + '.' + randomUUID() + '.tmp'
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 })
    fs.renameSync(temp, file)
  } finally {
    fs.rmSync(temp, { force: true })
  }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw invalidRequest('Expected an object.')
  return value as Record<string, unknown>
}
export function string(value: unknown, label = 'value'): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 120_000)
    throw invalidRequest(`Invalid ${label}.`)
  return value
}
export function uuid(value: unknown): string {
  const id = string(value, 'task or delivery ID')
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)
  )
    throw invalidRequest('Invalid task or delivery ID.')
  return id
}
export function alive(pid: unknown) {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0)
    return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e instanceof Error && 'code' in e && e.code === 'EPERM'
  }
}
