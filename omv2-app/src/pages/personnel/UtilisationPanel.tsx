import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { PersonCard, usePersonCard } from '../../components/PersonCard'
import type { Person } from '../../lib/persons'

interface ResourceRow {
  id: string
  name: string
  role: string
  category: string
  company: string | null
  mob_in: string | null
  mob_out: string | null
  person_id: string | null
  project_id: string
  project_name: string
  person: Person | null
}

const CAT_COLORS: Record<string, string> = {
  trades:        '#3b82f6',
  management:    '#10b981',
  seag:          '#f59e0b',
  subcontractor: '#8b5cf6',
}

function dateRange(year: number, month: number): { start: string; end: string; days: number } {
  const start = new Date(year, month, 1)
  const end = new Date(year, month + 1, 0)
  return {
    start: start.toISOString().slice(0, 10),
    end:   end.toISOString().slice(0, 10),
    days:  end.getDate(),
  }
}

export function UtilisationPanel() {
  const [resources, setResources] = useState<ResourceRow[]>([])
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [filterCat, setFilterCat] = useState('')
  const [filterProject, setFilterProject] = useState('')
  const [viewYear, setViewYear] = useState(new Date().getFullYear())
  const [viewMonth, setViewMonth] = useState(new Date().getMonth())
  const { cardPerson, openCard, closeCard } = usePersonCard()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data: projData } = await supabase.from('projects').select('id,name').order('name')
    setProjects((projData || []) as { id: string; name: string }[])

    const { data } = await supabase
      .from('resources')
      .select('id,name,role,category,company,mob_in,mob_out,person_id,project_id,project:projects!project_id(name),person:persons!person_id(*)')
      .not('mob_in', 'is', null)
      .order('mob_in')
    setResources((data || []).map((r: unknown) => {
      const row = r as Record<string, unknown>
      return {
        ...(row as object),
        project_name: (row.project as { name: string } | null)?.name || '—',
        person: row.person || null,
      }
    }) as ResourceRow[])
    setLoading(false)
  }

  const range = dateRange(viewYear, viewMonth)
  const monthDays = Array.from({ length: range.days }, (_, i) => i + 1)

  const filtered = resources.filter(r => {
    if (filterCat && r.category !== filterCat) return false
    if (filterProject && r.project_id !== filterProject) return false
    // Only show people with overlap in this month
    const mobIn  = r.mob_in || ''
    const mobOut = r.mob_out || '9999-12-31'
    return mobOut >= range.start && mobIn <= range.end
  })

  // Group by person_id (or resource id if unlinked) — show each unique person once
  const personMap = new Map<string, ResourceRow[]>()
  for (const r of filtered) {
    const key = r.person_id || r.id
    if (!personMap.has(key)) personMap.set(key, [])
    personMap.get(key)!.push(r)
  }
  const groupedRows = Array.from(personMap.values())

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
  }

  const monthLabel = new Date(viewYear, viewMonth).toLocaleString('en-AU', { month: 'long', year: 'numeric' })

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflow: 'auto', padding: '24px', minWidth: 0 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700 }}>Utilisation</h1>
            <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
              {groupedRows.length} people · {monthLabel}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn btn-sm" onClick={prevMonth}>←</button>
            <span style={{ fontWeight: 600, minWidth: 120, textAlign: 'center', fontSize: 13 }}>{monthLabel}</span>
            <button className="btn btn-sm" onClick={nextMonth}>→</button>
          </div>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <select className="input" style={{ width: 160 }} value={filterCat} onChange={e => setFilterCat(e.target.value)}>
            <option value="">All categories</option>
            <option value="trades">Trades</option>
            <option value="management">Management</option>
            <option value="seag">SE AG</option>
            <option value="subcontractor">Subcontractor</option>
          </select>
          <select className="input" style={{ width: 220 }} value={filterProject} onChange={e => setFilterProject(e.target.value)}>
            <option value="">All projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {loading ? (
          <div className="loading-center"><span className="spinner" /></div>
        ) : groupedRows.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text3)', padding: 40 }}>
            No resource deployments with mob dates in this period.
          </div>
        ) : (
          <div className="table-scroll-x">
            <table style={{ borderCollapse: 'collapse', minWidth: 900, width: '100%' }}>
              <thead>
                <tr style={{ background: 'var(--bg3)' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left', minWidth: 200, position: 'sticky', left: 0, background: 'var(--bg3)', zIndex: 2 }}>Person</th>
                  {monthDays.map(d => {
                    const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
                    const dow = new Date(dateStr).getDay()
                    const isWeekend = dow === 0 || dow === 6
                    const isToday = dateStr === new Date().toISOString().slice(0,10)
                    return (
                      <th key={d} style={{
                        padding: '4px 2px', textAlign: 'center', fontSize: 9, fontWeight: 400,
                        color: isToday ? 'var(--accent)' : isWeekend ? 'var(--text3)' : 'var(--text2)',
                        background: isWeekend ? 'rgba(0,0,0,0.03)' : 'var(--bg3)',
                        minWidth: 24, width: 24,
                      }}>
                        {d}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {groupedRows.map(deployments => {
                  const first = deployments[0]
                  const person = first.person
                  const catColor = CAT_COLORS[first.category] || '#6b7280'
                  const hasOverlap = deployments.length > 1

                  return (
                    <tr key={first.person_id || first.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      {/* Name cell */}
                      <td style={{ padding: '6px 12px', position: 'sticky', left: 0, background: 'var(--bg)', zIndex: 1, minWidth: 200 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{
                            width: 28, height: 28, borderRadius: '50%', background: catColor + '20',
                            color: catColor, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 10, fontWeight: 700, flexShrink: 0,
                          }}>
                            {first.name.split(' ').map(w => w[0]).slice(0,2).join('')}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div
                              style={{ fontWeight: 600, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: person ? 'pointer' : 'default', color: person ? 'var(--accent)' : 'var(--text)' }}
                              onClick={() => person && openCard(person as Person)}
                            >
                              {first.name}
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {first.role} · {deployments.map(d => d.project_name).join(', ')}
                            </div>
                          </div>
                          {hasOverlap && (
                            <div title="On multiple projects" style={{ background: '#fef3c7', color: '#92400e', fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 3, flexShrink: 0 }}>
                              {deployments.length}×
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Day cells */}
                      {monthDays.map(d => {
                        const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
                        const dow = new Date(dateStr).getDay()
                        const isWeekend = dow === 0 || dow === 6
                        const isToday = dateStr === new Date().toISOString().slice(0,10)
                        const activeDeployments = deployments.filter(dep => {
                          const mobIn  = dep.mob_in  || ''
                          const mobOut = dep.mob_out || '9999-12-31'
                          return dateStr >= mobIn && dateStr <= mobOut
                        })
                        const isActive = activeDeployments.length > 0
                        const isMulti  = activeDeployments.length > 1

                        return (
                          <td key={d} style={{
                            padding: '4px 2px', textAlign: 'center',
                            background: isToday
                              ? 'rgba(0,137,138,0.08)'
                              : isWeekend ? 'rgba(0,0,0,0.02)' : 'transparent',
                          }}>
                            {isActive && (
                              <div style={{
                                height: 16, borderRadius: 2, margin: '0 1px',
                                background: isMulti ? '#ef4444' : catColor,
                                opacity: isWeekend ? 0.5 : 0.8,
                              }} title={activeDeployments.map(d => d.project_name).join(', ')} />
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Legend */}
        <div style={{ display: 'flex', gap: 16, marginTop: 16, fontSize: 11, color: 'var(--text3)', flexWrap: 'wrap' }}>
          {Object.entries(CAT_COLORS).map(([cat, color]) => (
            <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 12, height: 12, borderRadius: 2, background: color }} />
              <span style={{ textTransform: 'capitalize' }}>{cat}</span>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 12, height: 12, borderRadius: 2, background: '#ef4444' }} />
            <span>Multi-project overlap</span>
          </div>
        </div>
      </div>

      {cardPerson && <PersonCard person={cardPerson} onClose={closeCard} />}
    </div>
  )
}
