/** The page the window sits on until broodmother answers. It is served from a data URL
 *  rather than a file so that packaging has one less thing to carry. */
export function holding(url: string): string {
  const html = `<!doctype html>
<meta charset="utf-8">
<title>broodmother</title>
<style>
  :root { color-scheme: light dark }
  body {
    display: flex; flex-direction: column; gap: .4rem;
    align-items: center; justify-content: center;
    height: 100vh; margin: 0;
    background: #f6f0e4; color: #2b2419;
    font: 13px/1.6 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
  }
  code { font-family: ui-monospace, "SF Mono", Menlo, monospace; opacity: .7 }
  p { margin: 0 }
</style>
<p>Waiting for broodmother at <code>${url}</code></p>
<p><code>make -C daemon start</code> &nbsp; <code>make -C frontend start</code></p>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}
