import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// import App from './App.jsx'
import TestBench from './TestBench.jsx'
import { EnvManager } from './components/env-manager/EnvManager.js'


createRoot(document.getElementById('root')).render(
  <StrictMode>
    <EnvManager />
  </StrictMode>,
)

