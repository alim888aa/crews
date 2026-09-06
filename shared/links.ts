/** Links messages may open through the desktop shell after a user click. */
export function messageLink(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim() || value.length > 8192)
    return undefined
  try {
    const url = new URL(value)
    if (url.username || url.password) return undefined
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href
    if (url.protocol === 'mailto:') return url.href
    if (
      url.protocol === 'codex:' &&
      url.hostname === 'threads' &&
      /^\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        url.pathname,
      ) &&
      !url.search &&
      !url.hash
    )
      return url.href
  } catch {}
  return undefined
}
