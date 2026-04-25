import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

interface AuditEvent { time: string; who: string; what: string; detail: string; module: string }

const MODULE_COLORS: Record<string, string> = {
  invoices: '#0284c7', resources: 'var(--mod-hr)', variations: '#d97706',
  parts: '#0891b2', timesheets: '#6366f1', work_orders: '#7c3aed',
  default: 'var(--text3)',
}

export function AuditTrailPanel() {
  const { activeProject } = useAppStore()
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [moduleFilter, setModuleFilter] = useState('all')
  const [search, setSearch] = useState('')

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const allEvents: AuditEvent[] = []

    // Invoice status changes
    const { data: invData } = await supabase.from('invoices')
      .select('invoice_number,vendor_ref,status_history,updated_at').eq('project_id', pid)
    for (const inv of invData || []) {
      const history = inv.status_history as { to: string; by: string; byEmail: string; at: string; note?: string }[]
      for (const h of history || []) {
        allEvents.push({
          time: h.at, who: h.by || h.byEmail || 'System',
          what: `Invoice ${inv.invoice_number || inv.vendor_ref} → ${h.to}`,
          detail: h.note || '', module: 'invoices'
        })
      }
    }

    // Recent variation changes
    const { data: varData } = await supabase.from('variations')
      .select('number,title,status,updated_at').eq('project_id', pid).order('updated_at', { ascending: false }).limit(30)
    for (const v of varData || []) {
      allEvents.push({
        time: v.updated_at, who: '', what: `Variation ${v.number} — ${v.status}`,
        detail: v.title || '', module: 'variations'
      })
    }

    // Recent resource adds
    const { data: resData } = await supabase.from('resources')
      .select('name,role,status,created_at').eq('project_id', pid).order('created_at', { ascending: false }).limit(20)
    for (const r of resData || []) {
      allEvents.push({
        time: r.created_at, who: '', what: `Resource added: ${r.name}`,
        detail: `${r.role || ''}${r.status ? ` (${r.status})` : ''}`, module: 'resources'
      })
    }

    // Recent parts status changes
    const { data: partsData } = await supabase.from('wosit_lines')
      .select('description,material_no,status,updated_at').eq('project_id', pid)
      .in('status', ['received', 'issued']).order('updated_at', { ascending: false }).limit(20)
    for (const p of partsData || []) {
      allEvents.push({
        time: p.updated_at, who: '', what: `Part ${p.status}: ${p.material_no || p.description}`,
        detail: p.description, module: 'parts'
      })
    }

    // Recent issued log entries
    const { data: issuedData } = await supabase.from('issued_log')
      .select('description,qty,issued_to,issued_by,issued_at').eq('project_id', pid)
      .order('issued_at', { ascending: false }).limit(20)
    for (const i of issuedData || []) {
      allEvents.push({
        time: i.issued_at, who: i.issued_by || '',
        what: `Issued ${i.qty}× ${i.description || 'part'}`,
        detail: `To: ${i.issued_to}`, module: 'parts'
      })
    }

    // Recent timesheet saves
    const { data: tsData } = await supabase.from('weekly_timesheets')
      .select('week_start,type,status,updated_at').eq('project_id', pid)
      .order('updated_at', { ascending: false }).limit(20)
    for (const t of tsData || []) {
      allEvents.push({
        time: t.updated_at, who: '', what: `Timesheet ${t.week_start} (${t.type}) — ${t.status || 'draft'}`,
        detail: '', module: 'timesheets'
      })
    }

    // Sort all events newest first
    allEvents.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    setEvents(allEvents)
    setLoading(false)
  }

  const modules = [...new Set(events.map(e => e.module))]
  const filtered = events
    .filter(e => moduleFilter === 'all' || e.module === moduleFilter)
    .filter(e => !search || e.what.toLowerCase().includes(search.toLowerCase()) || e.detail.toLowerCase().includes(search.toLowerCase()))

  return (
    <div style={{ padding: '24px', maxWidth: '900px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>Audit Trail</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>{events.length} events across all modules</p>
        </div>
        <button className="btn btn-sm" onClick={load}>🔄 Refresh</button>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <input className="input" style={{ maxWidth: '220px', fontSize: '12px' }} placeholder="Search events..." value={search} onChange={e => setSearch(e.target.value)} />
        <button className="btn btn-sm" style={{ background: moduleFilter === 'all' ? 'var(--accent)' : '', color: moduleFilter === 'all' ? '#fff' : '' }} onClick={() => setModuleFilter('all')}>All</button>
        {modules.map(m => (
          <button key={m} className="btn btn-sm" style={{ background: moduleFilter === m ? 'var(--accent)' : '', color: moduleFilter === m ? '#fff' : '' }} onClick={() => setModuleFilter(m)}>
            {m.charAt(0).toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>

      {loading ? <div className="loading-center"><span className="spinner" /></div>
      : filtered.length === 0 ? (
        <div className="empty-state"><div className="icon">📋</div><h3>No events</h3><p>Activity across invoices, variations, resources, parts and timesheets will appear here.</p></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {filtered.slice(0, 150).map((e, i) => {
            const color = MODULE_COLORS[e.module] || MODULE_COLORS.default
            const date = new Date(e.time)
            const isToday = date.toDateString() === new Date().toDateString()
            return (
              <div key={i} style={{ display: 'flex', gap: '12px', padding: '8px 12px', background: 'var(--bg2)', borderRadius: '6px', borderLeft: `3px solid ${color}` }}>
                <div style={{ minWidth: '120px', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text3)', flexShrink: 0 }}>
                  <div>{isToday ? 'Today' : date.toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })}</div>
                  <div>{date.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}</div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.what}</div>
                  {e.detail && <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '1px' }}>{e.detail}</div>}
                </div>
                {e.who && <div style={{ fontSize: '11px', color: 'var(--text3)', flexShrink: 0 }}>{e.who}</div>}
                <div style={{ flexShrink: 0 }}>
                  <span style={{ fontSize: '9px', padding: '1px 6px', borderRadius: '3px', background: color + '22', color, fontWeight: 600, textTransform: 'uppercase' }}>{e.module}</span>
                </div>
              </div>
            )
          })}
          {filtered.length > 150 && <div style={{ textAlign: 'center', fontSize: '12px', color: 'var(--text3)', padding: '8px' }}>Showing 150 of {filtered.length} events</div>}
        </div>
      )}
    </div>
  )
}
