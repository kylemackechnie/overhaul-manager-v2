import { useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'

// ShIp import reads WOSIT Excel/CSV and populates:
// 1. TV Sheet → shipment records + project_tvs
// 2. Kollo Sheet → project_kollos
// 3. VB Details → wosit_lines (spare parts)

type DropZoneProps = {
  label: string; sub: string; icon: string; color: string
  onFile: (f: File) => void; status: { msg: string; type: 'info' | 'ok' | 'error' } | null
}
function DropZone({ label, sub, icon, color, onFile, status }: DropZoneProps) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className="card" style={{ padding: '16px' }}>
      <div style={{ fontWeight: 700, fontSize: '12px', color, marginBottom: '10px' }}>{label}</div>
      <div
        style={{ border: '2px dashed var(--border)', borderRadius: 'var(--radius)', padding: '20px', textAlign: 'center', cursor: 'pointer', background: 'var(--bg3)', transition: 'border-color .15s' }}
        onClick={() => ref.current?.click()}
        onDragOver={e => { e.preventDefault(); (e.currentTarget as HTMLDivElement).style.borderColor = color }}
        onDragLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)' }}
        onDrop={e => { e.preventDefault(); (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)'; const f = e.dataTransfer.files[0]; if (f) onFile(f) }}
      >
        <div style={{ fontSize: '28px', marginBottom: '6px' }}>{icon}</div>
        <div style={{ fontSize: '12px', fontWeight: 600 }}>{sub}</div>
      </div>
      <input ref={ref} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />
      {status && (
        <div style={{ marginTop: '8px', fontSize: '11px', color: status.type === 'ok' ? 'var(--green)' : status.type === 'error' ? 'var(--red)' : 'var(--text3)' }}>
          {status.msg}
        </div>
      )}
    </div>
  )
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cur = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1]
    if (c === '"') { if (inQ && n === '"') { cur += '"'; i++ } else inQ = !inQ }
    else if (c === ',' && !inQ) { row.push(cur); cur = '' }
    else if ((c === '\n' || (c === '\r' && n === '\n')) && !inQ) {
      if (c === '\r') i++; row.push(cur); cur = ''; rows.push(row); row = []
    } else if (c === '\r' && !inQ) { row.push(cur); cur = ''; rows.push(row); row = [] }
    else cur += c
  }
  if (cur || row.length) { row.push(cur); rows.push(row) }
  return rows
}

async function readFileText(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result as string)
    r.onerror = () => rej(new Error('File read failed'))
    r.readAsText(file, 'utf-8')
  })
}

interface TVRow {
  tvNo: string; headerName: string; replValue: number; departure: string; eta: string; hawb: string; mawb: string
  selected: boolean; type: 'tooling' | 'hardware'
}

