import { invalidRequest } from './errors.js'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { object, optionalJSON, string } from './storage.js'
export const supportDirectory = () =>
  path.join(os.homedir(), 'Library', 'Application Support', 'Crews')
export const codexHooksFile = () =>
  path.join(
    process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
    'hooks.json',
  )
export function dataDirectory() {
  return process.env.CREWS_DATA || path.join(supportDirectory(), 'data')
}
export function runtimeDirectory() {
  return (
    process.env.CREWS_RUNTIME ||
    (process.env.CREWS_DATA
      ? path.join(process.env.CREWS_DATA, 'runtime')
      : path.join(supportDirectory(), 'runtime'))
  )
}
export function runtimeConfig() {
  const config = object(
    optionalJSON(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'runtime.json'),
    ),
  )
  const command = config.nodeCommand
  if (!Array.isArray(command) || !command.every((v) => typeof v === 'string'))
    throw invalidRequest('Invalid runtime executable.')
  return {
    directory: string(config.directory),
    nodeCommand: command as string[],
  }
}
export const quote = (value: string) =>
  "'" + value.replaceAll("'", "'\\''") + "'"
export const shellCommand = (parts: string[]) => parts.map(quote).join(' ')
export function runtimeCommand(
  runtime: string,
  executable: string[],
  ...args: string[]
) {
  return shellCommand([...executable, path.join(runtime, 'cli.mjs'), ...args])
}
