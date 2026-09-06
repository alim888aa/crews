// Compiled to a standalone script evaluated by the desktop task's functions.exec.
// Tool outputs and routing strings stay in program memory, never model transcription.
declare const crewRelayCommand: string
// Supplied by the native relay only after choosing its supported approval path.
declare const crewRelayApproval: boolean | undefined
declare const text: (value: unknown) => void
type Result = { isError?: boolean; content?: { type: string; text?: string }[] }
type ExecResult = { output: string; exit_code?: number; session_id?: number }
declare const tools: {
  exec_command(args: {
    cmd: string
    yield_time_ms?: number
    max_output_tokens?: number
    sandbox_permissions?: 'require_escalated'
    justification?: string
  }): Promise<ExecResult>
  write_stdin(args: {
    session_id: number
    chars: string
    yield_time_ms: number
    max_output_tokens: number
  }): Promise<ExecResult>
  mcp__codex_app__send_message_to_thread(args: {
    threadId: string
    prompt: string
  }): Promise<Result>
  mcp__codex_app__list_threads(args: { limit: number }): Promise<Result>
  mcp__codex_app__wait_threads(args: {
    targets: { threadId: string }[]
    timeoutMs: number
  }): Promise<Result>
}
;(async () => {
  const quote = (v: string) => "'" + v.replaceAll("'", "'\\''") + "'"
  const record = (v: unknown): Record<string, unknown> => {
    if (!v || typeof v !== 'object' || Array.isArray(v))
      throw new Error('Invalid result')
    return v as Record<string, unknown>
  }
  function unpack(result: Result): Record<string, unknown> {
    if (result.isError) throw new Error(JSON.stringify(result))
    const block = result.content?.find(
      (c) => c.type === 'text' && c.text?.trim().startsWith('{'),
    )
    if (!block?.text) throw new Error('No structured native result')
    return record(JSON.parse(block.text))
  }
  async function cli(
    args: string[],
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    // Bodies are encoded as a quoted literal JSON line, not shell interpolation.
    const command = crewRelayCommand + ' ' + args.map(quote).join(' ')
    let r = await tools.exec_command({
      cmd:
        body === undefined
          ? command
          : 'printf %s ' + quote(JSON.stringify(body)) + ' | ' + command,
      ...(typeof crewRelayApproval !== 'undefined' && crewRelayApproval
        ? {
            sandbox_permissions: 'require_escalated' as const,
            justification:
              'Allow this Crews helper operation to read and write the authorized local room data?',
          }
        : {}),
      yield_time_ms: 1000,
      max_output_tokens: 9000,
    })
    let out = r.output
    while (r.session_id) {
      r = await tools.write_stdin({
        session_id: r.session_id,
        chars: '',
        yield_time_ms: 10000,
        max_output_tokens: 9000,
      })
      out += r.output
    }
    if (r.exit_code !== 0) throw new Error(out)
    const line = out.split(/\r?\n/).findLast((s) => s.startsWith('{'))
    if (!line)
      throw new Error(
        'Dispatcher interrupted without a result. Leave claims held.',
      )
    return record(JSON.parse(line))
  }
  const batch = await cli(['next', 'compact'])
  if (batch.refreshCatalog) {
    const listed = unpack(
      await tools.mcp__codex_app__list_threads({ limit: 40 }),
    )
    const all = [
      ...(Array.isArray(listed.pinnedThreads) ? listed.pinnedThreads : []),
      ...(Array.isArray(listed.threads) ? listed.threads : []),
    ].map(record)
    const tasks = all
      .filter(
        (t) =>
          t.kind === 'codex' &&
          t.hostId === 'local' &&
          typeof t.id === 'string' &&
          typeof t.title === 'string',
      )
      .map((t) => ({
        id: t.id,
        title: t.title,
        cwd: typeof t.cwd === 'string' ? t.cwd : '',
        updatedAt:
          typeof t.updatedAt === 'number'
            ? t.updatedAt < 1e12
              ? t.updatedAt * 1000
              : t.updatedAt
            : 0,
      }))
    await cli(['catalog'], { tasks })
    text({ catalogUpdated: true })
  }
  const jobs = Array.isArray(batch.jobs) ? batch.jobs.map(record) : []
  for (const job of jobs) {
    if (typeof job.threadId !== 'string' || typeof job.deliveryId !== 'string')
      throw new Error('Invalid dispatch job')
    // Read the app's frozen prompt in bounded pieces; never ask Luna to rewrite it.
    // Inline prompts remain supported for a dispatcher already running during an update.
    let prompt = typeof job.prompt === 'string' ? job.prompt : ''
    if (typeof job.prompt !== 'string') {
      let offset = 0
      while (true) {
        const part = await cli([
          'prompt-chunk',
          job.threadId,
          job.deliveryId,
          String(offset),
        ])
        if (typeof part.chunk !== 'string' || !part.chunk.length)
          throw new Error('Missing delivery prompt chunk. Leave claim held.')
        prompt += part.chunk
        if (part.nextOffset === null) break
        if (part.nextOffset !== offset + part.chunk.length)
          throw new Error('Invalid delivery prompt offset. Leave claim held.')
        offset = Number(part.nextOffset)
      }
    }
    try {
      const result = await tools.mcp__codex_app__send_message_to_thread({
        threadId: job.threadId,
        prompt,
      })
      if (result.isError)
        await cli([
          'attention',
          job.deliveryId,
          'task',
          'Codex rejected the dispatch. Open the relay task for the exact reason.',
        ])
      else await cli(['sent', job.deliveryId])
    } catch (e) {
      await cli([
        'attention',
        job.deliveryId,
        'uncertain',
        'Dispatch outcome uncertain. Inspect the original task before doing anything again.',
      ])
      text({ error: String(e) })
    }
  }
  // Native status only establishes whether a task finished. The relay inspects
  // unresolved cases and records the actual reason; no guessing from a timeout.
  const held = Array.isArray(batch.inFlight) ? batch.inFlight.map(record) : []
  const pending = held
    .filter((d) => d.status === 'sent' || d.status === 'claimed')
    .slice(0, 8)
  if (pending.length) {
    const status = await tools.mcp__codex_app__wait_threads({
      targets: pending
        .filter((d) => typeof d.threadId === 'string')
        .map((d) => ({ threadId: String(d.threadId) })),
      timeoutMs: 0,
    })
    text({ inFlight: pending, status })
  }
  if (!jobs.length && !batch.refreshCatalog) text(batch)
})()
