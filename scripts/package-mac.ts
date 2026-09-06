import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

if (process.platform !== 'darwin')
  throw new Error('Build the Mac app on macOS.')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'release', 'Crews.app')
// Resolving Electron also installs its binary on a fresh npm checkout.
const executable: unknown = createRequire(import.meta.url)('electron')
if (typeof executable !== 'string')
  throw new Error('Electron did not provide an executable path.')
const binary = path.resolve(executable, '../../..')
fs.mkdirSync(path.dirname(output), { recursive: true })
// This directory contains build output only. The configured message store is separate.
fs.rmSync(output, { recursive: true, force: true })
execFileSync('/usr/bin/ditto', [binary, output])
const resources = path.join(output, 'Contents', 'Resources')
fs.rmSync(path.join(resources, 'default_app.asar'), { force: true })
const bundle = path.join(resources, 'app')
fs.mkdirSync(bundle, { recursive: true })
for (const file of ['dist', 'build'])
  fs.cpSync(path.join(root, file), path.join(bundle, file), { recursive: true })
for (const notice of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  const source = path.join(root, notice)
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(bundle, notice))
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
fs.writeFileSync(
  path.join(bundle, 'package.json'),
  JSON.stringify(
    {
      name: pkg.name,
      productName: 'Crews',
      version: pkg.version,
      type: 'module',
      main: pkg.main,
    },
    null,
    2,
  ),
)
const plist = path.join(output, 'Contents', 'Info.plist')
for (const [key, value] of Object.entries({
  CFBundleName: 'Crews',
  CFBundleDisplayName: 'Crews',
  CFBundleIdentifier: 'local.crews.desktop',
  CFBundleShortVersionString: pkg.version,
  CFBundleVersion: pkg.version,
})) {
  execFileSync('/usr/bin/plutil', ['-replace', key, '-string', value, plist])
}
const frameworks = path.join(output, 'Contents', 'Frameworks')
for (const helper of fs
  .readdirSync(frameworks)
  .filter((name) => name.endsWith('.app'))) {
  const helperPlist = path.join(frameworks, helper, 'Contents', 'Info.plist')
  const name = helper.replace(/\.app$/, '').replace('Electron', 'Crews')
  execFileSync('/usr/bin/plutil', [
    '-replace',
    'CFBundleDisplayName',
    '-string',
    name,
    helperPlist,
  ])
  execFileSync('/usr/bin/plutil', [
    '-replace',
    'CFBundleIdentifier',
    '-string',
    'local.crews.' + name.toLowerCase().replace(/[^a-z0-9]/g, ''),
    helperPlist,
  ])
}
execFileSync(
  '/usr/bin/codesign',
  ['--force', '--deep', '--sign', '-', output],
  { stdio: 'inherit' },
)
console.log(output)
