import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import {TerminalComponent}  from './terminal/components/Terminal.tsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <TerminalComponent/>
  </StrictMode>,
)
