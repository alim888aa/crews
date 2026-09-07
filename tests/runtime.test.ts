import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { Effect, Fiber } from 'effect'
import vm from 'node:vm'
import { Room } from '../backend/room.js'
import { atomicWrite } from '../backend/storage.js'
import { installRuntime } from '../backend/runtime.js'
import { shellCommand } from '../backend/paths.js'
import { claimBatch } from '../backend/relay.js'
const exec = promisify(execFile)
function fixture(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crew runtime ' ")),
    runtime = path.join(dir, 'helpers')
  installRuntime(path.resolve('build'), runtime, dir, [process.execPath])
  const room = new Room(dir),
    watcher = Effect.runFork(room.watch())
  t.after(async () => {
    await Effect.runPromise(Fiber.interrupt(watcher))
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return { dir, runtime, room, cli: path.join(runtime, 'cli.mjs') }
}
test('built helper performs real setup and connection receipt through the app loop', async (t) => {
  const { room, cli } = fixture(t),
    relay = randomUUID(),
    worker = randomUUID()
  let r = await exec(process.execPath, [
    cli,
    'register',
    relay,
    'test-automation',
    room.state.relay.token,
  ])
  assert.equal(JSON.parse(r.stdout).accepted, true)
  room.receive({
    kind: 'catalog',
    tasks: [
      {
        id: worker,
        title: 'My existing task',
        updatedAt: Date.now(),
        cwd: '/project',
      },
    ],
  })
  room.add({ id: worker, title: 'Worker', handle: 'worker' })
  const w = room.beginApproval(worker)
  r = await exec(process.execPath, [cli, 'connect', worker, w.token])
  assert.equal(JSON.parse(r.stdout).accepted, true)
  assert.equal(room.state.workers[0]!.connection, 'connected')
  await assert.rejects(
    exec(process.execPath, [cli, 'connect', worker, randomUUID()]),
  )
})
test('built helper publishes one accepted reply, then deduplicates the same delivery', async (t) => {
  const { dir, runtime, room, cli } = fixture(t),
    worker = randomUUID()
  room.receive({
    kind: 'relay',
    taskId: randomUUID(),
    automationId: 'test',
    token: room.state.relay.token,
  })
  room.receive({
    kind: 'catalog',
    tasks: [{ id: worker, title: 'Worker', updatedAt: 1, cwd: '' }],
  })
  room.add({ id: worker, title: 'Worker', handle: 'worker' })
  const w = room.beginApproval(worker)
  await exec(process.execPath, [cli, 'connect', worker, w.token])
  room.send({ text: '@worker test', parentId: null })
  const [job] = claimBatch(dir, runtime, [process.execPath])
  assert.ok(job)
  const taken = await exec(process.execPath, [
    cli,
    'take',
    worker,
    job.deliveryId,
  ])
  assert.equal(JSON.parse(taken.stdout).messages[0].text, '@worker test')
  assert.equal(typeof room.state.deliveries[0]!.startedAt, 'number')
  assert.equal(room.snapshot().workers[0]!.presence, 'working')
  async function reply() {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, [
        cli,
        'reply',
        worker,
        job!.deliveryId,
      ])
      let out = '',
        err = ''
      child.stdout.on('data', (c) => (out += String(c)))
      child.stderr.on('data', (c) => (err += String(c)))
      child.on('error', reject)
      child.on('close', (code) =>
        code === 0 ? resolve(out) : reject(new Error(err)),
      )
      child.stdin.end(
        JSON.stringify({ text: 'Real child process reply', to: [] }),
      )
    })
  }
  assert.equal(JSON.parse(await reply()).accepted, true)
  assert.equal(JSON.parse(await reply()).completed, true)
  assert.equal(room.state.messages.filter((m) => m.kind === 'reply').length, 1)
})
test('interrupting an Effect listener releases its lock for the next start', async (t) => {
  const { dir, room, cli } = fixture(t)
  room.receive({
    kind: 'relay',
    taskId: randomUUID(),
    automationId: 'test',
    token: room.state.relay.token,
  })
  room.receive({ kind: 'catalog', tasks: [] })
  atomicWrite(path.join(dir, 'host.json'), { running: true, pid: process.pid })
  const child = spawn(process.execPath, [cli, 'next'], { stdio: 'ignore' })
  t.after(() => child.kill())
  for (
    let i = 0;
    i < 50 && !fs.existsSync(path.join(dir, 'listener.json'));
    i++
  )
    await new Promise((r) => setTimeout(r, 20))
  assert.ok(fs.existsSync(path.join(dir, 'listener.json')))
  await assert.rejects(exec(process.execPath, [cli, 'next']))
  const closed = new Promise((resolve) => child.once('close', resolve))
  child.kill('SIGTERM')
  await closed
  assert.equal(fs.existsSync(path.join(dir, 'listener.json')), false)
  atomicWrite(path.join(dir, 'host.json'), { running: false, pid: process.pid })
  const result = await exec(process.execPath, [cli, 'next'])
  assert.equal(JSON.parse(result.stdout).stopped, true)
})
test('dispatcher passes prompts byte-for-byte and never auto-retries an uncertain send', async () => {
  const job = {
    deliveryId: randomUUID(),
    threadId: randomUUID(),
    prompt: "literal `$(whoami)` ' quotes\nmessage",
  }
  const commands: string[] = [],
    sent: unknown[] = []
  const tools = {
    exec_command: async ({ cmd }: { cmd: string }) => {
      commands.push(cmd)
      return {
        exit_code: 0,
        output:
          'startup diagnostic\n' +
          JSON.stringify(
            cmd.endsWith("'next' 'compact'") ? { jobs: [job] } : { ok: true },
          ),
      }
    },
    mcp__codex_app__send_message_to_thread: async (value: unknown) => {
      sent.push(value)
      throw new Error('connection lost after send')
    },
  }
  const source =
    'const crewRelayCommand = "cli";\n' +
    fs.readFileSync('build/relay-turn.js', 'utf8')
  await vm.runInNewContext(source, { tools, text: () => {} })
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [
    { threadId: job.threadId, prompt: job.prompt },
  ])
  assert.ok(commands.at(-1)!.includes("'uncertain'"))
  assert.equal(sent.length, 1)
})
test('native catalog combines pinned tasks and normalizes timestamps', async () => {
  let catalogCommand = ''
  const a = randomUUID(),
    b = randomUUID()
  const tools = {
    exec_command: async ({ cmd }: { cmd: string }) => {
      if (cmd.includes("'catalog'")) catalogCommand = cmd
      return {
        exit_code: 0,
        output: JSON.stringify(
          cmd.endsWith("'next' 'compact'")
            ? { refreshCatalog: true }
            : { accepted: true },
        ),
      }
    },
    mcp__codex_app__list_threads: async () => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            pinnedThreads: [
              {
                id: a,
                title: 'Pinned',
                kind: 'codex',
                hostId: 'local',
                updatedAt: 100,
              },
            ],
            threads: [
              {
                id: b,
                title: 'Recent',
                kind: 'codex',
                hostId: 'local',
                updatedAt: 2000000000000,
              },
              {
                id: randomUUID(),
                title: 'Cloud',
                kind: 'chatgpt',
                updatedAt: 9999999999999,
              },
            ],
          }),
        },
      ],
    }),
  }
  await vm.runInNewContext(
    'const crewRelayCommand = "cli";\n' +
      fs.readFileSync('build/relay-turn.js', 'utf8'),
    { tools, text: () => {} },
  )
  assert.ok(catalogCommand.includes('100000'))
  assert.ok(catalogCommand.includes('2000000000000'))
  assert.ok(!catalogCommand.includes('Cloud'))
})
test('quoted executable arguments preserve shell syntax literally', async () => {
  const parts = ["a'b", '$(printf WRONG)', '`printf WRONG`', 'a\nb']
  const cmd = shellCommand([
    process.execPath,
    '-e',
    'console.log(JSON.stringify(process.argv.slice(1)))',
    ...parts,
  ])
  const result = await exec('/bin/sh', ['-c', cmd])
  assert.deepEqual(JSON.parse(result.stdout), parts)
})

