import { useState, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { messageLink } from '../shared/links'

const plugins = [remarkGfm, remarkBreaks]

export function MessageMarkdown({ text }: { text: string }) {
  const [error, setError] = useState('')
  function link(href: string | undefined, children: ReactNode, title?: string) {
    const url = messageLink(href)
    if (!url) return <span>{children}</span>
    return (
      <a
        href={url}
        title={title ?? url}
        onClick={(event) => {
          event.preventDefault()
          setError('')
          void window.crew
            .openLink(url)
            .catch(() => setError('Could not open this link.'))
        }}
      >
        {children}
      </a>
    )
  }
  return (
    <div className="message-markdown min-w-0">
      <Markdown
        remarkPlugins={plugins}
        skipHtml
        urlTransform={(url) => messageLink(url) ?? ''}
        components={{
          a: ({ href, children, title }) => link(href, children, title),
          // Uploaded screenshots use ImagePreviews; remote images remain click-to-open.
          img: ({ src, alt, title }) =>
            link(
              typeof src === 'string' ? src : undefined,
              alt || 'Image',
              title,
            ),
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </Markdown>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
