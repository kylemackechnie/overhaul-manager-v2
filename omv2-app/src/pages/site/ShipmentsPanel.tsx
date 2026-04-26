import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import type { Shipment } from '../../types'
import { downloadCSV } from '../../lib/csv'

type Direction = 'import' | 'export'

const STATUSES = ['pending','in_transit','customs','delivered','returned'] as const
const STATUS_COLORS: Record<string, {bg:string,color:string}> = {
  pending:{bg:'#f1f5f9',color:'#64748b'}, in_transit:{bg:'#dbeafe',color:'#1e40af'},
  customs:{bg:'#fef3c7',color:'#92400e'}, delivered:{bg:'#d1fae5',color:'#065f46'},
  returned:{bg:'#fee2e2',color:'#7f1d1d'},
}

const EMPTY = {
  direction:'import' as Direction, reference:'', description:'',
  status:'pending', carrier:'', tracking:'', eta:'', shipped_date:'',
  origin:'', notes:''
}

export function ShipmentsPanel({ direction }: { direction: Direction }) {
  const { activeProject } = useAppStore()
  const [items, setItems] = useState<Shipment[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null|'new'|Shipment>(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id, direction])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('shipments').select('*')
      .eq('project_id', activeProject!.id).eq('direction', direction)
      .order('created_at', { ascending: false })
    setItems((data || []) as Shipment[])
    setLoading(false)
  }

  function openNew() { setForm({ ...EMPTY, direction, origin:'' }); setModal('new') }
  function openEdit(s: Shipment) {
    setForm({
      direction: s.direction, reference: s.reference, description: s.description,
      status: s.status, carrier: s.carrier, tracking: s.tracking,
      eta: s.eta || '', shipped_date: s.shipped_date || '',
      origin: (s as typeof s & {origin?:string}).origin || '', notes: s.notes,
    })
    setModal(s)
  }

  async function save() {
    setSaving(true)
    const payload = {
      project_id: activeProject!.id, direction,
      reference: form.reference.trim(), description: form.description,
      status: form.status, carrier: form.carrier, tracking: form.tracking,
      eta: form.eta || null, shipped_date: form.shipped_date || null, notes: form.notes,
    }
    if (modal === 'new') {
      const { error } = await supabase.from('shipments').insert(payload)
      if (error) { toast(error.message,'error'); setSaving(false); return }
      toast('Shipment added','success')
    } else {
      const { error } = await supabase.from('shipments').update(payload).eq('id',(modal as Shipment).id)
      if (error) { toast(error.message,'error'); setSaving(false); return }
      toast('Saved','success')
    }
    setSaving(false); setModal(null); load()
  }

  
  function exportCSV() {
    downloadCSV(
      [["reference", "description", "carrier", "direction", "status", "eta", "shipped_date"], ...items.map(item => [String(item.reference||''), String(item.description||''), String(item.carrier||''), String(item.direction||''), String(item.status||''), String(item.eta||''), String(item.shipped_date||'')])],
      'shipments_' + (activeProject?.name || 'project')
    )
  }

  async function del(s: Shipment) {
    const pid = activeProject!.id
    // Check if this shipment references a TV
    const ref = s.reference || ''
    const tvNo = ref.startsWith('TV') ? ref.slice(2) : null

    if (tvNo) {
      // Check what downstream data exists
      const [tvLink, kollos, wositLines] = await Promise.all([
        supabase.from('project_tvs').select('tv_no').eq('project_id', pid).eq('tv_no', tvNo).maybeSingle(),
        supabase.from('global_kollos').select('kollo_id').eq('tv_no', tvNo),
        supabase.from('wosit_lines').select('id').eq('project_id', pid).eq('tv_no', tvNo),
      ])
      const hasTV = !!tvLink.data
      const kolloCount = kollos.data?.length || 0
      const wositCount = wositLines.data?.length || 0

      const lines = [`Remove shipment ${ref}?`, '']
      if (hasTV) lines.push(`TV${tvNo} will be removed from the TV Register and Costing.`)
      if (kolloCount) lines.push(`${kolloCount} package record(s) for TV${tvNo} will be deleted.`)
      if (wositCount) lines.push(`${wositCount} spare parts line(s) for TV${tvNo} will be deleted.`)
      lines.push('', 'Delete shipment only, or delete everything?')

      const choice = await new Promise<'cancel'|'shiponly'|'all'>(resolve => {
        const overlay = document.createElement('div')
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center'
        overlay.innerHTML = `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:24px;max-width:420px;width:90vw;box-shadow:0 20px 60px rgba(0,0,0,.3)">
          <div style="font-size:16px;font-weight:700;color:var(--red);margin-bottom:12px">🗑 Delete Shipment</div>
          <p style="white-space:pre-line;font-size:13px;color:var(--text2);line-height:1.6;margin-bottom:14px">${lines.join('\n')}</p>
          <div style="background:#fef2f2;border:1px solid #ef4444;border-radius:6px;padding:10px;font-size:11px;color:#ef4444;margin-bottom:16px">⚠ Cascade delete cannot be undone.</div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button id="_dsCancelBtn" style="padding:7px 14px;border:1px solid var(--border);border-radius:6px;background:var(--bg3);cursor:pointer;font-size:13px">Cancel</button>
            <button id="_dsShipOnlyBtn" style="padding:7px 14px;border:1px solid var(--border);border-radius:6px;background:var(--bg3);cursor:pointer;font-size:13px">Shipment Only</button>
            <button id="_dsAllBtn" style="padding:7px 14px;border:none;border-radius:6px;background:#ef4444;color:#fff;cursor:pointer;font-size:13px;font-weight:600">Delete Everything</button>
          </div>
        </div>`
        document.body.appendChild(overlay)
        overlay.querySelector('#_dsCancelBtn')!.addEventListener('click', () => { overlay.remove(); resolve('cancel') })
        overlay.querySelector('#_dsShipOnlyBtn')!.addEventListener('click', () => { overlay.remove(); resolve('shiponly') })
        overlay.querySelector('#_dsAllBtn')!.addEventListener('click', () => { overlay.remove(); resolve('all') })
      })

      if (choice === 'cancel') return

      // Always delete the shipment
      await supabase.from('shipments').delete().eq('id', s.id)

      if (choice === 'all') {
        // Cascade: TV Register, costings, kollos, WOSIT lines
        await supabase.from('project_tvs').delete().eq('project_id', pid).eq('tv_no', tvNo)
        await supabase.from('tooling_costings').delete().eq('project_id', pid).eq('tv_no', tvNo)
        if (kollos.data && kollos.data.length > 0) {
          const kolloIds = kollos.data.map(k => k.kollo_id)
          await supabase.from('project_kollos').delete().eq('project_id', pid).in('kollo_id', kolloIds)
        }
        if (wositCount > 0) {
          await supabase.from('wosit_lines').delete().eq('project_id', pid).eq('tv_no', tvNo)
        }
        toast(`Shipment ${ref} and all related data deleted`, 'info')
      } else {
        toast(`Shipment ${ref} deleted`, 'info')
      }
    } else {
      // Non-TV shipment — simple confirm
      if (!confirm(`Delete shipment "${ref}"?`)) return
      await supabase.from('shipments').delete().eq('id', s.id)
      toast('Deleted', 'info')
    }
    load()
  }

  const label = direction === 'import' ? 'Inbound' : 'Outbound'
  const icon = direction === 'import' ? '📦' : '🚚'

  return (
    <div style={{ padding:'24px', maxWidth:'1000px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'16px' }}>
        <div>
          <h1 style={{ fontSize:'18px', fontWeight:700 }}>{icon} {label} Shipments</h1>
          <p style={{ fontSize:'12px', color:'var(--text3)', marginTop:'2px' }}>{items.length} shipments</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ Add Shipment</button>
          <button className="btn btn-sm" onClick={exportCSV}>⬇ CSV</button>
      </div>

      {loading ? <div className="loading-center"><span className="spinner"/> Loading...</div>
      : items.length === 0 ? (
        <div className="empty-state">
          <div className="icon">{icon}</div>
          <h3>No {label.toLowerCase()} shipments</h3>
          <p>Track tooling, equipment and parts shipments here.</p>
        </div>
      ) : (
        <div className="card" style={{ padding:0, overflow:'hidden' }}>
          <table>
            <thead>
              <tr><th>Reference</th><th>Description</th><th>Status</th><th>Carrier</th><th>Tracking</th><th>ETA</th><th></th></tr>
            </thead>
            <tbody>
              {items.map(s => {
                const sc = STATUS_COLORS[s.status] || STATUS_COLORS.pending
                return (
                  <tr key={s.id}>
                    <td style={{ fontFamily:'var(--mono)', fontWeight:600, fontSize:'12px' }}>{s.reference || '—'}</td>
                    <td style={{ color:'var(--text2)', maxWidth:'200px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.description || '—'}</td>
                    <td><span className="badge" style={sc}>{s.status.replace('_',' ')}</span></td>
                    <td style={{ fontSize:'12px' }}>{s.carrier || '—'}</td>
                    <td style={{ fontFamily:'var(--mono)', fontSize:'11px', color:'var(--text3)' }}>{s.tracking || '—'}</td>
                    <td style={{ fontFamily:'var(--mono)', fontSize:'12px' }}>{s.eta || '—'}</td>
                    <td style={{ whiteSpace:'nowrap' }}>
                      <button className="btn btn-sm" onClick={() => openEdit(s)}>Edit</button>
                      <button className="btn btn-sm" style={{ marginLeft:'4px', color:'var(--red)' }} onClick={() => del(s)}>✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" style={{ maxWidth:'520px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal==='new' ? `New ${label} Shipment` : `Edit Shipment`}</h3>
              <button className="btn btn-sm" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg-row">
                <div className="fg">
                  <label>Reference</label>
                  <input className="input" value={form.reference} onChange={e=>setForm(f=>({...f,reference:e.target.value}))} placeholder="e.g. TV482, PO-1234" autoFocus />
                </div>
                <div className="fg">
                  <label>Status</label>
                  <select className="input" value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>
                    {STATUSES.map(s=><option key={s} value={s}>{s.replace('_',' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>)}
                  </select>
                </div>
              </div>
              <div className="fg">
                <label>Description</label>
                <input className="input" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="What's being shipped" />
              </div>
              <div className="fg-row">
                <div className="fg">
                  <label>Carrier</label>
                  <input className="input" value={form.carrier} onChange={e=>setForm(f=>({...f,carrier:e.target.value}))} placeholder="e.g. DHL, Toll" />
                </div>
                <div className="fg" style={{ flex:2 }}>
                  <label>Tracking Number</label>
                  <input className="input" value={form.tracking} onChange={e=>setForm(f=>({...f,tracking:e.target.value}))} />
                </div>
              </div>
              <div className="fg-row">
                <div className="fg">
                  <label>{direction==='import' ? 'ETA' : 'Ship Date'}</label>
                  <input type="date" className="input" value={direction==='import' ? form.eta : form.shipped_date}
                    onChange={e=>setForm(f=>direction==='import' ? {...f,eta:e.target.value} : {...f,shipped_date:e.target.value})} />
                </div>
                <div className="fg">
                  <label>{direction==='import' ? 'Ship Date' : 'ETA'}</label>
                  <input type="date" className="input" value={direction==='import' ? form.shipped_date : form.eta}
                    onChange={e=>setForm(f=>direction==='import' ? {...f,shipped_date:e.target.value} : {...f,eta:e.target.value})} />
                </div>
              </div>
              <div className="fg">
                <label>Notes</label>
                <textarea className="input" rows={2} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} style={{ resize:'vertical' }} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving?<span className="spinner" style={{width:'14px',height:'14px'}}/>:null} Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