test('Effect failures preserve the actionable message for the UI', async () => {
  const { attempt, invalidRequest } = await import('../backend/errors.js')
  await assert.rejects(
    Effect.runPromise(
      attempt('validate teammate', () => {
        throw invalidRequest('That @name is already taken.')
      }),
    ),
    /That @name is already taken/,
  )
})

test('dispatcher requests supported approval only when explicitly enabled by the relay', async () => {
  const calls: Record<string, unknown>[] = []
  const tools = {
    exec_command: async (args: Record<string, unknown>) => {
      calls.push(args)
      return { exit_code: 0, output: '{"stopped":true}' }
    },
  }
  const source = fs.readFileSync('build/relay-turn.js', 'utf8')
  await vm.runInNewContext('const crewRelayCommand="cli";\n' + source, {
    tools,
    text: () => {},
  })
  assert.equal(calls[0]!.sandbox_permissions, undefined)
  await vm.runInNewContext(
    'const crewRelayCommand="cli"; const crewRelayApproval=true;\n' + source,
    { tools, text: () => {} },
  )
  assert.equal(calls[1]!.sandbox_permissions, 'require_escalated')
  assert.equal(calls[1]!.cmd, calls[0]!.cmd)
  assert.ok(
    String(calls[1]!.justification).includes('authorized local room data'),
  )
})

