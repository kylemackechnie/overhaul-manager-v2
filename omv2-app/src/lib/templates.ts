/**
 * Template downloads — generates blank XLSX/CSV templates for import
 * Uses the globally-loaded XLSX from CDN
 */

declare const XLSX: {
  utils: {
    book_new: () => { SheetNames: string[]; Sheets: Record<string, unknown> }
    aoa_to_sheet: (data: unknown[][]) => unknown
    book_append_sheet: (wb: unknown, ws: unknown, name: string) => void
  }
  writeFile: (wb: unknown, name: string) => void
}

function xlsxTemplate(filename: string, headers: string[], example: unknown[]) {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([headers, example])
  XLSX.utils.book_append_sheet(wb, ws, 'Template')
  XLSX.writeFile(wb, filename)
}

function csvTemplate(filename: string, headers: string[], example: (string | number)[]) {
  const rows = [headers.join(','), example.map(v => `"${v}"`).join(',')]
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

export function downloadTemplate(type: string) {
  switch (type) {
    case 'wosit':
      return xlsxTemplate('WOSIT_Parts_Template.xlsx',
        ['TV-No.', 'VB-No.', 'Delivery Package', 'Material', 'Material (Kanlog)', 'Language 1', 'Language 2', 'Quantity (Kanlog)', 'Cum Quantity Unit'],
        ['482', 'VB-001', '482-001-001', '1234567890', 'Install Location # Material', 'Beschreibung', 'Description English', '2', 'PCE']
      )
    case 'tv':
      return xlsxTemplate('TV_Sheet_Template.xlsx',
        ['TV-No.', 'TV Name', 'HAWB', 'MAWB', 'Flight', 'Date of Departure', 'ETA POD', 'Kanlog Price', 'Kanl Price Curr', 'Danger (Kanlog)', 'TV Comment', 'TV Status'],
        ['482', 'TV482 - GT11 Compressor Tools', '12345678', 'MAWB123', 'LH1234', '2026-03-01', '2026-03-10', '50000', 'EUR', '', 'Example comment', 'On Tour']
      )
    case 'kollo':
      return xlsxTemplate('Kollo_Sheet_Template.xlsx',
        ['TV-No.', 'Kollo ID', 'VB-No.', 'Gross', 'Net', 'Length', 'Width', 'Height', 'Delivery Package', '# pack items'],
        ['482', '100001', 'VB-001', '250', '200', '120', '80', '90', '482-001-001', '5']
      )
    case 'resources':
      return csvTemplate('Resources_Template.csv',
        ['Name', 'Role', 'Category', 'Company', 'Email', 'Phone', 'Mob In', 'Mob Out', 'WBS'],
        ['John Smith', 'Fitter Machinist', 'trades', 'Acme Co', 'john@example.com', '0400000000', '2026-05-01', '2026-06-30', '']
      )
    case 'expenses':
      return csvTemplate('Expenses_Template.csv',
        ['Date', 'Category', 'Description', 'Amount', 'Cost ex GST', 'Sell Price', 'Currency', 'WBS', 'Notes'],
        ['2026-05-01', 'Accommodation', 'Hotel Brisbane', '220.00', '200.00', '230.00', 'AUD', '', '']
      )
    case 'nrg_tce':
      return xlsxTemplate('NRG_TCE_Template.xlsx',
        ['Item ID', 'Activity Description', 'Work Order', 'Service Order Number', 'Type of Unit', 'Hours or Units', 'Gang Rate', 'Total Cost', 'Included in KPI'],
        ['1.1.1', 'Example overhead item', '28243985', 'SO12345', 'hours', '100', '250', '25000', 'Yes']
      )
    case 'payroll':
      return csvTemplate('UKG_Payroll_Template.csv',
        ['Employee Id', '', 'First Name', '', 'Last Name', ''],
        ['', 'EMP001', 'John', '', 'Smith', '']
      )
    default:
      console.warn('Unknown template type:', type)
  }
}
