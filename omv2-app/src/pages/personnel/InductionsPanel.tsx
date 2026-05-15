import * as XLSX from 'xlsx'
import { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { HelpButton } from '../../components/HelpButton'
import { useIsMobile } from '../../hooks/useIsMobile'

const InductionsMobile = lazy(() =>
  import('../mobile/InductionsMobile').then(m => ({ default: m.InductionsMobile }))
)

// ── Print helpers ──────────────────────────────────────────────────────────

const SEP_SQP_KEYS = ['sep_trades','sep_project','sep_contractors','sqp_gt','sqp_gt_contr','sqp_project','sqp_trades','sqp_contractors']
const SITE_KEYS    = ['hydraulic','rad_torque','confined_space','hytorc','grinder']
const HRWL_KEYS    = ['white_card','cs_licence','gas_test','work_permit','breathing_app','cs_rescue','wah_licence']

const SHORT: Record<string,string> = {
  sep_trades:'SEP Trades', sep_project:'SEP Project', sep_contractors:'SEP Contr.',
  sqp_gt:'SQP GT', sqp_gt_contr:'SQP GT Contr.', sqp_project:'SQP Project', sqp_trades:'SQP Trades', sqp_contractors:'SQP Contr.',
  hydraulic:'Hydraulic', rad_torque:'Rad Torque', confined_space:'Confined Sp.', hytorc:'Hytorc', grinder:'Grinder',
  white_card:'White Card', cs_licence:'CS Licence', gas_test:'Gas Test Atm.', work_permit:'Issue Work Permit',
  breathing_app:'Breathing Apparatus', cs_rescue:'CS Rescue', wah_licence:'WAH Licence',
}

function printCss() {
  return `
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:Arial,sans-serif;font-size:9pt;color:#111;background:#fff;}
    h1{font-size:13pt;font-weight:700;}
    h2{font-size:10pt;font-weight:700;margin:0;}
    .meta{font-size:8pt;color:#555;margin-top:2px;}
    table{width:100%;border-collapse:collapse;}
    th,td{border:0.5px solid #bbb;padding:3px 5px;font-size:7.5pt;vertical-align:middle;}
    th{background:#1e293b;color:#f1f5f9;font-weight:600;text-align:center;}
    th.left,td.left{text-align:left;}
    .sep-border-l{border-left:2px solid #334155!important;}
    .sep-border-r{border-right:2px solid #334155!important;}
    .ok   {background:#dcfce7;color:#166534;text-align:center;border-radius:2px;padding:1px 3px;font-size:6.5pt;font-weight:600;display:inline-block;white-space:nowrap;}
    .exp  {background:#fee2e2;color:#991b1b;text-align:center;border-radius:2px;padding:1px 3px;font-size:6.5pt;font-weight:600;display:inline-block;white-space:nowrap;}
    .warn {background:#fef3c7;color:#92400e;text-align:center;border-radius:2px;padding:1px 3px;font-size:6.5pt;font-weight:600;display:inline-block;white-space:nowrap;}
    .miss {background:#fce7f3;color:#9d174d;text-align:center;border-radius:2px;padding:1px 3px;font-size:6.5pt;font-weight:600;display:inline-block;white-space:nowrap;}
    .row-exp{background:#fff5f5;}
    .row-miss{background:#fdf4ff;}
    .kpi-strip{display:flex;border:0.5px solid #bbb;border-radius:4px;overflow:hidden;margin:8px 0;}
    .kpi{flex:1;padding:6px 8px;text-align:center;border-right:0.5px solid #bbb;}
    .kpi:last-child{border-right:none;}
    .kpi-val{font-size:16pt;font-weight:700;}
    .kpi-lbl{font-size:7pt;color:#555;margin-top:1px;}
    .green{color:#166534;} .red{color:#991b1b;} .amber{color:#92400e;} .gray{color:#555;}
    .alert{background:#fff7ed;border-left:3px solid #f59e0b;padding:6px 8px;margin:8px 0;font-size:8pt;color:#78350f;border-radius:0 3px 3px 0;}
    .alert strong{display:block;font-size:8.5pt;margin-bottom:2px;}
    .section-head{background:#1e293b;color:#f1f5f9;font-size:8pt;font-weight:700;padding:5px 8px;margin:12px 0 0;letter-spacing:.04em;text-transform:uppercase;}
    .legend{display:flex;gap:14px;margin-top:8px;font-size:7pt;color:#555;flex-wrap:wrap;}
    .legend span{display:inline-flex;align-items:center;gap:3px;}
    .page-header{border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:8px;}
    @media print{
      @page{margin:12mm 10mm;}
      .no-break{page-break-inside:avoid;}
      .page-break{page-break-before:always;}
    }
  `
}

type MatchRow = { resource: Resource; match: InductionPerson | null; score: number }

function cellHtml(cs: CourseStatus | undefined, refDate: string, today: string): string {
  if (!cs || cs.status === 'na') return '<td style="text-align:center;color:#aaa;">—</td>'
  const expired  = !cs.noExpiry && cs.expISO ? cs.expISO < refDate : false
  const expToday = !cs.noExpiry && cs.expISO ? cs.expISO < today   : false
  if (expired && expToday) return `<td style="text-align:center;"><span class="exp">EXPIRED<br>${cs.exp}</span></td>`
  if (expired)             return `<td style="text-align:center;"><span class="warn">EXPIRING<br>${cs.exp}</span></td>`
  return `<td style="text-align:center;"><span class="ok">${cs.noExpiry ? '∞' : cs.exp}</span></td>`
}

// ── Wall sheet (landscape, 1 page) ────────────────────────────────────────

function buildWallSheet(
  rows: MatchRow[], projectName: string, refDate: string, today: string,
  expiringOnSite: { name: string; mobOut: string; courses: string[] }[],
  kpis: { allValid: number; someExpired: number; notFound: number },
) {
  const sepCols      = INDUCTION_COURSES.filter(c => SEP_SQP_KEYS.includes(c.key))
  const otherKeys    = INDUCTION_COURSES.filter(c => SITE_KEYS.includes(c.key) || HRWL_KEYS.includes(c.key))

  const headerCells = [
    `<th class="left sep-border-l" style="min-width:120px">Name</th>`,
    `<th class="left" style="min-width:80px">Role</th>`,
    `<th class="left" style="min-width:100px">Mob In → Out</th>`,
    ...sepCols.map((c, i) =>
      `<th${i === sepCols.length - 1 ? ' class="sep-border-r"' : ''}>${SHORT[c.key]}</th>`
    ),
    `<th style="color:#94a3b8;background:#334155;">Other certs</th>`,
  ].join('')

  const bodyRows = rows.map(m => {
    const p = m.match
    const mobStr = `${m.resource.mob_in || '—'} → ${m.resource.mob_out || '—'}`
    if (!p) {
      return `<tr class="row-miss">
        <td class="left sep-border-l" style="font-weight:700">${m.resource.name}</td>
        <td class="left" style="color:#555">${m.resource.role || '—'}</td>
        <td class="left" style="color:#555">${mobStr}</td>
        <td colspan="${sepCols.length + 1}" class="sep-border-r" style="color:#9d174d">
          <span class="miss">NOT FOUND IN SYSTEM</span>
        </td>
      </tr>`
    }
    const hasExpired = INDUCTION_COURSES.some(c => {
      const cs = p.courses[c.key]
      return cs && cs.status !== 'na' && !cs.noExpiry && cs.expISO && cs.expISO < refDate
    })
    const rowClass = hasExpired ? 'row-exp' : ''
    const sepCells = sepCols.map((c, i) =>
      cellHtml(p.courses[c.key], refDate, today)
        .replace('<td', `<td${i === sepCols.length - 1 ? ' class="sep-border-r"' : ''}`)
    ).join('')

    // "Other certs" summary
    const otherValid   = otherKeys.filter(c => { const cs = p.courses[c.key]; return cs && cs.status !== 'na' && !(cs.expISO && cs.expISO < refDate) }).length
    const otherExpired = otherKeys.filter(c => { const cs = p.courses[c.key]; return cs && cs.expISO && cs.expISO < refDate }).length
    const otherSummary = otherValid === 0 && otherExpired === 0
      ? '<td style="text-align:center;color:#aaa;">—</td>'
      : `<td style="text-align:center;font-size:7pt;color:#555;">${otherValid > 0 ? `<span class="ok">${otherValid} valid</span> ` : ''}${otherExpired > 0 ? `<span class="exp">${otherExpired} exp.</span>` : ''}</td>`

    return `<tr class="${rowClass}">
      <td class="left sep-border-l" style="font-weight:700">${m.resource.name}${m.score < 1 ? `<span style="font-size:6.5pt;color:#b45309;margin-left:3px">≈ ${p.name}</span>` : ''}</td>
      <td class="left" style="color:#555">${m.resource.role || '—'}</td>
      <td class="left" style="color:#555;white-space:nowrap">${mobStr}</td>
      ${sepCells}
      ${otherSummary}
    </tr>`
  }).join('')

  const alertHtml = expiringOnSite.length > 0
    ? `<div class="alert"><strong>⚠ Expiring before mob-out</strong>${expiringOnSite.map(w => `${w.name} (off site ${w.mobOut}) — ${w.courses.join(', ')}`).join('<br>')}</div>`
    : ''

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <title>HSE Induction Status — ${projectName}</title>
  <style>${printCss()}</style>
  </head><body>
  <div class="page-header">
    <h1>HSE Induction Status — ${projectName}</h1>
    <div class="meta">Printed ${new Date().toLocaleDateString('en-AU')} · Ref date ${refDate} · ${rows.length} resources</div>
  </div>
  <div class="kpi-strip">
    <div class="kpi"><div class="kpi-val green">${kpis.allValid}</div><div class="kpi-lbl">All valid</div></div>
    <div class="kpi"><div class="kpi-val red">${kpis.someExpired}</div><div class="kpi-lbl">Expired</div></div>
    <div class="kpi"><div class="kpi-val amber">${expiringOnSite.length}</div><div class="kpi-lbl">Expiring on-site</div></div>
    <div class="kpi"><div class="kpi-val gray">${kpis.notFound}</div><div class="kpi-lbl">Not in system</div></div>
  </div>
  ${alertHtml}
  <table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>
  <div class="legend">
    <span><span class="ok">VALID</span> Current</span>
    <span><span class="warn">EXPIRING</span> Expires before mob-out</span>
    <span><span class="exp">EXPIRED</span> Already expired</span>
    <span><span class="miss">NOT FOUND</span> No SE Learning record</span>
    <span style="margin-left:auto;font-style:italic;">SEP/SQP columns bordered · site certs summarised</span>
  </div>
  </body></html>`
}

// ── HSE Officer report (multi-page, all courses) ──────────────────────────

function buildHseReport(
  rows: MatchRow[], projectName: string, refDate: string, today: string,
  expiringOnSite: { name: string; mobOut: string; courses: string[] }[],
  kpis: { allValid: number; someExpired: number; notFound: number },
) {
  // Action required: expired vs today OR expiring before refDate, OR not found
  const actionRows = rows.filter(m => {
    if (!m.match) return true
    return INDUCTION_COURSES.some(c => {
      const cs = m.match!.courses[c.key]
      return cs && cs.status !== 'na' && !cs.noExpiry && cs.expISO && cs.expISO < refDate
    })
  })

  const actionTableRows = actionRows.flatMap(m => {
    if (!m.match) {
      return [`<tr class="row-miss">
        <td class="left" style="font-weight:700;color:#7c3aed">${m.resource.name}</td>
        <td class="left" style="color:#555">${m.resource.role || '—'}</td>
        <td><span class="miss">Not found</span></td>
        <td class="left" colspan="2" style="color:#9d174d">No SE Learning record matched</td>
      </tr>`]
    }
    const expiredCourses = INDUCTION_COURSES.filter(c => {
      const cs = m.match!.courses[c.key]
      return cs && cs.status !== 'na' && !cs.noExpiry && cs.expISO && cs.expISO < refDate
    })
    return expiredCourses.map(c => {
      const cs = m.match!.courses[c.key]
      const alreadyGone = cs.expISO! < today
      return `<tr class="row-exp">
        <td class="left" style="font-weight:700">${m.resource.name}</td>
        <td class="left" style="color:#555">${m.resource.role || '—'}</td>
        <td style="text-align:center"><span class="${alreadyGone ? 'exp' : 'warn'}">${alreadyGone ? 'EXPIRED' : 'EXPIRING'}</span></td>
        <td class="left">${SHORT[c.key]}</td>
        <td class="left" style="color:#991b1b">${cs.exp}</td>
      </tr>`
    })
  }).join('')

  // Full register — all courses
  const sepCols  = INDUCTION_COURSES.filter(c => SEP_SQP_KEYS.includes(c.key))
  const siteCols = INDUCTION_COURSES.filter(c => SITE_KEYS.includes(c.key))
  const hrwlCols = INDUCTION_COURSES.filter(c => HRWL_KEYS.includes(c.key))

  const fullHeaderCells = [
    `<th class="left" style="min-width:110px">Name</th>`,
    `<th class="left" style="min-width:72px">Role</th>`,
    `<th class="left" style="min-width:100px">Mob In → Out</th>`,
    ...sepCols.map((c, i) =>
      `<th${i === 0 ? ' class="sep-border-l"' : ''}${i === sepCols.length - 1 ? ' class="sep-border-r"' : ''}>${SHORT[c.key]}</th>`
    ),
    ...siteCols.map(c => `<th style="color:#94a3b8;background:#334155;">${SHORT[c.key]}</th>`),
    ...hrwlCols.map((c, i) =>
      `<th style="color:#fbbf24;background:#292524;"${i === 0 ? ' class="sep-border-l"' : ''}${i === hrwlCols.length - 1 ? ' class="sep-border-r"' : ''}>${SHORT[c.key]}</th>`
    ),
  ].join('')

  const fullBodyRows = rows.map(m => {
    const p = m.match
    const mobStr = `${m.resource.mob_in || '—'} → ${m.resource.mob_out || '—'}`
    if (!p) {
      return `<tr class="row-miss">
        <td class="left sep-border-l" style="font-weight:700;color:#7c3aed">${m.resource.name}</td>
        <td class="left" style="color:#9d174d">${m.resource.role || '—'}</td>
        <td class="left" style="color:#555">${mobStr}</td>
        <td colspan="${sepCols.length + siteCols.length + hrwlCols.length}" style="color:#9d174d">
          <span class="miss">NOT FOUND IN SYSTEM</span>
        </td>
      </tr>`
    }
    const hasExpired = INDUCTION_COURSES.some(c => { const cs = p.courses[c.key]; return cs && cs.status !== 'na' && !cs.noExpiry && cs.expISO && cs.expISO < refDate })
    const rowClass = hasExpired ? 'row-exp' : ''
    const sepCells = sepCols.map((c, i) => {
      const raw = cellHtml(p.courses[c.key], refDate, today)
      if (i === 0) return raw.replace('<td', '<td class="sep-border-l"')
      if (i === sepCols.length - 1) return raw.replace('<td', '<td class="sep-border-r"')
      return raw
    }).join('')
    const siteCells = siteCols.map(c => cellHtml(p.courses[c.key], refDate, today)).join('')
    const hrwlCells = hrwlCols.map((c, i) => {
      const raw = cellHtml(p.courses[c.key], refDate, today)
      if (i === 0) return raw.replace('<td', '<td class="sep-border-l"')
      if (i === hrwlCols.length - 1) return raw.replace('<td', '<td class="sep-border-r"')
      return raw
    }).join('')
    return `<tr class="${rowClass}">
      <td class="left" style="font-weight:700">${m.resource.name}${m.score < 1 ? `<span style="font-size:6.5pt;color:#b45309;margin-left:3px">≈ ${p.name}</span>` : ''}</td>
      <td class="left" style="color:#555">${m.resource.role || '—'}</td>
      <td class="left" style="color:#555;white-space:nowrap">${mobStr}</td>
      ${sepCells}${siteCells}${hrwlCells}
    </tr>`
  }).join('')

  // Already-expired compact list: any cert where expISO < today
  const alreadyExpiredLines = rows.flatMap(m => {
    if (!m.match) return []
    const expCourses = INDUCTION_COURSES
      .filter(c => { const cs = m.match!.courses[c.key]; return cs && cs.status !== 'na' && !cs.noExpiry && cs.expISO && cs.expISO < today })
      .map(c => `${SHORT[c.key]} (${m.match!.courses[c.key]?.exp})`)
    return expCourses.length ? [`${m.resource.name} — ${expCourses.join(', ')}`] : []
  })

  // Not-found compact list
  const notFoundLines = rows.filter(m => !m.match).map(m => m.resource.name)

  const alreadyExpiredHtml = alreadyExpiredLines.length > 0
    ? `<div class="alert alert-red"><strong>🚫 Already expired — must not be on site</strong>${alreadyExpiredLines.join('<br>')}</div>`
    : ''

  const expiringOnSiteHtml = expiringOnSite.length > 0
    ? `<div class="alert"><strong>⚠ Expiring before mob-out — action required</strong>${expiringOnSite.map(w => `${w.name} (off site ${w.mobOut}) — ${w.courses.join(', ')}`).join('<br>')}</div>`
    : ''

  const notFoundHtml = notFoundLines.length > 0
    ? `<div class="alert alert-purple"><strong>❓ Not found in SE Learning system</strong>${notFoundLines.join('<br>')}</div>`
    : ''

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <title>HSE Induction Compliance Report — ${projectName}</title>
  <style>${printCss()}
    .alert-red{background:#fff5f5;border-left-color:#dc2626;color:#7f1d1d;}
    .alert-red strong{color:#7f1d1d;}
    .alert-purple{background:#fdf4ff;border-left-color:#9333ea;color:#581c87;}
    .alert-purple strong{color:#581c87;}
    .two-col{display:flex;gap:12px;}
    .two-col>div{flex:1;}
  </style>
  </head><body>
  <div class="page-header">
    <h1>HSE Induction Compliance Report</h1>
    <div class="meta">${projectName} · Printed ${new Date().toLocaleDateString('en-AU')} · Ref date ${refDate}</div>
  </div>
  <div class="kpi-strip">
    <div class="kpi"><div class="kpi-val green">${kpis.allValid}</div><div class="kpi-lbl">All valid</div></div>
    <div class="kpi"><div class="kpi-val red">${kpis.someExpired}</div><div class="kpi-lbl">Expired</div></div>
    <div class="kpi"><div class="kpi-val amber">${expiringOnSite.length}</div><div class="kpi-lbl">Expiring on-site</div></div>
    <div class="kpi"><div class="kpi-val gray">${kpis.notFound}</div><div class="kpi-lbl">Not in system</div></div>
  </div>
  ${alreadyExpiredHtml}
  <div class="two-col">
    <div>${expiringOnSiteHtml}</div>
    <div>${notFoundHtml}</div>
  </div>
  <div class="section-head">Action required — all issues</div>
  <table class="no-break"><thead><tr>
    <th class="left">Name</th><th class="left">Role</th><th>Status</th><th class="left">Course</th><th class="left">Expiry date</th>
  </tr></thead><tbody>${actionTableRows || '<tr><td colspan="5" style="text-align:center;color:#166534;padding:8px;">✓ No issues — all personnel current at ref date</td></tr>'}</tbody></table>
  <div class="page-break"></div>
  <div class="page-header">
    <h1>Full Induction Register</h1>
    <div class="meta">${projectName} · Ref date ${refDate} · ${rows.length} resources</div>
  </div>
  <table><thead><tr>${fullHeaderCells}</tr></thead><tbody>${fullBodyRows}</tbody></table>
  <div class="legend">
    <span><span class="ok">VALID</span> Current</span>
    <span><span class="warn">EXPIRING</span> Expires before mob-out</span>
    <span><span class="exp">EXPIRED</span> Already expired</span>
    <span><span class="miss">NOT FOUND</span> No SE Learning record</span>
    <span style="margin-left:auto;font-style:italic;">SEP/SQP columns bordered · site certs shaded</span>
  </div>
  </body></html>`
}

function openPrint(html: string, landscape = false) {
  const w = window.open('', '_blank')
  if (!w) { alert('Allow popups to print'); return }
  if (landscape) {
    // inject landscape page rule before closing </style>
    const withLandscape = html.replace('@media print{', '@media print{@page{size:A4 landscape;margin:10mm 8mm;}')
    w.document.write(withLandscape)
  } else {
    w.document.write(html)
  }
  w.document.close()
  w.focus()
  setTimeout(() => { w.print(); w.close() }, 400)
}

// ── Course definitions ─────────────────────────────────────────────────────

// labels must match substrings of the SE Learning export column headers (case-insensitive)
// Preferred keywords are listed first; the first match wins. Hardcoded col fallbacks removed.
const INDUCTION_COURSES: { key: string; labels: string[]; shortLabel: string; isLesson?: boolean }[] = [
  // ── Siemens passports (SEP / SQP) ──────────────────────────────────────────
  { key: 'sep_trades',      labels: ['SIEMENS ENERGY PASSPORT (TRADES)'],                                       shortLabel: 'SEP\nTrades'    },
  { key: 'sep_project',     labels: ['SIEMENS ENERGY PASSPORT (PROJECT PERSONNEL)'],                            shortLabel: 'SEP\nProject'   },
  { key: 'sep_contractors', labels: ['SIEMENS ENERGY PASSPORT (CONTRACTORS)'],                                  shortLabel: 'SEP\nContract'  },
  { key: 'sqp_gt',          labels: ['SIEMENS QUALITY PASSPORT (GT PROJECT PERSONNEL)'],                        shortLabel: 'SQP\nGT'        },
  { key: 'sqp_gt_contr',    labels: ['SIEMENS QUALITY PASSPORT (GT CONTRACTORS)'],                              shortLabel: 'SQP\nGT Contr.' },
  { key: 'sqp_project',     labels: ['SIEMENS QUALITY PASSPORT (PROJECT PERSONNEL)'],                           shortLabel: 'SQP\nProject'   },
  { key: 'sqp_trades',      labels: ['SIEMENS QUALITY PASSPORT (TRADES)'],                                      shortLabel: 'SQP\nTrades'    },
  { key: 'sqp_contractors', labels: ['SIEMENS QUALITY PASSPORT (CONTRACTORS)'],                                 shortLabel: 'SQP\nContr'     },
  // ── Site-specific tool / procedural certs ──────────────────────────────────
  { key: 'hydraulic',       labels: ['HYDRAULIC TENSIONING'],                                                   shortLabel: 'Hydraulic'      },
  { key: 'rad_torque',      labels: ['RAD TORQUE SAFETY'],                                                      shortLabel: 'Rad\nTorque'    },
  // Prefer the Siemens-specific confined space column over the generic one
  { key: 'confined_space',  labels: ['CONFINED SPACE AWARENESS (SIEMENS ENERGY)', 'CONFINED SPACE AWARENESS'], shortLabel: 'Confined\nSp'   },
  { key: 'hytorc',          labels: ['HYTORC STEALTH'],                                                         shortLabel: 'Hytorc'         },
  { key: 'grinder',         labels: ['GRINDER SAFETY'],                                                         shortLabel: 'Grinder'        },
  // ── High-risk work licences (SE Qualification Uploads — lessons file) ──────
  { key: 'white_card',    labels: ['WHITE CARD (NO EXPIRY)', 'WHITE CARD'],                                    shortLabel: 'White\nCard',    isLesson: true },
  { key: 'cs_licence',    labels: ['CONFINED SPACE (REFRESH EVERY 2 YEARS)', 'CONFINED SPACE RESCUE'],         shortLabel: 'CS\nLicence',    isLesson: true },
  { key: 'gas_test',      labels: ['GAS TEST ATMOSPHERE'],                                                     shortLabel: 'Gas Test\nAtm.', isLesson: true },
  { key: 'work_permit',   labels: ['ISSUE WORK PERMIT'],                                                       shortLabel: 'Issue\nPermit',  isLesson: true },
  { key: 'breathing_app', labels: ['OPERATE BREATHING APPARATUS'],                                             shortLabel: 'Breathing\nApp', isLesson: true },
  { key: 'cs_rescue',     labels: ['CONFINED SPACE RESCUE'],                                                   shortLabel: 'CS\nRescue',     isLesson: true },
  { key: 'wah_licence',   labels: ['WORKING AT HEIGHT (REFRESH EVERY 2 YRS)', 'WORKING AT HEIGHT'],            shortLabel: 'WAH\nLicence',   isLesson: true },
]

// ── Types ──────────────────────────────────────────────────────────────────

interface CourseStatus { status: 'valid' | 'expired' | 'na'; pass?: string; exp?: string; expISO?: string; noExpiry?: boolean }
interface InductionPerson { name: string; courses: Record<string, CourseStatus>; company?: string; role?: string }
interface Resource { id: string; name: string; role?: string; mob_in?: string; mob_out?: string; company?: string }

// ── Helpers ────────────────────────────────────────────────────────────────

function normName(s: string) { return s.toLowerCase().replace(/[^a-z]/g, '') }
function nameSimilarity(a: string, b: string): number {
  const na = normName(a), nb = normName(b)
  if (na === nb) return 1
  const ta = a.trim().split(/\s+/), tb = b.trim().split(/\s+/)
  if (ta.length >= 2 && tb.length >= 2) {
    const fm = normName(ta[0]) === normName(tb[0])
    const lm = normName(ta[ta.length-1]) === normName(tb[tb.length-1])
    if (fm && lm) return 0.95
    if (fm || lm) return 0.6
  }
  return 0
}

function toISO(s: string): string | null {
  if (!s) return null
  const p = s.trim().split('-')
  if (p.length !== 3) return null
  return `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`
}

function parseCourseVal(val: unknown, today: string): CourseStatus {
  const str = val ? String(val).trim() : ''
  if (!str || str === 'N/A') return { status: 'na' }
  const m = str.match(/Pass:\s*([\d-]+)\s*\/\s*Exp:\s*([\d-]+|N\/A)/i)
  if (!m) return { status: 'na' }
  const expRaw = m[2].trim().toUpperCase()
  if (expRaw === 'N/A') return { status: 'valid', pass: m[1], exp: 'No expiry', expISO: '9999-12-31', noExpiry: true }
  const expISO = toISO(m[2])
  if (!expISO) return { status: 'na' }
  return { status: expISO < today ? 'expired' : 'valid', pass: m[1], exp: m[2], expISO }
}

function parseLessonVal(val: unknown, today: string): CourseStatus {
  const str = val ? String(val).trim() : ''
  if (!str) return { status: 'na' }
  // "Does Not Expiry" or bogus far-future dates (year < 100 or > 2100) → no expiry
  if (/does not expir/i.test(str)) return { status: 'valid', exp: 'No expiry', expISO: '9999-12-31', noExpiry: true }
  const m = str.match(/Exp:\s*([\d-]+)/i)
  if (!m) return { status: 'na' }
  const expISO = toISO(m[1])
  if (!expISO) return { status: 'na' }
  // Treat bogus years (0001–1900 or 9000+) as no-expiry
  const year = parseInt(expISO.slice(0, 4), 10)
  if (year < 1900 || year > 2200) return { status: 'valid', exp: 'No expiry', expISO: '9999-12-31', noExpiry: true }
  return { status: expISO < today ? 'expired' : 'valid', exp: m[1], expISO }
}

// ── Global register write ─────────────────────────────────────────────────
// Called after every PM upload as a silent side-effect.
// Also called directly from ResourceManagerInductionsPanel.
// Upserts into induction_courses (courses file) or induction_lessons (lessons file).
// Unique key: LOWER(person_name) + course_key — case-insensitive.
export async function writeToGlobalRegister(
  people: { name: string; courses: Record<string, { status: string; expISO?: string; noExpiry?: boolean }> }[],
  fileType: 'courses' | 'lessons',
  sourceProjectId?: string
): Promise<{ upserted: number; matched: number }> {
  const keyField = fileType === 'courses' ? 'course_key' : 'lesson_key'

  // Fetch persons for name matching (to populate person_id)
  const { data: personsData } = await supabase
    .from('persons')
    .select('id, full_name')
    .eq('active', true)

  // Build a simple name → id map (lowercase)
  const nameMap: Record<string, string> = {}
  for (const p of (personsData || [])) {
    nameMap[p.full_name.toLowerCase().trim()] = p.id
  }

  function matchPersonId(name: string): string | null {
    const lc = name.toLowerCase().trim()
    if (nameMap[lc]) return nameMap[lc]
    // Try last-first swap or partial match
    for (const [k, v] of Object.entries(nameMap)) {
      const ka = k.split(' '), na = lc.split(' ')
      if (ka.length >= 2 && na.length >= 2) {
        if (ka[0] === na[0] && ka[ka.length-1] === na[na.length-1]) return v
      }
    }
    return null
  }

  const rows: Record<string, unknown>[] = []
  for (const person of people) {
    const person_id = matchPersonId(person.name)
    for (const [courseKey, cs] of Object.entries(person.courses)) {
      if (cs.status === 'na') continue
      rows.push({
        person_name:       person.name.trim(),
        person_id,
        [keyField]:        courseKey,
        status:            cs.status,
        expiry_date:       cs.expISO && cs.expISO !== '9999-12-31' ? cs.expISO : null,
        uploaded_at:       new Date().toISOString(),
        source_project_id: sourceProjectId || null,
      })
    }
  }

  if (rows.length === 0) return { upserted: 0, matched: 0 }

  // Use RPC functions to upsert — Supabase JS client can't resolve expression indexes
  // (unique index is on lower(person_name) which onConflict string can't target)
  const rpcName = fileType === 'courses' ? 'upsert_induction_courses' : 'upsert_induction_lessons'
  const BATCH = 500
  let upserted = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    const { data, error } = await supabase.rpc(rpcName, { rows: batch })
    if (error) console.error(`Global register upsert error:`, error.message)
    else upserted += (data as number) ?? batch.length
  }

  const matched = rows.filter(r => r.person_id !== null).length
  return { upserted, matched }
}

