import { createRoot } from 'react-dom/client'
import App from './App'
import { connect } from './store'
import './index.css'

const root = createRoot(document.getElementById('root')!)
root.render(
  <main className="p-8 text-sm text-muted-foreground">Opening your room…</main>,
)
Promise.race([
  connect(),
  new Promise<never>((_resolve, reject) =>
    setTimeout(
      () =>
        reject(
          new Error(
            'The local room did not respond. Close and reopen Crews.',
          ),
        ),
      8000,
    ),
  ),
])
  .then(() => root.render(<App />))
  .catch((error) =>
    root.render(
      <main className="p-8">
        <h1 className="text-lg font-semibold">Crews couldn’t connect</h1>
        <p className="mt-3 text-muted-foreground">
          Close and reopen Crews. Your saved messages will stay on this Mac.
        </p>
        <pre className="mt-4 whitespace-pre-wrap text-xs">{String(error)}</pre>
      </main>,
    ),
  )
