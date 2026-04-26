import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'

interface WositLine {
  id: string
  tv_no: string | null
  vb_no: string | null
  delivery_package: string | null
  material_no: string | null
  install_location: string | null
  description: string | null
  qty_required: number
  received_qty: number | null
  status: string | null
}

interface Match {
  materialNo: string
  wositMatches: WositLine[]
  selected: WositLine | null
  supersession: boolean
}

type Step = 1 | 2 | 3

export function PartsReceivingPanel() {
  const { activeProject } = useAppStore()
  const [lines, setLines] = useState<WositLine[]>([])
  const [loading, setLoading] = useState(true)

  const [step, setStep] = useState<Step>(1)
  const [scanMat, setScanMat] = useState('')
  const [scanLoc, setScanLoc] = useState('')
  const [box, setBox] = useState('')
  const [qty, setQty] = useState('')
  const [match, setMatch] = useState<Match | null>(null)
  const [step1Err, setStep1Err] = useState('')
  const [step2Warn, setStep2Warn] = useState('')
  const [sessionList, setSessionList] = useState<{ desc: string; matNo: string; location: string; qty: number }[]>([])

  const [fStatus, setFStatus] = useState('pending')
  const [fTV, setFTV] = useState('')
  const [fMat, setFMat] = useState('')
  const [fDesc, setFDesc] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const matRef = useRef<HTMLInputElement>(null)
  const locRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('wosit_lines')
      .select('id,tv_no,vb_no,delivery_package,material_no,install_location,description,qty_required,received_qty,status')
      .eq('project_id', activeProject!.id)
      .order('tv_no')
    setLines((data || []) as WositLine[])
    setLoading(false)
  }

  function handleScanMat() {
    const val = scanMat.trim()
    if (!val) return
    const matches = lines.filter(l => (l.material_no || '').toUpperCase() === val.toUpperCase())
    if (!matches.length) { setStep1Err(`⚠ Material ${val} not found in WOSIT`); return }
    setStep1Err('')
    const m: Match = { materialNo: val, wositMatches: matches, selected: null, supersession: false }
    setMatch(m)
    if (matches.length === 1) {
      advanceToStep3(matches[0], m)
    } else {
      setStep(2)
      setTimeout(() => locRef.current?.focus(), 100)
    }
  }

  function handleScanLoc() {
    if (!match) return
    const loc = scanLoc.trim()
    const found = match.wositMatches.find(w => (w.install_location || '').trim() === loc)
    if (found) {
      advanceToStep3(found, match)
    } else {
      setStep2Warn('⚠ Location not found — possible supersession')
      advanceToStep3({ ...match.wositMatches[0], install_location: loc } as WositLine, match, true)
    }
  }

  function selectLine(line: WositLine) {
    if (!match) return
    advanceToStep3(line, match)
  }

  function advanceToStep3(line: WositLine, currentMatch: Match, supersession = false) {
    setMatch({ ...currentMatch, selected: line, supersession })
    setQty(String(line.qty_required || ''))
    setStep2Warn(supersession ? '⚠ Location not found — possible supersession' : '')
    setStep(3)
    setTimeout(() => boxRef.current?.focus(), 100)
  }

  const sel = match?.selected
  const tv    = sel?.tv_no || ''
  const crate = sel?.delivery_package || sel?.vb_no || ''
  const locationPreview = box.trim() ? `TV${tv} — Crate ${crate} — Box ${box.trim()}` : '—'

  async function confirmReceive() {
    if (!sel || !match || !activeProject) return
    if (!box.trim()) { toast('Enter a box number', 'error'); boxRef.current?.focus(); return }
    const qtyNum = parseInt(qty) || 0
    if (qtyNum < 1) { toast('Enter a valid quantity', 'error'); return }
    const location = `TV${tv} — Crate ${crate} — Box ${box.trim()}`
    const { error } = await supabase.from('site_inventory').insert({
      project_id: activeProject.id, wosit_line_id: sel.id,
      tv_no: tv || null, crate_no: crate || null, vb_no: sel.vb_no || null,
      box_no: box.trim(), location, material_no: match.materialNo,
      install_location: sel.install_location, description: sel.description,
      qty_delivered: qtyNum, qty_remaining: qtyNum, qty_issued: 0,
    })
    if (error) { toast('Receive failed: ' + error.message, 'error'); return }
    const prev = Number(sel.received_qty || 0)
    const newTotal = prev + qtyNum
    const newStatus = newTotal >= (sel.qty_required || 0) ? 'received' : 'partial'
    await supabase.from('wosit_lines').update({ received_qty: newTotal, status: newStatus }).eq('id', sel.id)
    toast(`Received ${qtyNum}× ${sel.description || match.materialNo}`, 'success')
    setSessionList(s => [{ desc: sel.description || match!.materialNo, matNo: match!.materialNo, location, qty: qtyNum }, ...s])
    reset()
    load()
  }

  function reset() {
    setScanMat(''); setScanLoc(''); setBox(''); setQty('')
    setMatch(null); setStep(1); setStep1Err(''); setStep2Warn('')
    setTimeout(() => matRef.current?.focus(), 100)
  }

  async function bulkReceive() {
    if (!selected.size) { toast('Select lines to receive', 'error'); return }
    const boxNum = prompt('Box number for all selected lines?', '1')
    if (!boxNum?.trim()) return
    const toReceive = filtered.filter(l => selected.has(l.id) && (l.status || 'pending') !== 'received')
    if (!toReceive.length) { toast('No eligible lines', 'error'); return }
    let count = 0
    for (const l of toReceive) {
      const q = l.qty_required || 1
      const loc = `TV${l.tv_no || ''} — Crate ${l.delivery_package || l.vb_no || ''} — Box ${boxNum.trim()}`
      const { data: ex } = await supabase.from('site_inventory').select('id').eq('wosit_line_id', l.id).limit(1)
      if (ex?.length) { toast(`${l.material_no} already received — skipped`, 'info'); continue }
      await supabase.from('site_inventory').insert({
        project_id: activeProject!.id, wosit_line_id: l.id,
        tv_no: l.tv_no, crate_no: l.delivery_package || l.vb_no, vb_no: l.vb_no,
        box_no: boxNum.trim(), location: loc, material_no: l.material_no,
        install_location: l.install_location, description: l.description,
        qty_delivered: q, qty_remaining: q, qty_issued: 0,
      })
      await supabase.from('wosit_lines').update({ received_qty: q, status: 'received' }).eq('id', l.id)
      count++
    }
    toast(`Received ${count} line(s)`, 'success')
    setSelected(new Set()); load()
  }

  const filtered = lines.filter(l => {
    const st = (l.status || 'pending').toLowerCase()
    if (fStatus && st !== fStatus) return false
    if (fTV && !String(l.tv_no || '').toLowerCase().includes(fTV.toLowerCase())) return false
    if (fMat && !(l.material_no || '').toLowerCase().includes(fMat.toLowerCase())) return false
    if (fDesc && !(l.description || '').toLowerCase().includes(fDesc.toLowerCase())) return false
    return true
  })

  const ST: Record<string, { bg: string; color: string }> = {
    received: { bg: '#d1fae5', color: '#065f46' },
    partial:  { bg: '#fef3c7', color: '#92400e' },
    pending:  { bg: '#f1f5f9', color: '#64748b' },
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1200px' }}>
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 700 }}>📬 Parts Receiving</h1>
        <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
          Scan WOSIT parts into site inventory — TV and Crate are pre-filled from import, storeman defines Box location
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: '16px', marginBottom: '16px' }}>

        {/* LEFT column: wizard + session */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="card">
            <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '12px' }}>Scan &amp; Receive Part</div>

            {/* Step tabs */}
            <div style={{ display: 'flex', gap: '0', marginBottom: '16px', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--border)' }}>
              {([1, 2, 3] as const).map(s => (
                <div key={s}
                  onClick={() => s === 1 && step > 1 ? reset() : undefined}
                  title={s === 1 && step > 1 ? 'Click to restart' : ''}
                  style={{
                    flex: 1, padding: '6px 0', textAlign: 'center', fontSize: '11px',
                    cursor: s === 1 && step > 1 ? 'pointer' : 'default',
                    borderRight: s < 3 ? '1px solid var(--border)' : undefined,
                    background: step === s ? 'var(--accent)' : step > s ? '#d1fae5' : 'var(--bg3)',
                    color: step === s ? '#fff' : step > s ? '#065f46' : 'var(--text3)',
                    fontWeight: step === s ? 600 : 400,
                  }}>
                  {step > s ? '✓ ' : `${s}. `}{s === 1 ? 'Material #' : s === 2 ? 'Location' : 'Confirm'}
                </div>
              ))}
            </div>

            {/* Step 1: scan material */}
            {step === 1 && (
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text3)', display: 'block', marginBottom: '4px' }}>
                  Material Number (scan or type)
                </label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input ref={matRef} className="input" autoFocus placeholder="Scan material barcode…"
                    value={scanMat} onChange={e => setScanMat(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleScanMat()} />
                  <button className="btn btn-primary" onClick={handleScanMat}>→</button>
                </div>
                {step1Err && (
                  <div style={{ marginTop: '8px', padding: '8px 10px', background: '#fee2e2', color: '#991b1b', borderRadius: '6px', fontSize: '12px' }}>
                    {step1Err}
                  </div>
                )}
              </div>
            )}

            {/* Step 2: resolve location (only if multiple matches) */}
            {step === 2 && match && (
              <div>
                <div style={{ padding: '10px 12px', background: '#d1fae5', borderRadius: '6px', fontSize: '12px', marginBottom: '12px' }}>
                  <strong>{match.wositMatches[0].description}</strong>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: '#065f46', marginTop: '2px' }}>{match.materialNo}</div>
                  <div style={{ fontSize: '11px', color: '#065f46', marginTop: '4px' }}>
                    {match.wositMatches.length} install locations found — click one or scan barcode
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '10px' }}>
                  {match.wositMatches.map((m, i) => (
                    <button key={i} className="btn btn-sm" style={{ fontFamily: 'var(--mono)', fontSize: '11px' }}
                      onClick={() => selectLine(m)}>
                      {m.install_location} — TV{m.tv_no}
                    </button>
                  ))}
                </div>
                <label style={{ fontSize: '11px', color: 'var(--text3)', display: 'block', marginBottom: '4px' }}>
                  Or scan install location barcode
                </label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input ref={locRef} className="input" placeholder="Scan install location…"
                    value={scanLoc} onChange={e => setScanLoc(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleScanLoc()} />
                  <button className="btn btn-primary" onClick={handleScanLoc}>→</button>
                </div>
                {step2Warn && (
                  <div style={{ marginTop: '8px', padding: '8px 10px', background: '#fef3c7', color: '#92400e', borderRadius: '6px', fontSize: '12px' }}>
                    {step2Warn}
                  </div>
                )}
              </div>
            )}

            {/* Step 3: confirm — TV + Crate readonly (from WOSIT), Box storeman-defined */}
            {step === 3 && sel && (
              <div>
                <div style={{ padding: '10px 12px', background: '#d1fae5', borderRadius: '6px', fontSize: '12px', marginBottom: '12px' }}>
                  ✓ <strong>{sel.description}</strong>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: '#065f46', marginTop: '2px' }}>
                    {match?.materialNo} | {sel.install_location}
                  </div>
                  {match?.supersession && <div style={{ color: '#d97706', marginTop: '4px', fontSize: '11px' }}>⚠ Possible supersession</div>}
                </div>

                {/* TV + Crate: pre-filled readonly from WOSIT import data */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--text3)', display: 'block', marginBottom: '2px' }}>TV Number</label>
                    <input className="input" readOnly value={tv}
                      style={{ background: 'var(--bg3)', color: 'var(--text2)', fontFamily: 'var(--mono)', cursor: 'default' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--text3)', display: 'block', marginBottom: '2px' }}>Crate No.</label>
                    <input className="input" readOnly value={crate}
                      style={{ background: 'var(--bg3)', color: 'var(--text2)', fontFamily: 'var(--mono)', cursor: 'default' }} />
                  </div>
                </div>

                {/* Box + Qty: storeman fills these */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
                  <div>
                    <label style={{ fontSize: '11px', display: 'block', marginBottom: '2px' }}>
                      Box / Bin No. <span style={{ color: 'var(--red)' }}>*</span>
                      <span style={{ color: 'var(--text3)', fontWeight: 400 }}> (storeman assigns)</span>
                    </label>
                    <input ref={boxRef} className="input" type="number" min={1} placeholder="e.g. 1"
                      value={box} onChange={e => setBox(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && confirmReceive()} />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', display: 'block', marginBottom: '2px' }}>
                      Qty Received <span style={{ color: 'var(--red)' }}>*</span>
                    </label>
                    <input className="input" type="number" min={1}
                      value={qty} onChange={e => setQty(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && confirmReceive()} />
                  </div>
                </div>

                {/* Live location preview */}
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ fontSize: '11px', color: 'var(--text3)', display: 'block', marginBottom: '2px' }}>Location Preview</label>
                  <div style={{
                    fontFamily: 'var(--mono)', fontSize: '12px', padding: '8px 10px',
                    background: 'var(--bg3)', borderRadius: '6px',
                    color: box.trim() ? 'var(--accent)' : 'var(--text3)',
                  }}>
                    {locationPreview}
                  </div>
                </div>

                <button className="btn btn-primary" style={{ width: '100%' }} onClick={confirmReceive}>
                  ✓ Confirm Receive
                </button>
              </div>
            )}
          </div>

          {/* Session received */}
          <div className="card">
            <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '10px' }}>Received This Session</div>
            {sessionList.length === 0
              ? <div style={{ color: 'var(--text3)', fontSize: '12px' }}>No parts received yet this session.</div>
              : sessionList.map((s, i) => (
                <div key={i} style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '6px', marginBottom: '6px', background: 'var(--bg3)' }}>
                  <div style={{ fontWeight: 500, fontSize: '13px' }}>{s.desc}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)' }}>{s.matNo}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--accent)' }}>{s.location}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text2)', marginTop: '2px' }}>Qty: <strong>{s.qty}</strong></div>
                </div>
              ))
            }
          </div>
        </div>

        {/* RIGHT: Pending WOSIT table */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: 600, fontSize: '13px' }}>
              Pending Parts — from WOSIT
              <span style={{ fontWeight: 400, color: 'var(--text3)', fontSize: '12px', marginLeft: '8px' }}>{filtered.length} lines</span>
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button className="btn btn-sm" style={{ color: 'var(--orange)', border: '1px solid var(--orange)', background: 'none' }}
                onClick={() => { setFStatus(''); setFTV(''); setFMat(''); setFDesc('') }}>
                Clear Filters
              </button>
              <button className="btn btn-sm" style={{ background: '#059669', color: '#fff', border: 'none' }}
                onClick={bulkReceive}>
                ✓ Receive Selected
              </button>
            </div>
          </div>

          <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: '8px', background: 'var(--bg3)', flexWrap: 'wrap' }}>
            <select className="input" style={{ width: '110px', padding: '3px 6px', fontSize: '11px' }}
              value={fStatus} onChange={e => setFStatus(e.target.value)}>
              <option value="">All Status</option>
              <option value="pending">Pending</option>
              <option value="partial">Partial</option>
              <option value="received">Received</option>
            </select>
            <input className="input" style={{ width: '65px', padding: '3px 6px', fontSize: '11px' }}
              placeholder="TV#" value={fTV} onChange={e => setFTV(e.target.value)} />
            <input className="input" style={{ width: '130px', padding: '3px 6px', fontSize: '11px' }}
              placeholder="Material #" value={fMat} onChange={e => setFMat(e.target.value)} />
            <input className="input" style={{ flex: 1, minWidth: '100px', padding: '3px 6px', fontSize: '11px' }}
              placeholder="Description" value={fDesc} onChange={e => setFDesc(e.target.value)} />
          </div>

          {loading
            ? <div className="loading-center"><span className="spinner" /></div>
            : (
              <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 300px)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg3)', position: 'sticky', top: 0, zIndex: 1 }}>
                      <th style={{ width: '32px', padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
                        <input type="checkbox" onChange={e => {
                          if (e.target.checked) setSelected(new Set(filtered.filter(l => l.status !== 'received').map(l => l.id)))
                          else setSelected(new Set())
                        }} />
                      </th>
                      {['Status','TV','Crate','VB No.','Material No.','Install Location','Description','Exp.','Rcv.'].map(h => (
                        <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, fontSize: '10px',
                          textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text3)',
                          borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={10} style={{ textAlign: 'center', padding: '24px', color: 'var(--text3)' }}>
                        {lines.length === 0 ? 'No WOSIT imported yet — go to Parts Import first.' : 'No matching lines'}
                      </td></tr>
                    ) : filtered.map(l => {
                      const st = (l.status || 'pending').toLowerCase()
                      const stc = ST[st] || ST.pending
                      return (
                        <tr key={l.id} style={{ borderBottom: '1px solid var(--border)' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                          onMouseLeave={e => (e.currentTarget.style.background = '')}>
                          <td style={{ padding: '6px 8px' }}>
                            <input type="checkbox" disabled={st === 'received'}
                              checked={selected.has(l.id)}
                              onChange={e => setSelected(s => { const n = new Set(s); e.target.checked ? n.add(l.id) : n.delete(l.id); return n })} />
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            <span style={{ ...stc, padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 600 }}>
                              {st.toUpperCase()}
                            </span>
                          </td>
                          <td style={{ padding: '6px 8px', fontFamily: 'var(--mono)', fontSize: '11px' }}>{l.tv_no || '—'}</td>
                          <td style={{ padding: '6px 8px', fontFamily: 'var(--mono)', fontSize: '11px' }}>{l.delivery_package || '—'}</td>
                          <td style={{ padding: '6px 8px', fontFamily: 'var(--mono)', fontSize: '11px' }}>{l.vb_no || '—'}</td>
                          <td style={{ padding: '6px 8px', fontFamily: 'var(--mono)', fontSize: '11px', fontWeight: 600 }}>{l.material_no}</td>
                          <td style={{ padding: '6px 8px', fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)' }}>{l.install_location}</td>
                          <td style={{ padding: '6px 8px', fontSize: '11px', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.description}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--mono)' }}>{l.qty_required}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600,
                            color: Number(l.received_qty) >= l.qty_required ? '#059669' : Number(l.received_qty) > 0 ? '#d97706' : 'var(--text3)' }}>
                            {Number(l.received_qty) || 0}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          }
        </div>
      </div>
    </div>
  )
}