export function InductionsPanel() {
  const isMobile = useIsMobile()
  if (isMobile) {
    return (
      <Suspense fallback={<div className="mobile-loading"><span className="spinner" /> Loading…</div>}>
        <InductionsMobile />
      </Suspense>
    )
  }
  return <InductionsPanelDesktop />
}

function InductionsPanelDesktop() {
  const { activeProject, setActiveProject } = useAppStore()
  const [resources, setResources]         = useState<Resource[]>([])
  const [inductionData, setInductionData] = useState<InductionPerson[]>([])
  const [lessonsData, setLessonsData]     = useState<InductionPerson[]>([])
  const [coursesFile, setCoursesFile]     = useState('')
  const [lessonsFile, setLessonsFile]     = useState('')
  const today = new Date().toISOString().slice(0,10)
  const [refDate, setRefDate] = useState(today)
  const [loading, setLoading] = useState(false)

  // Persist ref date per project in localStorage
  const refDateKey = activeProject ? `inductions_refdate_${activeProject.id}` : null
  function updateRefDate(d: string) {
    setRefDate(d)
    if (refDateKey) localStorage.setItem(refDateKey, d)
  }

  // Restore ref date when project changes
  useEffect(() => {
    if (!refDateKey) return
    const saved = localStorage.getItem(refDateKey)
    setRefDate(saved || today)
  }, [refDateKey])

  // Session cache: avoid re-fetching resources every time the panel is opened
  const resourceCache = useRef<Record<string, Resource[]>>({})

  useEffect(() => {
    if (!activeProject) return

    // Restore induction/lessons from activeProject (already in memory — instant)
    if (activeProject.induction_data?.length) {
      setInductionData(activeProject.induction_data as unknown as InductionPerson[])
      if (activeProject.induction_upload_time) {
        setCoursesFile(`Last uploaded: ${new Date(activeProject.induction_upload_time).toLocaleString('en-AU')}`)
      }
    } else {
      setInductionData([])
      setCoursesFile('')
    }
    if (activeProject.lessons_data?.length) {
      setLessonsData(activeProject.lessons_data as unknown as InductionPerson[])
      if (activeProject.lessons_upload_time) {
        setLessonsFile(`Last uploaded: ${new Date(activeProject.lessons_upload_time).toLocaleString('en-AU')}`)
      }
    } else {
      setLessonsData([])
      setLessonsFile('')
    }

    // Resources: use session cache if available, otherwise fetch once
    if (resourceCache.current[activeProject.id]) {
      setResources(resourceCache.current[activeProject.id])
    } else {
      setLoading(true)
      supabase.from('resources').select('id,name,role,mob_in,mob_out,company')
        .eq('project_id', activeProject.id)
        .then(({ data }) => {
          const r = data || []
          resourceCache.current[activeProject.id] = r
          setResources(r)
          setLoading(false)
        })
    }
  }, [activeProject?.id])

  // ── File parse ───────────────────────────────────────────────────────────

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>, fileType: 'courses' | 'lessons') {
    const file = e.target.files?.[0]; if (!file) return
    const buf = await file.arrayBuffer()
    try {
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][]
      if (rows.length < 2) { toast('No data in file', 'error'); return }

      const header = (rows[0] as string[]).map(h => String(h||'').toUpperCase().trim())
      const colFor = (...keywords: string[]) => {
        for (const kw of keywords) {
          const idx = header.findIndex(h => h.includes(kw.toUpperCase()))
          if (idx > -1) return idx
        }
        return -1
      }

      // Determine which courses to parse from this file
      const relevantCourses = fileType === 'lessons'
        ? INDUCTION_COURSES.filter(c => c.isLesson)
        : INDUCTION_COURSES.filter(c => !c.isLesson)

      const courseColMap: Record<string, number> = {}
      relevantCourses.forEach(c => { courseColMap[c.key] = colFor(...c.labels) })

      const people: InductionPerson[] = []
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i] as unknown[]
        const name = String(r[0]||'').trim()
        if (!name) continue
        const courses: Record<string, CourseStatus> = {}
        relevantCourses.forEach(c => {
          const colIdx = courseColMap[c.key]
          if (colIdx < 0) { courses[c.key] = { status: 'na' }; return }
          courses[c.key] = fileType === 'lessons'
            ? parseLessonVal(r[colIdx], today)
            : parseCourseVal(r[colIdx], today)
        })
        people.push({ name, courses, company: String(r[colFor('COMPANY')]||''), role: String(r[colFor('ROLE')]||'') })
      }

      const uploadTime = new Date().toISOString()

      if (fileType === 'courses') {
        setInductionData(people)
        setCoursesFile(file.name)
        supabase.from('projects')
          .update({ induction_data: people, induction_upload_time: uploadTime })
          .eq('id', activeProject!.id)
          .then(() => {
            if (activeProject) setActiveProject({ ...activeProject, induction_data: people as unknown as typeof activeProject.induction_data, induction_upload_time: uploadTime })
          })
      } else {
        setLessonsData(people)
        setLessonsFile(file.name)
        supabase.from('projects')
          .update({ lessons_data: people, lessons_upload_time: uploadTime })
          .eq('id', activeProject!.id)
          .then(() => {
            if (activeProject) setActiveProject({ ...activeProject, lessons_data: people as unknown as InductionPerson[], lessons_upload_time: uploadTime })
          })
      }

      // ── Write to global induction register (side-effect, non-blocking) ───────
      writeToGlobalRegister(people, fileType, activeProject!.id).catch(console.error)

      toast(`Loaded ${people.length} people from ${file.name}`, 'success')
    } catch {
      toast('Failed to parse file', 'error')
    }
    e.target.value = ''
  }

  // ── Matching — merge courses + lessons by name ────────────────────────────
  // Expensive O(resources × inductionData) — memoised, does NOT depend on refDate

  const matched = useMemo(() => {
    // Build merged dataset: courses base + lessons HRWL keys overlaid
    const mergedData: InductionPerson[] = inductionData.map(person => {
      let bestLesson: InductionPerson | null = null, bestScore = 0
      lessonsData.forEach(lp => {
        const s = nameSimilarity(person.name, lp.name)
        if (s > bestScore) { bestScore = s; bestLesson = lp }
      })
      if (!bestLesson || bestScore < 0.8) return person
      const mergedCourses = { ...person.courses }
      HRWL_KEYS.forEach(k => {
        const lc = (bestLesson as InductionPerson).courses[k]
        if (lc && lc.status !== 'na') mergedCourses[k] = lc
      })
      return { ...person, courses: mergedCourses }
    })

    const lessonsOnlyData: InductionPerson[] = lessonsData.filter(lp =>
      !inductionData.some(cp => nameSimilarity(cp.name, lp.name) >= 0.8)
    )
    const allInductionData = [...mergedData, ...lessonsOnlyData]

    return resources.map(r => {
      let best: InductionPerson | null = null, bestScore = 0
      allInductionData.forEach(p => {
        const s = nameSimilarity(r.name, p.name)
        if (s > bestScore) { bestScore = s; best = p }
      })
      return { resource: r, match: bestScore >= 0.8 ? best : null, score: bestScore }
    })
  }, [inductionData, lessonsData, resources])

  // allInductionData length for UI guards — derived cheaply from matched
  const hasInductionData = inductionData.length > 0 || lessonsData.length > 0

  // ── Status counting ───────────────────────────────────────────────────────

  const isExpiredAt = (c: CourseStatus, date: string) =>
    c.status !== 'na' && !c.noExpiry && c.expISO ? c.expISO < date : false

  let allValid = 0, someExpired = 0, notFound = 0
  const expiringOnSite: { name: string; mobOut: string; courses: string[] }[] = []

  matched.forEach(m => {
    if (!m.match) { notFound++; return }
    const p = m.match as InductionPerson
    const anyExpired = INDUCTION_COURSES.some(c => isExpiredAt(p.courses[c.key] || { status: 'na' }, refDate))
    if (anyExpired) someExpired++
    else allValid++
    if (m.resource.mob_out) {
      const expCourses = INDUCTION_COURSES.filter(c => {
        const cs = p.courses[c.key]
        return cs && cs.status !== 'na' && !cs.noExpiry && cs.expISO && cs.expISO >= today && cs.expISO < m.resource.mob_out!
      }).map(c => `${c.shortLabel.replace('\n',' ')} (${p.courses[c.key]?.exp})`)
      if (expCourses.length) expiringOnSite.push({ name: m.resource.name, mobOut: m.resource.mob_out, courses: expCourses })
    }
  })

  // ── Print handlers ────────────────────────────────────────────────────────

  function doPrint(type: 'wall' | 'report') {
    if (!activeProject || matched.length === 0) return
    const projectName = activeProject.name || 'Project'
    const kpis = { allValid, someExpired, notFound }
    const html = type === 'wall'
      ? buildWallSheet(matched, projectName, refDate, today, expiringOnSite, kpis)
      : buildHseReport(matched, projectName, refDate, today, expiringOnSite, kpis)
    openPrint(html, type === 'wall')
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const BADGE = {
    valid:   { background: 'rgba(16,185,129,.15)', color: '#059669' },
    expired: { background: 'rgba(239,68,68,.15)',  color: '#dc2626' },
    warning: { background: 'rgba(245,158,11,.15)', color: '#d97706' },
    na:      { background: 'transparent',           color: 'var(--text3)' },
  }

  return (
    <div style={{ padding: '24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h1 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>🎓 Inductions</h1>
            <HelpButton panelId="hr-inductions" />
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
            Match SE Learning induction export against project resources
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <label style={{ fontSize: '11px', color: 'var(--text3)' }}>Ref date</label>
            <input type="date" className="input" value={refDate} onChange={e => updateRefDate(e.target.value)}
              style={{ fontSize: '11px', width: '140px' }} />
          </div>
          {refDate !== today && (
            <button className="btn btn-xs btn-secondary" onClick={() => updateRefDate(today)}>Today</button>
          )}
          {hasInductionData && (<>
            <button className="btn btn-secondary" onClick={() => doPrint('wall')} title="Print wall/noticeboard sheet (landscape)">
              🖨 Wall Sheet
            </button>
            <button className="btn btn-secondary" onClick={() => doPrint('report')} title="Print full HSE officer compliance report">
              🖨 HSE Report
            </button>
          </>)}
          <label className="btn btn-secondary" style={{ cursor: 'pointer' }} title="SE Learning → Courses export (.xlsx)">
            📂 Courses
            <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={e => handleFile(e, 'courses')} />
          </label>
          <label className="btn btn-primary" style={{ cursor: 'pointer' }} title="SE Learning → Lessons export (.xlsx)">
            📂 Lessons
            <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={e => handleFile(e, 'lessons')} />
          </label>
        </div>
      </div>

      {/* File info */}
      {(coursesFile || lessonsFile) && (
        <div style={{ fontSize: '11px', color: 'var(--text3)', marginBottom: '12px', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          {coursesFile && <span>📋 Courses: {coursesFile} · {inductionData.length} people</span>}
          {lessonsFile && <span>🎓 Lessons: {lessonsFile} · {lessonsData.length} people</span>}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 24px', gap: '16px' }}>
          <div style={{
            width: '36px', height: '36px', borderRadius: '50%',
            border: '3px solid var(--border)', borderTopColor: 'var(--purple)',
            animation: 'spin 0.7s linear infinite',
          }} />
          <div style={{ fontSize: '13px', color: 'var(--text3)' }}>Loading resources…</div>
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      )}

      {/* KPIs */}
      {resources.length > 0 && hasInductionData && (
        <div className="kpi-grid" style={{ marginBottom: '16px' }}>
          <div className="kpi-card" style={{ borderTopColor: 'var(--green)' }}>
            <div className="kpi-val" style={{ color: 'var(--green)' }}>{allValid}</div>
            <div className="kpi-lbl">All Valid{refDate !== today ? ' at ref' : ''}</div>
          </div>
          <div className="kpi-card" style={{ borderTopColor: 'var(--red)' }}>
            <div className="kpi-val" style={{ color: 'var(--red)' }}>{someExpired}</div>
            <div className="kpi-lbl">Has Expired{refDate !== today ? ' at ref' : ''}</div>
          </div>
          <div className="kpi-card" style={{ borderTopColor: 'var(--amber)' }}>
            <div className="kpi-val" style={{ color: 'var(--amber)' }}>{notFound}</div>
            <div className="kpi-lbl">Not Found</div>
          </div>
          <div className="kpi-card" style={{ borderTopColor: 'var(--amber)' }}>
            <div className="kpi-val" style={{ color: 'var(--amber)' }}>{expiringOnSite.length}</div>
            <div className="kpi-lbl">Expiring On Site</div>
          </div>
        </div>
      )}

      {/* Expiring-on-site alert */}
      {expiringOnSite.length > 0 && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px' }}>
          <div style={{ fontWeight: 700, color: '#92400e', fontSize: '13px', marginBottom: '6px' }}>
            ⚠ {expiringOnSite.length} person{expiringOnSite.length !== 1 ? 's' : ''} have inductions expiring before mob-out
          </div>
          {expiringOnSite.map(w => (
            <div key={w.name} style={{ fontSize: '12px', color: '#78350f' }}>
              <strong>{w.name}</strong> (off site {w.mobOut}) — {w.courses.join(', ')}
            </div>
          ))}
        </div>
      )}

      {/* Empty states */}
      {!loading && resources.length === 0 && (
        <div className="empty-state"><div className="icon">👥</div><h3>No resources</h3><p>Add people to Resources first.</p></div>
      )}
      {!loading && resources.length > 0 && !hasInductionData && (
        <div className="empty-state"><div className="icon">📄</div><h3>No induction data</h3>
          <p>Load the Courses export and/or the Lessons export from SE Learning. Both files will be merged automatically.</p>
        </div>
      )}

      {/* Table */}
      {resources.length > 0 && hasInductionData && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
            <thead>
              <tr style={{ background: 'var(--bg3)' }}>
                <th style={{ textAlign: 'left', padding: '8px', position: 'sticky', left: 0, background: 'var(--bg3)', zIndex: 1, minWidth: '160px' }}>Name</th>
                <th style={{ textAlign: 'left', padding: '8px', minWidth: '100px' }}>Role</th>
                <th style={{ textAlign: 'left', padding: '8px', minWidth: '110px' }}>Mob In → Out</th>
                {INDUCTION_COURSES.map(c => (
                  <th key={c.key} style={{ textAlign: 'center', padding: '4px 6px', fontSize: '9px', fontWeight: 600, minWidth: '58px', whiteSpace: 'pre-line', lineHeight: '1.2' }}>
                    {c.shortLabel}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matched.map(m => {
                const p = m.match as InductionPerson | null
                const rowBg = !p ? '#fef2f2' : undefined
                return (
                  <tr key={m.resource.id} style={{ borderBottom: '1px solid var(--border)', background: rowBg }}>
                    <td style={{ padding: '6px 8px', fontWeight: 600, position: 'sticky', left: 0, background: rowBg || 'var(--bg)', zIndex: 1 }}>
                      {m.resource.name}
                      {p && m.score < 1 && (
                        <span style={{ fontSize: '9px', color: 'var(--amber)', marginLeft: '4px' }}>≈ {(p as InductionPerson).name}</span>
                      )}
                    </td>
                    <td style={{ padding: '6px 8px', color: 'var(--text3)', fontSize: '10px' }}>{m.resource.role || '—'}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--text3)', fontSize: '10px', whiteSpace: 'nowrap' }}>
                      {m.resource.mob_in || '—'} → {m.resource.mob_out || '—'}
                    </td>
                    {INDUCTION_COURSES.map(c => {
                      if (!p) return (
                        <td key={c.key} style={{ textAlign: 'center', padding: '4px' }}>
                          <span className="badge" style={{ fontSize: '9px', background: 'var(--bg3)', color: 'var(--text3)' }}>—</span>
                        </td>
                      )
                      const cs = (p as InductionPerson).courses[c.key] || { status: 'na' }
                      if (cs.status === 'na') return <td key={c.key} style={{ textAlign: 'center', padding: '4px', color: 'var(--text3)' }}>—</td>
                      const expired = isExpiredAt(cs, refDate)
                      const expiredToday = isExpiredAt(cs, today)
                      const style = expired ? (expiredToday ? BADGE.expired : BADGE.warning) : BADGE.valid
                      const label = expired ? (expiredToday ? 'EXPIRED' : 'EXPIRING') : 'VALID'
                      return (
                        <td key={c.key} style={{ textAlign: 'center', padding: '4px' }}>
                          <span className="badge" style={{ ...style, fontSize: '8px', display: 'block', lineHeight: '1.3' }}
                            title={`${label} — ${cs.noExpiry ? 'No expiry' : cs.exp}`}>
                            {label}<br />{cs.noExpiry ? '∞' : cs.exp}
                          </span>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