test('setup starts its dispatcher in the current turn after the model self-message', (t) => {
  const { runtime } = fixture(t)
  const setup = fs.readFileSync(path.join(runtime, 'SETUP.md'), 'utf8')
  assert.ok(setup.includes('does not guarantee a later turn'))
  assert.ok(setup.includes('execute its fresh dispatcher loader in this turn'))
  const guide = fs.readFileSync(path.join(runtime, 'RELAY.md'), 'utf8')
  assert.ok(guide.includes('Do not use this option under policy Never'))
  assert.ok(guide.includes('after an unresolved approval rejection'))
})

test('a reply queued while the app is closed is accepted once after reopening', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-closed-'))
  const runtime = path.join(dir, 'runtime')
  installRuntime(path.resolve('build'), runtime, dir, [process.execPath])
  const room = new Room(dir),
    worker = randomUUID()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  room.receive({
    kind: 'relay',
    taskId: randomUUID(),
    automationId: 'test',
    token: room.state.relay.token,
  })
  room.receive({
    kind: 'catalog',
    tasks: [{ id: worker, title: 'Worker', cwd: '', updatedAt: 1 }],
  })
  room.add({ id: worker, title: 'Worker', handle: 'worker' })
  const w = room.beginApproval(worker)
  room.receive({ kind: 'connect', workerId: worker, token: w.token })
  room.send({ text: '@worker closed app test', parentId: null })
  const job = claimBatch(dir, runtime, [process.execPath])[0]!
  atomicWrite(path.join(dir, 'host.json'), { running: false, pid: process.pid })
  const result = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(runtime, 'cli.mjs'),
      'reply',
      worker,
      job.deliveryId,
    ])
    let out = '',
      err = ''
    child.stdout.on('data', (chunk) => {
      out += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      err += String(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(err)),
    )
    child.stdin.end(JSON.stringify({ text: 'Reply survived closing', to: [] }))
  })
  assert.deepEqual(JSON.parse(result), { accepted: false, queued: true })
  const reopened = new Room(dir)
  reopened.drain()
  assert.equal(
    reopened.state.messages.filter((m) => m.kind === 'reply').length,
    1,
  )
  reopened.drain()
  assert.equal(
    reopened.state.messages.filter((m) => m.kind === 'reply').length,
    1,
  )
  assert.equal(reopened.state.deliveries[0]!.status, 'replied')
})

