import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'

declare const XLSX: {
  read: (data: ArrayBuffer, opts: { type: string }) => { SheetNames: string[]; Sheets: Record<string, unknown> }
  utils: { sheet_to_json: (sheet: unknown, opts?: { header?: number; defval?: unknown }) => unknown[][] }
}

interface WositRow {
  tv: string; vb: string; crate: string; delivPkg: string
  materialNo: string; installLocation: string; description: string
  qty: number; unit: string
}
interface TvRow {
  tvNo: string; tvName: string; hawb: string; mawb: string; flight: string
  departure: string; eta: string; kanlogPrice: number; currency: string
  hasDg: boolean; comment: string; status: string
}
interface KolloRow {
  kolloId: number; tvNo: string; vbNo: string; crateNo: string; delivPkg: string
  grossKg: number; netKg: number; lengthCm: number; widthCm: number; heightCm: number; packItems: number
}

function hdr(headers: string[], ...terms: string[]) {
  return headers.findIndex(h => terms.some(t => h.includes(t)))
}

function parseTV(buffer: ArrayBuffer): TvRow[] {
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][]
  let hi = -1
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if ((rows[i] as unknown[])?.some(c => String(c || '').includes('TV-No'))) { hi = i; break }
  }
  if (hi < 0) throw new Error('Could not find header row. Ensure sheet has TV-No. column.')
  const headers = (rows[hi] as string[]).map(h => String(h || '').trim())
  const tvNoI = hdr(headers, 'TV-No'), nameI = hdr(headers, 'TV Name'),
    hawbI = hdr(headers, 'HAWB'), mawbI = hdr(headers, 'MAWB'), flightI = hdr(headers, 'Flight'),
    depI = hdr(headers, 'Date of Departure', 'Departure'), etaI = hdr(headers, 'ETA POD', 'ETA'),
    priceI = hdr(headers, 'Kanlog Price', 'Price'), currI = hdr(headers, 'Kanl Price Curr', 'Curr', 'Currency'),
    dgI = hdr(headers, 'Danger'), commentI = hdr(headers, 'TV Comment', 'Comment'), statusI = hdr(headers, 'TV Status', 'Status')

  return rows.slice(hi + 1).filter(r => (r as unknown[])?.[tvNoI]).map(r => {
    const row = r as unknown[]
    return {
      tvNo: String(row[tvNoI] || ''), tvName: String(row[nameI] || ''),
      hawb: String(row[hawbI] || ''), mawb: String(row[mawbI] || ''), flight: String(row[flightI] || ''),
      departure: String(row[depI] || ''), eta: String(row[etaI] || ''),
      kanlogPrice: Number(row[priceI]) || 0, currency: String(row[currI] || 'EUR'),
      hasDg: String(row[dgI] || '').toLowerCase() === 'yes' || Boolean(row[dgI]),
      comment: String(row[commentI] || ''), status: String(row[statusI] || ''),
    }
  })
}

function parseKollo(buffer: ArrayBuffer): KolloRow[] {
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][]
  let hi = -1
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if ((rows[i] as unknown[])?.some(c => String(c || '').includes('TV-No') || String(c || '').includes('Kollo ID'))) { hi = i; break }
  }
  if (hi < 0) throw new Error('Could not find header row. Ensure sheet has TV-No. and Kollo ID columns.')
  const headers = (rows[hi] as string[]).map(h => String(h || '').trim())
  const kolloI = hdr(headers, 'Kollo ID'), tvI = hdr(headers, 'TV-No'), vbI = hdr(headers, 'VB-No'),
    grossI = hdr(headers, 'Gross'), netI = hdr(headers, 'Net'),
    lenI = hdr(headers, 'Length'), widI = hdr(headers, 'Width'), heiI = hdr(headers, 'Height'),
    pkgI = hdr(headers, 'Delivery Package'), packI = hdr(headers, '# pack items', 'Pack items', 'Items')

  return rows.slice(hi + 1).filter(r => (r as unknown[])?.[tvI]).map(r => {
    const row = r as unknown[]
    const delivPkg = String(row[pkgI] || '')
    const parts = delivPkg.split('-')
    return {
      kolloId: Number(row[kolloI]) || 0, tvNo: String(row[tvI] || ''), vbNo: String(row[vbI] || ''),
      crateNo: parts.length >= 3 ? parts[2] : delivPkg, delivPkg,
      grossKg: Number(row[grossI]) || 0, netKg: Number(row[netI]) || 0,
      lengthCm: Number(row[lenI]) || 0, widthCm: Number(row[widI]) || 0, heightCm: Number(row[heiI]) || 0,
      packItems: Number(row[packI]) || 0,
    }
  })
}

