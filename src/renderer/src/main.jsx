import './assets/main.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import faviconUrl from '../../../resources/images/logo.ico'

const favicon = document.querySelector("link[rel='icon']") || document.createElement('link')
favicon.rel = 'icon'
favicon.href = faviconUrl
document.head.appendChild(favicon)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
