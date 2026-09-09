import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

const rootElement = document.getElementById('root')
if (rootElement === null) throw new Error('Landing site root element is missing.')
createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
