import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

if (process.platform !== 'darwin')
  throw new Error('Build the Mac download on macOS.')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const release = path.join(root, 'release')
const app = path.join(release, 'Crews.app')
const { version } = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
)
const binary = path.join(app, 'Contents/MacOS/Electron')
const architecture = execFileSync('/usr/bin/lipo', ['-archs', binary], {
  encoding: 'utf8',
}).trim()
if (!['arm64', 'x86_64'].includes(architecture))
  throw new Error('Expected a single-architecture Mac build.')
const name = `Crews-${version}-${architecture}.dmg`
const output = path.join(release, name)
const notarized = process.argv.includes('--notarized')
if (notarized) {
  execFileSync('/usr/bin/xcrun', ['stapler', 'validate', app], {
    stdio: 'inherit',
  })
}
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'crews-dmg-'))
try {
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app])
  execFileSync('/usr/bin/ditto', [app, path.join(staging, 'Crews.app')])
  fs.symlinkSync('/Applications', path.join(staging, 'Applications'))
  fs.writeFileSync(
    path.join(staging, 'Install.txt'),
    `Crews — Slack for your Codex threads.\n\nDrag Crews.app onto Applications, then eject this disk and open Crews from Applications.\n\n${notarized ? '' : "This early alpha is not Apple-notarized. macOS may block its first launch. If you trust this download, follow Apple's per-app Open Anyway flow in System Settings > Privacy & Security.\nhttps://support.apple.com/102445\n\n"}Requires macOS 13 or later and the Codex desktop app. This download is for ${architecture === 'arm64' ? 'Apple Silicon' : 'Intel'} Macs.\n`,
  )
  execFileSync(
    '/usr/bin/hdiutil',
    [
      'create',
      '-volname',
      'Crews',
      '-srcfolder',
      staging,
      '-format',
      'UDZO',
      '-ov',
      output,
    ],
    { stdio: 'inherit' },
  )
  const digest = createHash('sha256')
    .update(fs.readFileSync(output))
    .digest('hex')
  fs.writeFileSync(path.join(release, 'SHA256SUMS.txt'), `${digest}  ${name}\n`)
  console.log(output)
} finally {
  fs.rmSync(staging, { recursive: true, force: true })
}
