import { build, transform } from 'esbuild'
import fs from 'node:fs'
fs.mkdirSync('build', { recursive: true })
await build({
  entryPoints: ['electron/main.ts'],
  outfile: 'build/main.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['electron'],
})
await build({
  entryPoints: ['backend/cli.ts'],
  outfile: 'build/cli.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
})
await build({
  entryPoints: ['backend/context-hook.ts'],
  outfile: 'build/context-hook.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
})
await build({
  entryPoints: ['electron/preload.ts'],
  outfile: 'build/preload.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
})
const dispatcher = await transform(
  fs.readFileSync('backend/relay-turn.ts', 'utf8'),
  { loader: 'ts', target: 'es2023' },
)
fs.writeFileSync('build/relay-turn.js', dispatcher.code)
