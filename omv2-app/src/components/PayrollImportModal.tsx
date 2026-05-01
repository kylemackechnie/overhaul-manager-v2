import { useState } from 'react'
import { toast } from './ui/Toast'
import { downloadTemplate } from '../lib/templates'
import type { WeeklyTimesheet } from '../types'


type DayEntry = { hours?: number; dayType?: string; shiftType?: string; laha?: boolean; meal?: boolean }
type CrewMember = { personId: string; name: string; role: string; wbs: string; days: Record<string, DayEntry>; mealBreakAdj?: boolean }

interface PayrollImportProps {
  activeWeek: WeeklyTimesheet | null
  onUpdate: (week: WeeklyTimesheet) => void
  onClose: () => void
}

function fuzzyMatch(a: string, b: string): number {
  const na = a.toLowerCase().trim().replace(/\s+/g, ' ')
  const nb = b.toLowerCase().trim().replace(/\s+/g, ' ')
  if (na === nb) return 1
  const partsA = na.split(' '); const partsB = nb.split(' ')
  let hits = 0
  partsA.forEach(pa => { if (partsB.some(pb => pb.startsWith(pa.slice(0, 4)) || pa.startsWith(pb.slice(0, 4)))) hits++ })
  return hits / Math.max(partsA.length, partsB.length)
}

function weekDateSet(weekStart: string): Set<string> {
  const monday = new Date(weekStart + 'T12:00:00')
  const s = new Set<string>()
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i)
    s.add(d.toISOString().slice(0, 10))
  }
  return s
}

