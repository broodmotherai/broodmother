'use client'

import { render } from '@/src/markdown/render'
import type { CellOutput } from '@broodmother/notebook/codec'
import { ansiSpans } from './ansi'

/** MIME bundle values arrive as a string or a list of lines, like sources do. */
function joined(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && value.every((one) => typeof one === 'string'))
    return value.join('')
  return ''
}

function AnsiText({ text }: { text: string }) {
  return (
    <>
      {ansiSpans(text).map((span, index) => (
        <span key={index} className={span.className || undefined}>
          {span.text}
        </span>
      ))}
    </>
  )
}

/**
 * Richest first, and only what can be shown safely. `text/html` and `image/svg+xml` can
 * carry script, and the markdown pipeline has no sanitizer — so both go into a sandboxed
 * iframe where plotly and friends still run but same-origin is denied, and nothing inside
 * reaches the app or the loopback API.
 */
const FRAMED = ['text/html', 'image/svg+xml']
const IMAGES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

function Display({ data }: { data: Record<string, unknown> }) {
  for (const mime of FRAMED)
    if (mime in data)
      return (
        <iframe
          className="notebook-frame"
          sandbox="allow-scripts"
          title="cell output"
          srcDoc={joined(data[mime])}
        />
      )
  for (const mime of IMAGES)
    if (mime in data)
      return (
        <img
          className="notebook-image"
          alt="cell output"
          src={`data:${mime};base64,${joined(data[mime]).replace(/\n/g, '')}`}
        />
      )
  if ('text/markdown' in data)
    return (
      <div
        className="notebook-md broodmother-reading"
        dangerouslySetInnerHTML={{ __html: render(joined(data['text/markdown'])) }}
      />
    )
  if ('application/json' in data)
    return (
      <pre className="notebook-text">
        {JSON.stringify(data['application/json'], null, 2)}
      </pre>
    )
  if ('text/plain' in data)
    return (
      <pre className="notebook-text">
        <AnsiText text={joined(data['text/plain'])} />
      </pre>
    )
  return null
}

function Output({ output }: { output: CellOutput }) {
  switch (output.kind) {
    case 'stream':
      return (
        <pre className="notebook-text" data-stream={output.name}>
          <AnsiText text={output.text} />
        </pre>
      )
    case 'error':
      return (
        <pre className="notebook-text" data-stream="error">
          <AnsiText
            text={output.traceback.join('\n') || `${output.ename}: ${output.evalue}`}
          />
        </pre>
      )
    case 'display':
      return <Display data={output.data} />
  }
}

export function Outputs({ outputs }: { outputs: CellOutput[] }) {
  if (outputs.length === 0) return null
  return (
    <div className="notebook-outputs">
      {outputs.map((output, index) => (
        <Output key={index} output={output} />
      ))}
    </div>
  )
}