test('a killed listener leaves a stale lock that the next listener safely recovers', async (t) => {
  const { dir, room, cli } = fixture(t)
  room.receive({
    kind: 'relay',
    taskId: randomUUID(),
    automationId: 'test',
    token: room.state.relay.token,
  })
  room.receive({ kind: 'catalog', tasks: [] })
  atomicWrite(path.join(dir, 'host.json'), { running: true, pid: process.pid })
  const child = spawn(process.execPath, [cli, 'next'], { stdio: 'ignore' })
  t.after(() => child.kill())
  for (
    let i = 0;
    i < 100 && !fs.existsSync(path.join(dir, 'listener.json'));
    i++
  )
    await new Promise((r) => setTimeout(r, 20))
  assert.ok(fs.existsSync(path.join(dir, 'listener.json')))
  const closed = new Promise((resolve) => child.once('close', resolve))
  child.kill('SIGKILL')
  await closed
  assert.ok(fs.existsSync(path.join(dir, 'listener.json')))
  atomicWrite(path.join(dir, 'host.json'), { running: false, pid: process.pid })
  const result = await exec(process.execPath, [cli, 'next'])
  assert.equal(JSON.parse(result.stdout).stopped, true)
  assert.equal(fs.existsSync(path.join(dir, 'listener.json')), false)
})

test('compact helper dispatch freezes large prompts and serves bounded chunks only to the addressed task', async (t) => {
  const { dir, room, cli } = fixture(t)
  const worker = randomUUID()
  room.receive({
    kind: 'relay',
    taskId: randomUUID(),
    automationId: 'test',
    token: room.state.relay.token,
  })
  room.receive({
    kind: 'catalog',
    tasks: [{ id: worker, title: 'Worker', updatedAt: 1, cwd: '' }],
  })
  room.add({ id: worker, title: 'Worker', handle: 'worker' })
  const w = room.beginApproval(worker)
  room.receive({ kind: 'connect', workerId: worker, token: w.token })
  // Maximum input, with characters expanded by JSON encoding.
  const text = '@worker ' + '\u0001🦊\n"'.repeat(24000).slice(0, 119992)
  const original = room.send({ text, parentId: null })
  atomicWrite(path.join(dir, 'host.json'), { running: true, pid: process.pid })
  const next = JSON.parse(
    (await exec(process.execPath, [cli, 'next', 'compact'])).stdout,
  )
  assert.equal(next.jobs.length, 1)
  const job = next.jobs[0]
  assert.equal(job.prompt, undefined)
  const claim = JSON.parse(
    fs.readFileSync(path.join(dir, 'claims', job.deliveryId), 'utf8'),
  )
  const inline = JSON.parse(
    claim.prompt.split('\n').find((line: string) => line.startsWith('{')),
  )
  assert.equal(inline.text, text)
  assert.equal(inline.messageId, original.id)
  room.send({ text: '@worker later request', parentId: original.id })
  for (const offset of [0, 1000, claim.prompt.length - 1]) {
    const result = await exec(process.execPath, [
      cli,
      'prompt-chunk',
      worker,
      job.deliveryId,
      String(offset),
    ])
    assert.ok(result.stdout.length < 7000)
    const part = JSON.parse(result.stdout)
    assert.equal(part.chunk, claim.prompt.slice(offset, offset + 1000))
    assert.equal(
      part.nextOffset,
      offset + 1000 < claim.prompt.length ? offset + 1000 : null,
    )
  }
  for (const [taskId, offset] of [
    [randomUUID(), '0'],
    [worker, '-1'],
    [worker, String(claim.prompt.length)],
  ]) {
    await assert.rejects(
      exec(process.execPath, [
        cli,
        'prompt-chunk',
        taskId!,
        job.deliveryId,
        offset!,
      ]),
    )
  }
})

