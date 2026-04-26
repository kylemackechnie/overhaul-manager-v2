import * as XLSX from 'xlsx'
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'

// ── Types ──────────────────────────────────────────────────────────────────

interface ParsedTV {
  tvNo: number; selected: boolean; shipType: 'tooling' | 'hardware'
  headerName: string; replacementValue: number; poNumber: string
  departure: string; eta: string; hawb: string; mawb: string
}

interface ParsedKollo {
  tvNo: number; kolloId: string; crateNo: string; vbNo: string
  grossKg: number; netKg: number
  lengthCm: number; widthCm: number; heightCm: number; volM3: number
  packItems: string; dangerousGoods: boolean; dgName: string; dgClass: string
}

// ── Date helpers ───────────────────────────────────────────────────────────

function fmtDate(v: unknown): string {
  if (!v) return ''
  if (typeof v === 'number') {
    // Excel serial date
    const d = new Date(1899, 11, 30 + v)
    return d.toISOString().slice(0, 10)
  }
  const s = String(v).trim()
  const dmy = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`
  return s
}

function colFind(headers: string[], ...terms: string[]): number {
  const h = headers.map(s => s.toLowerCase().trim())
  for (const t of terms) {
    const i = h.findIndex(s => s.includes(t.toLowerCase()))
    if (i >= 0) return i
  }
  return -1
}

// ── Summary tile ───────────────────────────────────────────────────────────

function SummaryTile({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div style={{ padding: '12px', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
      <div style={{ fontSize: '10px', color: 'var(--text3)', textTransform: 'uppercase', fontFamily: 'var(--mono)', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: '20px', fontWeight: 700, color }}>{value}</div>
    </div>
  )
}

// ── SLI Modal ─────────────────────────────────────────────────────────────

function SLIModal({ shipmentId: _shipmentId, onClose, project }: { shipmentId: string; onClose: () => void; project: { name: string } }) {
  const [form, setForm] = useState({
    senderCo: 'Siemens Energy Pty Ltd', senderAddr: '', senderContact: '', senderPhone: '',
    pickupAddr: '', pickupDate: new Date().toISOString().slice(0,10), shipperRef: '',
    recvCo: '', recvAddr: '', recvCity: '', recvCountry: 'Germany', recvContact: '', recvPhone: '', consigneeRef: '',
    airport: '', service: 'Air Value — Consol service', goodsDesc: '', countryMfg: 'AU', hsCode: '', customsVal: '', edn: '',
    insurance: 'No', pieces: '', weight: '', dg: 'No', notes: ''
  })

  function generateHTML() {
    const chk = (on: boolean) => on ? '<span class="check on">✓</span>' : '<span class="check"></span>'
    const isDG = form.dg.startsWith('Yes')
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>SLI — ${form.shipperRef}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:10px;color:#000;padding:20px}
h1{font-size:16px;font-weight:700;text-align:center;margin-bottom:4px}.subtitle{text-align:center;font-size:10px;color:#666;margin-bottom:16px}
table{width:100%;border-collapse:collapse}.ft td{border:1px solid #999;padding:5px 8px;vertical-align:top}
.ft .lb{font-weight:700;background:#f0f0f0;width:140px;font-size:9px}.section{font-weight:700;background:#d0d0d0;text-align:center;padding:6px;font-size:11px}
.gt th{background:#e0e0e0;border:1px solid #999;padding:4px 6px;font-size:9px;text-align:left}.gt td{border:1px solid #999;padding:4px 6px}
.check{display:inline-block;width:11px;height:11px;border:1px solid #000;text-align:center;line-height:11px;margin-right:3px;font-size:9px}
.check.on{background:#000;color:#fff}@media print{button{display:none!important}body{padding:10px}}</style>
</head><body>
<div style="display:flex;justify-content:flex-end;margin-bottom:8px">
  <button onclick="window.print()" style="padding:6px 16px;background:#d97706;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;font-weight:600">🖨 Print</button>
</div>
<h1>SHIPPER'S LETTER OF INSTRUCTION</h1>
<div class="subtitle">DHL Global Forwarding</div>

<table class="ft" style="margin-bottom:10px">
  <tr><td colspan="4" class="section">SENDER / SHIPPER DETAILS</td></tr>
  <tr><td class="lb">Company:</td><td>${form.senderCo}</td><td class="lb">Address:</td><td>${form.senderAddr}</td></tr>
  <tr><td class="lb">Contact Name:</td><td>${form.senderContact}</td><td class="lb">Telephone:</td><td>${form.senderPhone}</td></tr>
  <tr><td class="lb">Pick up required:</td><td>${chk(true)} Yes &nbsp; ${chk(false)} No</td><td class="lb">Date:</td><td>${form.pickupDate}</td></tr>
  <tr><td class="lb">Pickup address:</td><td colspan="3">${form.pickupAddr}</td></tr>
  <tr><td class="lb">Shipper's Ref:</td><td colspan="3">${form.shipperRef}</td></tr>
</table>

<table class="ft" style="margin-bottom:10px">
  <tr><td colspan="4" class="section">RECEIVER / CONSIGNEE DETAILS</td></tr>
  <tr><td class="lb">Company:</td><td colspan="3">${form.recvCo}</td></tr>
  <tr><td class="lb">Address:</td><td colspan="3">${form.recvAddr}</td></tr>
  <tr><td class="lb">City/Post Code:</td><td>${form.recvCity}</td><td class="lb">Country:</td><td>${form.recvCountry}</td></tr>
  <tr><td class="lb">Contact Name:</td><td>${form.recvContact}</td><td class="lb">Telephone:</td><td>${form.recvPhone}</td></tr>
  <tr><td class="lb">Special Instructions:</td><td colspan="3">${form.notes}</td></tr>
  <tr><td class="lb">Consignee Ref:</td><td colspan="3">${form.consigneeRef}</td></tr>
</table>

<table class="ft" style="margin-bottom:10px">
  <tr><td colspan="4" class="section">SHIPMENT DETAILS</td></tr>
  <tr><td class="lb">Airport of Dest:</td><td>${form.airport}</td><td class="lb">Service:</td><td>${form.service}</td></tr>
  <tr><td class="lb">Description:</td><td>${form.goodsDesc}</td><td class="lb">HS Code:</td><td>${form.hsCode}</td></tr>
  <tr><td class="lb">Country of Mfg:</td><td>${form.countryMfg}</td><td class="lb">Customs Value:</td><td>${form.customsVal}</td></tr>
  <tr><td class="lb">Pieces:</td><td>${form.pieces}</td><td class="lb">Gross Weight:</td><td>${form.weight} kg</td></tr>
  <tr><td class="lb">Dangerous Goods:</td><td>${chk(isDG)} Yes &nbsp; ${chk(!isDG)} No</td><td class="lb">Insurance:</td><td>${chk(form.insurance==='Yes')} Yes &nbsp; ${chk(form.insurance!=='Yes')} No</td></tr>
  <tr><td class="lb">EDN:</td><td colspan="3">${form.edn}</td></tr>
</table>

<div style="margin-top:16px;border-top:1px solid #ccc;padding-top:8px;font-size:8px;color:#999;text-align:center">
  Generated by Overhaul Manager — ${new Date().toLocaleDateString('en-AU',{day:'2-digit',month:'short',year:'numeric'})} — ${project.name}
</div></body></html>`
    const w = window.open('','_blank','width=900,height=1100')
    if (w) { w.document.write(html); w.document.close() }
    onClose()
  }

  const inp = (k: keyof typeof form, opts?: Record<string, unknown>) => (
    <input className="input" value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} style={{ fontSize: '11px' }} {...opts} />
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '12px', width: '680px', maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '15px', fontWeight: 700 }}>📄 Shipper's Letter of Instruction</div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: '18px', cursor: 'pointer', color: 'var(--text3)' }}>✕</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 20px' }}>
          {[
            ['Sender / Shipper', [
              ['Company', 'senderCo'], ['Address', 'senderAddr'],
              ['Contact', 'senderContact'], ['Phone', 'senderPhone'],
              ['Pickup Address', 'pickupAddr'], ['Pickup Date', 'pickupDate'],
              ['Shipper Reference', 'shipperRef'],
            ]],
            ['Consignee', [
              ['Company', 'recvCo'], ['Address', 'recvAddr'],
              ['City/Post Code', 'recvCity'], ['Country', 'recvCountry'],
              ['Contact', 'recvContact'], ['Phone', 'recvPhone'],
              ['Consignee Ref', 'consigneeRef'],
            ]],
            ['Shipment', [
              ['Airport of Destination', 'airport'], ['Service', 'service'],
              ['Description', 'goodsDesc'], ['Country of Mfg', 'countryMfg'],
              ['HS Code', 'hsCode'], ['Customs Value', 'customsVal'],
              ['Pieces', 'pieces'], ['Weight (kg)', 'weight'],
              ['EDN', 'edn'], ['Notes', 'notes'],
            ]],
          ].map(([heading, fields]) => (
            <div key={heading as string} style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '8px' }}>
                {heading as string}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {(fields as [string, string][]).map(([lbl, key]) => (
                  <div key={key} style={{ margin: 0 }}>
                    <label style={{ fontSize: '11px', display: 'block', marginBottom: '2px' }}>{lbl}</label>
                    {inp(key as keyof typeof form)}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn" style={{ background: '#c2185b', color: '#fff' }} onClick={generateHTML}>📄 Generate SLI</button>
        </div>
      </div>
    </div>
  )
}

// ── PackingListModal ───────────────────────────────────────────────────────

function PackingListModal({ shipmentId: _shipmentId, shipRef, onClose, project }: { shipmentId: string; shipRef: string; onClose: () => void; project: { name: string } }) {
  const [form, setForm] = useState({
    shipperCo: 'Siemens Energy Pty Ltd', shipperAddr: '',
    recvCo: 'Siemens Energy Global GmbH & Co. KG', recvAddr: '', recvCity: '', recvCountry: 'Germany',
    proj: project.name, po: '', lot: shipRef, date: new Date().toISOString().slice(0, 10),
    transport: 'Airfreight', incoterms: 'CIP Frankfurt Airport',
    reason: 'Return to country of origin for repair/refurbishment',
    currency: 'EUR', showPrices: false
  })

  function generateHTML() {
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${form.showPrices ? 'Commercial Invoice' : 'Packing List'} — ${form.lot}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:10px;color:#000;padding:20px}
h1{font-size:14px;font-weight:700;text-align:center;margin-bottom:16px}
table{width:100%;border-collapse:collapse}.ft td{border:1px solid #999;padding:5px 8px}
.ft .lb{font-weight:700;background:#f0f0f0;font-size:9px;width:140px}.section{font-weight:700;background:#d0d0d0;padding:4px 8px;font-size:11px}
.gt th{background:#e0e0e0;border:1px solid #999;padding:4px 6px;font-size:9px;text-align:left}.gt td{border:1px solid #999;padding:4px 6px}
@media print{button{display:none!important}body{padding:10px}}</style>
</head><body>
<div style="display:flex;justify-content:flex-end;margin-bottom:8px">
  <button onclick="window.print()" style="padding:6px 16px;background:#0284c7;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;font-weight:600">🖨 Print</button>
</div>
<h1>${form.showPrices ? 'COMMERCIAL INVOICE / GOODS ACCOMPANYING INVOICE' : 'PACKING LIST / PACKLISTE'}</h1>
<table class="ft" style="margin-bottom:10px">
  <tr><td class="section" colspan="4">SHIPPER / EXPORTER</td></tr>
  <tr><td class="lb">Company:</td><td>${form.shipperCo}</td><td class="lb">Address:</td><td>${form.shipperAddr}</td></tr>
  <tr><td class="section" colspan="4">CONSIGNEE</td></tr>
  <tr><td class="lb">Company:</td><td>${form.recvCo}</td><td class="lb">Address:</td><td>${form.recvAddr}</td></tr>
  <tr><td class="lb">City/Post Code:</td><td>${form.recvCity}</td><td class="lb">Country:</td><td>${form.recvCountry}</td></tr>
</table>
<table class="ft" style="margin-bottom:10px">
  <tr><td class="lb">Project:</td><td>${form.proj}</td><td class="lb">PO Number:</td><td>${form.po}</td></tr>
  <tr><td class="lb">Lot / TV No.:</td><td>${form.lot}</td><td class="lb">Date:</td><td>${form.date}</td></tr>
  <tr><td class="lb">Transport:</td><td>${form.transport}</td><td class="lb">Incoterms:</td><td>${form.incoterms}</td></tr>
  ${form.showPrices ? `<tr><td class="lb">Reason for Export:</td><td colspan="3">${form.reason}</td></tr>` : ''}
</table>
<table class="gt">
  <thead><tr><th>Crate No.</th><th>Description</th><th style="text-align:right">Gross kg</th><th style="text-align:right">Net kg</th><th>Dims (cm)</th>${form.showPrices ? '<th style="text-align:right">Value</th>' : ''}</tr></thead>
  <tbody><tr><td colspan="${form.showPrices ? 6 : 5}" style="text-align:center;color:#999;padding:12px">No package data — import Kollo sheet first</td></tr></tbody>
</table>
<div style="margin-top:16px;font-size:8px;color:#999;text-align:center">Generated by Overhaul Manager — ${new Date().toLocaleDateString('en-AU')} — ${project.name}</div>
</body></html>`
    const w = window.open('','_blank')
    if (w) { w.document.write(html); w.document.close() }
    onClose()
  }

  const inp = (k: keyof typeof form) => (
    <input className="input" value={form[k] as string}
      onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} style={{ fontSize: '11px' }} />
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '12px', width: '620px', maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '15px', fontWeight: 700 }}>📦 {form.showPrices ? 'Commercial Invoice' : 'Packing List'} — {shipRef}</div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: '18px', cursor: 'pointer', color: 'var(--text3)' }}>✕</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
            {([['Shipper Company','shipperCo'],['Shipper Address','shipperAddr'],
               ['Consignee Company','recvCo'],['Consignee Address','recvAddr'],
               ['City/Post Code','recvCity'],['Country','recvCountry'],
               ['Project','proj'],['PO Number','po'],
               ['Lot / TV No.','lot'],['Date','date'],
               ['Transport','transport'],['Incoterms','incoterms'],
            ] as [string, keyof typeof form][]).map(([lbl, k]) => (
              <div key={k} style={{ margin: 0 }}>
                <label style={{ fontSize: '11px', display: 'block', marginBottom: '2px' }}>{lbl}</label>
                {inp(k)}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input type="checkbox" checked={form.showPrices} onChange={e => setForm(f => ({ ...f, showPrices: e.target.checked }))} />
            <label style={{ fontSize: '12px' }}>Include prices (Commercial Invoice)</label>
          </div>
          {form.showPrices && (
            <div style={{ marginTop: '8px' }}>
              <label style={{ fontSize: '11px', display: 'block', marginBottom: '2px' }}>Reason for Export</label>
              <select className="select" value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} style={{ fontSize: '11px' }}>
                <option>Return to country of origin for repair/refurbishment</option>
                <option>Permanent export - sale of goods</option>
                <option>Temporary export - will be re-imported</option>
              </select>
            </div>
          )}
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn" style={{ background: '#0284c7', color: '#fff' }} onClick={generateHTML}>
            {form.showPrices ? '💰 Generate Invoice' : '📦 Generate Packing List'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export function ShippingImportPanel() {
  const { activeProject } = useAppStore()
  const [tvParsed, setTVParsed]   = useState<ParsedTV[]>([])
  const [tvStatus, setTVStatus]   = useState('')
  const [kolloStatus, setKolloStatus] = useState('')
  const [vbStatus, setVbStatus]   = useState('')
  const [summary, setSummary]     = useState({ shipments: 0, tooling: 0, hardware: 0, kollos: 0, parts: 0 })
  const [sliShipId, setSliShipId] = useState<string | null>(null)
  const [packShipId, setPackShipId] = useState<string | null>(null)
  const [packShipRef, setPackShipRef] = useState('')
  const [exportShipments, setExportShipments] = useState<{ id: string; reference: string }[]>([])
  const today = new Date().toISOString().slice(0,10)

  useEffect(() => {
    if (!activeProject) return
    loadSummary()
    supabase.from('shipments').select('id,reference').eq('project_id', activeProject.id).eq('direction','export')
      .then(({ data }) => setExportShipments((data || []) as { id: string; reference: string }[]))
  }, [activeProject?.id])

  async function loadSummary() {
    if (!activeProject) return
    const pid = activeProject.id
    const [sRes, kRes, pRes] = await Promise.all([
      supabase.from('shipments').select('id,ship_type').eq('project_id', pid).eq('direction','import'),
      supabase.from('tooling_kollos').select('id').eq('project_id', pid),
      supabase.from('wosit_lines').select('id').eq('project_id', pid),
    ])
    const ships = sRes.data || []
    setSummary({
      shipments: ships.length,
      tooling: ships.filter(s => (s as { ship_type: string }).ship_type === 'tooling').length,
      hardware: ships.filter(s => (s as { ship_type: string }).ship_type === 'hardware').length,
      kollos: (kRes.data || []).length,
      parts: (pRes.data || []).length,
    })
  }

  // ── Step 1: Parse TV sheet ─────────────────────────────────────────────

  async function handleTVFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    const buf = await file.arrayBuffer()
    try {
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][]

      let headerIdx = -1
      for (let i = 0; i < Math.min(rows.length, 8); i++) {
        if ((rows[i] as unknown[])?.some(c => String(c||'').includes('TV-No'))) { headerIdx = i; break }
      }
      if (headerIdx < 0) { setTVStatus('❌ Could not find TV-No header row.'); return }

      const headers = (rows[headerIdx] as unknown[]).map(h => String(h||''))
      const tvCol   = colFind(headers, 'TV-No')
      const nameCol = colFind(headers, 'Header', 'TV Name')
      const replCol = colFind(headers, 'Kanlog Price', 'Replacement')
      const depCol  = colFind(headers, 'Date of Departure', 'Departure')
      const etaCol  = colFind(headers, 'ETA POD', 'ETA')
      const hawbCol = colFind(headers, 'HAWB')
      const mawbCol = colFind(headers, 'MAWB')

      if (tvCol < 0) { setTVStatus('❌ No TV-No column found.'); return }

      const parsed: ParsedTV[] = []
      for (let i = headerIdx + 1; i < rows.length; i++) {
        const r = rows[i] as unknown[]
        if (!r || !r[tvCol]) continue
        const tvNo = parseInt(String(r[tvCol]))
        if (isNaN(tvNo)) continue
        parsed.push({
          tvNo, selected: true, shipType: 'tooling',
          headerName:      nameCol >= 0 ? String(r[nameCol] || '').trim() : '',
          replacementValue: replCol >= 0 ? parseFloat(String(r[replCol] || '0')) || 0 : 0,
          poNumber:         '',
          departure:        depCol  >= 0 ? fmtDate(r[depCol]) : '',
          eta:              etaCol  >= 0 ? fmtDate(r[etaCol]) : '',
          hawb:             hawbCol >= 0 ? String(r[hawbCol] || '').trim() : '',
          mawb:             mawbCol >= 0 ? String(r[mawbCol] || '').trim() : '',
        })
      }
      setTVParsed(parsed)
      setTVStatus(`✓ ${parsed.length} TVs found — classify and confirm below.`)
    } catch (err) {
      setTVStatus(`❌ Error: ${(err as Error).message}`)
    }
    e.target.value = ''
  }

  // ── Step 1 Confirm ─────────────────────────────────────────────────────

  async function confirmTVs() {
    if (!activeProject) return
    const selected = tvParsed.filter(t => t.selected)
    if (!selected.length) { toast('Select at least one TV', 'error'); return }
    const pid = activeProject.id

    // Insert tooling_tvs — check existing first to avoid conflict issues
    const { data: existingTVs } = await supabase.from('tooling_tvs')
      .select('tv_no').eq('project_id', pid)
    const existingSet = new Set((existingTVs || []).map(t => (t as { tv_no: number }).tv_no))

    const toInsert = selected.filter(tv => !existingSet.has(tv.tvNo)).map(tv => ({
      project_id: pid, tv_no: tv.tvNo, header_name: tv.headerName,
      replacement_value: tv.replacementValue, po_number: tv.poNumber,
      departure: tv.departure || null, eta: tv.eta || null,
      hawb: tv.hawb, mawb: tv.mawb,
    }))
    const toUpdate = selected.filter(tv => existingSet.has(tv.tvNo))

    if (toInsert.length) {
      const { error: insErr } = await supabase.from('tooling_tvs').insert(toInsert)
      if (insErr) { toast('Error saving TVs: ' + insErr.message, 'error'); return }
    }
    for (const tv of toUpdate) {
      await supabase.from('tooling_tvs').update({
        header_name: tv.headerName, replacement_value: tv.replacementValue,
        departure: tv.departure || null, eta: tv.eta || null,
        hawb: tv.hawb, mawb: tv.mawb,
      }).eq('project_id', pid).eq('tv_no', tv.tvNo)
    }

    // Upsert shipment records
    let shipmentsCreated = 0
    for (const tv of selected) {
      const ref = `TV${tv.tvNo}`
      const { data: existing } = await supabase.from('shipments').select('id').eq('project_id', pid).eq('reference', ref).eq('direction','import').maybeSingle()
      if (!existing) {
        const status = tv.eta && tv.eta <= today ? 'delivered' : 'in_transit'
        await supabase.from('shipments').insert({
          project_id: pid, direction: 'import', ship_type: tv.shipType,
          reference: ref, description: tv.headerName || ref,
          hawb: tv.hawb, mawb: tv.mawb, eta: tv.eta || null,
          status, notes: tv.poNumber ? `PO: ${tv.poNumber}` : '',
          origin: 'Germany',
        })
        shipmentsCreated++
      } else {
        await supabase.from('shipments').update({
          eta: tv.eta || null, hawb: tv.hawb,
          description: tv.headerName,
        }).eq('id', (existing as { id: string }).id)
      }
    }

    toast(`${selected.length} TVs imported — ${shipmentsCreated} shipments created`, 'success')
    setTVParsed([]); setTVStatus('')
    loadSummary()
  }

  // ── Step 2: Kollo sheet ────────────────────────────────────────────────

  async function handleKolloFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    if (!activeProject) return
    const pid = activeProject.id
    const buf = await file.arrayBuffer()
    try {
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][]

      let headerIdx = -1
      for (let i = 0; i < Math.min(rows.length, 8); i++) {
        if ((rows[i] as unknown[])?.some(c => { const s = String(c||'').toLowerCase(); return s.includes('tv') || s.includes('crate') || s.includes('gross') })) { headerIdx = i; break }
      }
      if (headerIdx < 0) { setKolloStatus('❌ Could not find header row.'); return }

      const headers = (rows[headerIdx] as unknown[]).map(h => String(h||'').toLowerCase())
      const tvCol      = colFind(headers, 'tv')
      const kolloIdCol = colFind(headers, 'kollo id', 'kollo')
      const crateCol   = colFind(headers, 'crate')
      const vbCol      = colFind(headers, 'vb')
      const grossCol   = colFind(headers, 'gross')
      const netCol     = colFind(headers, 'net')
      const lenCol     = colFind(headers, 'length', 'l ')
      const widCol     = colFind(headers, 'width', 'w ')
      const hgtCol     = colFind(headers, 'height', 'h ')
      const volCol     = colFind(headers, 'vol')
      const itemsCol   = colFind(headers, 'pack', 'item')
      const dgCol      = colFind(headers, 'danger (kanlog)', 'danger')
      const dgNameCol  = colFind(headers, 'dangerous good name', 'good name')
      const dgClassCol = colFind(headers, 'dangerous goods class', 'goods class')

      if (tvCol < 0) { setKolloStatus('❌ No TV column found.'); return }

      const kollos: ParsedKollo[] = []
      for (let i = headerIdx + 1; i < rows.length; i++) {
        const r = rows[i] as unknown[]
        if (!r || !r[tvCol]) continue
        const tvNo = parseInt(String(r[tvCol])); if (isNaN(tvNo)) continue
        kollos.push({
          tvNo, kolloId: kolloIdCol >= 0 ? String(r[kolloIdCol] || '') : '',
          crateNo:         crateCol   >= 0 ? String(r[crateCol] || '') : '',
          vbNo:            vbCol      >= 0 ? String(r[vbCol] || '') : '',
          grossKg:         grossCol   >= 0 ? parseFloat(String(r[grossCol] || '0')) || 0 : 0,
          netKg:           netCol     >= 0 ? parseFloat(String(r[netCol] || '0')) || 0 : 0,
          lengthCm:        lenCol     >= 0 ? parseFloat(String(r[lenCol] || '0')) || 0 : 0,
          widthCm:         widCol     >= 0 ? parseFloat(String(r[widCol] || '0')) || 0 : 0,
          heightCm:        hgtCol     >= 0 ? parseFloat(String(r[hgtCol] || '0')) || 0 : 0,
          volM3:           volCol     >= 0 ? parseFloat(String(r[volCol] || '0')) || 0 : 0,
          packItems:       itemsCol   >= 0 ? String(r[itemsCol] || '') : '',
          dangerousGoods:  dgCol      >= 0 ? !!(r[dgCol]) : false,
          dgName:          dgNameCol  >= 0 ? String(r[dgNameCol] || '').trim() : '',
          dgClass:         dgClassCol >= 0 ? String(r[dgClassCol] || '').trim() : '',
        })
      }

      // Upsert into tooling_kollos
      const kolloRows = kollos.map(k => ({
        project_id: pid, tv_no: k.tvNo,
        kollo_id: k.kolloId || null, crate_no: k.crateNo, vb_no: k.vbNo,
        gross_kg: k.grossKg, net_kg: k.netKg,
        length_cm: k.lengthCm, width_cm: k.widthCm, height_cm: k.heightCm, vol_m3: k.volM3,
        pack_items: k.packItems, dangerous_goods: k.dangerousGoods,
        dg_name: k.dgName, dg_class: k.dgClass,
      }))
      const { error: kErr } = await supabase.from('tooling_kollos').insert(kolloRows)
      if (kErr) { setKolloStatus(`❌ Error: ${kErr.message}`); return }

      // Update shipment records with weight/package totals
      const kollosByTV: Record<number, ParsedKollo[]> = {}
      kollos.forEach(k => { (kollosByTV[k.tvNo] ||= []).push(k) })

      const { data: importShips } = await supabase.from('shipments').select('id,reference').eq('project_id', pid).eq('direction','import')
      for (const s of (importShips || [])) {
        const ref = (s as { reference: string }).reference
        if (!ref?.startsWith('TV')) continue
        const tvNo = parseInt(ref.replace('TV',''))
        const tvKollos = kollosByTV[tvNo] || []
        if (!tvKollos.length) continue
        const pkgs = tvKollos.length
        const weight = tvKollos.reduce((sum, k) => sum + k.grossKg, 0)
        const hasDg = tvKollos.some(k => k.dangerousGoods)
        const dgInfo = hasDg ? [...new Set(tvKollos.filter(k => k.dangerousGoods).map(k => k.dgClass).filter(Boolean))].map(c => `Class ${c}`).join(', ') : ''
        await supabase.from('shipments').update({ packages: pkgs, gross_kg: weight, has_dg: hasDg, dg_info: dgInfo }).eq('id', (s as { id: string }).id)
      }

      setKolloStatus(`✓ ${kollos.length} packages imported. Shipment weights updated.`)
      loadSummary()
    } catch (err) {
      setKolloStatus(`❌ Error: ${(err as Error).message}`)
    }
    e.target.value = ''
  }

  // ── Step 3: VB Details ─────────────────────────────────────────────────

  async function handleVBFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    if (!activeProject) return
    const pid = activeProject.id
    const buf = await file.arrayBuffer()
    try {
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][]

      let headerIdx = -1
      for (let i = 0; i < Math.min(rows.length, 5); i++) {
        if ((rows[i] as unknown[])?.some(c => String(c||'').includes('TV-No') || String(c||'').includes('Material'))) { headerIdx = i; break }
      }
      if (headerIdx < 0) { setVbStatus('❌ Could not find header row.'); return }

      const headers = (rows[headerIdx] as unknown[]).map(h => String(h||'').trim())
      const idx = (...terms: string[]) => headers.findIndex(h => terms.some(t => h.includes(t)))

      const tvIdx      = idx('TV-No.')
      const vbIdx      = idx('VB-No.')
      const delivPkgIdx= idx('Delivery Package')
      const matColIdx  = headers.findIndex(h => h === 'Material')
      const matKanIdx  = idx('Material (Kanlog)')
      const descEnIdx  = idx('Language 2')
      const descDeIdx  = idx('Language 1')
      const qtyIdx     = idx('Quantity (Kanlog)')
      const unitIdx    = idx('Cum Quantity Unit')

      // Get tooling TVs to skip
      // Get all TV numbers for this project that are in the shipments as tooling type
      const { data: toolingShipments } = await supabase.from('shipments').select('reference').eq('project_id', pid).eq('direction','import').eq('ship_type','tooling')
      const toolingSet = new Set((toolingShipments || []).map(s => {
        const ref = String((s as { reference: string }).reference || '')
        return ref.startsWith('TV') ? ref.slice(2) : ref
      }))

      const parts: {
        project_id: string; tv_no: string; vb_no: string; delivery_package: string; deliv_pkg: string
        material_no: string; install_location: string; description: string
        qty_required: number; unit: string; received_qty: number; status: string
      }[] = []
      let skipped = 0

      for (let i = headerIdx + 1; i < rows.length; i++) {
        const row = rows[i] as unknown[]
        if (!row || !row[matColIdx]) continue
        const tvStr = String(row[tvIdx] || '')
        if (toolingSet.has(tvStr)) { skipped++; continue }

        const kanlogParts = String(row[matKanIdx] || '').split('#').map(s => s.trim()).filter(Boolean)
        const installLoc = kanlogParts[0] || ''
        const delivPkg = String(row[delivPkgIdx] || '')

        parts.push({
          project_id: pid,
          tv_no: tvStr, vb_no: String(row[vbIdx] || ''), delivery_package: delivPkg, deliv_pkg: delivPkg,
          material_no: String(row[matColIdx] || ''), install_location: installLoc,
          description: String(row[descEnIdx] || row[descDeIdx] || ''),
          qty_required: Number(row[qtyIdx]) || 0, unit: String(row[unitIdx] || 'PCE'),
          received_qty: 0, status: 'pending',
        })
      }

      if (parts.length) {
        const { error: pErr } = await supabase.from('wosit_lines').insert(parts)
        if (pErr) { setVbStatus(`❌ Error: ${pErr.message}`); return }
      }

      setVbStatus(`✓ ${parts.length} parts added${skipped ? `, ${skipped} tooling TV lines skipped` : ''}.`)
      loadSummary()
    } catch (err) {
      setVbStatus(`❌ Error: ${(err as Error).message}`)
    }
    e.target.value = ''
  }

  if (!activeProject) return <div className="loading-center">No project selected.</div>

  const sel = tvParsed.filter(t => t.selected)
  const toolCount = sel.filter(t => t.shipType === 'tooling').length
  const hwCount = sel.filter(t => t.shipType === 'hardware').length

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <h1 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '4px' }}>📥 WOSIT Import</h1>
      <p style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '20px' }}>
        Upload three WOSIT export sheets from SAP. Creates import shipment records and populates tooling &amp; spare parts modules.
      </p>

      {/* Summary */}
      {summary.shipments > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '12px', marginBottom: '20px' }}>
          <SummaryTile label="Import Shipments" value={summary.shipments} color="#0284c7" />
          <SummaryTile label="Tooling TVs" value={summary.tooling} color="var(--mod-tooling, #7c3aed)" />
          <SummaryTile label="Hardware TVs" value={summary.hardware} color="#0891b2" />
          <SummaryTile label="Packages (Kollos)" value={summary.kollos} color="var(--mod-tooling, #7c3aed)" />
          <SummaryTile label="WOSIT Parts" value={summary.parts} color="var(--mod-parts, #059669)" />
        </div>
      )}

      {/* Three-step import */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>

        {/* Step 1 — TV Sheet */}
        <div className="card" style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '13px' }}>Step 1 — TV Sheet</div>
              <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>TV numbers, header names, departure/ETA dates, HAWB → creates import shipments + TV register</div>
            </div>
            <label className="btn btn-primary" style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
              📋 Load TV Sheet
              <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleTVFile} />
            </label>
          </div>
          {tvStatus && <div style={{ fontSize: '12px', color: tvStatus.startsWith('✓') ? 'var(--green)' : 'var(--red)', marginBottom: '8px' }}>{tvStatus}</div>}

          {tvParsed.length > 0 && (
            <>
              <div style={{ fontSize: '11px', color: 'var(--text3)', marginBottom: '8px' }}>
                {sel.length} selected — {toolCount} tooling, {hwCount} hardware
                &nbsp;
                <button className="btn btn-xs" onClick={() => setTVParsed(p => p.map(t => ({ ...t, shipType: 'tooling' })))}>All Tooling</button>
                &nbsp;
                <button className="btn btn-xs" onClick={() => setTVParsed(p => p.map(t => ({ ...t, shipType: 'hardware' })))}>All Hardware</button>
              </div>
              <div style={{ overflowX: 'auto', marginBottom: '10px' }}>
                <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg3)' }}>
                      <th style={{ padding: '5px 8px', textAlign: 'left' }}>
                        <input type="checkbox" onChange={e => setTVParsed(p => p.map(t => ({ ...t, selected: e.target.checked })))} defaultChecked />
                      </th>
                      <th style={{ padding: '5px 8px', textAlign: 'left' }}>TV#</th>
                      <th style={{ padding: '5px 8px', textAlign: 'left' }}>Header Name</th>
                      <th style={{ padding: '5px 8px', textAlign: 'right' }}>Repl. Value</th>
                      <th style={{ padding: '5px 8px' }}>Departure</th>
                      <th style={{ padding: '5px 8px' }}>ETA</th>
                      <th style={{ padding: '5px 8px' }}>HAWB / MAWB</th>
                      <th style={{ padding: '5px 8px' }}>Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tvParsed.map((tv, i) => (
                      <tr key={tv.tvNo} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                          <input type="checkbox" checked={tv.selected} onChange={e => setTVParsed(p => p.map((t, j) => j === i ? { ...t, selected: e.target.checked } : t))} />
                        </td>
                        <td style={{ padding: '4px 8px', fontWeight: 700, fontFamily: 'var(--mono)' }}>TV{tv.tvNo}</td>
                        <td style={{ padding: '4px 8px' }}>{tv.headerName || '—'}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'var(--mono)' }}>{tv.replacementValue ? `€${tv.replacementValue.toLocaleString()}` : '—'}</td>
                        <td style={{ padding: '4px 8px', fontFamily: 'var(--mono)', fontSize: '10px' }}>{tv.departure || '—'}</td>
                        <td style={{ padding: '4px 8px', fontFamily: 'var(--mono)', fontSize: '10px' }}>{tv.eta || '—'}</td>
                        <td style={{ padding: '4px 8px', fontFamily: 'var(--mono)', fontSize: '10px' }}>{tv.hawb || tv.mawb || '—'}</td>
                        <td style={{ padding: '4px 8px' }}>
                          <select className="select" value={tv.shipType} onChange={e => setTVParsed(p => p.map((t, j) => j === i ? { ...t, shipType: e.target.value as 'tooling' | 'hardware' } : t))}
                            style={{ fontSize: '10px', padding: '2px 4px' }}>
                            <option value="tooling">🔩 Tooling</option>
                            <option value="hardware">📦 Hardware</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button className="btn btn-primary" onClick={confirmTVs} disabled={!sel.length}>
                ✓ Import {sel.length} Selected TVs
              </button>
            </>
          )}
        </div>

        {/* Step 2 — Kollo Sheet */}
        <div className="card" style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '13px' }}>Step 2 — Kollo Sheet</div>
              <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>Package list with weights, dimensions, DG info → updates shipment records</div>
            </div>
            <label className="btn btn-primary" style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
              📦 Load Kollo Sheet
              <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleKolloFile} />
            </label>
          </div>
          {kolloStatus && <div style={{ fontSize: '12px', color: kolloStatus.startsWith('✓') ? 'var(--green)' : 'var(--red)', marginTop: '8px' }}>{kolloStatus}</div>}
        </div>

        {/* Step 3 — VB Details */}
        <div className="card" style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '13px' }}>Step 3 — VB Details Sheet</div>
              <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>Part line items, material numbers, quantities → fills Spare Parts WOSIT inventory</div>
            </div>
            <label className="btn btn-primary" style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
              🗄️ Load VB Details
              <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleVBFile} />
            </label>
          </div>
          {vbStatus && <div style={{ fontSize: '12px', color: vbStatus.startsWith('✓') ? 'var(--green)' : 'var(--red)', marginTop: '8px' }}>{vbStatus}</div>}
        </div>
      </div>

      {/* Export Document Generation */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '4px' }}>📤 Export Documents</div>
        <div style={{ fontSize: '11px', color: 'var(--text3)', marginBottom: '12px' }}>Generate shipping documents for export shipments</div>

        {exportShipments.length === 0 ? (
          <div style={{ fontSize: '12px', color: 'var(--text3)' }}>No export shipments yet. Create exports from the Exports panel.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {exportShipments.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                <span style={{ fontWeight: 600, fontFamily: 'var(--mono)' }}>{s.reference}</span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button className="btn btn-sm" onClick={() => setSliShipId(s.id)}>📄 SLI</button>
                  <button className="btn btn-sm" onClick={() => { setPackShipId(s.id); setPackShipRef(s.reference) }}>📦 Packing List</button>
                  <button className="btn btn-sm" onClick={() => { setPackShipId(s.id); setPackShipRef(s.reference) }}>💰 Invoice</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {sliShipId && (
        <SLIModal shipmentId={sliShipId} project={activeProject} onClose={() => setSliShipId(null)} />
      )}
      {packShipId && (
        <PackingListModal shipmentId={packShipId} shipRef={packShipRef} project={activeProject} onClose={() => setPackShipId(null)} />
      )}
    </div>
  )
}
// force redeploy Sun Apr 26 11:15:16 UTC 2026
