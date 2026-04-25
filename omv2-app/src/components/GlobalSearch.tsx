import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/appStore'

interface SearchResult {
  id: string; label: string; sub: string; panel: string; icon: string; score: number
}

export function GlobalSearch() {
  const { activeProject, setActivePanel } = useAppStore()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)

  // Keyboard shortcut
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(o => !o)
        setQuery('')
        setResults([])
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])

  useEffect(() => {
    if (!query.trim() || !activeProject) { setResults([]); return }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(query.trim()), 180)
  }, [query, activeProject?.id])

  async function search(q: string) {
    if (!activeProject || q.length < 2) return
    setLoading(true)
    const pid = activeProject.id
    const ql = q.toLowerCase()

    const [resData, partsData, woData, invData, varData, poData] = await Promise.all([
      supabase.from('resources').select('id,name,role,company').eq('project_id', pid).ilike('name', `%${q}%`).limit(5),
      supabase.from('wosit_lines').select('id,description,material_no,tv_no').eq('project_id', pid)
        .or(`description.ilike.%${q}%,material_no.ilike.%${q}%`).limit(5),
      supabase.from('work_orders').select('id,wo_number,description').eq('project_id', pid)
        .or(`wo_number.ilike.%${q}%,description.ilike.%${q}%`).limit(4),
      supabase.from('invoices').select('id,invoice_number,vendor_ref').eq('project_id', pid)
        .or(`invoice_number.ilike.%${q}%,vendor_ref.ilike.%${q}%`).limit(4),
      supabase.from('variations').select('id,number,title').eq('project_id', pid)
        .or(`number.ilike.%${q}%,title.ilike.%${q}%`).limit(4),
      supabase.from('purchase_orders').select('id,po_number,vendor').eq('project_id', pid)
        .or(`po_number.ilike.%${q}%,vendor.ilike.%${q}%`).limit(4),
    ])

    const hits: SearchResult[] = []

    for (const r of resData.data || []) {
      hits.push({ id: r.id, icon: '👤', label: r.name, sub: `${r.role || ''}${r.company ? ' · ' + r.company : ''}`, panel: 'hr-resources', score: r.name.toLowerCase().startsWith(ql) ? 2 : 1 })
    }
    for (const p of partsData.data || []) {
      hits.push({ id: p.id, icon: '🔩', label: p.description || p.material_no, sub: `${p.material_no || ''}${p.tv_no ? ' · TV' + p.tv_no : ''}`, panel: 'parts-list', score: 1 })
    }
    for (const w of woData.data || []) {
      hits.push({ id: w.id, icon: '⚙️', label: w.wo_number, sub: w.description || '', panel: 'work-orders', score: w.wo_number.toLowerCase().startsWith(ql) ? 2 : 1 })
    }
    for (const i of invData.data || []) {
      hits.push({ id: i.id, icon: '🧾', label: i.invoice_number || 'Invoice', sub: i.vendor_ref || '', panel: 'invoices', score: 1 })
    }
    for (const v of varData.data || []) {
      hits.push({ id: v.id, icon: '📝', label: `VN ${v.number}`, sub: v.title || '', panel: 'variations', score: 1 })
    }
    for (const p of poData.data || []) {
      hits.push({ id: p.id, icon: '📋', label: p.po_number, sub: p.vendor || '', panel: 'purchase-orders', score: p.po_number.toLowerCase().startsWith(ql) ? 2 : 1 })
    }

    hits.sort((a, b) => b.score - a.score)
    setResults(hits)
    setSelected(0)
    setLoading(false)
  }

  function pick(result: SearchResult) {
    setActivePanel(result.panel)
    setOpen(false)
    setQuery('')
    setResults([])
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, results.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)) }
    if (e.key === 'Enter' && results[selected]) pick(results[selected])
    if (e.key === 'Escape') setOpen(false)
  }

  if (!open) return (
    <button
      style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text3)', fontSize: '12px', cursor: 'pointer', width: '160px' }}
      onClick={() => setOpen(true)}
    >
      <span>🔍</span>
      <span style={{ flex: 1 }}>Search...</span>
      <span style={{ fontSize: '10px', background: 'var(--bg)', padding: '1px 4px', borderRadius: '3px', border: '1px solid var(--border)' }}>⌘K</span>
    </button>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '80px' }} onClick={() => setOpen(false)}>
      <div style={{ width: '560px', background: 'var(--bg2)', borderRadius: '10px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: '16px' }}>🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search resources, parts, WOs, invoices, variations, POs..."
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: '15px', color: 'var(--text)' }}
          />
          {loading && <span className="spinner" style={{ width: '14px', height: '14px', flexShrink: 0 }} />}
          <kbd style={{ fontSize: '11px', background: 'var(--bg3)', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--border)', color: 'var(--text3)' }}>Esc</kbd>
        </div>
        {query.length >= 2 && (
          <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
            {results.length === 0 && !loading ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text3)', fontSize: '13px' }}>No results for "{query}"</div>
            ) : (
              results.map((r, i) => (
                <div key={r.id + r.panel}
                  style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 16px', cursor: 'pointer', background: i === selected ? 'var(--accent-light)' : 'transparent', borderLeft: i === selected ? '3px solid var(--accent)' : '3px solid transparent' }}
                  onMouseEnter={() => setSelected(i)}
                  onClick={() => pick(r)}
                >
                  <span style={{ fontSize: '18px', flexShrink: 0 }}>{r.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</div>
                    {r.sub && <div style={{ fontSize: '11px', color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '1px' }}>{r.sub}</div>}
                  </div>
                  <span style={{ fontSize: '10px', color: 'var(--text3)', flexShrink: 0, textTransform: 'capitalize' }}>{r.panel.replace(/-/g, ' ')}</span>
                  <span style={{ fontSize: '11px', color: 'var(--text3)', flexShrink: 0 }}>→</span>
                </div>
              ))
            )}
          </div>
        )}
        {query.length < 2 && (
          <div style={{ padding: '16px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
            {[
              { icon: '👤', label: 'Resources', panel: 'hr-resources' },
              { icon: '🔩', label: 'Parts', panel: 'parts-list' },
              { icon: '⚙️', label: 'Work Orders', panel: 'work-orders' },
              { icon: '🧾', label: 'Invoices', panel: 'invoices' },
              { icon: '📝', label: 'Variations', panel: 'variations' },
              { icon: '📋', label: 'POs', panel: 'purchase-orders' },
            ].map(q => (
              <button key={q.panel} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--bg3)', cursor: 'pointer', fontSize: '12px', color: 'var(--text2)' }}
                onClick={() => { setActivePanel(q.panel); setOpen(false) }}>
                <span>{q.icon}</span><span>{q.label}</span>
              </button>
            ))}
          </div>
        )}
        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: '16px', fontSize: '10px', color: 'var(--text3)' }}>
          <span>↑↓ navigate</span><span>↵ open</span><span>Esc close</span>
        </div>
      </div>
    </div>
  )
}
