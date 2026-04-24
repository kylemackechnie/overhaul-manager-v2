import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'

interface SavedReport {
  id: string; project_id: string; title: string; type: string
  content: string; created_at: string; created_by: string
}

export function ReportsDatabasePanel() {
  const { activeProject } = useAppStore()
  const [reports, setReports] = useState<SavedReport[]>([])
  const [loading, setLoading] = useState(true)
  const [viewReport, setViewReport] = useState<SavedReport|null>(null)
  const [typeFilter, setTypeFilter] = useState('all')

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('saved_reports')
      .select('*').eq('project_id', activeProject!.id)
      .order('created_at', { ascending: false })
    setReports((data||[]) as SavedReport[])
    setLoading(false)
  }

  async function del(r: SavedReport) {
    if (!confirm(`Delete report "${r.title}"?`)) return
    await supabase.from('saved_reports').delete().eq('id', r.id)
    toast('Deleted','info'); load()
  }

  const types = [...new Set(reports.map(r => r.type))]
  const filtered = reports.filter(r => typeFilter === 'all' || r.type === typeFilter)

  return (
    <div style={{ padding:'24px', maxWidth:'1000px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'16px' }}>
        <div>
          <h1 style={{ fontSize:'18px', fontWeight:707 }}>Reports Database</h1>
          <p style={{ fontSize:'12px', color:'var(--text3)', marginTop:'2px' }}>{reports.length} saved reports</p>
        </div>
      </div>

      {types.length > 0 && (
        <div style={{ display:'flex', gap:'4px', marginBottom:'16px', flexWrap:'wrap' }}>
          <button className="btn btn-sm" style={{ background:typeFilter==='all'?'var(--accent)':'var(--bg)', color:typeFilter==='all'?'#fff':'var(--text)' }} onClick={()=>setTypeFilter('all')}>All ({reports.length})</button>
          {types.map(t => (
            <button key={t} className="btn btn-sm" style={{ background:typeFilter===t?'var(--accent)':'var(--bg)', color:typeFilter===t?'#fff':'var(--text)' }} onClick={()=>setTypeFilter(t)}>
              {t} ({reports.filter(r=>r.type===t).length})
            </button>
          ))}
        </div>
      )}

      {loading ? <div className="loading-center"><span className="spinner"/> Loading...</div>
      : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="icon">📦</div>
          <h3>No saved reports</h3>
          <p>Reports saved from the Cost Summary and Customer Report panels will appear here.</p>
        </div>
      ) : (
        <div className="card" style={{ padding:0, overflow:'hidden' }}>
          <table>
            <thead><tr><th>Title</th><th>Type</th><th>Created</th><th>By</th><th></th></tr></thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight:500 }}>{r.title}</td>
                  <td><span className="badge" style={{ bg:'#dbeafe', color:'#1e40af' } as {bg:string,color:string}}>{r.type}</span></td>
                  <td style={{ fontFamily:'var(--mono)', fontSize:'12px', color:'var(--text3)' }}>{new Date(r.created_at).toLocaleDateString('en-AU')}</td>
                  <td style={{ fontSize:'12px', color:'var(--text2)' }}>{r.created_by || '—'}</td>
                  <td style={{ whiteSpace:'nowrap' }}>
                    <button className="btn btn-sm" onClick={()=>setViewReport(r)}>View</button>
                    <button className="btn btn-sm" style={{ marginLeft:'4px', color:'var(--red)' }} onClick={()=>del(r)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {viewReport && (
        <div className="modal-overlay" onClick={()=>setViewReport(null)}>
          <div className="modal" style={{ maxWidth:'800px', maxHeight:'85vh' }} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h3>{viewReport.title}</h3>
              <button className="btn btn-sm" onClick={()=>setViewReport(null)}>✕</button>
            </div>
            <div style={{ padding:'16px 20px', overflowY:'auto', maxHeight:'calc(85vh - 80px)' }}>
              <div dangerouslySetInnerHTML={{ __html: viewReport.content }} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
