import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { parseHardwareContract } from '../../lib/hardwareContractImport'
import type { ContractImportResult } from '../../lib/hardwareContractImport'

const fmt = (n: number) => '€' + n.toLocaleString('en-AU', { maximumFractionDigits: 0 })

export function HardwareImportPanel() {
  const { activeProject, setActivePanel } = useAppStore()
  const [result, setResult] = useState<ContractImportResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [fileName, setFileName] = useState('')

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true)
    setFileName(file.name)
    setResult(null)
    try {
      const buffer = await file.arrayBuffer()
      const parsed = parseHardwareContract(buffer)
      setResult(parsed)
      if (parsed.error) toast(parsed.error, 'error')
      else toast(`Parsed ${parsed.lines.length} contract lines`, 'info')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
    setLoading(false)
    e.target.value = ''
  }

  async function confirmImport() {
    if (!result || !activeProject) return
    setImporting(true)

    // Create the hardware contract record
    const { error: cErr } = await supabase
      .from('hardware_contracts')
      .insert({
        project_id: activeProject.id,
        vendor: result.meta.debitor || result.meta.projectName || 'SE AG',
        status: 'active',
        value: result.lines.reduce((s: number, l: typeof result.lines[0]) => s + (l.transfer_price || l.list_price || 0) * l.qty, 0),
        currency: 'EUR',
        notes: `OPSA/SPASS import — ${result.meta.contractType || ''}. Valid: ${result.meta.validFrom || '?'} → ${result.meta.validTo || '?'}`,
        line_items: result.lines.map(l => ({
          id: `hwl_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          part_no: l.material_no,
          description: l.description,
          qty: l.qty,
          transfer_price: l.transfer_price || l.list_price,
          customer_price: l.customer_price,
          escalation_factor: l.escalation_factor,
          escalated_price: l.escalated_price,
          install_location: l.install_location,
        }))
      })
      .select()
      .single()

    if (cErr) { toast(cErr.message, 'error'); setImporting(false); return }

    // Also insert escalation factor if present
    if (result.meta.escalationFactor && result.meta.escalationFactor !== 1) {
      const year = result.meta.validFrom ? parseInt(result.meta.validFrom.slice(0, 4)) : new Date().getFullYear()
      await supabase.from('hardware_escalation').insert({
        project_id: activeProject.id,
        year,
        factor: result.meta.escalationFactor,
        source: 'import',
        notes: `Imported from ${fileName}`
      })
    }

    toast(`✅ Imported ${result.lines.length} contract lines`, 'success')
    setImporting(false)
    setResult(null)
    setActivePanel('hardware-contract')
  }

  return (
    <div style={{ padding: '24px', maxWidth: '960px' }}>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 700 }}>Import Hardware Contract</h1>
        <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
          Upload the Excel contract file from Germany (OPSA/SPASS format). Reads the Master tab — metadata from header rows, part lines from row 19+.
        </p>
      </div>

      {/* Upload zone */}
      <div className="card" style={{ padding: '24px', marginBottom: '20px', textAlign: 'center', border: '2px dashed var(--border2)' }}>
        <div style={{ fontSize: '40px', marginBottom: '12px' }}>📊</div>
        <div style={{ fontWeight: 600, marginBottom: '6px' }}>Drop OPSA/SPASS contract XLSX here</div>
        <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '16px' }}>
          File must have a "Master" sheet with "Material Number" column header near row 17
        </div>
        <label className="btn btn-primary" style={{ cursor: 'pointer' }}>
          {loading ? <><span className="spinner" style={{ width: '14px', height: '14px' }} /> Parsing...</> : '📂 Select XLSX File'}
          <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleFile} />
        </label>
        {fileName && <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '8px' }}>{fileName}</div>}
      </div>

      {result?.error && (
        <div style={{ padding: '12px 16px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '8px', marginBottom: '16px', color: '#991b1b', fontSize: '13px' }}>
          ⚠ {result.error}
        </div>
      )}

      {result && !result.error && (
        <>
          {/* Metadata summary */}
          <div className="card" style={{ padding: '14px 16px', marginBottom: '16px' }}>
            <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '10px' }}>Contract Metadata</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '10px', fontSize: '12px' }}>
              {[
                ['Project / Debitor', result.meta.debitor || result.meta.projectName || '—'],
                ['Contract Type', result.meta.contractType || '—'],
                ['Valid From', result.meta.validFrom || '—'],
                ['Valid Until', result.meta.validTo || '—'],
                ['Escalation Factor', result.meta.escalationFactor?.toFixed(4) || '1.0000'],
                ['EPA Number', result.meta.epaNumber || '—'],
              ].map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontSize: '10px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{k}</div>
                  <div style={{ fontWeight: 600, marginTop: '2px', fontFamily: typeof v === 'number' ? 'var(--mono)' : undefined }}>{v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Lines summary */}
          <div className="card" style={{ padding: '14px 16px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ fontWeight: 600, fontSize: '13px' }}>{result.lines.length} Contract Lines</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '13px', fontWeight: 700, color: 'var(--accent)' }}>
                Transfer total: {fmt(result.lines.reduce((s: number, l: typeof result.lines[0]) => s + (l.transfer_price || l.list_price || 0) * l.qty, 0))}
              </div>
            </div>
            <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
              <table style={{ fontSize: '11px' }}>
                <thead>
                  <tr>
                    <th>Material No</th>
                    <th>Description</th>
                    <th>Location</th>
                    <th style={{ textAlign: 'right' }}>Qty</th>
                    <th style={{ textAlign: 'right' }}>List Price</th>
                    <th style={{ textAlign: 'right' }}>Escalated</th>
                    <th style={{ textAlign: 'right' }}>Transfer</th>
                  </tr>
                </thead>
                <tbody>
                  {result.lines.slice(0, 50).map((l: typeof result.lines[0], i: number) => (
                    <tr key={i}>
                      <td style={{ fontFamily: 'var(--mono)', color: 'var(--accent)' }}>{l.material_no}</td>
                      <td style={{ maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.description}</td>
                      <td style={{ color: 'var(--text3)', fontSize: '10px' }}>{l.install_location || '—'}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{l.qty}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmt(l.list_price)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{l.escalated_price ? fmt(l.escalated_price) : '—'}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600 }}>{l.transfer_price ? fmt(l.transfer_price) : '—'}</td>
                    </tr>
                  ))}
                  {result.lines.length > 50 && (
                    <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text3)', padding: '8px' }}>...and {result.lines.length - 50} more lines</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="btn" onClick={() => setResult(null)}>← Cancel</button>
            <button className="btn btn-primary" onClick={confirmImport} disabled={importing}>
              {importing ? <><span className="spinner" style={{ width: '14px', height: '14px' }} /> Importing...</> : `✅ Import ${result.lines.length} Lines`}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
