// DHL / Siemens document generation — ported exactly from Overhaul_Manager_v4_47.html
// Uses JSZip to load .docx templates, fill fields, and trigger browser download.

import JSZip from 'jszip'
import { DHL_SLI_TEMPLATE_B64, DHL_INVOICE_TEMPLATE_B64, DHL_PACKING_TEMPLATE_B64 } from './docTemplates'

// ── XML helpers ──────────────────────────────────────────────────────────────
function xmlEsc(s: unknown): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function deEurFmt(n: number): string {
  return Number(n || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── Helper: replace the value in the cell after a label ──────────────────────
function replaceValueAfterLabel(xml: string, labelText: string, newValue: string): string {
  const labelIdx = xml.indexOf(labelText)
  if (labelIdx === -1) return xml
  const afterLabel = xml.indexOf('</w:tc>', labelIdx)
  if (afterLabel === -1) return xml
  let nextT = afterLabel
  while (true) {
    nextT = xml.indexOf('<w:t', nextT + 1)
    if (nextT === -1) return xml
    const charAfter = xml[nextT + 4]
    if (charAfter === '>' || charAfter === ' ') break
  }
  const closeT = xml.indexOf('</w:t>', nextT)
  if (closeT === -1) return xml
  const gtPos = xml.indexOf('>', nextT)
  return xml.substring(0, gtPos + 1) + xmlEsc(newValue) + xml.substring(closeT)
}

// ── Shared: fill the Siemens cover page ──────────────────────────────────────
interface CoverData {
  gv: (id: string) => string
  s: Record<string, unknown>
  d: DocData
  proj: Record<string, unknown>
  headerName: string
}

function fillCoverPage(xml: string, data: CoverData): string {
  const { gv, s, d, proj, headerName } = data
  const recvCo    = gv('pl-recv-co')
  const recvAddr   = gv('pl-recv-addr')
  const recvCity   = gv('pl-recv-city')
  const recvCountry = gv('pl-recv-country') || 'Germany'
  const poNumber   = gv('pl-po')
  const date       = gv('pl-date')
  const transport  = gv('pl-transport')
  const incoterms  = gv('pl-incoterms')

  // Invoice/order number in bold box
  xml = xml.replace(/>AH037902\/418801\/0137</g, '>' + xmlEsc(poNumber || (String(s.reference || '') + '/' + String(proj.name || ''))) + '<')

  // Date
  xml = xml.replace(/>2025-07-01</g, '>' + xmlEsc(date) + '<')

  // Consignee block
  xml = xml.replace(/>Siemens Energy Pty\. Ltd\.</g, '>' + xmlEsc(recvCo) + '<')
  xml = xml.replace(/>HEAD OFFICE MELBOURNE SPG</, '>' + xmlEsc(recvAddr) + '<')
  xml = xml.replace(/>885 Mountain Highway</, '><')
  xml = xml.replace(/>3153 Bayswater</, '>' + xmlEsc(recvCity) + '<')
  xml = xml.replace(/>Bayswater</, '>' + xmlEsc(recvCity) + '<')
  xml = xml.replace(/>Australien</, '>' + xmlEsc(recvCountry) + '<')

  // Project refs
  xml = xml.replace(/>RGS Townsville</g, '>' + xmlEsc(String(proj.name || '')) + '<')
  xml = xml.replace(/>RSP-Townsville</g, '>' + xmlEsc(String(s.reference || '')) + '<')
  xml = xml.replace(/>Townsville Power Station</, '>' + xmlEsc(recvCo) + '<')
  xml = xml.replace(/>Townsville Power Station</g, '>' + xmlEsc(headerName || String(proj.name || '')) + '<')
  xml = xml.replace(/>Transfield Townsville PtY Ltd\.</g, '>' + xmlEsc(recvCo) + '<')

  // Transport mode
  xml = xml.replace(/>Luftfracht \/ Air freight</, '>' + xmlEsc(transport) + '<')

  // Forwarding address
  xml = xml.replace(/>Lot 1 Greenvale Street</, '>' + xmlEsc(recvAddr) + '<')
  xml = xml.replace(/>4818 Yabulu</, '>' + xmlEsc(recvCity) + '<')

  // Final user
  xml = xml.replace(/>Walker Street 141</, '>' + xmlEsc(recvAddr) + '<')
  xml = xml.replace(/>2000 Sydney</, '>' + xmlEsc(recvCity) + '<')

  // Remaining Australien
  xml = xml.replace(/>Australien</, '>' + xmlEsc(recvCountry) + '<')
  xml = xml.replace(/>Australien</, '>' + xmlEsc(recvCountry) + '<')

  // Incoterms
  xml = xml.replace(/CIP Brisbane Airport\s*</, xmlEsc(incoterms) + '<')

  // PO / order number
  xml = xml.replace(/>O-4188-01-A</g, '>' + xmlEsc(poNumber || String(s.reference || '')) + '<')

  // Totals
  const totalPkg = d.kollos.length || 1
  xml = replaceValueAfterLabel(xml, 'Gesamtanzahl Kolli / Total No. of Packages', String(totalPkg))
  xml = replaceValueAfterLabel(xml, 'Gesamtnettogewicht / Total Net-Weight (kg)', deEurFmt(d.totalNet))
  xml = replaceValueAfterLabel(xml, 'Gesamtbruttogewicht / Total Gross-Weight (kg)', deEurFmt(d.totalGross))
  xml = replaceValueAfterLabel(xml, 'Gesamtvolumen / Total volume (m', deEurFmt(d.totalVol))

  // Description of goods
  const descBlock = `Destination: ${headerName || String(proj.name || '')}`
  xml = xml.replace(/Destination: Townsville Power Station/, xmlEsc(descBlock))
  xml = xml.replace(/>Townsville Syncon - Offshore scope</, '>' + xmlEsc(String(proj.name || '')) + '<')
  xml = xml.replace(/>FOC Tool replacement</, '>' + xmlEsc(String(s.description || '')) + '<')

  return xml
}

// ── Shared: fill kollo/package section ──────────────────────────────────────
function fillKollos(xml: string, kollos: KolloData[]): string {
  const packstuckIdx = xml.indexOf('Packstück / Package')
  if (packstuckIdx === -1) return xml
  const kolloHeaderIdx = xml.indexOf('Kollo / UCR-No. Kollo', packstuckIdx)
  if (kolloHeaderIdx === -1) return xml
  const kolloColEnd = xml.indexOf('</w:tr>', kolloHeaderIdx) + '</w:tr>'.length
  const kolloDataStart = xml.indexOf('<w:tr ', kolloColEnd)
  const consistIdx2 = xml.indexOf('bestehend aus', kolloDataStart)
  const consistRowStart = xml.lastIndexOf('<w:tr ', consistIdx2)
  const kolloDataEnd = consistRowStart
  const kolloRowEnd = xml.indexOf('</w:tr>', kolloDataStart) + '</w:tr>'.length
  const kolloTemplateRow = xml.substring(kolloDataStart, kolloRowEnd)

  let newKolloRows = ''
  if (kollos.length) {
    kollos.forEach(k => {
      let kr = kolloTemplateRow
      kr = kr.replace(/A-0137-0001-C-O-4188-01-A-N\s*/, xmlEsc(k.vbNo || k.crateNo || ''))
      kr = kr.replace(/>SIEKI0000612289</, '>' + xmlEsc(k.kolloId || '') + '<')
      kr = kr.replace(/>SIEKK0000490093001</, '>' + xmlEsc(k.ucrNo || '') + '<')
      kr = kr.replace(/Kasten \(BX\)\s*/, xmlEsc(k.packagingType || 'Crate (CH)'))
      kr = kr.replace(/>102840424\/</, '>' + xmlEsc(k.fertigmeldung || '') + '<')
      kr = kr.replace(/SIEKK0000490093\s*/, xmlEsc(k.masterKollo || ''))
      kr = kr.replace(
        /<w:t>40<\/w:t>([\s\S]*?)<w:t>40<\/w:t>([\s\S]*?)<w:t>35<\/w:t>/,
        '<w:t>' + xmlEsc(k.lengthCm || '') + '</w:t>$1<w:t>' + xmlEsc(k.widthCm || '') + '</w:t>$2<w:t>' + xmlEsc(k.heightCm || '') + '</w:t>'
      )
      kr = kr.replace(/>30,000</, '>' + deEurFmt(k.grossKg || 0) + '<')
      kr = kr.replace(/>26,540</, '>' + deEurFmt(k.netKg || 0) + '<')
      newKolloRows += kr + '\n'
    })
  } else {
    newKolloRows = kolloTemplateRow
  }

  return xml.substring(0, kolloDataStart) + newKolloRows + xml.substring(kolloDataEnd)
}

// ── Types ────────────────────────────────────────────────────────────────────
export interface KolloData {
  kolloId?: string
  crateNo?: string
  vbNo?: string
  ucrNo?: string
  packagingType?: string
  fertigmeldung?: string
  masterKollo?: string
  lengthCm?: string | number
  widthCm?: string | number
  heightCm?: string | number
  grossKg?: number
  netKg?: number
  volM3?: number
}

export interface WositPart {
  description?: string
  materialNo?: string
  qty?: number
  unit?: string
  hsCode?: string
  countryOfOrigin?: string
}

export interface DocData {
  kollos: KolloData[]
  wositParts: WositPart[]
  totalGross: number
  totalNet: number
  totalVol: number
  replacementValue?: number
}

export interface SLIFields {
  acct: string
  senderCo: string
  senderAddr: string
  senderContact: string
  senderPhone: string
  pickupDate: string
  pickupAddr: string
  shipperRef: string
  recvCo: string
  recvAddr: string
  recvCity: string
  recvCountry: string
  recvContact: string
  recvPhone: string
  notes: string
  consigneeRef: string
  airport: string
  serviceType: string
  goodsDesc: string
  countryMfg: string
  hsCode: string
  customsVal: string
  edn: string
  insurance: string
  pieces: string
  weight: string
  dg: string
  // per-kollo goods lines (from kollos)
  kollos: KolloData[]
}

export interface PandIFields {
  shipperCo: string
  shipperAddr: string
  recvCo: string
  recvAddr: string
  recvCity: string
  recvCountry: string
  poNumber: string
  date: string
  transport: string
  incoterms: string
  lot: string
  currency: string
}

// ── DHL SLI ──────────────────────────────────────────────────────────────────
export async function generateDHLSLI(
  fields: SLIFields,
  shipRef: string,
  today: string
): Promise<void> {
  const templateBytes = b64ToBytes(DHL_SLI_TEMPLATE_B64)
  const zip = await JSZip.loadAsync(templateBytes)
  let docXml = await zip.file('word/document.xml')!.async('string')

  const isDG = fields.dg.startsWith('Yes')
  const serviceType = fields.serviceType
  const wantInsurance = fields.insurance === 'Yes'

  // Build per-kollo goods lines
  let kolloData: Array<{ pieces: string; weight: string; dims: string; hsCode: string; countryMfg: string; desc: string }> = []
  if (fields.kollos.length) {
    kolloData = fields.kollos.map(k => ({
      pieces: '1',
      weight: String(k.grossKg || ''),
      dims: `${k.lengthCm || ''} x ${k.widthCm || ''} x ${k.heightCm || ''}`,
      hsCode: fields.hsCode,
      countryMfg: fields.countryMfg,
      desc: `${fields.goodsDesc} - Crate ${k.crateNo || ''}`,
    }))
  }
  if (!kolloData.length) {
    kolloData = [{
      pieces: fields.pieces,
      weight: fields.weight,
      dims: '',
      hsCode: fields.hsCode,
      countryMfg: fields.countryMfg,
      desc: fields.goodsDesc,
    }]
  }

  // Text field values — indexed by sequential FORMTEXT position (0-31)
  const textValues: Record<number, string> = {
    0:  fields.acct,
    1:  fields.senderCo,
    2:  fields.senderAddr,
    3:  '',
    4:  fields.senderContact,
    5:  fields.senderPhone,
    6:  fields.pickupDate,
    7:  '',
    8:  fields.pickupAddr,
    9:  fields.shipperRef,
    10: fields.recvCo,
    11: fields.recvAddr,
    12: '',
    13: fields.recvCity,
    14: fields.recvCountry,
    15: fields.recvContact,
    16: fields.recvPhone,
    17: fields.notes,
    18: fields.consigneeRef,
    19: '',
    20: fields.airport,
    21: '',
    22: kolloData[0]?.pieces || '',
    23: kolloData[0]?.weight || '',
    24: kolloData[0]?.dims || '',
    25: kolloData[0]?.desc || '',
    26: fields.customsVal,
    27: '',
    28: fields.edn,
    29: '',
    30: '',
    31: today,
  }

  // Checkbox values — indexed by sequential FORMCHECKBOX position (0-43)
  const checkValues: Record<number, boolean> = {
    0:  true,
    1:  false,
    3:  true,
    4:  false,
    5:  false,
    6:  true,
    7:  isDG,
    8:  false,
    10: serviceType.includes('Plus'),
    11: false,
    12: serviceType.includes('Value'),
    13: serviceType.includes('First'),
    15: !isDG,
    16: isDG,
    17: !wantInsurance,
    18: wantInsurance,
    20: true,
    23: true,
    26: true,
    29: true,
  }

  // Fill FORMTEXT fields by sequential position
  let textFieldIdx = 0
  docXml = docXml.replace(
    /(<w:fldChar w:fldCharType="begin">\s*<w:ffData>[\s\S]*?<\/w:ffData>\s*<\/w:fldChar>[\s\S]*?<w:instrText[^>]*>\s*FORMTEXT\s*<\/w:instrText>[\s\S]*?<w:fldChar w:fldCharType="separate"\/>)([\s\S]*?)(<w:fldChar w:fldCharType="end"[\s]*\/>)/g,
    (_match: string, before: string, _valuePart: string, after: string) => {
      const idx = textFieldIdx++
      const newVal = textValues[idx] !== undefined ? textValues[idx] : ''
      if (newVal) {
        return before + '<w:t xml:space="preserve">' + newVal.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</w:t>' + after
      }
      return before + _valuePart + after
    }
  )

  // Fill FORMCHECKBOX fields by sequential position
  let checkFieldIdx = 0
  docXml = docXml.replace(
    /<w:fldChar w:fldCharType="begin">\s*<w:ffData>\s*<w:name w:val="[^"]*"\/>\s*<w:enabled\/>\s*<w:calcOnExit w:val="0"\/>\s*<w:checkBox>([\s\S]*?)<\/w:checkBox>\s*<\/w:ffData>\s*<\/w:fldChar>/g,
    (match: string, checkBoxContent: string) => {
      const idx = checkFieldIdx++
      const shouldCheck = !!checkValues[idx]
      if (checkBoxContent.includes('<w:checked')) {
        return match.replace(/<w:checked w:val="[^"]*"\/>/g, `<w:checked w:val="${shouldCheck ? '1' : '0'}"`)
      } else {
        return match.replace('</w:checkBox>', `<w:checked w:val="${shouldCheck ? '1' : '0'}"/></w:checkBox>`)
      }
    }
  )

  zip.file('word/document.xml', docXml)
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  triggerDownload(blob, `SLI_${shipRef}_${today}.docx`)
}

// ── Commercial Invoice ────────────────────────────────────────────────────────
export async function generateDHLInvoice(
  fields: PandIFields,
  s: Record<string, unknown>,
  proj: Record<string, unknown>,
  docData: DocData,
): Promise<void> {
  const templateBytes = b64ToBytes(DHL_INVOICE_TEMPLATE_B64)
  const zip = await JSZip.loadAsync(templateBytes)
  let xml = await zip.file('word/document.xml')!.async('string')

  const headerName = String(s.header_name || s.description || '').replace(/ \(return\)$/, '')

  // Build cover-page-compatible gv lookup from PandIFields
  const overlayEl = _buildFakeOverlay(fields)
  const gvOverlay = (id: string) => overlayEl[id] || ''

  xml = fillCoverPage(xml, { gv: gvOverlay, s, d: docData, proj, headerName })

  // ── Line item rows ──────────────────────────────────────────────────────────
  const consistingIdx = xml.indexOf('bestehend aus / consisting of')
  if (consistingIdx !== -1) {
    const posNrIdx = xml.indexOf('Pos.-Nr.', consistingIdx)
    if (posNrIdx !== -1) {
      const headerRowEnd = xml.indexOf('</w:tr>', posNrIdx)
      const firstDataRowStart = xml.indexOf('<w:tr ', headerRowEnd)
      const totalIdx = xml.indexOf('Gesamtrechnungswert')
      const pageBreakBefore = xml.lastIndexOf('<w:br w:type="page"/>', totalIdx)
      const totalRowStart = xml.lastIndexOf('<w:tr ', totalIdx)
      let dataRowsEnd = xml.lastIndexOf('</w:tr>', pageBreakBefore !== -1 ? pageBreakBefore : totalRowStart)
      dataRowsEnd = dataRowsEnd + '</w:tr>'.length
      const firstRowEnd = xml.indexOf('</w:tr>', firstDataRowStart) + '</w:tr>'.length
      const templateRow = xml.substring(firstDataRowStart, firstRowEnd)

      const totalValue = docData.replacementValue || 0
      const parts = docData.wositParts
      const totalQty = parts.reduce((s, p) => s + (p.qty || 1), 0)
      const perItemValue = parts.length && totalQty ? totalValue / totalQty : 0

      let newDataRows = ''
      if (parts.length) {
        parts.forEach((p, i) => {
          let row = templateRow
          row = row.replace(/<w:t>1<\/w:t>/, '<w:t>' + xmlEsc(String(i + 1)) + '</w:t>')
          row = row.replace(/>Zugbolzen</, '>' + xmlEsc(p.description || 'Part') + '<')
          row = row.replace(/>Tensioning Bolt</, '><')
          row = row.replace(/Material Nr\. \/ Material No\.: B94961700 \/ A2A50037309/, 'Material Nr. / Material No.: ' + xmlEsc(p.materialNo || ''))
          row = row.replace(/<w:t>ST<\/w:t>/, '<w:t>' + xmlEsc(p.unit || 'ST') + '</w:t>')
          row = row.replace(/>761090</, '>' + xmlEsc(p.hsCode || '') + '<')
          row = row.replace(/>Deutschland</, '>' + xmlEsc((p.countryOfOrigin || 'DE') === 'DE' ? 'Deutschland' : (p.countryOfOrigin || 'DE')) + '<')
          row = row.replace(/>LKZ: DE</, '>LKZ: ' + xmlEsc(p.countryOfOrigin || 'DE') + '<')
          const qty = p.qty || 1
          const lineValue = perItemValue * qty
          row = row.replace(/624,36\s*</, deEurFmt(perItemValue) + ' <')
          row = row.replace(/>624,36</, '>' + deEurFmt(lineValue) + '<')
          newDataRows += row + '\n'
        })
      } else {
        let row = templateRow
        row = row.replace(/>Zugbolzen</, '>Parts<')
        row = row.replace(/>Tensioning Bolt</, '><')
        row = row.replace(/Material Nr\. \/ Material No\.: B94961700 \/ A2A50037309/, '')
        row = row.replace(/624,36\s*</, deEurFmt(totalValue) + ' <')
        row = row.replace(/>624,36</, '>' + deEurFmt(totalValue) + '<')
        newDataRows = row
      }

      xml = xml.substring(0, firstDataRowStart) + newDataRows + xml.substring(dataRowsEnd)
    }
  }

  // ── Kollo rows ──────────────────────────────────────────────────────────────
  xml = fillKollos(xml, docData.kollos)

  // ── Totals ──────────────────────────────────────────────────────────────────
  const totalValue = docData.replacementValue || 0
  xml = xml.replace(/>6\.404,36</, '>' + deEurFmt(totalValue) + '<')

  // HS code summary blocks
  const parts = docData.wositParts
  const totalQty = parts.reduce((s, p) => s + (p.qty || 1), 0)
  const perItemValue2 = parts.length && totalQty ? totalValue / totalQty : 0
  const hsGroups: Record<string, number> = {}
  parts.forEach(p => {
    const hs = p.hsCode || 'N/A'
    if (!hsGroups[hs]) hsGroups[hs] = 0
    hsGroups[hs] += perItemValue2 * (p.qty || 1)
  })
  if (!parts.length) hsGroups['N/A'] = totalValue

  const hsSummeIdx = xml.indexOf('Summe für HS-Code')
  if (hsSummeIdx !== -1) {
    const hsTblStart = xml.lastIndexOf('<w:tbl>', hsSummeIdx)
    const hsTblEnd = xml.indexOf('</w:tbl>', hsSummeIdx) + '</w:tbl>'.length
    const hsTable = xml.substring(hsTblStart, hsTblEnd)
    const firstSummeInTbl = hsTable.indexOf('Summe für HS-Code')
    const firstBlockStart = hsTable.lastIndexOf('<w:tr ', firstSummeInTbl)
    let blockEnd = firstBlockStart
    for (let r = 0; r < 3; r++) {
      blockEnd = hsTable.indexOf('</w:tr>', blockEnd) + '</w:tr>'.length
    }
    const hsBlockTemplate = hsTable.substring(firstBlockStart, blockEnd)
    const beforeBlocks = hsTable.substring(0, firstBlockStart)
    const lastTrEnd = hsTable.lastIndexOf('</w:tr>') + '</w:tr>'.length
    const afterBlocks = hsTable.substring(lastTrEnd)

    let newHsBlocks = ''
    for (const [hsCode, subtotal] of Object.entries(hsGroups)) {
      let block = hsBlockTemplate
      block = block.replace(/731815/, xmlEsc(hsCode))
      block = block.replace(/5\.780,00/, deEurFmt(subtotal))
      newHsBlocks += block
    }
    xml = xml.substring(0, hsTblStart) + beforeBlocks + newHsBlocks + afterBlocks + xml.substring(hsTblEnd)
  }

  // Incoterms place
  const incotermPlace = fields.incoterms.replace(/^CIP\s*/i, '') || 'Airport'
  xml = xml.replace(/Brisbane Airport/g, xmlEsc(incotermPlace))

  zip.file('word/document.xml', xml)
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  triggerDownload(blob, `Invoice_${String(s.reference || 'INV')}_${fields.date}.docx`)
}

// ── Packing List ─────────────────────────────────────────────────────────────
export async function generateDHLPackingList(
  fields: PandIFields,
  s: Record<string, unknown>,
  proj: Record<string, unknown>,
  docData: DocData,
): Promise<void> {
  const templateBytes = b64ToBytes(DHL_PACKING_TEMPLATE_B64)
  const zip = await JSZip.loadAsync(templateBytes)
  let xml = await zip.file('word/document.xml')!.async('string')

  const headerName = String(s.header_name || s.description || '').replace(/ \(return\)$/, '')
  const overlayEl = _buildFakeOverlay(fields)
  const gvOverlay = (id: string) => overlayEl[id] || ''

  xml = fillCoverPage(xml, { gv: gvOverlay, s, d: docData, proj, headerName })

  // ── Line item rows ──────────────────────────────────────────────────────────
  const consistingIdx = xml.indexOf('bestehend aus / consisting of')
  if (consistingIdx !== -1) {
    const posNrIdx = xml.indexOf('Pos.-Nr.', consistingIdx)
    if (posNrIdx !== -1) {
      const headerRowEnd = xml.indexOf('</w:tr>', posNrIdx)
      const firstDataRowStart = xml.indexOf('<w:tr ', headerRowEnd)
      const endOfTable = xml.indexOf('</w:tbl>', firstDataRowStart)
      let dataRowsEnd = xml.lastIndexOf('</w:tr>', endOfTable)
      dataRowsEnd = dataRowsEnd + '</w:tr>'.length
      const firstRowEnd = xml.indexOf('</w:tr>', firstDataRowStart) + '</w:tr>'.length
      const templateRow = xml.substring(firstDataRowStart, firstRowEnd)
      const parts = docData.wositParts

      let newDataRows = ''
      if (parts.length) {
        parts.forEach((p, i) => {
          let row = templateRow
          row = row.replace(/<w:t>1<\/w:t>/, '<w:t>' + xmlEsc(String(i + 1)) + '</w:t>')
          row = row.replace(/>Zugbolzen</, '>' + xmlEsc(p.description || 'Part') + '<')
          row = row.replace(/>Tensioning Bolt</, '><')
          row = row.replace(/Material Nr\. \/ Material No\.: B94961700 \/ A2A50037309/, 'Material Nr. / Material No.: ' + xmlEsc(p.materialNo || ''))
          row = row.replace(/<w:t>ST<\/w:t>/, '<w:t>' + xmlEsc(p.unit || 'ST') + '</w:t>')
          row = row.replace(/>761090</, '>' + xmlEsc(p.hsCode || '') + '<')
          row = row.replace(/>Deutschland</, '>' + xmlEsc((p.countryOfOrigin || 'DE') === 'DE' ? 'Deutschland' : (p.countryOfOrigin || 'DE')) + '<')
          row = row.replace(/>LKZ: DE</, '>LKZ: ' + xmlEsc(p.countryOfOrigin || 'DE') + '<')
          newDataRows += row + '\n'
        })
      } else {
        let row = templateRow
        row = row.replace(/>Zugbolzen</, '>Parts<')
        row = row.replace(/>Tensioning Bolt</, '><')
        row = row.replace(/Material Nr\. \/ Material No\.: B94961700 \/ A2A50037309/, '')
        newDataRows = row
      }

      xml = xml.substring(0, firstDataRowStart) + newDataRows + xml.substring(dataRowsEnd)
    }
  }

  // ── Kollo rows ──────────────────────────────────────────────────────────────
  xml = fillKollos(xml, docData.kollos)

  // Incoterms place
  const incotermPlace = fields.incoterms.replace(/^CIP\s*/i, '') || 'Airport'
  xml = xml.replace(/Brisbane Airport/g, xmlEsc(incotermPlace))

  zip.file('word/document.xml', xml)
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  triggerDownload(blob, `PackingList_${String(s.reference || 'PL')}_${fields.date}.docx`)
}

// ── Internal helpers ──────────────────────────────────────────────────────────
// Build a simple id→value lookup from PandIFields so fillCoverPage's gv() works
function _buildFakeOverlay(fields: PandIFields): Record<string, string> {
  return {
    'pl-shipper-co':  fields.shipperCo,
    'pl-shipper-addr': fields.shipperAddr,
    'pl-recv-co':    fields.recvCo,
    'pl-recv-addr':  fields.recvAddr,
    'pl-recv-city':  fields.recvCity,
    'pl-recv-country': fields.recvCountry,
    'pl-po':         fields.poNumber,
    'pl-date':       fields.date,
    'pl-transport':  fields.transport,
    'pl-incoterms':  fields.incoterms,
    'pl-lot':        fields.lot,
    'pl-currency':   fields.currency,
  }
}
