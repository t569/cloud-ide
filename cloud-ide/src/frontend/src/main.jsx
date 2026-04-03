import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// import App from './App.jsx'
import { EnvManager } from './env-manager/components/EnvManager';


createRoot(document.getElementById('root')).render(
  <StrictMode>
    <EnvManager />
  </StrictMode>,
)

