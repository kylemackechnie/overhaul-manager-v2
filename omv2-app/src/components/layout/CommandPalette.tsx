import { useEffect, useRef, useState } from 'react'

import { useAppStore } from '../../store/appStore'

interface CmdItem {
  icon: string
  title: string
  sub: string
  badge: string
  action: () => void
}

interface CmdSection {
  label: string
  items: CmdItem[]
}

const NAV_PAGES = [
  { icon:'📊', label:'Dashboard', panel:'dashboard' },
  { icon:'📅', label:'Calendar', panel:'calendar' },
  { icon:'📋', label:'Gantt Chart', panel:'gantt' },
  { icon:'📝', label:'Variations', panel:'variations' },
  { icon:'⚙️', label:'Project Settings', panel:'project-settings' },
  { icon:'📍', label:'WBS List', panel:'wbs-list' },
  { icon:'🗓️', label:'Public Holidays', panel:'public-holidays' },
  { icon:'💰', label:'Cost Dashboard', panel:'cost-dashboard' },
  { icon:'📈', label:'Forecast', panel:'cost-forecast' },
  { icon:'📉', label:'S-Curve', panel:'cost-scurve' },
  { icon:'📑', label:'Cost Report', panel:'cost-report' },
  { icon:'📦', label:'Reports Database', panel:'reports-db' },
  { icon:'🧾', label:'Expenses', panel:'expenses' },
  { icon:'📄', label:'Purchase Orders', panel:'purchase-orders' },
  { icon:'💳', label:'Invoices', panel:'invoices' },
  { icon:'🔄', label:'SAP Reconciliation', panel:'sap-recon' },
  { icon:'🤝', label:'Subcontractor Register', panel:'subcon-rfq' },
  { icon:'👥', label:'HR Dashboard', panel:'hr-dashboard' },
  { icon:'💲', label:'Rate Cards', panel:'hr-ratecards' },
  { icon:'👤', label:'Resources', panel:'hr-resources' },
  { icon:'⏱️', label:'Trades Timesheets', panel:'hr-timesheets-trades' },
  { icon:'⏱️', label:'Management Timesheets', panel:'hr-timesheets-mgmt' },
  { icon:'⏱️', label:'SE AG Timesheets', panel:'hr-timesheets-seag' },
  { icon:'⏱️', label:'Subcon Timesheets', panel:'hr-timesheets-subcon' },
  { icon:'🏢', label:'Back Office Hours', panel:'hr-backoffice' },
  { icon:'🚗', label:'Car Hire', panel:'hr-cars' },
  { icon:'🏨', label:'Accommodation', panel:'hr-accommodation' },
  { icon:'🚜', label:'Dry Hire', panel:'hire-dry' },
  { icon:'🏗️', label:'Wet Hire', panel:'hire-wet' },
  { icon:'🧰', label:'Local Hire', panel:'hire-local' },
  { icon:'📋', label:'Inductions', panel:'hr-inductions' },
  { icon:'🦺', label:'HSE Dashboard', panel:'hse-dashboard' },
  { icon:'🌿', label:'CO₂ Tracking', panel:'hse-co2' },
  { icon:'📦', label:'Inbound Shipping', panel:'shipping-inbound' },
  { icon:'🚚', label:'Outbound Shipping', panel:'shipping-outbound' },
  { icon:'📋', label:'Work Orders', panel:'work-orders' },
  { icon:'📊', label:'NRG Dashboard', panel:'nrg-dashboard' },
  { icon:'📋', label:'NRG TCE Register', panel:'nrg-tce' },
  { icon:'📈', label:'NRG Overhead Forecast', panel:'nrg-ohf' },
  { icon:'🔧', label:'Hardware Contract', panel:'hardware-contract' },
  { icon:'🛒', label:'Hardware Carts', panel:'hardware-carts' },
  { icon:'🔩', label:'Spare Parts', panel:'parts-list' },
  { icon:'🧰', label:'TV Register', panel:'tooling-tvs' },
  { icon:'📦', label:'Kollos', panel:'tooling-kollos' },
  { icon:'🏢', label:'Departments', panel:'tooling-departments' },
  { icon:'💶', label:'Tooling Costings', panel:'tooling-costings' },
  { icon:'🧰', label:'Global Tooling Register', panel:'global-tooling' },
  { icon:'📦', label:'Global Kits', panel:'global-kits' },
  { icon:'👥', label:'User Management', panel:'user-management' },
  { icon:'📋', label:'Audit Trail', panel:'audit-trail' },
]

