import * as XLSX from 'xlsx'
/**
 * NRG TCE XLSX Import
 * Parses two-tab XLSX (Overheads + Skilled Labour) using synonym-based header detection.
 * Smart re-import: back-fills blank fields only, never overwrites user edits.
 */


const OH_SYNONYMS: Record<string, string[]> = {
  workOrder:     ['work order'],
  contractScope: ['service order number', 'service order/release', 'release number', 'service order and release'],
  itemId:        ['item id', 'item no', 'item number'],
  description:   ['activity description', 'description'],
  kpiIncluded:   ['included in kpi', 'kpi included', 'incl. kpi', 'incl in kpi'],
  estimatedQty:  ['hours or units', 'estimated hours', 'hours/units'],
  unitType:      ['type of unit'],
  tceRate:       ['gang rate', 'unit rate'],
  tceTotal:      ['total cost', 'estimated total cost'],
}

const SL_SYNONYMS: Record<string, string[]> = {
  contractScope:  ['service order number', 'service order/release', 'release number', 'service order and release'],
  workOrder:      ['work order and work order task combined', 'work order task combined', 'work order'],
  workOrderTask:  ['work order task'],
  itemId:         ['scope no', 'scope number', 'item id'],
  description:    ['activity description', 'scope description', 'description'],
  scopeType:      ['scope type'],
  estimatedQty:   ['estimated hours', 'hours'],
  tceRate:        ['gang rate', 'unit rate', '$/hr'],
  tceTotal:       ['estimated total cost', 'total cost'],
}

type Row = unknown[]

function buildHeaderMap(rows: Row[], synonyms: Record<string, string[]>, maxScan = 6) {
  let best = { score: 0, rowIdx: -1, map: {} as Record<string, number> }
  for (let r = 0; r < Math.min(rows.length, maxScan); r++) {
    const row = rows[r] as unknown[]
    const map: Record<string, number> = {}
    let score = 0
    Object.keys(synonyms).forEach(field => {
      for (let c = 0; c < row.length; c++) {
        const hay = String(row[c] || '').trim().toLowerCase()
        if (!hay || map[field] !== undefined) continue
        if (synonyms[field].some(n => hay.includes(n.toLowerCase()))) {
          map[field] = c; score++; break
        }
      }
    })
    if (score > best.score) best = { score, rowIdx: r, map }
  }
  if (best.score < 3) return null
  return { colMap: best.map, firstDataRow: best.rowIdx + 1 }
}

function cellStr(row: Row, idx: number | undefined): string {
  if (idx === undefined) return ''
  return String(row[idx] || '').trim()
}
function cellNum(row: Row, idx: number | undefined): number {
  if (idx === undefined) return 0
  const n = parseFloat(String(row[idx] || ''))
  return isNaN(n) ? 0 : n
}

export interface TceLine {
  item_id: string
  description: string
  source: 'overhead' | 'skilled'
  work_order: string | null
  contract_scope: string | null
  unit_type: string
  estimated_qty: number
  tce_rate: number
  tce_total: number
  kpi_included: boolean
  line_type: string
}

export interface TceImportResult {
  added: TceLine[]
  toUpdate: { item_id: string; fields: Partial<TceLine> }[]
  skipped: number
  errors: string[]
}

