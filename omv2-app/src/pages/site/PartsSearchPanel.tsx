import { useState } from 'react'
import { supabase } from '../../lib/supabase'

interface PartResult {
  id: string; part_number: string; description: string
  manufacturer: string | null; qty_on_hand: number; qty_reserved: number
  location: string | null; unit: string | null
  project_name: string
}

export function PartsSearchPanel() {
  const [query,   setQuery]   = useState('')
  const [results, setResults] = useState<PartResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  async function search() {
    if (query.trim().length < 2) return
    setLoading(true); setSearched(true)
    const { data } = await supabase
      .from('spare_parts')
      .select('*, project:projects(name)')
      .or(`part_number.ilike.%${query}%,description.ilike.%${query}%,manufacturer.ilike.%${query}%`)
      .order('part_number')
      .limit(200)
    setResults(((data || []) as (PartResult & { project?: { name: string } })[]).map(r => ({ ...r, project_name: r.project?.name || '—' })))
    setLoading(false)
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1000px' }}>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 700 }}>🔍 Parts Search</h1>
        <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>Search across all projects for parts by number, description or manufacturer</p>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        <input className="input" style={{ flex: 1, maxWidth: '500px' }}
          placeholder="Part number, description or manufacturer…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()} />
        <button className="btn btn-primary" onClick={search} disabled={loading || query.trim().length < 2}>
          {loading ? <span className="spinner" style={{ width: '14px', height: '14px' }} /> : '🔍 Search'}
        </button>
      </div>

      {!searched ? (
        <div className="empty-state" style={{ padding: '40px' }}>
          <div className="icon">🔍</div>
          <h3>Search for Parts</h3>
          <p>Enter at least 2 characters to search across all project inventories.</p>
        </div>
      ) : loading ? (
        <div className="loading-center"><span className="spinner" /> Searching…</div>
      ) : results.length === 0 ? (
        <div className="empty-state" style={{ padding: '40px' }}>
          <div className="icon">😶</div>
          <h3>No results for "{query}"</h3>
          <p>Try a different part number or description.</p>
        </div>
      ) : (
        <>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '10px' }}>{results.length} result{results.length !== 1 ? 's' : ''} found</p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Part #</th><th>Description</th><th>Manufacturer</th><th>Project</th>
                <th style={{ textAlign: 'right' }}>On Hand</th>
                <th style={{ textAlign: 'right' }}>Available</th>
                <th>Location</th>
              </tr>
            </thead>
            <tbody>
              {results.map(p => {
                const avail = (p.qty_on_hand || 0) - (p.qty_reserved || 0)
                return (
                  <tr key={p.id}>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '11px', fontWeight: 600 }}>{p.part_number}</td>
                    <td style={{ fontSize: '12px' }}>{p.description}</td>
                    <td style={{ fontSize: '11px', color: 'var(--text3)' }}>{p.manufacturer || '—'}</td>
                    <td style={{ fontSize: '11px' }}><span className="badge" style={{ background: 'var(--bg3)', color: 'var(--text2)', fontSize: '10px' }}>{p.project_name}</span></td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '11px' }}>{p.qty_on_hand}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '11px', fontWeight: 600,
                                 color: avail <= 0 ? 'var(--red)' : 'var(--green)' }}>{avail}</td>
                    <td style={{ fontSize: '11px', color: 'var(--text3)' }}>{p.location || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