function parseWosit(buffer: ArrayBuffer): WositRow[] {
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][]
  let hi = -1
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if ((rows[i] as unknown[])?.some(c => String(c || '').includes('TV-No') || String(c || '').includes('Material'))) { hi = i; break }
  }
  if (hi < 0) throw new Error('Could not find header row. Ensure sheet has TV-No. and Material columns.')
  const headers = (rows[hi] as string[]).map(h => String(h || '').trim())
  const tvI = hdr(headers, 'TV-No.', 'TV-No'), vbI = hdr(headers, 'VB-No.', 'VB-No'),
    matI = headers.findIndex(h => h === 'Material'),
    matKanI = hdr(headers, 'Material (Kanlog)'), descEnI = hdr(headers, 'Language 2'),
    descDeI = hdr(headers, 'Language 1'), qtyI = hdr(headers, 'Quantity (Kanlog)', 'Quantity'),
    unitI = hdr(headers, 'Cum Quantity Unit', 'Unit'), pkgI = hdr(headers, 'Delivery Package')

  return rows.slice(hi + 1).filter(r => (r as unknown[])?.[matI] || (r as unknown[])?.[matKanI]).map(r => {
    const row = r as unknown[]
    const kanlogParts = String(row[matKanI] || '').split('#').map(s => s.trim()).filter(Boolean)
    const delivPkg = String(row[pkgI] || '')
    const dp = delivPkg.split('-')
    return {
      tv: String(row[tvI] || ''), vb: String(row[vbI] || ''),
      crate: dp.length >= 3 ? dp[2] : delivPkg, delivPkg,
      materialNo: String(row[matI] || row[matKanI] || ''),
      installLocation: kanlogParts[0] || '',
      description: String(row[descEnI] || row[descDeI] || ''),
      qty: Number(row[qtyI]) || 0, unit: String(row[unitI] || 'PCE'),
    }
  }).filter(r => r.materialNo)
}

