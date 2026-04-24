import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'

interface InductionPerson { name: string; company: string; inducted_at?: string; [key: string]: unknown }

export function InductionsPanel() {
  const { activeProject, setActiveProject } = useAppStore()
  const [people, setPeople] = useState<InductionPerson[]>([])
  const [search, setSearch] = useState('')
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    if (activeProject?.induction_data) {
      setPeople(activeProject.induction_data as InductionPerson[])
    }
  }, [activeProject?.id])

  async function handleCSV(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const text = await file.text()
    const lines = text.split('\n').filter(l => l.trim())
    if (lines.length < 2) { toast('CSV appears empty','error'); setUploading(false); return }

    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g,'').toLowerCase())
    const nameIdx = headers.findIndex(h => h.includes('name') || h === 'full name')
    const compIdx = headers.findIndex(h => h.includes('company') || h.includes('employer') || h.includes('org'))

    if (nameIdx < 0) { toast('Could not find Name column in CSV','error'); setUploading(false); return }

    const parsed: InductionPerson[] = lines.slice(1).map(line => {
      const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g,''))
      const row: InductionPerson = { name: cols[nameIdx]||'', company: compIdx>=0 ? cols[compIdx]||'' : '' }
      headers.forEach((h, i) => { if (cols[i]) row[h] = cols[i] })
      return row
    }).filter(r => r.name)

    // Save to project
    const { data, error } = await supabase.from('projects')
      .update({ induction_data: parsed, induction_upload_time: new Date().toISOString() })
      .eq('id', activeProject!.id)
      .select('*,site:sites(id,name)').single()

    if (error) { toast(error.message,'error'); setUploading(false); return }
    setActiveProject(data as typeof activeProject)
    setPeople(parsed)
    toast(`${parsed.length} people imported`,'success')
    setUploading(false)
    e.target.value = ''
  }

  async function clearData() {
    if (!confirm('Clear all induction data?')) return
    const { data, error } = await supabase.from('projects')
      .update({ induction_data: null, induction_upload_time: null })
      .eq('id', activeProject!.id)
      .select('*,site:sites(id,name)').single()
    if (error) { toast(error.message,'error'); return }
    setActiveProject(data as typeof activeProject)
    setPeople([])
    toast('Cleared','info')
  }

  const filtered = people.filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.company||'').toLowerCase().includes(search.toLowerCase())
  )
  const companies = [...new Set(people.map(p => p.company).filter(Boolean))]

  return (
    <div style={{padding:'24px',maxWidth:'900px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
        <div>
          <h1 style={{fontSize:'18px',fontWeight:700}}>Site Inductions</h1>
          <p style={{fontSize:'12px',color:'var(--text3)',marginTop:'2px'}}>
            {people.length} people inducted · {companies.length} companies
            {activeProject?.induction_upload_time && (
              <span style={{marginLeft:'8px'}}>· Uploaded {new Date(activeProject.induction_upload_time).toLocaleDateString()}</span>
            )}
          </p>
        </div>
        <div style={{display:'flex',gap:'8px'}}>
          {people.length > 0 && <button className="btn btn-sm" style={{color:'var(--red)'}} onClick={clearData}>Clear</button>}
          <label className="btn btn-primary" style={{cursor:'pointer'}}>
            {uploading ? <span className="spinner" style={{width:'14px',height:'14px'}}/> : '📂'} Import CSV
            <input type="file" accept=".csv" style={{display:'none'}} onChange={handleCSV} />
          </label>
        </div>
      </div>

      {people.length > 0 && (
        <input className="input" style={{maxWidth:'280px',marginBottom:'16px'}} placeholder="Search name or company..." value={search} onChange={e=>setSearch(e.target.value)} />
      )}

      {people.length === 0 ? (
        <div className="empty-state">
          <div className="icon">📋</div>
          <h3>No induction data</h3>
          <p>Import a CSV export from your induction system. The CSV should have Name and Company columns.</p>
        </div>
      ) : (
        <div className="card" style={{padding:0,overflow:'hidden'}}>
          <table>
            <thead><tr><th>#</th><th>Name</th><th>Company</th></tr></thead>
            <tbody>
              {filtered.map((p, i) => (
                <tr key={i}>
                  <td style={{color:'var(--text3)',fontSize:'12px',fontFamily:'var(--mono)'}}>{i+1}</td>
                  <td style={{fontWeight:500}}>{p.name}</td>
                  <td style={{color:'var(--text2)',fontSize:'13px'}}>{p.company||'—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
