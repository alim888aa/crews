import { Data, Effect, ParseResult } from 'effect'

export class StorageError extends Data.TaggedError('StorageError')<{
  operation: string
  cause: unknown
  message: string
}> {}
export class InvalidRequest extends Data.TaggedError('InvalidRequest')<{
  message: string
}> {}
export class EventRejected extends Data.TaggedError('EventRejected')<{
  eventId: string
  message: string
}> {}
export class ListenerBusy extends Data.TaggedError('ListenerBusy')<{
  message: string
}> {}
export class OperationError extends Data.TaggedError('OperationError')<{
  operation: string
  cause: unknown
  message: string
}> {}
export type BackendError =
  StorageError | InvalidRequest | EventRejected | ListenerBusy | OperationError

export function backendError(operation: string, cause: unknown): BackendError {
  if (
    cause instanceof StorageError ||
    cause instanceof InvalidRequest ||
    cause instanceof EventRejected ||
    cause instanceof ListenerBusy ||
    cause instanceof OperationError
  )
    return cause
  const message = cause instanceof Error ? cause.message : String(cause)
  if (ParseResult.isParseError(cause) || cause instanceof SyntaxError)
    return new InvalidRequest({ message })
  if (
    cause instanceof Error &&
    'code' in cause &&
    typeof cause.code === 'string'
  )
    return new StorageError({ operation, cause, message })
  return new OperationError({ operation, cause, message })
}

/** Capture synchronous domain and filesystem operations without losing failure identity. */
export const attempt = <A>(operation: string, run: () => A) =>
  Effect.try({ try: run, catch: (cause) => backendError(operation, cause) })
/** Promise conversion belongs at external boundaries, including Electron handlers. */
export const attemptAsync = <A>(
  operation: string,
  run: () => A | PromiseLike<A>,
) =>
  Effect.tryPromise({
    try: async () => await run(),
    catch: (cause) => backendError(operation, cause),
  })

export const invalidRequest = (message: string) =>
  new InvalidRequest({ message })