export function WositImportPanel() {
  const { activeProject } = useAppStore()
  const [tvRows, setTvRows] = useState<TvRow[]>([])
  const [kolloRows, setKolloRows] = useState<KolloRow[]>([])
  const [wositRows, setWositRows] = useState<WositRow[]>([])
  const [tvFile, setTvFile] = useState('')
  const [kolloFile, setKolloFile] = useState('')
  const [wositFile, setWositFile] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  async function handleFile(step: 1 | 2 | 3, file: File) {
    try {
      const buffer = await file.arrayBuffer()
      if (step === 1) { const rows = parseTV(buffer); setTvRows(rows); setTvFile(file.name); toast(`${rows.length} TVs parsed`, 'success') }
      if (step === 2) { const rows = parseKollo(buffer); setKolloRows(rows); setKolloFile(file.name); toast(`${rows.length} Kollos parsed`, 'success') }
      if (step === 3) { const rows = parseWosit(buffer); setWositRows(rows); setWositFile(file.name); toast(`${rows.length} parts parsed`, 'success') }
    } catch (e) { toast((e as Error).message, 'error') }
  }

  async function doImport() {
    if (!wositRows.length && !tvRows.length && !kolloRows.length) return toast('No files loaded yet', 'error')
    setImporting(true)
    setResult(null)
    const pid = activeProject!.id
    let tvAdded = 0, kolloAdded = 0, wositAdded = 0, wositUpdated = 0

    try {
      // Import TVs → global_tvs + project_tvs
      for (const tv of tvRows) {
        const siteId = (activeProject as typeof activeProject & {site_id?:string}).site_id || null
        const { data: existing } = await supabase.from('global_tvs').select('id').eq('tv_no', tv.tvNo).eq('site_id', siteId || '').maybeSingle()
        if (existing) {
          await supabase.from('global_tvs').update({
            header_name: tv.tvName || undefined, hawb: tv.hawb, mawb: tv.mawb, flight: tv.flight,
            departure_date: tv.departure || null, eta_pod: tv.eta || null,
            kanlog_price: tv.kanlogPrice || null, has_dg: tv.hasDg, tv_comment: tv.comment,
          }).eq('id', existing.id)
        } else {
          const { data: newTv } = await supabase.from('global_tvs').insert({ site_id: siteId,
            tv_no: tv.tvNo, header_name: tv.tvName, hawb: tv.hawb, mawb: tv.mawb, flight: tv.flight,
            departure_date: tv.departure || null, eta_pod: tv.eta || null,
            kanlog_price: tv.kanlogPrice || null, kanlog_currency: tv.currency,
            has_dg: tv.hasDg, tv_status: tv.status, tv_comment: tv.comment,
          }).select('id').single()
          if (newTv) tvAdded++
        }
        // Link to project
        await supabase.from('project_tvs').upsert({ project_id: pid, tv_no: parseInt(tv.tvNo) || 0, site_id: siteId }, { onConflict: 'project_id,tv_no' })
      }

      // Import Kollos → global_kollos + project_kollos
      for (const k of kolloRows) {
        const { data: existing } = await supabase.from('global_kollos').select('id').eq('kollo_id', String(k.kolloId)).single()
        if (existing) {
          await supabase.from('global_kollos').update({ tv_no: k.tvNo, vb_no: k.vbNo, crate_no: k.crateNo, gross_kg: k.grossKg, net_kg: k.netKg, length_cm: k.lengthCm, width_cm: k.widthCm, height_cm: k.heightCm, pack_items: k.packItems, delivery_package: k.delivPkg }).eq('id', existing.id)
        } else {
          const { data: newK } = await supabase.from('global_kollos').insert({ kollo_id: String(k.kolloId), tv_no: k.tvNo, vb_no: k.vbNo, crate_no: k.crateNo, gross_kg: k.grossKg, net_kg: k.netKg, length_cm: k.lengthCm, width_cm: k.widthCm, height_cm: k.heightCm, pack_items: k.packItems, delivery_package: k.delivPkg }).select('id').single()
          if (newK) kolloAdded++
        }
        await supabase.from('project_kollos').upsert({ project_id: pid, tv_no: k.tvNo }, { onConflict: 'project_id,tv_no' })
      }

      // Import WOSIT → wosit_lines (upsert by project+material+tv+vb)
      for (const w of wositRows) {
        const { data: existing } = await supabase.from('wosit_lines').select('id,qty_received,status').eq('project_id', pid).eq('material_no', w.materialNo).eq('tv_no', w.tv).eq('vb_no', w.vb).single()
        if (existing) {
          // Preserve receive state on reimport
          await supabase.from('wosit_lines').update({ description: w.description, qty_required: w.qty, unit: w.unit, install_location: w.installLocation, delivery_package: w.delivPkg }).eq('id', existing.id)
          wositUpdated++
        } else {
          await supabase.from('wosit_lines').insert({ project_id: pid, material_no: w.materialNo, tv_no: w.tv, vb_no: w.vb, description: w.description, qty_required: w.qty, unit: w.unit, install_location: w.installLocation, delivery_package: w.delivPkg, location: w.crate, status: 'required', qty_received: 0 })
          wositAdded++
        }
      }

      const summary = [
        tvRows.length ? `${tvAdded} TVs imported` : '',
        kolloRows.length ? `${kolloAdded} Kollos imported` : '',
        wositRows.length ? `${wositAdded} new parts, ${wositUpdated} updated` : '',
      ].filter(Boolean).join(' · ')
      setResult(`✓ ${summary}`)
      toast(summary, 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
    setImporting(false)
  }

  function DropZone({ step, label, fileName, icon, hint }: { step: 1 | 2 | 3; label: string; fileName: string; icon: string; hint: string }) {
    return (
      <div style={{ border: '2px dashed var(--border2)', borderRadius: '8px', padding: '20px', textAlign: 'center', position: 'relative', background: fileName ? 'var(--bg3)' : 'transparent' }}>
        <div style={{ fontSize: '28px', marginBottom: '8px' }}>{fileName ? '✅' : icon}</div>
        <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>Step {step}: {label}</div>
        <div style={{ fontSize: '11px', color: 'var(--text3)', marginBottom: '12px' }}>{hint}</div>
        {fileName ? (
          <div style={{ fontSize: '12px', color: 'var(--green)', fontWeight: 500 }}>{fileName}</div>
        ) : (
          <label className="btn">
            📂 Choose File (.xlsx)
            <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(step, f) }} />
          </label>
        )}
        {fileName && (
          <button className="btn btn-sm" style={{ marginTop: '8px', display: 'block', marginLeft: 'auto', marginRight: 'auto' }}
            onClick={() => { if (step === 1) { setTvRows([]); setTvFile('') } if (step === 2) { setKolloRows([]); setKolloFile('') } if (step === 3) { setWositRows([]); setWositFile('') } }}>
            ✕ Remove
          </button>
        )}
      </div>
    )
  }

  const total = tvRows.length + kolloRows.length + wositRows.length
  const preview = wositRows.slice(0, 8)

  return (
    <div style={{ padding: '24px', maxWidth: '900px' }}>
      <h1 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '6px' }}>WOSIT / TV / Kollo Import</h1>
      <p style={{ fontSize: '13px', color: 'var(--text3)', marginBottom: '20px' }}>
        Import spare parts data from the WOSIT Excel export. Load files in any order — Step 3 (WOSIT) is required to populate the parts list.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '20px' }}>
        <DropZone step={1} label="TV Sheet" icon="📦" fileName={tvFile} hint="Contains TV-No., TV Name, departure dates, HAWB/MAWB" />
        <DropZone step={2} label="Kollo Sheet" icon="📫" fileName={kolloFile} hint="Contains TV-No., Kollo ID, dimensions and weights" />
        <DropZone step={3} label="WOSIT / VB Details" icon="🔩" fileName={wositFile} hint="Contains Material, Description, Quantity, TV-No., VB-No." />
      </div>

      {total > 0 && (
        <div className="card" style={{ padding: '12px 16px', marginBottom: '16px', display: 'flex', gap: '16px', alignItems: 'center' }}>
          <div style={{ flex: 1, fontSize: '13px' }}>
            {tvRows.length > 0 && <span style={{ marginRight: '16px' }}>📦 <strong>{tvRows.length}</strong> TVs</span>}
            {kolloRows.length > 0 && <span style={{ marginRight: '16px' }}>📫 <strong>{kolloRows.length}</strong> Kollos</span>}
            {wositRows.length > 0 && <span>🔩 <strong>{wositRows.length}</strong> Parts</span>}
          </div>
          <button className="btn btn-primary" onClick={doImport} disabled={importing}>
            {importing ? <span className="spinner" style={{ width: '14px', height: '14px' }} /> : null}
            {importing ? ' Importing...' : '✓ Import All'}
          </button>
        </div>
      )}

      {result && (
        <div style={{ padding: '12px 16px', borderRadius: '6px', background: '#d1fae5', color: '#065f46', fontWeight: 600, marginBottom: '16px' }}>
          {result}
        </div>
      )}

      {preview.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', fontWeight: 600, fontSize: '12px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)' }}>
            Preview — first {preview.length} of {wositRows.length} parts
          </div>
          <table style={{ fontSize: '11px' }}>
            <thead><tr><th>TV</th><th>VB</th><th>Material No</th><th>Description</th><th style={{ textAlign: 'right' }}>Qty</th><th>Unit</th><th>Location</th></tr></thead>
            <tbody>
              {preview.map((r, i) => (
                <tr key={i}>
                  <td style={{ fontFamily: 'var(--mono)' }}>{r.tv}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: '10px' }}>{r.vb}</td>
                  <td style={{ fontFamily: 'var(--mono)' }}>{r.materialNo}</td>
                  <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.description}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{r.qty}</td>
                  <td style={{ fontSize: '10px', color: 'var(--text3)' }}>{r.unit}</td>
                  <td style={{ fontSize: '10px', color: 'var(--text3)' }}>{r.installLocation || r.crate || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
