import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App.tsx'
import './styles/global.css'

const el = document.getElementById('root')
if (!el) throw new Error('#root not found')

// embed.html sets data-embedded, which drops the chrome the host page provides.
const embedded = el.dataset.embedded === 'true'

createRoot(el).render(
  <StrictMode>
    <App embedded={embedded} />
  </StrictMode>,
)
