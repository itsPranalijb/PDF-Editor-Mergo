import { useState } from 'react'
import PDFEditor from './components/PDFEditor'
import PDFMerger from './components/PDFMerger'
import './App.css'
import './merger.css'

export default function App() {
  const [tab, setTab] = useState('editor')

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="app-header">
        <div className="app-header__brand">
          <span className="app-header__logo">📄</span>
          <span className="app-header__name">PDFCraft</span>
        </div>

        <nav className="tabs">
          <button className={tab==='editor'?'tab tab--active':'tab'} onClick={()=>setTab('editor')}>
            <span>✏️</span> Edit PDF
          </button>
          <button className={tab==='merger'?'tab tab--active':'tab'} onClick={()=>setTab('merger')}>
            <span>🔗</span> Merge PDFs
          </button>
        </nav>

        <div className="app-header__right">
          <span className="header-badge">🔒 100% Local</span>
        </div>
      </header>

      {/* ── Content ── */}
      <main className="app-main">
        {tab === 'editor' ? <PDFEditor /> : <PDFMerger />}
      </main>

      {/* ── Footer ── */}
      <footer className="app-footer">
        <div className="app-footer__inner">
          <span className="app-footer__copy">
            © {new Date().getFullYear()} <strong>PDFCraft</strong>
          </span>
          <span className="app-footer__sep">·</span>
          <span className="app-footer__by">
            Crafted with <span className="heart">♥</span> by{' '}
            <strong className="app-footer__name">Pranali Babhulgaonkar</strong>
          </span>
          <span className="app-footer__sep">·</span>
          <span className="app-footer__note">🔒 100% local — your files never leave your device</span>
        </div>
      </footer>
    </div>
  )
}
