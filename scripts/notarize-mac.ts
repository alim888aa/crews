import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const release = path.join(root, 'release')
const app = path.join(release, 'Crews.app')
const identity = process.env.CREWS_SIGNING_IDENTITY
const profile = process.env.CREWS_NOTARY_PROFILE
if (process.platform !== 'darwin')
  throw new Error('Notarization requires macOS.')
if (!identity || !identity.startsWith('Developer ID Application:'))
  throw new Error(
    'Set CREWS_SIGNING_IDENTITY to your Developer ID Application certificate name.',
  )
if (!profile)
  throw new Error(
    'Set CREWS_NOTARY_PROFILE to your notarytool Keychain profile name.',
  )
const keychainProfile = profile
const run = (command: string, args: string[]) =>
  execFileSync(command, args, { cwd: root, stdio: 'inherit' })
const digest = (file: string) =>
  createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const json = (args: string[]): unknown =>
  JSON.parse(
    execFileSync(
      '/usr/bin/xcrun',
      [
        'notarytool',
        ...args,
        '--keychain-profile',
        keychainProfile,
        '--output-format',
        'json',
      ],
      { encoding: 'utf8', cwd: root },
    ),
  )
function notarize(archive: string, label: string) {
  const receipt = path.join(release, `notarization-${label}.json`)
  const sha256 = digest(archive)
  let submission: unknown = fs.existsSync(receipt)
    ? JSON.parse(fs.readFileSync(receipt, 'utf8'))
    : null
  if (
    !submission ||
    typeof submission !== 'object' ||
    !('sha256' in submission) ||
    submission.sha256 !== sha256
  ) {
    submission = json(['submit', archive, '--no-wait'])
    if (
      !submission ||
      typeof submission !== 'object' ||
      !('id' in submission) ||
      typeof submission.id !== 'string'
    )
      throw new Error(
        'Apple did not return a submission ID. Check notarytool history before retrying.',
      )
    submission = { ...submission, sha256 }
    fs.writeFileSync(receipt, JSON.stringify(submission, null, 2))
  }
  if (
    !submission ||
    typeof submission !== 'object' ||
    !('id' in submission) ||
    typeof submission.id !== 'string'
  )
    throw new Error(`Invalid notarization receipt: ${receipt}`)
  console.log(`Apple submission ${submission.id}; receipt saved to ${receipt}`)
  spawnSync(
    '/usr/bin/xcrun',
    [
      'notarytool',
      'wait',
      submission.id,
      '--keychain-profile',
      keychainProfile,
      '--timeout',
      '15m',
    ],
    { stdio: 'inherit' },
  )
  // Read the authoritative status even when wait exits for a timeout or rejection.
  const result = json(['info', submission.id])
  if (
    result &&
    typeof result === 'object' &&
    'status' in result &&
    result.status === 'In Progress'
  ) {
    throw new Error(
      'Apple is still processing. Run npm run package:notarized -- --resume to continue without uploading again.',
    )
  }
  if (
    !result ||
    typeof result !== 'object' ||
    !('status' in result) ||
    result.status !== 'Accepted'
  ) {
    run('/usr/bin/xcrun', [
      'notarytool',
      'log',
      submission.id,
      '--keychain-profile',
      keychainProfile,
      path.join(release, `notarization-${label}-log.json`),
    ])
    throw new Error(
      `Apple did not accept ${label}. See the notarization log in release/.`,
    )
  }
  fs.writeFileSync(
    receipt,
    JSON.stringify({ ...submission, status: 'Accepted' }, null, 2),
  )
}

// Resume keeps the exact previously uploaded archives and submission receipts.
const resume = process.argv.includes('--resume')
if (!resume) {
  run('npm', ['run', 'package:mac'])
  fs.rmSync(path.join(release, 'notarization-dmg.json'), { force: true })
  run('/usr/bin/ditto', [
    '-c',
    '-k',
    '--keepParent',
    app,
    path.join(release, 'Crews-notary.zip'),
  ])
}
notarize(path.join(release, 'Crews-notary.zip'), 'app')
run('/usr/bin/xcrun', ['stapler', 'staple', app])
run('/usr/bin/xcrun', ['stapler', 'validate', app])
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app])
run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', app])
const { version } = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
)
const arch = execFileSync(
  '/usr/bin/lipo',
  ['-archs', path.join(app, 'Contents/MacOS/Electron')],
  { encoding: 'utf8' },
).trim()
const name = `Crews-${version}-${arch}.dmg`
const dmg = path.join(release, name)
const dmgReceipt = path.join(release, 'notarization-dmg.json')
if (!resume || !fs.existsSync(dmgReceipt)) {
  run(process.execPath, [
    '--import',
    'tsx',
    'scripts/dmg-mac.ts',
    '--notarized',
  ])
  run('/usr/bin/codesign', ['--force', '--sign', identity, '--timestamp', dmg])
}
notarize(dmg, 'dmg')
run('/usr/bin/xcrun', ['stapler', 'staple', dmg])
run('/usr/bin/xcrun', ['stapler', 'validate', dmg])
run('/usr/bin/hdiutil', ['verify', dmg])
fs.writeFileSync(
  path.join(release, 'SHA256SUMS.txt'),
  `${digest(dmg)}  ${name}\n`,
)
console.log(`Signed and notarized download ready: ${dmg}`)
