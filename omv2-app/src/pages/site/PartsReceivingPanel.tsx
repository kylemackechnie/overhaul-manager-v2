import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'

interface SparePart {
  id: string; part_number: string; description: string
  manufacturer: string | null; qty_on_hand: number; unit: string | null
  location: string | null; po_id: string | null
}

interface PO { id: string; po_number: string; vendor: string }

interface ReceivingLine {
  part_id: string; part_number: string; description: string
  qty_ordered: number; qty_received: number; condition: string; notes: string
}

export function PartsReceivingPanel() {
  const { activeProject } = useAppStore()
  const [parts,    setParts]    = useState<SparePart[]>([])
  const [pos,      setPos]      = useState<PO[]>([])
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [poId,     setPoId]     = useState('')
  const [recDate,  setRecDate]  = useState(new Date().toISOString().slice(0, 10))
  const [lines,    setLines]    = useState<ReceivingLine[]>([])
  const [search,   setSearch]   = useState('')
  const [history,  setHistory]  = useState<{id:string;received_date:string;part_number:string;description:string;qty:number;po_number:string|null;condition:string;notes:string}[]>([])

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [pRes, poRes, hRes] = await Promise.all([
      supabase.from('spare_parts').select('id,part_number,description,manufacturer,qty_on_hand,unit,location,po_id').eq('project_id', pid).order('part_number'),
      supabase.from('purchase_orders').select('id,po_number,vendor').eq('project_id', pid).order('po_number'),
      supabase.from('parts_receipts').select('id,received_date,qty,condition,notes,spare_part:spare_parts(part_number,description),purchase_order:purchase_orders(po_number)').eq('project_id', pid).order('received_date', { ascending: false }).limit(50),
    ])
    setParts((pRes.data || []) as SparePart[])
    setPos((poRes.data || []) as PO[])
    const h = (hRes.data || []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      received_date: r.received_date as string,
      part_number: (r.spare_part as {part_number:string}|null)?.part_number || '—',
      description: (r.spare_part as {description:string}|null)?.description || '—',
      qty: r.qty as number,
      po_number: (r.purchase_order as {po_number:string}|null)?.po_number || null,
      condition: r.condition as string,
      notes: r.notes as string,
    }))
    setHistory(h)
    setLoading(false)
  }

  function addLine(part: SparePart) {
    if (lines.some(l => l.part_id === part.id)) return
    setLines(ls => [...ls, { part_id: part.id, part_number: part.part_number, description: part.description, qty_ordered: 1, qty_received: 1, condition: 'good', notes: '' }])
    setSearch('')
  }

  function updateLine(i: number, patch: Partial<ReceivingLine>) {
    setLines(ls => ls.map((l, j) => j === i ? { ...l, ...patch } : l))
  }

  async function receive() {
    if (!lines.length) { toast('Add at least one part', 'error'); return }
    const bad = lines.find(l => l.qty_received <= 0)
    if (bad) { toast(`Qty received must be > 0 for ${bad.part_number}`, 'error'); return }
    setSaving(true)
    const pid = activeProject!.id

    for (const line of lines) {
      // Insert receipt record
      const { error: rErr } = await supabase.from('parts_receipts').insert({
        project_id: pid, spare_part_id: line.part_id, po_id: poId || null,
        received_date: recDate, qty: line.qty_received,
        condition: line.condition, notes: line.notes,
      })
      if (rErr) { toast(`Failed for ${line.part_number}: ${rErr.message}`, 'error'); continue }

      // Update qty_on_hand
      const part = parts.find(p => p.id === line.part_id)
      if (part) {
        await supabase.from('spare_parts').update({ qty_on_hand: (part.qty_on_hand || 0) + line.qty_received }).eq('id', line.part_id)
      }
    }

    toast(`${lines.length} line(s) received`, 'success')
    setSaving(false); setLines([]); setPoId(''); load()
  }

  const filteredParts = search.length > 1
    ? parts.filter(p => [p.part_number, p.description, p.manufacturer].some(f => (f||'').toLowerCase().includes(search.toLowerCase())))
    : []

  return (
    <div style={{ padding: '24px', maxWidth: '1000px' }}>
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 700 }}>📬 Receive Parts</h1>
        <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>Receive parts into inventory — updates stock levels</p>
      </div>

      {/* Receipt form */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>New Receiving Entry</div>
        <div className="fg-row" style={{ marginBottom: '10px' }}>
          <div className="fg">
            <label>Linked PO <span style={{ fontWeight: 400, color: 'var(--text3)', fontSize: '10px' }}>(optional)</span></label>
            <select className="input" value={poId} onChange={e => setPoId(e.target.value)}>
              <option value="">— No PO —</option>
              {pos.map(p => <option key={p.id} value={p.id}>{p.po_number} — {p.vendor}</option>)}
            </select>
          </div>
          <div className="fg" style={{ maxWidth: '180px' }}>
            <label>Received Date</label>
            <input type="date" className="input" value={recDate} onChange={e => setRecDate(e.target.value)} />
          </div>
        </div>

        {/* Part search */}
        <div style={{ position: 'relative', marginBottom: '12px' }}>
          <input className="input" placeholder="Search part number or description to add…"
            value={search} onChange={e => setSearch(e.target.value)} />
          {filteredParts.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', maxHeight: '220px', overflowY: 'auto' }}>
              {filteredParts.map(p => (
                <div key={p.id} style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '12px', borderBottom: '1px solid var(--border)' }}
                  onClick={() => addLine(p)}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}>
                  <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, marginRight: '8px' }}>{p.part_number}</span>
                  {p.description}
                  <span style={{ float: 'right', color: 'var(--text3)' }}>On hand: {p.qty_on_hand}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Lines */}
        {lines.length > 0 && (
          <table className="data-table" style={{ marginBottom: '12px' }}>
            <thead>
              <tr>
                <th>Part</th>
                <th style={{ textAlign: 'right', width: '80px' }}>Qty Ordered</th>
                <th style={{ textAlign: 'right', width: '80px' }}>Qty Received</th>
                <th style={{ width: '110px' }}>Condition</th>
                <th>Notes</th>
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
                  <td><input type="number" className="input" style={{ textAlign: 'right', padding: '2px 6px', width: '70px' }} min={0} value={l.qty_ordered} onChange={e => updateLine(i, { qty_ordered: parseInt(e.target.value) || 0 })} /></td>
                  <td><input type="number" className="input" style={{ textAlign: 'right', padding: '2px 6px', width: '70px' }} min={0} value={l.qty_received} onChange={e => updateLine(i, { qty_received: parseInt(e.target.value) || 0 })} /></td>
                  <td>
                    <select className="input" style={{ fontSize: '11px', padding: '2px 4px', height: '26px' }} value={l.condition} onChange={e => updateLine(i, { condition: e.target.value })}>
                      <option value="good">Good</option>
                      <option value="damaged">Damaged</option>
                      <option value="partial">Partial</option>
                      <option value="rejected">Rejected</option>
                    </select>
                  </td>
                  <td><input className="input" style={{ fontSize: '11px', padding: '2px 6px', width: '100%' }} placeholder="Notes…" value={l.notes} onChange={e => updateLine(i, { notes: e.target.value })} /></td>
                  <td><button className="btn btn-sm" style={{ color: 'var(--red)' }} onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <button className="btn btn-primary" disabled={saving || lines.length === 0} onClick={receive}>
          {saving ? <span className="spinner" style={{ width: '14px', height: '14px' }} /> : null} ✅ Confirm Receipt
        </button>
      </div>

      {/* Recent history */}
      <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>Recent Receipts</div>
      {loading ? <div className="loading-center"><span className="spinner" /></div>
      : history.length === 0 ? <p style={{ color: 'var(--text3)', fontSize: '12px' }}>No receiving history yet.</p>
      : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th><th>Part</th><th>Description</th><th style={{ textAlign: 'right' }}>Qty</th>
              <th>Condition</th><th>PO</th><th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {history.map(h => (
              <tr key={h.id}>
                <td style={{ fontSize: '11px', whiteSpace: 'nowrap' }}>{h.received_date}</td>
                <td style={{ fontFamily: 'var(--mono)', fontSize: '11px', fontWeight: 600 }}>{h.part_number}</td>
                <td style={{ fontSize: '11px' }}>{h.description}</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '11px' }}>{h.qty}</td>
                <td><span className="badge" style={{ background: h.condition === 'good' ? '#d1fae5' : '#fee2e2', color: h.condition === 'good' ? '#065f46' : '#991b1b', fontSize: '10px' }}>{h.condition}</span></td>
                <td style={{ fontSize: '11px', color: 'var(--text3)' }}>{h.po_number || '—'}</td>
                <td style={{ fontSize: '11px', color: 'var(--text3)' }}>{h.notes || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
