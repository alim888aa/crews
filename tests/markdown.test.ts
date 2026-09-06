import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { messageLink } from '../shared/links.js'
import { MessageMarkdown } from '../src/MessageMarkdown.js'

test('message links allow web, mail and task links but reject executable protocols and local files', () => {
  const task = 'codex://threads/11111111-1111-4111-8111-111111111111'
  for (const url of [
    'https://example.com/docs?a=1#next',
    'http://localhost:3000',
    'mailto:hello@example.com',
    task,
  ])
    assert.equal(messageLink(url), new URL(url).href)
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,boom',
    'file:///etc/passwd',
    '/etc/passwd',
    '//example.com',
    'codex://new?prompt=do-this',
    task + '?prompt=changed',
    'https://user:pass@example.com',
    {},
    null,
  ])
    assert.equal(messageLink(url), undefined)
})

test('messages render Markdown links, line breaks, lists, tables and code without executing HTML or loading remote images', () => {
  const text = [
    '## Heading',
    '',
    '**Bold** and *italic* with [docs](https://example.com/docs).',
    'Next line and https://example.com/plain',
    '',
    '- First',
    '- Second',
    '',
    '| A | B |',
    '| - | - |',
    '| 1 | 2 |',
    '',
    '```ts',
    'const text = "<script>"',
    '```',
    '',
    '<script>alert("bad")</script>',
    '',
    '[unsafe](javascript:alert%281%29)',
    '',
    '![Reference](https://example.com/image.png)',
  ].join('\n')
  const html = renderToStaticMarkup(createElement(MessageMarkdown, { text }))
  for (const fragment of [
    '<h2>Heading</h2>',
    '<strong>Bold</strong>',
    '<em>italic</em>',
    'href="https://example.com/docs"',
    '<br/>',
    '<ul>',
    '<table>',
    '<pre>',
    '&lt;script&gt;',
    'href="https://example.com/image.png"',
  ])
    assert.ok(html.includes(fragment), fragment)
  assert.ok(!html.includes('<script>'))
  assert.ok(!html.includes('href="javascript:'))
  assert.ok(!html.includes('<img'))
})
