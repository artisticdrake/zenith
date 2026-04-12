import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// Apply saved theme before first paint (default: light)
const _saved = localStorage.getItem('jt.theme') ?? 'light';
document.documentElement.classList.toggle('dark', _saved === 'dark');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