export function PayrollImportModal({ activeWeek, onUpdate, onClose }: PayrollImportProps) {
  const [result, setResult] = useState<{ msg: string; ok: boolean } | null>(null)
  const [importing, setImporting] = useState(false)

  if (!activeWeek) return null
  const aw = activeWeek

  async function handleTasTK(file: File) {
    setImporting(true); setResult(null)
    try {
      const text = await file.text()
      const lines = text.trim().split('\n')
      if (lines.length < 2) { setResult({ msg: 'File is empty', ok: false }); setImporting(false); return }

      function parseCSVLine(line: string): string[] {
        const fields: string[] = []; let inQ = false; let field = ''
        for (const ch of line) {
          if (ch === '"') inQ = !inQ
          else if (ch === ',' && !inQ) { fields.push(field.trim()); field = '' }
          else field += ch
        }
        fields.push(field.trim())
        return fields
      }

      const hdr = parseCSVLine(lines[0])
      const col = (name: string) => hdr.findIndex(h => h === name)
      const iName   = col('Full Name')
      const iDate   = col('Timesheet Date')
      const iQty    = col('Quantity')
      const iOp = col('Operation - Custom Code')
      const iPay = col('Pay Code')

      if (iName < 0 || iDate < 0 || iQty < 0) {
        setResult({ msg: 'Missing required columns — expected "Full Name", "Timesheet Date", "Quantity"', ok: false })
        setImporting(false); return
      }

      const weekDates = weekDateSet(aw.week_start)
      type RowEntry = { qty: number; op: string; payCode: string }
      const personDays: Record<string, Record<string, RowEntry[]>> = {}

      for (let i = 1; i < lines.length; i++) {
        const row = parseCSVLine(lines[i])
        const name = row[iName]?.trim() || ''
        if (!name) continue
        const rawDate = row[iDate]?.trim() || ''
        const dm = rawDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
        if (!dm) continue
        const dateStr = `${dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`
        if (!weekDates.has(dateStr)) continue
        const qty = parseFloat(row[iQty] || '0') || 0
        if (qty <= 0) continue
        // Operation - Custom Code is either a TCE item ID (e.g. "2.02.5.1") or "Mob/Demob" or blank
        const op = (iOp >= 0 ? row[iOp]?.trim() : '') || ''
        if (!personDays[name]) personDays[name] = {}
        if (!personDays[name][dateStr]) personDays[name][dateStr] = []
        const payCode = (iPay >= 0 ? row[iPay]?.trim() : '') || ''
        personDays[name][dateStr].push({ qty, op, payCode })
      }

      let matched = 0; const unmatched: string[] = []; let daysWritten = 0
      const crew = (aw.crew || []) as CrewMember[]

      const updatedCrew = crew.map(member => {
        let bestScore = 0; let bestMatch = ''
        Object.keys(personDays).forEach(pName => {
          const score = fuzzyMatch(member.name, pName)
          if (score > bestScore) { bestScore = score; bestMatch = pName }
        })
        if (bestScore < 0.65) return member
        matched++
        const updatedDays = { ...member.days }
        Object.entries(personDays[bestMatch]).forEach(([dateStr, rows]) => {
          const totalHours = rows.reduce((s, r) => s + r.qty, 0)
          // op is either a TCE item ID (has dots), "Mob/Demob", or blank
          const isMob = rows.some(r => r.op === 'Mob/Demob')
          const existing = (updatedDays[dateStr] || {}) as DayEntry & { nrgWoAllocations?: { tceItemId: string; hours: number }[] }
          const dayType = isMob ? 'travel' : ((existing.dayType as string) || 'weekday')
          // Rows with a TCE code (not Mob/Demob, not blank) → nrgWoAllocations
          // payCode preserved per row so client reports can show NT/T1.5/DT split per scope
          const rowsWithTce = rows.filter(r => r.op && r.op !== 'Mob/Demob')
          const nrgWoAllocations = rowsWithTce.length > 0
            ? rowsWithTce.map(r => ({ tceItemId: r.op, hours: r.qty, payCode: r.payCode }))
            : existing.nrgWoAllocations
          updatedDays[dateStr] = {
            ...existing,
            hours: totalHours,
            dayType,
            shiftType: (existing.shiftType as string) || 'day',
            ...(nrgWoAllocations ? { nrgWoAllocations } : {}),
          }
          daysWritten++
        })
        return { ...member, days: updatedDays }
      })

      Object.keys(personDays).forEach(name => {
        if (!crew.some(m => fuzzyMatch(m.name, name) >= 0.65)) unmatched.push(name)
      })

      onUpdate({ ...aw, crew: updatedCrew as WeeklyTimesheet['crew'] })
      let msg = `✓ TasTK: ${matched}/${Object.keys(personDays).length} people matched, ${daysWritten} days written`
      if (unmatched.length) msg += `. ⚠ Not matched: ${unmatched.join(', ')}`
      setResult({ msg, ok: matched > 0 })
      if (matched > 0) toast(msg, 'success')
    } catch (e) {
      setResult({ msg: 'Error: ' + (e as Error).message, ok: false })
    }
    setImporting(false)
  }
  async function handleUKG(file: File) {
    setImporting(true); setResult(null)
    try {
      const text = await file.text()
      const lines = text.trim().split('\n')
      const people: { firstName: string; lastName: string; days: Record<string, { hours: number }> }[] = []
      let current: typeof people[0] | null = null

      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line) { if (current) { people.push(current); current = null } continue }
        const fields: string[] = []; let inQ = false; let field = ''
        for (const ch of line) {
          if (ch === '"') inQ = !inQ
          else if (ch === ',' && !inQ) { fields.push(field.trim()); field = '' }
          else field += ch
        }
        fields.push(field.trim())
        const fnIdx = fields.findIndex(f => f.trim() === 'First Name')
        const lnIdx = fields.findIndex(f => f.trim() === 'Last Name')
        if (fnIdx >= 0 && lnIdx >= 0) {
          if (current) people.push(current)
          current = { firstName: fields[fnIdx + 1]?.trim() || '', lastName: fields[lnIdx + 1]?.trim() || '', days: {} }
          continue
        }
        if (fields[0] === 'Subtotal' || !current) continue
        let dateStr = ''
        for (const ci of [2, 3, 4, 1]) {
          const m = (fields[ci] || '').trim().match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/)
          if (m) { dateStr = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; break }
        }
        if (!dateStr) continue
        const hrs = parseFloat(fields[8]) || parseFloat(fields[7]) || 0
        if (hrs <= 0) continue
        if (!current.days[dateStr]) current.days[dateStr] = { hours: 0 }
        current.days[dateStr].hours = Math.max(current.days[dateStr].hours, hrs)
      }
      if (current) people.push(current)
      if (!people.length) { setResult({ msg: 'No employee data found in file', ok: false }); setImporting(false); return }

            const weekDates = weekDateSet(aw.week_start)
      const crew = (aw.crew || []) as CrewMember[]
      let matched = 0; const unmatched: string[] = []; let daysWritten = 0
      const updatedCrew = crew.map(member => {
        let bestScore = 0; let bestIdx = -1
        people.forEach((p, i) => {
          const score = fuzzyMatch(member.name, `${p.firstName} ${p.lastName}`.trim())
          if (score > bestScore) { bestScore = score; bestIdx = i }
        })
        if (bestScore < 0.65 || bestIdx < 0) return member
        matched++
        const p = people[bestIdx]
        const updatedDays = { ...member.days }
        Object.entries(p.days).forEach(([dateStr, dayData]) => {
          if (!weekDates.has(dateStr)) return
          const existing = updatedDays[dateStr] || {}
          updatedDays[dateStr] = { ...existing, hours: dayData.hours, dayType: (existing.dayType as string) || 'weekday', shiftType: (existing.shiftType as string) || 'day' }
          daysWritten++
        })
        return { ...member, days: updatedDays }
      })
      people.forEach(p => {
        const fullName = `${p.firstName} ${p.lastName}`.trim()
        if (!crew.some(m => fuzzyMatch(m.name, fullName) >= 0.65)) unmatched.push(fullName)
      })

      onUpdate({ ...aw, crew: updatedCrew as WeeklyTimesheet['crew'] })
      let msg = `✓ UKG: ${matched}/${people.length} people matched, ${daysWritten} days written`
      if (unmatched.length) msg += `. ⚠ Not matched: ${unmatched.join(', ')}`
      setResult({ msg, ok: matched > 0 })
      if (matched > 0) toast(msg, 'success')
    } catch (e) {
      setResult({ msg: 'Error: ' + (e as Error).message, ok: false })
    }
    setImporting(false)
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: '520px' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>📥 Import Payroll Hours</h3>
          <button className="btn btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: '13px', color: 'var(--text2)', marginBottom: '16px' }}>
            Import hours from payroll into <strong>{aw.week_start}</strong>.
            Hours are matched to crew members by name (fuzzy match — 65% threshold).
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
            <div style={{ border: '2px dashed var(--border2)', borderRadius: '8px', padding: '16px', textAlign: 'center' }}>
              <div style={{ fontSize: '24px', marginBottom: '8px' }}>📊</div>
              <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>TasTK / TimeCloud</div>
              <div style={{ fontSize: '11px', color: 'var(--text3)', marginBottom: '10px' }}>CSV export — columns: Full Name, Timesheet Date, Quantity, Operation, Work Order Custom Code</div>
              <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
                {importing ? <span className="spinner" style={{ width: '12px', height: '12px' }} /> : '📂'} Choose File
                <input type="file" accept=".csv" style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleTasTK(f) }} />
              </label>
            </div>
            <div style={{ border: '2px dashed var(--border2)', borderRadius: '8px', padding: '16px', textAlign: 'center' }}>
              <div style={{ fontSize: '24px', marginBottom: '8px' }}>📋</div>
              <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>UKG / Kronos</div>
              <div style={{ fontSize: '11px', color: 'var(--text3)', marginBottom: '8px' }}>CSV payroll export with Employee Id, First Name, Last Name rows</div>
              <button className="btn btn-sm" style={{marginBottom:'6px',display:'block'}} onClick={()=>downloadTemplate('payroll')}>⬇ Template</button>
              <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
                {importing ? <span className="spinner" style={{ width: '12px', height: '12px' }} /> : '📂'} Choose File
                <input type="file" accept=".csv" style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleUKG(f) }} />
              </label>
            </div>
          </div>

          {result && (
            <div style={{
              padding: '10px 14px', borderRadius: '6px', fontSize: '13px', fontWeight: 500,
              background: result.ok ? '#d1fae5' : '#fee2e2',
              color: result.ok ? '#065f46' : '#991b1b',
            }}>
              {result.msg}
            </div>
          )}

          <div style={{ marginTop: '12px', padding: '10px 12px', background: 'var(--bg3)', borderRadius: '6px', fontSize: '11px', color: 'var(--text3)' }}>
            <strong>Matching rules:</strong> Names are matched using fuzzy string comparison (first 4 chars of each word). Add all crew members to the week before importing. Unmatched names are listed in the result message.
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>{result?.ok ? 'Done' : 'Cancel'}</button>
        </div>
      </div>
    </div>
  )
}
