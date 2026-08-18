import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

const DESIGN_WIDTH = 375
const DESIGN_HEIGHT = 812

function syncVisualViewport() {
  const width = window.visualViewport?.width ?? window.innerWidth
  const height = window.visualViewport?.height ?? window.innerHeight
  const scale = Math.min(1, width / DESIGN_WIDTH, height / DESIGN_HEIGHT)
  document.documentElement.style.setProperty('--viewport-height', `${Math.round(height)}px`)
  document.documentElement.style.setProperty('--app-scale', scale.toFixed(4))
}

syncVisualViewport()
window.addEventListener('resize', syncVisualViewport)
window.visualViewport?.addEventListener('resize', syncVisualViewport)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="app-viewport">
      <App />
    </div>
  </StrictMode>,
)
