/** Download a 2D array as a CSV file */
export function downloadCSV(rows: (string | number | boolean | null | undefined)[][], filename: string) {
  const escape = (v: string | number | boolean | null | undefined): string => {
    const s = String(v ?? '')
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = rows.map(r => r.map(escape).join(',')).join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download = filename.endsWith('.csv') ? filename : filename + '.csv'
  a.click()
  URL.revokeObjectURL(a.href)
}
