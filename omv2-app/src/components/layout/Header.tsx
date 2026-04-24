import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

interface HeaderProps {
  onOpenPicker: () => void
  onOpenSearch: () => void
  onOpenSettings: () => void
}

export function Header({ onOpenPicker, onOpenSearch, onOpenSettings }: HeaderProps) {
  const { activeProject, currentUser, setActiveProject } = useAppStore()
  const [darkMode, setDarkMode] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const saved = localStorage.getItem('omv2-darkmode') === 'true'
    setDarkMode(saved)
    if (saved) document.body.classList.add('dark-mode')
  }, [])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  function toggleDarkMode() {
    const next = !darkMode
    setDarkMode(next)
    localStorage.setItem('omv2-darkmode', String(next))
    document.body.classList.toggle('dark-mode', next)
  }

  async function signOut() {
    setUserMenuOpen(false)
    await supabase.auth.signOut()
    setActiveProject(null)
    window.location.reload()
  }

  const initials = currentUser
    ? (currentUser.name || currentUser.email || '?').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  const siteName = (activeProject?.site as { name?: string } | null)?.name || ''

  return (
    <header className="app-header">
      {/* Left: Logo */}
      <div className="header-logo" onClick={onOpenPicker}>
        <div className="header-logo-icon">SE</div>
        <span className="header-logo-text">Siemens Energy</span>
      </div>
      <span className="header-sep">|</span>
      <span className="header-app">
        Overhaul Manager{' '}
        <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', opacity: 0.7 }}>v2</span>
      </span>

      {/* Centre: Search */}
      <div className="header-search">
        <button className="header-search-btn" onClick={onOpenSearch}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M11 11l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <span>Search</span>
          <kbd className="header-search-kbd">Ctrl K</kbd>
        </button>
      </div>

      {/* Right: project pill + theme + user */}
      <div className="header-right">
        {/* Project pill */}
        <div className="header-proj-pill" onClick={onOpenPicker}>
          <span className="hb-dot" style={{ background: activeProject ? '#059669' : '#94a3b8' }} />
          {siteName && (
            <>
              <span className="header-site-name">{siteName}</span>
              <span className="header-proj-sep">›</span>
            </>
          )}
          <span className="header-proj-name">
            {activeProject ? activeProject.name : 'Select Project'}
          </span>
          {activeProject && (
            <div
              className="header-gear"
              onClick={e => { e.stopPropagation(); onOpenSettings() }}
              title="Project Settings"
            >
              ⚙
            </div>
          )}
        </div>

        {/* Theme toggle */}
        <button className="header-theme-btn" onClick={toggleDarkMode} title="Toggle dark/light mode">
          {darkMode ? '☀️' : '🌙'}
        </button>

        {/* User pill */}
        <div style={{ position: 'relative' }} ref={menuRef}>
          <div className="header-user-pill" onClick={() => setUserMenuOpen(o => !o)}>
            <div className="header-avatar">{initials}</div>
            <span className="header-user-name">{currentUser?.name || currentUser?.email || 'User'}</span>
          </div>

          {userMenuOpen && (
            <div className="header-user-dropdown">
              <div className="header-user-info">
                <div className="header-user-info-name">{currentUser?.name || 'User'}</div>
                <div className="header-user-info-email">{currentUser?.email || ''}</div>
              </div>
              <button className="header-dropdown-item" onClick={() => { setUserMenuOpen(false); /* user mgmt */ }}>
                👥 Manage Users
              </button>
              <button className="header-dropdown-item danger" onClick={signOut}>
                ↩ Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
