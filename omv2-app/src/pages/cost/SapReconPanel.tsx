import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'

declare const XLSX: {
  read: (data: ArrayBuffer, opts: { type: string }) => {
    SheetNames: string[]
    Sheets: Record<string, unknown>
  }
  utils: {
    sheet_to_json: (sheet: unknown, opts?: { header?: number; defval?: string }) => Record<string, string>[]
  }
}

interface SapRow {
  docNumber: string; vendor: string; amount: number; currency: string
  wbs: string; description: string; postDate: string; matched: boolean; matchedInvoiceId?: string
}

export function SapReconPanel() {
  const { activeProject } = useAppStore()
  const [rows, setRows] = useState<SapRow[]>([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [fileName, setFileName] = useState('')

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setLoading(true)

    const buffer = await file.arrayBuffer()
    try {
      const wb = XLSX.read(buffer, { type: 'array' })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown as string[][]

      // Find header row (look for common SAP column names)
      let headerIdx = 0
      for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
        const row = rawRows[i].map(c => String(c).toLowerCase())
        if (row.some(c => c.includes('document') || c.includes('vendor') || c.includes('amount'))) {
          headerIdx = i; break
        }
      }

      const headers = rawRows[headerIdx].map(h => String(h).trim())
      const dataRows = rawRows.slice(headerIdx + 1)

      // Try to find columns by common SAP names
      const colIdx = (names: string[]) => {
        for (const n of names) {
          const idx = headers.findIndex(h => h.toLowerCase().includes(n.toLowerCase()))
          if (idx >= 0) return idx
        }
        return -1
      }

      const docCol = colIdx(['Document Number','Doc. No','Doc No','Posting Document'])
      const vendorCol = colIdx(['Vendor','Vendor Name','Creditor'])
      const amtCol = colIdx(['Amount','Amount in LC','LC Amount','Amount in Local Currency'])
      const wbsCol = colIdx(['WBS','WBS Element','Cost Object'])
      const descCol = colIdx(['Text','Description','Posting Text'])
      const dateCol = colIdx(['Posting Date','Post Date','Date'])

      const parsed: SapRow[] = dataRows
        .filter(r => r.some(c => c))
        .map(r => ({
          docNumber: String(r[docCol] ?? '').trim(),
          vendor: String(r[vendorCol] ?? '').trim(),
          amount: parseFloat(String(r[amtCol] ?? '0').replace(/[,$]/g, '')) || 0,
          currency: 'AUD',
          wbs: String(r[wbsCol] ?? '').trim(),
          description: String(r[descCol] ?? '').trim(),
          postDate: String(r[dateCol] ?? '').trim(),
          matched: false,
        }))
        .filter(r => r.docNumber || r.amount)

      // Match against existing invoices
      const { data: existingInvs } = await supabase.from('invoices').select('id,invoice_number,sap_doc_number')
        .eq('project_id', activeProject!.id)

      const invByDoc = Object.fromEntries((existingInvs||[]).map(i => [i.sap_doc_number || i.invoice_number, i.id]))

      const matched = parsed.map(r => ({
        ...r,
        matched: !!(invByDoc[r.docNumber]),
        matchedInvoiceId: invByDoc[r.docNumber],
      }))

      setRows(matched)
      toast(`Loaded ${matched.length} SAP rows — ${matched.filter(r=>r.matched).length} matched`, 'info')
    } catch (err) {
      toast('Failed to parse file. Ensure it is a valid XLSX SAP export.', 'error')
    }
    setLoading(false)
    e.target.value = ''
  }

  function toggleMatch(idx: number) {
    setRows(rows => rows.map((r, i) => i === idx ? { ...r, matched: !r.matched } : r))
  }

  async function importUnmatched() {
    const unmatched = rows.filter(r => !r.matched && r.amount !== 0)
    if (unmatched.length === 0) { toast('No unmatched rows to import','info'); return }
    if (!confirm(`Import ${unmatched.length} unmatched SAP rows as invoices?`)) return
    setImporting(true)

    const toInsert = unmatched.map(r => ({
      project_id: activeProject!.id,
      invoice_number: r.docNumber, vendor_ref: r.docNumber,
      sap_doc_number: r.docNumber, sap_wbs: r.wbs,
      amount: Math.abs(r.amount), currency: r.currency,
      invoice_date: r.postDate || null,
      status: 'received', source: 'sap_import',
      status_history: [{ to:'received', by:'SAP Import', at: new Date().toISOString() }],
      notes: r.description || r.vendor,
    }))

    const { error } = await supabase.from('invoices').insert(toInsert)
    if (error) { toast(error.message,'error'); setImporting(false); return }
    toast(`Imported ${toInsert.length} invoices from SAP`,'success')
    setImporting(false)
    setRows(rows.map(r => r.matched ? r : { ...r, matched: true }))
  }

  const unmatched = rows.filter(r => !r.matched)
  const matched = rows.filter(r => r.matched)
  const totalUnmatched = unmatched.reduce((s,r) => s + Math.abs(r.amount), 0)
  const fmt = (n: number) => '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2 })

  return (
    <div style={{ padding:'24px', maxWidth:'1100px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'16px' }}>
        <div>
          <h1 style={{ fontSize:'18px', fontWeight:700 }}>SAP Reconciliation</h1>
          <p style={{ fontSize:'12px', color:'var(--text3)', marginTop:'2px' }}>Import SAP exports and match against project invoices</p>
        </div>
        <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
          {unmatched.length > 0 && (
            <button className="btn btn-primary" onClick={importUnmatched} disabled={importing}>
              {importing?<span className="spinner" style={{width:'14px',height:'14px'}}/>:null}
              Import {unmatched.length} Unmatched
            </button>
          )}
          <button className="btn btn-sm" onClick={() => {
              const rows2 = rows.map(r => [r.docNumber||'',r.vendor||'',r.wbs||'',r.postDate||'',r.amount,r.matched?'Matched':'Unmatched'])
              const csv = [['Doc Number','Vendor','WBS','Post Date','Amount','Status'],...rows2].map(r=>r.join(',')).join('\n')
              const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='sap-recon.csv';a.click()
            }} disabled={rows.length===0}>⬇ Export CSV</button>
          <label className="btn" style={{ cursor:'pointer' }}>
            📂 Load SAP Export (.xlsx)
            <input type="file" accept=".xlsx,.xls,.csv" style={{ display:'none' }} onChange={handleFile} />
          </label>
        </div>
      </div>

      {fileName && (
        <div style={{ fontSize:'12px', color:'var(--text3)', marginBottom:'12px' }}>
          File: <span style={{ color:'var(--text)' }}>{fileName}</span>
        </div>
      )}

      {loading && <div className="loading-center"><span className="spinner"/> Parsing SAP export...</div>}

      {rows.length === 0 && !loading && (
        <div className="empty-state">
          <div className="icon">🔄</div>
          <h3>No data loaded</h3>
          <p>Upload an SAP export XLSX to begin reconciliation. The parser will auto-detect column headers.</p>
        </div>
      )}

      {rows.length > 0 && (
        <>
          {/* Summary */}
          <div className="kpi-grid" style={{ marginBottom:'16px' }}>
            <div className="kpi-card" style={{ borderTopColor:'var(--green)' }}>
              <div className="kpi-val">{matched.length}</div>
              <div className="kpi-lbl">Matched</div>
            </div>
            <div className="kpi-card" style={{ borderTopColor:'var(--amber)' }}>
              <div className="kpi-val">{unmatched.length}</div>
              <div className="kpi-lbl">Unmatched</div>
            </div>
            <div className="kpi-card" style={{ borderTopColor:'var(--red)' }}>
              <div className="kpi-val">{fmt(totalUnmatched)}</div>
              <div className="kpi-lbl">Unmatched Value</div>
            </div>
          </div>

          <div className="card" style={{ padding:0, overflow:'hidden' }}>
            <table>
              <thead>
                <tr>
                  <th>Status</th><th>Doc Number</th><th>Vendor / Description</th>
                  <th>WBS</th><th>Post Date</th><th style={{textAlign:'right'}}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={{ background: r.matched ? 'transparent' : '#fffbeb' }}>
                    <td>
                      <span className="badge" style={r.matched ? {bg:'#d1fae5',color:'#065f46'} as {bg:string,color:string} : {bg:'#fef3c7',color:'#92400e'}}
                        title={r.matched ? 'Click to unmatch' : 'Click to mark matched'}
                        onClick={() => toggleMatch(i)} >
                        {r.matched ? '✓ Matched' : '⚠ Unmatched'}
                      </span>
                    </td>
                    <td style={{ fontFamily:'var(--mono)', fontSize:'12px', fontWeight:500 }}>{r.docNumber}</td>
                    <td style={{ fontSize:'12px', maxWidth:'220px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {r.vendor || r.description || '—'}
                    </td>
                    <td style={{ fontFamily:'var(--mono)', fontSize:'11px', color:'var(--text3)' }}>{r.wbs || '—'}</td>
                    <td style={{ fontFamily:'var(--mono)', fontSize:'12px' }}>{r.postDate || '—'}</td>
                    <td style={{ textAlign:'right', fontFamily:'var(--mono)', fontSize:'12px', fontWeight:600, color: r.amount < 0 ? 'var(--red)' : undefined }}>
                      {fmt(Math.abs(r.amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
