import * as XLSX from 'xlsx'
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'


interface InductionPerson { name: string; company: string; inducted_at?: string; [key: string]: unknown }


// Fuzzy name match: normalise name, check first+last token overlap (port of HTML fuzzyNameMatch)
export function fuzzyNameMatch(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
  const na = norm(a); const nb = norm(b)
  if (na === nb) return 1
  const ta = na.split(' '); const tb = nb.split(' ')
  // Exact first+last match
  if (ta[0] === tb[0] && ta[ta.length-1] === tb[tb.length-1]) return 0.95
  // Reversed first/last (SMITH, John vs John Smith)
  if (ta[0] === tb[tb.length-1] && ta[ta.length-1] === tb[0]) return 0.9
  // Any token overlap score
  const setA = new Set(ta); const setB = new Set(tb)
  const overlap = [...setA].filter(t => setB.has(t) && t.length > 2).length
  const total = Math.max(setA.size, setB.size)
  return total > 0 ? overlap / total : 0
}

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

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)

    // Handle XLSX files
    if (file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls')) {
      try {
        const buffer = await file.arrayBuffer()
        const wb = XLSX.read(buffer, { type: 'array' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown as string[][]
        if (rawRows.length < 2) { toast('Spreadsheet appears empty', 'error'); setUploading(false); return }
        const headers = rawRows[0].map(h => String(h).trim().toLowerCase())
        const nameIdx = headers.findIndex(h => h.includes('name') || h === 'full name' || h === 'employee')
        const compIdx = headers.findIndex(h => h.includes('company') || h.includes('employer') || h.includes('org') || h.includes('contractor'))
        if (nameIdx < 0) { toast('Could not find Name column in spreadsheet', 'error'); setUploading(false); return }
        const parsed: InductionPerson[] = rawRows.slice(1)
          .map(row => ({ name: String(row[nameIdx]||'').trim(), company: compIdx >= 0 ? String(row[compIdx]||'').trim() : '' }))
          .filter(r => r.name)
        if (parsed.length === 0) { toast('No people found in file', 'error'); setUploading(false); return }
        const { error } = await supabase.from('projects')
          .update({ induction_data: parsed, induction_upload_time: new Date().toISOString() })
          .eq('id', activeProject!.id)
        if (error) { toast(error.message, 'error') } else {
          setPeople(parsed)
          setActiveProject({ ...activeProject!, induction_data: parsed, induction_upload_time: new Date().toISOString() })
          toast(`Imported ${parsed.length} people from spreadsheet`, 'success')
        }
        setUploading(false)
        return
      } catch (err) { toast('Failed to parse spreadsheet', 'error'); setUploading(false); return }
    }

    // Handle CSV files
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
            {uploading ? <span className="spinner" style={{width:'14px',height:'14px'}}/> : '📂'} Import CSV / XLSX
            <input type="file" accept=".csv,.xlsx,.xls" style={{display:'none'}} onChange={handleFile} />
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
