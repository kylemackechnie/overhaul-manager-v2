import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

// Wrap mount in try/catch — if React itself throws on mount (e.g. due to a
// runtime error in a top-level import), surface the error directly into #root
// so it's visible on the device. Without this, iOS standalone PWA users see
// just the boot screen forever with no diagnostic info.
try {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
} catch (err) {
  const root = document.getElementById('root')
  if (root) {
    const msg = err instanceof Error ? `${err.message}\n\n${err.stack ?? ''}` : String(err)
    root.innerHTML = `<div style="padding:24px;font-family:-apple-system,sans-serif;color:#dc2626;font-size:13px;line-height:1.5;white-space:pre-wrap;"><strong>React mount failed</strong><br><br>${msg.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!))}</div>`
  }
  throw err
}
