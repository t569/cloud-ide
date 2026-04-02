import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// import App from './App.jsx'
import {TerminalComponent}  from './terminal/components/Terminal.tsx'
import EnvironmentManager from './managers/EnvironmentManager.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <EnvironmentManager/>
  </StrictMode>,
)
