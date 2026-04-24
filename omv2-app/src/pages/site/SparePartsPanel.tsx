import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'

interface WositLine {
  id: string; item_no: string; description: string; part_no: string
  qty_required: number; qty_ordered: number; qty_received: number
  vendor: string; status: string; notes: string
}

const STATUSES = ['required','ordered','received','not_required'] as const
const STATUS_COLORS: Record<string,{bg:string,color:string}> = {
  required:{bg:'#dbeafe',color:'#1e40af'}, ordered:{bg:'#fef3c7',color:'#92400e'},
  received:{bg:'#d1fae5',color:'#065f46'}, not_required:{bg:'#e5e7eb',color:'#374151'},
}

const EMPTY = { item_no:'', description:'', part_no:'', qty_required:1, qty_ordered:0, qty_received:0, vendor:'', status:'required', notes:'' }

export function SparePartsPanel() {
  const { activeProject } = useAppStore()
  const [parts, setParts] = useState<WositLine[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null|'new'|WositLine>(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('wosit_lines')
      .select('*').eq('project_id', activeProject!.id).order('item_no')
    setParts((data||[]) as WositLine[])
    setLoading(false)
  }

  function openNew() { setForm(EMPTY); setModal('new') }
  function openEdit(p: WositLine) {
    setForm({ item_no:p.item_no, description:p.description, part_no:p.part_no,
      qty_required:p.qty_required, qty_ordered:p.qty_ordered, qty_received:p.qty_received,
      vendor:p.vendor, status:p.status, notes:p.notes })
    setModal(p)
  }

  async function save() {
    if (!form.description.trim()) return toast('Description required','error')
    setSaving(true)
    const payload = { project_id:activeProject!.id, item_no:form.item_no.trim(), description:form.description.trim(),
      part_no:form.part_no.trim(), qty_required:form.qty_required, qty_ordered:form.qty_ordered,
      qty_received:form.qty_received, vendor:form.vendor, status:form.status, notes:form.notes }
    if (modal==='new') {
      const { error } = await supabase.from('wosit_lines').insert(payload)
      if (error) { toast(error.message,'error'); setSaving(false); return }
      toast('Part added','success')
    } else {
      const { error } = await supabase.from('wosit_lines').update(payload).eq('id',(modal as WositLine).id)
      if (error) { toast(error.message,'error'); setSaving(false); return }
      toast('Saved','success')
    }
    setSaving(false); setModal(null); load()
  }

  async function del(p: WositLine) {
    if (!confirm(`Delete "${p.description}"?`)) return
    await supabase.from('wosit_lines').delete().eq('id', p.id)
    toast('Deleted','info'); load()
  }

  async function handleCSV(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    const text = await file.text()
    const lines = text.split('\n').filter(l=>l.trim())
    if (lines.length < 2) { toast('CSV too short','error'); return }
    const headers = lines[0].split(',').map(h=>h.trim().replace(/^"|"$/g,'').toLowerCase())
    const toInsert = lines.slice(1).map(line => {
      const cols = line.split(',').map(c=>c.trim().replace(/^"|"$/g,''))
      const get = (...names: string[]) => { for (const n of names) { const i = headers.findIndex(h=>h.includes(n)); if (i>=0) return cols[i]||'' } return '' }
      return { project_id:activeProject!.id, item_no:get('item','no','#'), description:get('description','desc','name'),
        part_no:get('part','material'), qty_required:parseInt(get('qty','quantity','required'))||1,
        qty_ordered:0, qty_received:0, vendor:get('vendor','supplier'), status:'required', notes:get('notes','comment') }
    }).filter(r=>r.description)
    if (!toInsert.length) { toast('No valid rows found','error'); return }
    const { error } = await supabase.from('wosit_lines').insert(toInsert)
    if (error) { toast(error.message,'error'); return }
    toast(`${toInsert.length} parts imported`,'success'); load()
    e.target.value = ''
  }

  const filtered = parts
    .filter(p=>statusFilter==='all'||p.status===statusFilter)
    .filter(p=>!search||p.description.toLowerCase().includes(search.toLowerCase())||p.part_no.toLowerCase().includes(search.toLowerCase())||p.item_no.toLowerCase().includes(search.toLowerCase()))

  const statCounts = (s: string) => parts.filter(p=>p.status===s).length

  return (
    <div style={{ padding:'24px', maxWidth:'1100px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'16px' }}>
        <div>
          <h1 style={{ fontSize:'18px', fontWeight:700 }}>Spare Parts (WOSIT)</h1>
          <p style={{ fontSize:'12px', color:'var(--text3)', marginTop:'2px' }}>{parts.length} parts</p>
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          <label className="btn" style={{ cursor:'pointer' }}>
            📂 Import CSV
            <input type="file" accept=".csv" style={{ display:'none' }} onChange={handleCSV} />
          </label>
          <button className="btn btn-primary" onClick={openNew}>+ Add Part</button>
        </div>
      </div>

      <div style={{ display:'flex', gap:'8px', marginBottom:'16px', flexWrap:'wrap', alignItems:'center' }}>
        <input className="input" style={{ maxWidth:'240px' }} placeholder="Search description, part no..." value={search} onChange={e=>setSearch(e.target.value)} />
        {(['all',...STATUSES] as string[]).map(s => (
          <button key={s} className="btn btn-sm"
            style={{ background:statusFilter===s?'var(--accent)':'var(--bg)', color:statusFilter===s?'#fff':'var(--text)' }}
            onClick={()=>setStatusFilter(s)}>
            {s==='all'?`All (${parts.length})`:`${s.replace('_',' ')} (${statCounts(s)})`}
          </button>
        ))}
      </div>

      {loading ? <div className="loading-center"><span className="spinner"/> Loading...</div>
      : filtered.length===0 ? (
        <div className="empty-state"><div className="icon">🔩</div><h3>No spare parts</h3><p>Add parts manually or import a WOSIT CSV export.</p></div>
      ) : (
        <div className="card" style={{ padding:0, overflow:'hidden' }}>
          <table style={{ fontSize:'12px' }}>
            <thead>
              <tr>
                <th>Item #</th><th>Description</th><th>Part No.</th>
                <th style={{ textAlign:'right' }}>Req'd</th>
                <th style={{ textAlign:'right' }}>Ordered</th>
                <th style={{ textAlign:'right' }}>Received</th>
                <th>Vendor</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const sc = STATUS_COLORS[p.status]||STATUS_COLORS.required
                return (
                  <tr key={p.id}>
                    <td style={{ fontFamily:'var(--mono)', fontWeight:500 }}>{p.item_no||'—'}</td>
                    <td style={{ fontWeight:500 }}>{p.description}</td>
                    <td style={{ fontFamily:'var(--mono)', color:'var(--text3)' }}>{p.part_no||'—'}</td>
                    <td style={{ textAlign:'right', fontFamily:'var(--mono)' }}>{p.qty_required}</td>
                    <td style={{ textAlign:'right', fontFamily:'var(--mono)', color: p.qty_ordered>0?undefined:'var(--text3)' }}>{p.qty_ordered||'—'}</td>
                    <td style={{ textAlign:'right', fontFamily:'var(--mono)', color: p.qty_received>=p.qty_required?'var(--green)':'var(--text)' }}>
                      {p.qty_received||'—'}
                    </td>
                    <td style={{ color:'var(--text2)' }}>{p.vendor||'—'}</td>
                    <td><span className="badge" style={sc}>{p.status.replace('_',' ')}</span></td>
                    <td style={{ whiteSpace:'nowrap' }}>
                      <button className="btn btn-sm" onClick={()=>openEdit(p)}>Edit</button>
                      <button className="btn btn-sm" style={{ marginLeft:'4px', color:'var(--red)' }} onClick={()=>del(p)}>✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="modal-overlay" onClick={()=>setModal(null)}>
          <div className="modal" style={{ maxWidth:'520px' }} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal==='new'?'Add Spare Part':'Edit Part'}</h3>
              <button className="btn btn-sm" onClick={()=>setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg-row">
                <div className="fg"><label>Item #</label><input className="input" value={form.item_no} onChange={e=>setForm(f=>({...f,item_no:e.target.value}))} placeholder="e.g. 1.1" /></div>
                <div className="fg" style={{ flex:3 }}><label>Description</label><input className="input" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} autoFocus /></div>
              </div>
              <div className="fg-row">
                <div className="fg" style={{ flex:2 }}><label>Part / Material No.</label><input className="input" value={form.part_no} onChange={e=>setForm(f=>({...f,part_no:e.target.value}))} /></div>
                <div className="fg"><label>Vendor</label><input className="input" value={form.vendor} onChange={e=>setForm(f=>({...f,vendor:e.target.value}))} /></div>
              </div>
              <div className="fg-row">
                <div className="fg"><label>Qty Required</label><input type="number" className="input" value={form.qty_required} onChange={e=>setForm(f=>({...f,qty_required:parseInt(e.target.value)||0}))} /></div>
                <div className="fg"><label>Qty Ordered</label><input type="number" className="input" value={form.qty_ordered} onChange={e=>setForm(f=>({...f,qty_ordered:parseInt(e.target.value)||0}))} /></div>
                <div className="fg"><label>Qty Received</label><input type="number" className="input" value={form.qty_received} onChange={e=>setForm(f=>({...f,qty_received:parseInt(e.target.value)||0}))} /></div>
              </div>
              <div className="fg"><label>Status</label>
                <select className="input" value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>
                  {STATUSES.map(s=><option key={s} value={s}>{s.replace('_',' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>)}
                </select>
              </div>
              <div className="fg"><label>Notes</label><input className="input" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} /></div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={()=>setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?<span className="spinner" style={{width:'14px',height:'14px'}}/>:null} Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
