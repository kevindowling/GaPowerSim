import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App.tsx'
import '@fontsource-variable/public-sans/wght.css'
import './styles/global.css'

const el = document.getElementById('root')
if (!el) throw new Error('#root not found')

// Set by embed.html.
const embedded = el.dataset.embedded === 'true'

createRoot(el).render(
  <StrictMode>
    <App embedded={embedded} />
  </StrictMode>,
)
