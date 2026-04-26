import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'

interface SparePart {
  id: string; part_number: string; description: string
  qty_on_hand: number; qty_reserved: number; unit: string | null; location: string | null
}
interface WO { id: string; wo_number: string; description: string }

interface IssueLine {
  part_id: string; part_number: string; description: string; available: number
  qty: number; wo_id: string; purpose: string
}

export function PartsIssuePanel() {
  const { activeProject } = useAppStore()
  const [parts,   setParts]   = useState<SparePart[]>([])
  const [wos,     setWos]     = useState<WO[]>([])
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [lines,   setLines]   = useState<IssueLine[]>([])
  const [search,  setSearch]  = useState('')
  const [history, setHistory] = useState<{id:string;issued_date:string;part_number:string;description:string;qty:number;wo_number:string|null;purpose:string|null}[]>([])
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0,10))

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [pRes, woRes, hRes] = await Promise.all([
      supabase.from('spare_parts').select('id,part_number,description,qty_on_hand,qty_reserved,unit,location').eq('project_id', pid).order('part_number'),
      supabase.from('work_orders').select('id,wo_number,description').eq('project_id', pid).order('wo_number'),
      supabase.from('parts_issues').select('id,issued_date,qty,purpose,spare_part:spare_parts(part_number,description),work_order:work_orders(wo_number)').eq('project_id', pid).order('issued_date', { ascending: false }).limit(50),
    ])
    setParts((pRes.data || []) as SparePart[])
    setWos((woRes.data || []) as WO[])
    const h = (hRes.data || []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      issued_date: r.issued_date as string,
      part_number: (r.spare_part as {part_number:string}|null)?.part_number || '—',
      description: (r.spare_part as {description:string}|null)?.description || '—',
      qty: r.qty as number,
      wo_number: (r.work_order as {wo_number:string}|null)?.wo_number || null,
      purpose: r.purpose as string | null,
    }))
    setHistory(h)
    setLoading(false)
  }

  function addLine(part: SparePart) {
    if (lines.some(l => l.part_id === part.id)) return
    const available = (part.qty_on_hand || 0) - (part.qty_reserved || 0)
    setLines(ls => [...ls, { part_id: part.id, part_number: part.part_number, description: part.description, available, qty: 1, wo_id: '', purpose: '' }])
    setSearch('')
  }

  function updateLine(i: number, patch: Partial<IssueLine>) {
    setLines(ls => ls.map((l, j) => j === i ? { ...l, ...patch } : l))
  }

  async function issue() {
    if (!lines.length) { toast('Add at least one part', 'error'); return }
    const over = lines.find(l => l.qty > l.available)
    if (over) { toast(`Insufficient stock for ${over.part_number} (available: ${over.available})`, 'error'); return }
    const bad = lines.find(l => l.qty <= 0)
    if (bad) { toast(`Qty must be > 0 for ${bad.part_number}`, 'error'); return }
    setSaving(true)
    const pid = activeProject!.id

    for (const line of lines) {
      const { error: iErr } = await supabase.from('parts_issues').insert({
        project_id: pid, spare_part_id: line.part_id,
        work_order_id: line.wo_id || null,
        issued_date: issueDate, qty: line.qty, purpose: line.purpose || null,
      })
      if (iErr) { toast(`Failed for ${line.part_number}: ${iErr.message}`, 'error'); continue }

      const part = parts.find(p => p.id === line.part_id)
      if (part) {
        await supabase.from('spare_parts').update({ qty_on_hand: Math.max(0, (part.qty_on_hand || 0) - line.qty) }).eq('id', line.part_id)
      }
    }

    toast(`${lines.length} part(s) issued`, 'success')
    setSaving(false); setLines([]); load()
  }

  const filteredParts = search.length > 1
    ? parts.filter(p => {
        const avail = (p.qty_on_hand || 0) - (p.qty_reserved || 0)
        return avail > 0 && [p.part_number, p.description].some(f => (f||'').toLowerCase().includes(search.toLowerCase()))
      })
    : []

  return (
    <div style={{ padding: '24px', maxWidth: '1000px' }}>
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 700 }}>📋 Issue Parts</h1>
        <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>Issue parts from inventory to work orders</p>
      </div>

      <div className="card" style={{ marginBottom: '16px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>New Issue</div>

        <div className="fg-row" style={{ marginBottom: '10px' }}>
          <div className="fg" style={{ maxWidth: '180px' }}>
            <label>Issue Date</label>
            <input type="date" className="input" value={issueDate} onChange={e => setIssueDate(e.target.value)} />
          </div>
        </div>

        <div style={{ position: 'relative', marginBottom: '12px' }}>
          <input className="input" placeholder="Search available parts to issue…"
            value={search} onChange={e => setSearch(e.target.value)} />
          {filteredParts.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', maxHeight: '220px', overflowY: 'auto' }}>
              {filteredParts.map(p => {
                const avail = (p.qty_on_hand || 0) - (p.qty_reserved || 0)
                return (
                  <div key={p.id} style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '12px', borderBottom: '1px solid var(--border)' }}
                    onClick={() => addLine(p)}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}>
                    <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, marginRight: '8px' }}>{p.part_number}</span>
                    {p.description}
                    <span style={{ float: 'right', color: avail > 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>Available: {avail}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {lines.length > 0 && (
          <table className="data-table" style={{ marginBottom: '12px' }}>
            <thead>
              <tr>
                <th>Part</th>
                <th style={{ textAlign: 'right', width: '70px' }}>Avail</th>
                <th style={{ textAlign: 'right', width: '70px' }}>Qty</th>
                <th style={{ width: '160px' }}>Work Order</th>
                <th>Purpose</th>
                <th style={{ width: '32px' }}></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.part_id}>
                  <td style={{ fontSize: '11px' }}>
                    <div style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{l.part_number}</div>
                    <div style={{ color: 'var(--text3)' }}>{l.description}</div>
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '11px', color: l.available > 0 ? 'var(--green)' : 'var(--red)' }}>{l.available}</td>
                  <td>
                    <input type="number" className="input" style={{ textAlign: 'right', padding: '2px 6px', width: '60px', borderColor: l.qty > l.available ? 'var(--red)' : '' }}
                      min={1} max={l.available} value={l.qty}
                      onChange={e => updateLine(i, { qty: parseInt(e.target.value) || 0 })} />
                  </td>
                  <td>
                    <select className="input" style={{ fontSize: '11px', padding: '2px 4px', height: '26px' }} value={l.wo_id} onChange={e => updateLine(i, { wo_id: e.target.value })}>
                      <option value="">— No WO —</option>
                      {wos.map(w => <option key={w.id} value={w.id}>{w.wo_number}</option>)}
                    </select>
                  </td>
                  <td><input className="input" style={{ fontSize: '11px', padding: '2px 6px', width: '100%' }} placeholder="Purpose…" value={l.purpose} onChange={e => updateLine(i, { purpose: e.target.value })} /></td>
                  <td><button className="btn btn-sm" style={{ color: 'var(--red)' }} onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <button className="btn btn-primary" disabled={saving || lines.length === 0} onClick={issue}>
          {saving ? <span className="spinner" style={{ width: '14px', height: '14px' }} /> : null} 📤 Confirm Issue
        </button>
      </div>

      <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>Recent Issues</div>
      {loading ? <div className="loading-center"><span className="spinner" /></div>
      : history.length === 0 ? <p style={{ color: 'var(--text3)', fontSize: '12px' }}>No issue history yet.</p>
      : (
        <table className="data-table">
          <thead>
            <tr><th>Date</th><th>Part</th><th>Description</th><th style={{ textAlign: 'right' }}>Qty</th><th>Work Order</th><th>Purpose</th></tr>
          </thead>
          <tbody>
            {history.map(h => (
              <tr key={h.id}>
                <td style={{ fontSize: '11px', whiteSpace: 'nowrap' }}>{h.issued_date}</td>
                <td style={{ fontFamily: 'var(--mono)', fontSize: '11px', fontWeight: 600 }}>{h.part_number}</td>
                <td style={{ fontSize: '11px' }}>{h.description}</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '11px' }}>{h.qty}</td>
                <td style={{ fontSize: '11px' }}>{h.wo_number || '—'}</td>
                <td style={{ fontSize: '11px', color: 'var(--text3)' }}>{h.purpose || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
