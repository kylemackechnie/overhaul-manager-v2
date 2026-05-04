import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { toast } from '../../components/ui/Toast'

interface PartRow {
  id: string
  part_number: string
  description: string
  manufacturer: string | null
  qty_on_hand: number
  qty_reserved: number
  unit: string | null
  location: string | null
  project_id: string
  project_name?: string
  created_at: string
}

export function GlobalPartsPanel() {
  const [parts,   setParts]   = useState<PartRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('spare_parts')
      .select('*, project:projects(name)')
      .order('part_number')
    if (error) { toast(error.message, 'error'); setLoading(false); return }
    const rows = (data || []).map((r: PartRow & { project?: { name: string } }) => ({
      ...r,
      project_name: r.project?.name || '—',
    }))
    setParts(rows)
    setLoading(false)
  }

  const filtered = parts.filter(p => {
    if (!search) return true
    const q = search.toLowerCase()
    return [p.part_number, p.description, p.manufacturer, p.project_name].some(
      f => (f || '').toLowerCase().includes(q)
    )
  })

  const totalParts    = parts.length
  const lowStock      = parts.filter(p => p.qty_on_hand - (p.qty_reserved || 0) <= 0).length
  const totalProjects = new Set(parts.map(p => p.project_id)).size

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>🔩 Global Parts Register</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
            Cross-project view of all spare parts inventory
          </p>
        </div>
        <button className="btn btn-secondary" onClick={load}>↻ Refresh</button>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '12px', marginBottom: '16px' }}>
        {[
          { label: 'Total Parts',    val: totalParts,    color: 'var(--accent)' },
          { label: 'Projects',       val: totalProjects, color: 'var(--text)'   },
          { label: 'Out of Stock',   val: lowStock,      color: lowStock > 0 ? 'var(--red)' : 'var(--green)' },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '14px' }}>
            <div style={{ fontSize: '22px', fontWeight: 700, color: s.color }}>{s.val}</div>
            <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Search */}
      <input className="input" style={{ marginBottom: '12px', maxWidth: '400px' }}
        placeholder="Search part number, description, manufacturer…"
        value={search} onChange={e => setSearch(e.target.value)} />

      {loading ? (
        <div className="loading-center"><span className="spinner" /> Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="icon">🔩</div>
          <h3>{search ? 'No matching parts' : 'No parts in any project yet'}</h3>
          <p>Parts are added through individual project spare parts modules.</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Part Number</th>
                <th>Description</th>
                <th>Manufacturer</th>
                <th>Project</th>
                <th style={{ textAlign: 'right' }}>On Hand</th>
                <th style={{ textAlign: 'right' }}>Reserved</th>
                <th style={{ textAlign: 'right' }}>Available</th>
                <th>Location</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const avail = (p.qty_on_hand || 0) - (p.qty_reserved || 0)
                return (
                  <tr key={p.id}>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '11px', fontWeight: 600 }}>{p.part_number}</td>
                    <td style={{ fontSize: '12px' }}>{p.description}</td>
                    <td style={{ fontSize: '11px', color: 'var(--text3)' }}>{p.manufacturer || '—'}</td>
                    <td style={{ fontSize: '11px' }}>{p.project_name}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '11px' }}>{p.qty_on_hand ?? '—'}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text3)' }}>{p.qty_reserved || 0}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '11px', fontWeight: 600,
                                 color: avail <= 0 ? 'var(--red)' : avail <= 2 ? 'var(--orange, #f59e0b)' : 'var(--green)' }}>
                      {avail}
                    </td>
                    <td style={{ fontSize: '11px', color: 'var(--text3)' }}>{p.location || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
