import * as XLSX from 'xlsx'
/**
 * OPSA/SPASS hardware contract XLSX import
 * Reads the German SE contract format:
 * - Rows 1–17: metadata (project name, contract type, validity, escalation factor)
 * - Row 17 (index 16): header row containing "Material Number"
 * - Row 18 (index 17): units row (skip)
 * - Row 19+ (index 18+): part data lines
 */

export interface ContractMeta {
  projectName: string
  contractType: string
  validFrom: string | null
  validTo: string | null
  escalationFactor: number
  epaNumber: string
  debitor: string
  tpParts: number | null
}

export interface ContractLine {
  external_ref: string
  internal_ref: string
  material_no: string
  description: string
  install_location: string
  old_material_no: string
  qty: number
  lead_time_months: number | null
  stock_type: string
  list_price: number
  escalation_factor: number
  escalated_price: number | null
  discount_pct: number
  discounted_price: number | null
  transfer_price: number | null
  part_no: string
  customer_price: number
}

export interface ContractImportResult {
  meta: ContractMeta
  lines: ContractLine[]
  error?: string
}

export function parseHardwareContract(buffer: ArrayBuffer): ContractImportResult {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  const ws = wb.Sheets['Master'] || wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true }) as (string | number | null)[][]

  // Parse metadata from rows 0–16
  const meta: ContractMeta = {
    projectName: '', contractType: '', validFrom: null, validTo: null,
    escalationFactor: 1, epaNumber: '', debitor: '', tpParts: null
  }

  for (let i = 0; i < Math.min(rows.length, 17); i++) {
    const r = rows[i]
    if (!r) continue
    const k = String(r[0] || '').trim().toLowerCase()
    if (k.includes('project name'))    meta.projectName = String(r[1] || '')
    if (k.includes('contract type'))   meta.contractType = String(r[1] || '')
    if (k.includes('escalation'))      meta.escalationFactor = Number(r[1]) || 1
    if (k.includes('tp (parts'))       meta.tpParts = Number(r[1]) || null
    if (String(r[5] || '').toLowerCase().includes('valid from'))
      meta.validFrom = r[6] ? String(r[6]).slice(0, 10) : null
    if (String(r[5] || '').toLowerCase().includes('valid until'))
      meta.validTo = r[6] ? String(r[6]).slice(0, 10) : null
    if (String(r[5] || '').toLowerCase().includes('epa number')) meta.epaNumber = String(r[6] || '')
    if (String(r[5] || '').toLowerCase().includes('debitor')) meta.debitor = String(r[6] || '')
  }

  // Find header row (contains "Material Number")
  let headerIdx = -1
  for (let i = 0; i < Math.min(rows.length, 22); i++) {
    if (rows[i] && rows[i].some(c => String(c || '').includes('Material Number'))) {
      headerIdx = i; break
    }
  }
  if (headerIdx < 0) {
    return { meta, lines: [], error: 'Could not find header row — expected "Material Number" column. Is this an OPSA/SPASS contract file?' }
  }

  // Parse lines from headerIdx+2 onwards (skip header + unit row)
  const lines: ContractLine[] = []
  for (let i = headerIdx + 2; i < rows.length; i++) {
    const r = rows[i]
    if (!r || !r[3]) continue           // col D = Material Number
    const listPrice = Number(r[10])
    if (!listPrice && listPrice !== 0) continue  // skip empty/non-part rows

    const escalationFactor = Number(r[11]) || meta.escalationFactor || 1
    const escalatedPrice = Number(r[12]) || null
    const discountedPrice = Number(r[14]) || null
    const transferPrice = Number(r[18]) || null
    const customerPrice = discountedPrice || escalatedPrice || listPrice

    lines.push({
      external_ref:       String(r[0] || ''),
      internal_ref:       String(r[1] || ''),
      material_no:        String(r[3] || ''),
      description:        String(r[4] || ''),
      install_location:   String(r[5] || ''),
      old_material_no:    String(r[6] || ''),
      qty:                Number(r[7]) || 1,
      lead_time_months:   Number(r[8]) || null,
      stock_type:         String(r[9] || ''),
      list_price:         listPrice,
      escalation_factor:  escalationFactor,
      escalated_price:    escalatedPrice,
      discount_pct:       Number(r[13]) || 0,
      discounted_price:   discountedPrice,
      transfer_price:     transferPrice,
      part_no:            String(r[3] || ''),   // use material_no as part_no
      customer_price:     customerPrice,
    })
  }

  if (!lines.length) {
    return { meta, lines: [], error: 'No part lines found after the header row. Check file format.' }
  }

  return { meta, lines }
}