test('dispatcher reassembles a long Unicode prompt exactly before sending once', async () => {
  const threadId = randomUUID(),
    deliveryId = randomUUID()
  const prompt = 'Exact text 🦊 "quotes"\n'.repeat(7000)
  const sent: unknown[] = []
  const tools = {
    exec_command: async ({ cmd }: { cmd: string }) => {
      let output: unknown = { recorded: true }
      if (cmd.endsWith("'next' 'compact'"))
        output = { jobs: [{ threadId, deliveryId }] }
      else if (cmd.includes("'prompt-chunk'")) {
        const offset = Number(cmd.match(/'(\d+)'$/)![1])
        output = {
          chunk: prompt.slice(offset, offset + 1000),
          nextOffset: offset + 1000 < prompt.length ? offset + 1000 : null,
        }
      }
      return { exit_code: 0, output: JSON.stringify(output) }
    },
    mcp__codex_app__send_message_to_thread: async (value: unknown) => {
      sent.push(value)
      return {}
    },
  }
  await vm.runInNewContext(
    'const crewRelayCommand="cli";\n' +
      fs.readFileSync('build/relay-turn.js', 'utf8'),
    { tools, text: () => {} },
  )
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [{ threadId, prompt }])
})

test('dispatcher never forwards an incomplete prompt', async () => {
  let sends = 0
  const tools = {
    exec_command: async ({ cmd }: { cmd: string }) => ({
      exit_code: 0,
      output: JSON.stringify(
        cmd.endsWith("'next' 'compact'")
          ? { jobs: [{ threadId: randomUUID(), deliveryId: randomUUID() }] }
          : { chunk: 'partial', nextOffset: 1 },
      ),
    }),
    mcp__codex_app__send_message_to_thread: async () => {
      sends++
      return {}
    },
  }
  await assert.rejects(
    vm.runInNewContext(
      'const crewRelayCommand="cli";\n' +
        fs.readFileSync('build/relay-turn.js', 'utf8'),
      { tools, text: () => {} },
    ),
    /Invalid delivery prompt offset/,
  )
  assert.equal(sends, 0)
})

test('take refreshes identity without a prompt hook, then deduplicates and clears it', async (t) => {
  const { dir, runtime, room, cli } = fixture(t)
  const worker = randomUUID()
  room.receive({
    kind: 'relay',
    taskId: randomUUID(),
    automationId: 'test',
    token: room.state.relay.token,
  })
  room.receive({
    kind: 'catalog',
    tasks: [{ id: worker, title: 'Intern', updatedAt: 1, cwd: '' }],
  })
  room.add({
    id: worker,
    title: 'Intern',
    handle: 'intern',
    identity: 'Desk label COBALT',
  })
  const approval = room.beginApproval(worker)
  await exec(process.execPath, [cli, 'connect', worker, approval.token])
  room.send({ text: '@intern What is your desk label?', parentId: null })
  const [job] = claimBatch(dir, runtime, [process.execPath])
  assert.ok(job)
  const take = async () =>
    JSON.parse(
      (await exec(process.execPath, [cli, 'take', worker, job.deliveryId]))
        .stdout,
    )
  assert.match((await take()).identityUpdate, /Desk label COBALT/)
  assert.equal((await take()).identityUpdate, undefined)
  room.edit({
    id: worker,
    title: 'Intern',
    handle: 'intern',
    identity: 'Desk label AMBER',
  })
  assert.match((await take()).identityUpdate, /Desk label AMBER/)
  // A normal prompt hook shares the checkpoint instead of injecting the same brief again.
  const hook = spawn(
    process.execPath,
    [path.join(runtime, 'context-hook.mjs')],
    { env: { ...process.env, CODEX_THREAD_ID: worker } },
  )
  let output = ''
  hook.stdout.on('data', (chunk) => {
    output += String(chunk)
  })
  const ended = new Promise<number | null>((resolve) =>
    hook.once('close', resolve),
  )
  hook.stdin.end(
    JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: worker }),
  )
  assert.equal(await ended, 0)
  assert.equal(output, '')
  room.edit({ id: worker, title: 'Intern', handle: 'intern', identity: '' })
  assert.match(
    (await take()).identityUpdate,
    /cleared the Crews teammate identity/,
  )
  assert.equal((await take()).identityUpdate, undefined)
})