export function parseNrgTceFile(buffer: ArrayBuffer, existingItemIds: Set<string>): TceImportResult {
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' })
  const result: TceImportResult = { added: [], toUpdate: [], skipped: 0, errors: [] }

  // ── Overheads tab ──
  const ohName = wb.SheetNames.find(n => /overhead/i.test(n))
  if (ohName) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[ohName], { header: 1, defval: '' }) as Row[]
    const hdr = buildHeaderMap(rows, OH_SYNONYMS, 6)
    if (hdr) {
      for (let r = hdr.firstDataRow; r < rows.length; r++) {
        const row = rows[r]
        const itemId = cellStr(row, hdr.colMap.itemId)
        const desc = cellStr(row, hdr.colMap.description)
        if (!itemId || !/^\d+\.\d+\.\d+/.test(itemId)) continue
        if (!desc) continue
        const isGroup = /^\d+\.\d+\.\d+$/.test(itemId) // 3 segments = group header
        const qty = cellNum(row, hdr.colMap.estimatedQty)
        const rate = cellNum(row, hdr.colMap.tceRate)
        const total = cellNum(row, hdr.colMap.tceTotal) || qty * rate
        const wo = cellStr(row, hdr.colMap.workOrder)
        const cs = cellStr(row, hdr.colMap.contractScope)
        const kpi = cellStr(row, hdr.colMap.kpiIncluded).toLowerCase() === 'yes'
        const unit = cellStr(row, hdr.colMap.unitType)

        if (existingItemIds.has(itemId)) {
          // Back-fill: only update blank fields
          const fields: Partial<TceLine> = {}
          if (!wo) {} else fields.work_order = wo
          if (!cs) {} else fields.contract_scope = cs
          if (Object.keys(fields).length > 0) result.toUpdate.push({ item_id: itemId, fields })
          else result.skipped++
        } else {
          result.added.push({
            item_id: itemId, description: desc, source: 'overhead',
            work_order: wo || null, contract_scope: cs || null,
            unit_type: isGroup ? '' : unit,
            estimated_qty: isGroup ? 0 : qty,
            tce_rate: isGroup ? 0 : rate,
            tce_total: isGroup ? 0 : total,
            kpi_included: kpi, line_type: '',
          })
          existingItemIds.add(itemId)
        }
      }
    } else {
      result.errors.push('Overheads tab: could not detect header row (need Item ID + Description + at least one other column)')
    }
  }

  // ── Skilled Labour tab ──
  const slName = wb.SheetNames.find(n => /skilled|labour/i.test(n))
  if (slName) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[slName], { header: 1, defval: '' }) as Row[]
    const hdr = buildHeaderMap(rows, SL_SYNONYMS, 6)
    if (hdr) {
      for (let r = hdr.firstDataRow; r < rows.length; r++) {
        const row = rows[r]
        const scopeNo   = cellStr(row, hdr.colMap.itemId)
        const desc      = cellStr(row, hdr.colMap.description)
        const scopeType = cellStr(row, hdr.colMap.scopeType).toUpperCase()

        if (!desc) continue

        // ── Section header: Scope Type = 'H' ──
        if (scopeType === 'H') {
          const wo  = cellStr(row, hdr.colMap.workOrder)
          const cs  = cellStr(row, hdr.colMap.contractScope)
          const headerId = scopeNo || wo || `SL-HDR-${r}`
          if (!existingItemIds.has(headerId)) {
            result.added.push({
              item_id: headerId, description: desc, source: 'skilled',
              work_order: wo || null, contract_scope: cs || null,
              unit_type: '', estimated_qty: 0, tce_rate: 0, tce_total: 0,
              kpi_included: false, line_type: 'group',
            })
            existingItemIds.add(headerId)
          }
          continue
        }

        // ── Line item ──
        if (!scopeNo || !/^\d+\.\d+/.test(scopeNo)) continue
        const wo = cellStr(row, hdr.colMap.workOrder)
        const task = cellStr(row, hdr.colMap.workOrderTask)
        const cs = cellStr(row, hdr.colMap.contractScope)
        const qty = cellNum(row, hdr.colMap.estimatedQty)
        const rate = cellNum(row, hdr.colMap.tceRate)
        const total = cellNum(row, hdr.colMap.tceTotal) || qty * rate
        // Resolve WO — priority: WO+Task → task → wo
        let woFinal = ''
        if (wo && task) woFinal = wo.includes('-') ? wo : `${wo}-${task}`
        else if (task) woFinal = task
        else if (wo) woFinal = wo
        // Sanity check — reject free-text comments
        if (woFinal && (/[\s?]/.test(woFinal) || woFinal.length > 30 || !/\d/.test(woFinal))) woFinal = ''

        if (existingItemIds.has(scopeNo)) {
          const fields: Partial<TceLine> = {}
          if (woFinal) fields.work_order = woFinal
          if (cs) fields.contract_scope = cs
          if (Object.keys(fields).length > 0) result.toUpdate.push({ item_id: scopeNo, fields })
          else result.skipped++
        } else {
          result.added.push({
            item_id: scopeNo, description: desc, source: 'skilled',
            work_order: woFinal || null, contract_scope: cs || null,
            unit_type: 'hours', estimated_qty: qty, tce_rate: rate, tce_total: total,
            kpi_included: true, line_type: 'Labour',
          })
          existingItemIds.add(scopeNo)
        }
      }
    } else {
      result.errors.push('Skilled Labour tab: could not detect header row (need Scope No + Description + at least one other column)')
    }
  }

  if (!ohName && !slName) {
    result.errors.push(`No recognised tabs found. Sheet names: ${wb.SheetNames.join(', ')}. Need a tab matching "overhead" and/or "skilled" or "labour".`)
  }

  return result
}