export function ShippingImportPanel() {
  const { activeProject, setActivePanel } = useAppStore()
  const [tvRows, setTvRows] = useState<TVRow[]>([])
  const [tvStatus, setTvStatus] = useState<{ msg: string; type: 'info' | 'ok' | 'error' } | null>(null)
  const [kolloStatus, setKolloStatus] = useState<{ msg: string; type: 'info' | 'ok' | 'error' } | null>(null)
  const [vbStatus, setVbStatus] = useState<{ msg: string; type: 'info' | 'ok' | 'error' } | null>(null)
  const [importing, setImporting] = useState(false)
  const [results, setResults] = useState<string[]>([])

  async function handleTVFile(file: File) {
    setTvStatus({ msg: '⏳ Parsing TV sheet…', type: 'info' })
    try {
      const text = await readFileText(file)
      const rows = parseCSV(text)
      if (!rows.length) { setTvStatus({ msg: '✗ Empty file', type: 'error' }); return }

      // Find header row containing TV or TV No
      let hIdx = -1
      for (let i = 0; i < Math.min(15, rows.length); i++) {
        if (rows[i].some(c => /^tv\s*no/i.test(c.trim()) || /^tv$/i.test(c.trim()))) { hIdx = i; break }
      }
      if (hIdx < 0) { setTvStatus({ msg: '✗ Could not find TV header row', type: 'error' }); return }

      const hdr = rows[hIdx].map(h => h.trim().toLowerCase())
      const col = (names: string[]) => { for (const n of names) { const i = hdr.findIndex(h => h.includes(n)); if (i >= 0) return i } return -1 }
      const iTV = col(['tv no', 'tv_no', 'tv']), iName = col(['header', 'name', 'description'])
      const iRepl = col(['repl', 'replacement', 'value']), iDep = col(['departure', 'depart', 'dep'])
      const iETA = col(['eta', 'arrival', 'pod']), iHAWB = col(['hawb', 'awb', 'air waybill'])
      const iMAWB = col(['mawb', 'master'])

      const parsed: TVRow[] = []
      for (let i = hIdx + 1; i < rows.length; i++) {
        const r = rows[i]
        const tvNo = iTV >= 0 ? r[iTV]?.trim().replace(/^tv/i, '').trim() : ''
        if (!tvNo || isNaN(Number(tvNo))) continue
        parsed.push({
          tvNo,
          headerName: iName >= 0 ? r[iName]?.trim() || '' : '',
          replValue: iRepl >= 0 ? parseFloat((r[iRepl] || '0').replace(/[^0-9.]/g, '')) || 0 : 0,
          departure: iDep >= 0 ? r[iDep]?.trim() || '' : '',
          eta: iETA >= 0 ? r[iETA]?.trim() || '' : '',
          hawb: iHAWB >= 0 ? r[iHAWB]?.trim() || '' : '',
          mawb: iMAWB >= 0 ? r[iMAWB]?.trim() || '' : '',
          selected: true, type: 'tooling',
        })
      }
      if (!parsed.length) { setTvStatus({ msg: '✗ No TV rows found', type: 'error' }); return }
      setTvRows(parsed)
      setTvStatus({ msg: `✓ Parsed ${parsed.length} TVs — classify and confirm below`, type: 'ok' })
    } catch (e) { setTvStatus({ msg: '✗ ' + (e as Error).message, type: 'error' }) }
  }

  async function confirmTVImport() {
    const selected = tvRows.filter(r => r.selected)
    if (!selected.length || !activeProject) return
    setImporting(true)
    const pid = activeProject.id
    const log: string[] = []

    const today = new Date().toISOString().slice(0, 10)
    for (const tv of selected) {
      // 1. Upsert global_tvs register
      await supabase.from('global_tvs').upsert({
        tv_no: tv.tvNo, header_name: tv.headerName,
        replacement_value_eur: tv.replValue || null,
        gross_kg: null, net_kg: null, pack_items: '',
        extra: {},
      }, { onConflict: 'tv_no' })

      // 2. Upsert project_tvs (links TV to this project)
      const { error: tvErr } = await supabase.from('project_tvs').upsert({
        project_id: pid, tv_no: tv.tvNo, header_name: tv.headerName,
        replacement_value_eur: tv.replValue || null,
        departure_date: tv.departure || null, eta_pod: tv.eta || null,
      }, { onConflict: 'project_id,tv_no' })
      if (tvErr) { log.push(`TV${tv.tvNo}: ${tvErr.message}`); continue }

      // 3. For tooling TVs — create a blank tooling_costings entry so it appears in costing panel
      if (tv.type === 'tooling') {
        const { data: existing } = await supabase.from('tooling_costings')
          .select('id').eq('project_id', pid).eq('tv_no', tv.tvNo).maybeSingle()
        if (!existing) {
          await supabase.from('tooling_costings').insert({
            project_id: pid, tv_no: tv.tvNo,
            charge_start: null, charge_end: null,
            cost_eur: null, sell_eur: null, notes: '',
          })
          log.push(`✓ TV${tv.tvNo} — Tooling (costing entry created)`)
        } else {
          log.push(`✓ TV${tv.tvNo} — Tooling (costing entry already exists)`)
        }
      } else {
        log.push(`✓ TV${tv.tvNo} — Hardware`)
      }

      // 4. Create import shipment record (skip if already exists for this TV)
      const { data: existingShip } = await supabase.from('shipments')
        .select('id').eq('project_id', pid).eq('reference', `TV${tv.tvNo}`).eq('direction', 'import').maybeSingle()
      if (!existingShip) {
        const { error: sErr } = await supabase.from('shipments').insert({
          project_id: pid, direction: 'import',
          reference: `TV${tv.tvNo}`, description: tv.headerName || `TV${tv.tvNo}`,
          status: tv.eta && tv.eta <= today ? 'delivered' : 'pending',
          carrier: '', tracking: '', origin: 'Germany',
          hawb: tv.hawb, mawb: tv.mawb,
          eta: tv.eta || null,
        })
        if (sErr) log.push(`  ⚠ Shipment TV${tv.tvNo}: ${sErr.message}`)
      }
    }

    setResults(log)
    setTvStatus({ msg: `✓ Imported ${selected.length} TVs`, type: 'ok' })
    setTvRows([])
    setImporting(false)
    toast(`Imported ${selected.length} TVs`, 'success')
  }

  async function handleKolloFile(file: File) {
    setKolloStatus({ msg: '⏳ Parsing Kollo sheet…', type: 'info' })
    try {
      const text = await readFileText(file)
      const rows = parseCSV(text)
      let hIdx = -1
      for (let i = 0; i < Math.min(15, rows.length); i++) {
        if (rows[i].some(c => /crate|kollo|vb\s*no/i.test(c.trim()))) { hIdx = i; break }
      }
      if (hIdx < 0) { setKolloStatus({ msg: '✗ Could not find Kollo header row', type: 'error' }); return }

      const hdr = rows[hIdx].map(h => h.trim().toLowerCase())
      const col = (names: string[]) => { for (const n of names) { const i = hdr.findIndex(h => h.includes(n)); if (i >= 0) return i } return -1 }
      const iTV = col(['tv no', 'tv']), iVB = col(['vb no', 'vb', 'crate']), iGross = col(['gross', 'weight'])
      const iNet = col(['net']), iL = col(['length', 'l (cm)']), iW = col(['width', 'w (cm)']), iH = col(['height', 'h (cm)'])

      const inserts = []
      const pid = activeProject!.id
      for (let i = hIdx + 1; i < rows.length; i++) {
        const r = rows[i]
        const tvNo = iTV >= 0 ? r[iTV]?.trim().replace(/^tv/i, '').trim() : ''
        if (!tvNo || isNaN(Number(tvNo))) continue
        inserts.push({
          project_id: pid, tv_no: tvNo,
          vb_no: iVB >= 0 ? r[iVB]?.trim() || '' : '',
          gross_kg: iGross >= 0 ? parseFloat(r[iGross] || '0') || null : null,
          net_kg: iNet >= 0 ? parseFloat(r[iNet] || '0') || null : null,
          length_cm: iL >= 0 ? parseFloat(r[iL] || '0') || null : null,
          width_cm: iW >= 0 ? parseFloat(r[iW] || '0') || null : null,
          height_cm: iH >= 0 ? parseFloat(r[iH] || '0') || null : null,
        })
      }
      if (!inserts.length) { setKolloStatus({ msg: '✗ No Kollo rows found', type: 'error' }); return }

      const { error } = await supabase.from('project_kollos').insert(inserts)
      if (error) { setKolloStatus({ msg: '✗ ' + error.message, type: 'error' }); return }
      setKolloStatus({ msg: `✓ Imported ${inserts.length} Kollo records`, type: 'ok' })
      setResults(r => [...r, `✓ ${inserts.length} Kollo packages imported`])
      toast(`${inserts.length} Kollos imported`, 'success')
    } catch (e) { setKolloStatus({ msg: '✗ ' + (e as Error).message, type: 'error' }) }
  }

  async function handleVBFile(file: File) {
    setVbStatus({ msg: '⏳ Parsing VB Details…', type: 'info' })
    try {
      const text = await readFileText(file)
      const rows = parseCSV(text)
      let hIdx = -1
      for (let i = 0; i < Math.min(15, rows.length); i++) {
        if (rows[i].some(c => /material|item|part/i.test(c.trim()))) { hIdx = i; break }
      }
      if (hIdx < 0) { setVbStatus({ msg: '✗ Could not find VB header row', type: 'error' }); return }

      const hdr = rows[hIdx].map(h => h.trim().toLowerCase())
      const col = (names: string[]) => { for (const n of names) { const i = hdr.findIndex(h => h.includes(n)); if (i >= 0) return i } return -1 }
      const iTV = col(['tv']), iVB = col(['vb', 'crate']), iMat = col(['material', 'mat no', 'item'])
      const iDesc = col(['description', 'desc', 'text']), iQty = col(['qty', 'quantity'])
      const iLoc = col(['location', 'install loc']), iBox = col(['box', 'position'])

      const inserts = []
      const pid = activeProject!.id
      for (let i = hIdx + 1; i < rows.length; i++) {
        const r = rows[i]
        const matNo = iMat >= 0 ? r[iMat]?.trim() : ''
        if (!matNo) continue
        inserts.push({
          project_id: pid,
          tv_no: iTV >= 0 ? r[iTV]?.trim().replace(/^tv/i, '').trim() || '' : '',
          vb_no: iVB >= 0 ? r[iVB]?.trim() || '' : '',
          material_no: matNo,
          description: iDesc >= 0 ? r[iDesc]?.trim() || '' : '',
          qty_required: iQty >= 0 ? parseInt(r[iQty] || '1') || 1 : 1,
          location: iLoc >= 0 ? r[iLoc]?.trim() || '' : '',
          box_no: iBox >= 0 ? r[iBox]?.trim() || '' : '',
          status: 'required',
          qty_received: 0, qty_issued: 0,
        })
      }
      if (!inserts.length) { setVbStatus({ msg: '✗ No part rows found', type: 'error' }); return }

      const { error } = await supabase.from('wosit_lines').insert(inserts)
      if (error) { setVbStatus({ msg: '✗ ' + error.message, type: 'error' }); return }
      setVbStatus({ msg: `✓ Imported ${inserts.length} part lines`, type: 'ok' })
      setResults(r => [...r, `✓ ${inserts.length} VB part lines imported`])
      toast(`${inserts.length} part lines imported`, 'success')
    } catch (e) { setVbStatus({ msg: '✗ ' + (e as Error).message, type: 'error' }) }
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1000px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>Import Shipments</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>Upload WOSIT sheets — populates shipping, rental tooling & spare parts</p>
        </div>
        <button className="btn btn-sm" onClick={() => setActivePanel('shipping-dashboard')}>← Shipping</button>
      </div>

      {/* How it works */}
      <div className="card" style={{ marginBottom: '16px', padding: '14px 16px', borderLeft: '3px solid #0284c7' }}>
        <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '8px' }}>How it works</div>
        <p style={{ fontSize: '12px', color: 'var(--text2)', lineHeight: '1.7', marginBottom: '12px' }}>
          Upload the three WOSIT export sheets from SAP. The system will automatically create import shipment records and populate the relevant modules.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '12px' }}>
          {[
            { title: '1. TV Sheet', color: 'var(--mod-tooling)', body: 'TV numbers, descriptions, flight info, HAWB/MAWB, ETAs → creates shipment records and fills TV Register' },
            { title: '2. Kollo Sheet', color: 'var(--mod-tooling)', body: 'Package weights, dimensions, crate numbers → updates shipment weights/packages and fills Tooling Packages' },
            { title: '3. VB Details Sheet', color: 'var(--mod-parts, #0891b2)', body: 'Part line items, material numbers, quantities → fills Spare Parts WOSIT inventory' },
          ].map(s => (
            <div key={s.title} style={{ padding: '10px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg3)' }}>
              <div style={{ fontWeight: 600, color: s.color, marginBottom: '4px' }}>{s.title}</div>
              <div style={{ fontSize: '11px', color: 'var(--text3)' }}>{s.body}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Step 1 — TV Sheet */}
      <div className="card" style={{ marginBottom: '16px', padding: '16px' }}>
        <div style={{ fontWeight: 700, fontSize: '12px', color: 'var(--mod-tooling)', marginBottom: '10px' }}>
          🔩 Step 1: TV Sheet <span style={{ fontWeight: 400, color: 'var(--text3)', fontSize: '11px' }}>— upload first, then classify each TV as tooling or hardware</span>
        </div>
        <div
          style={{ border: '2px dashed var(--border)', borderRadius: 'var(--radius)', padding: '20px', textAlign: 'center', cursor: 'pointer', background: 'var(--bg3)' }}
          onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.xls,.csv'; inp.onchange = e => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) handleTVFile(f) }; inp.click() }}
          onDragOver={e => { e.preventDefault(); (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--mod-tooling)' }}
          onDragLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)' }}
          onDrop={e => { e.preventDefault(); (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)'; const f = e.dataTransfer.files[0]; if (f) handleTVFile(f) }}
        >
          <div style={{ fontSize: '28px', marginBottom: '6px' }}>📋</div>
          <div style={{ fontSize: '12px', fontWeight: 600 }}>Drop TV sheet or click to browse</div>
          <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '4px' }}>.xlsx/.csv — WOSIT TV export</div>
        </div>
        {tvStatus && <div style={{ marginTop: '8px', fontSize: '11px', color: tvStatus.type === 'ok' ? 'var(--green)' : tvStatus.type === 'error' ? 'var(--red)' : 'var(--text3)' }}>{tvStatus.msg}</div>}

        {tvRows.length > 0 && (
          <div style={{ marginTop: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div style={{ fontWeight: 600, fontSize: '13px' }}>Classify TVs — select which to import and set type</div>
              <div style={{ display: 'flex', gap: '6px' }}>
                {['tooling', 'hardware'].map(t => (
                  <button key={t} className="btn btn-sm" onClick={() => setTvRows(r => r.map(x => ({ ...x, type: t as 'tooling' | 'hardware' })))}>
                    All → {t === 'tooling' ? 'Tooling' : 'Hardware'}
                  </button>
                ))}
                <button className="btn btn-sm" onClick={() => setTvRows(r => r.map(x => ({ ...x, selected: true })))}>Select All</button>
                <button className="btn btn-sm" onClick={() => setTvRows(r => r.map(x => ({ ...x, selected: false })))}>Deselect All</button>
              </div>
            </div>
            <div style={{ overflowX: 'auto', maxHeight: '340px', overflowY: 'auto' }}>
              <table style={{ fontSize: '11px', minWidth: '700px' }}>
                <thead>
                  <tr>
                    <th style={{ width: '32px' }}><input type="checkbox" checked={tvRows.every(r => r.selected)} onChange={e => setTvRows(r => r.map(x => ({ ...x, selected: e.target.checked })))} /></th>
                    <th>TV No.</th><th>Header Name</th><th style={{ textAlign: 'right' }}>Repl. Value</th>
                    <th>Departure</th><th>ETA</th><th>HAWB</th><th>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {tvRows.map((tv, i) => (
                    <tr key={i}>
                      <td style={{ textAlign: 'center' }}><input type="checkbox" checked={tv.selected} onChange={e => setTvRows(r => r.map((x, j) => j === i ? { ...x, selected: e.target.checked } : x))} /></td>
                      <td style={{ fontFamily: 'var(--mono)', fontWeight: 600, color: 'var(--mod-tooling)' }}>TV{tv.tvNo}</td>
                      <td>{tv.headerName || <em style={{ color: 'var(--text3)' }}>unnamed</em>}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{tv.replValue > 0 ? '€' + tv.replValue.toLocaleString() : '—'}</td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: '10px' }}>{tv.departure || '—'}</td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: '10px' }}>{tv.eta || '—'}</td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)' }}>{tv.hawb || '—'}</td>
                      <td>
                        <select style={{ fontSize: '10px', padding: '2px 4px', border: '1px solid var(--border)', borderRadius: '3px', background: 'var(--bg2)' }}
                          value={tv.type}
                          onChange={e => setTvRows(r => r.map((x, j) => j === i ? { ...x, type: e.target.value as 'tooling' | 'hardware' } : x))}>
                          <option value="tooling">Tooling</option>
                          <option value="hardware">Hardware</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: 'var(--text3)', marginRight: 'auto' }}>{tvRows.filter(r => r.selected).length} of {tvRows.length} selected</span>
              <button className="btn" onClick={() => setTvRows([])}>Cancel</button>
              <button className="btn btn-primary" onClick={confirmTVImport} disabled={importing || !tvRows.some(r => r.selected)}>
                {importing ? '⏳ Importing…' : `✓ Import ${tvRows.filter(r => r.selected).length} TVs`}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Steps 2 + 3 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '14px', marginBottom: '16px' }}>
        <DropZone label="📦 Step 2: Kollo Sheet" sub="Drop Kollo sheet or click" icon="📦"
          color="var(--mod-tooling)" onFile={handleKolloFile} status={kolloStatus} />
        <DropZone label="🗄️ Step 3: VB Details (Parts)" sub="Drop VB Details or click — only needed for hardware TVs" icon="🗄️"
          color="var(--mod-parts, #0891b2)" onFile={handleVBFile} status={vbStatus} />
      </div>

      {/* Results log */}
      {results.length > 0 && (
        <div className="card" style={{ padding: '14px 16px' }}>
          <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '10px' }}>Import Results</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {results.map((r, i) => (
              <div key={i} style={{ color: r.startsWith('✓') ? 'var(--green)' : 'var(--red)' }}>{r}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
