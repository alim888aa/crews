import { Effect } from 'effect'
import type { Readable } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'
import {
  attempt,
  backendError,
  InvalidRequest,
  type BackendError,
} from './errors.js'

/** Own only our listeners; cancellation releases stdin instead of leaving a pending Promise. */
export function jsonInput(input: Readable, limit = 2_000_000) {
  return Effect.async<unknown, BackendError>((resume) => {
    const decoder = new StringDecoder('utf8')
    let text = '',
      finished = false
    const cleanup = () => {
      input
        .off('data', data)
        .off('end', end)
        .off('error', error)
        .off('close', close)
      input.pause()
    }
    const finish = (result: Effect.Effect<unknown, BackendError>) => {
      if (finished) return
      finished = true
      cleanup()
      resume(result)
    }
    const data = (chunk: Buffer | string) => {
      text += typeof chunk === 'string' ? chunk : decoder.write(chunk)
      if (text.length > limit)
        finish(Effect.fail(new InvalidRequest({ message: 'Input too large.' })))
    }
    const end = () => {
      text += decoder.end()
      finish(attempt('decode input', () => JSON.parse(text) as unknown))
    }
    const error = (cause: Error) =>
      finish(Effect.fail(backendError('read input', cause)))
    const close = () =>
      finish(
        Effect.fail(
          new InvalidRequest({
            message: 'Input closed before a complete message arrived.',
          }),
        ),
      )
    input
      .on('data', data)
      .once('end', end)
      .once('error', error)
      .once('close', close)
    if (input.readableEnded) end()
    else if (input.destroyed) close()
    return Effect.sync(cleanup)
  })
}