function fuzzy(str: string, pattern: string): { match: boolean; score: number } {
  if (!pattern) return { match: true, score: 0 }
  const s = str.toLowerCase()
  const p = pattern.toLowerCase()
  const subIdx = s.indexOf(p)
  if (subIdx >= 0) return { match: true, score: 1000 + (100 - subIdx) }
  return { match: false, score: 0 }
}

interface Props {
  open: boolean
  onClose: () => void
}

export function CommandPalette({ open, onClose }: Props) {
  const { setActivePanel } = useAppStore()
  const [query, setQuery] = useState('')
  const [sections, setSections] = useState<CmdSection[]>([])
  const [activeIdx, setActiveIdx] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const allItems = sections.flatMap(s => s.items)

  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIdx(-1)
      setTimeout(() => inputRef.current?.focus(), 60)
    }
  }, [open])

  useEffect(() => {
    buildResults(query)
  }, [query])

  function buildResults(q: string) {
    const ql = q.toLowerCase()
    const result: CmdSection[] = []

    // Nav pages
    const pageHits = NAV_PAGES
      .map(p => { const r = fuzzy(p.label, ql); return r.match ? { ...p, score: r.score } : null })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0))
      .slice(0, 6) as typeof NAV_PAGES[0][]

    if (pageHits.length) {
      result.push({
        label: 'Pages',
        items: pageHits.map(p => ({
          icon: p.icon,
          title: p.label,
          sub: 'Navigate to page',
          badge: '→',
          action: () => { onClose(); setActivePanel(p.panel) }
        }))
      })
    }

    setSections(result)
    setActiveIdx(-1)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, allItems.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter' && activeIdx >= 0) { allItems[activeIdx]?.action() }
    if (e.key === 'Enter' && activeIdx < 0 && allItems.length > 0) { allItems[0]?.action() }
  }

  if (!open) return null

  let globalIdx = 0

  return (
    <div className="cmd-overlay" onClick={onClose}>
      <div className="cmd-modal" onClick={e => e.stopPropagation()}>
        <div className="cmd-input-wrap">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--text3)', flexShrink: 0 }}>
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M11 11l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            ref={inputRef}
            className="cmd-input"
            placeholder="Search parts, TVs, kits, pages…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {query && (
            <button onClick={() => setQuery('')} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: '16px' }}>×</button>
          )}
        </div>

        <div className="cmd-results">
          {sections.length === 0 && query.length > 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text3)', fontSize: '13px' }}>
              No results for "{query}"
            </div>
          ) : sections.length === 0 ? (
            <div style={{ padding: '16px' }}>
              <div className="cmd-section-label">Quick Navigation</div>
              {NAV_PAGES.slice(0, 8).map((p, i) => (
                <div key={p.panel} className={`cmd-item ${i === activeIdx ? 'active' : ''}`}
                  onClick={() => { onClose(); setActivePanel(p.panel) }}>
                  <span className="cmd-item-icon">{p.icon}</span>
                  <div className="cmd-item-body">
                    <div className="cmd-item-title">{p.label}</div>
                  </div>
                  <span className="cmd-item-badge">→</span>
                </div>
              ))}
            </div>
          ) : (
            sections.map(section => (
              <div key={section.label}>
                <div className="cmd-section-label">{section.label}</div>
                {section.items.map(item => {
                  const idx = globalIdx++
                  return (
                    <div key={idx} className={`cmd-item ${idx === activeIdx ? 'active' : ''}`}
                      onClick={item.action}
                      onMouseEnter={() => setActiveIdx(idx)}>
                      <span className="cmd-item-icon">{item.icon}</span>
                      <div className="cmd-item-body">
                        <div className="cmd-item-title">{item.title}</div>
                        {item.sub && <div className="cmd-item-sub">{item.sub}</div>}
                      </div>
                      <span className="cmd-item-badge">{item.badge}</span>
                    </div>
                  )
                })}
              </div>
            ))
          )}
        </div>

        <div className="cmd-footer">
          <span className="cmd-key"><kbd>↑↓</kbd> navigate</span>
          <span className="cmd-key"><kbd>Enter</kbd> select</span>
          <span className="cmd-key"><kbd>Esc</kbd> close</span>
          <span className="cmd-key"><kbd>Ctrl K</kbd> open anywhere</span>
        </div>
      </div>
    </div>
  )
}
