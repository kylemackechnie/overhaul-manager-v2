import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

const fmt = (n: number, currency = '$') => n > 0 ? currency + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'
const fmtInt = (n: number) => n > 0 ? '$' + n.toLocaleString('en-AU', { maximumFractionDigits: 0 }) : '—'

interface Section {
  title: string; rows: { label: string; sub?: string; value: number; note?: string }[]
  total: number; currency?: string
}

export function CustomerReportPanel() {
  const { activeProject } = useAppStore()
  const [sections, setSections] = useState<Section[]>([])
  const [grandTotal, setGrandTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showGM, setShowGM] = useState(false)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id

    const [tsData, rcData, hireData, boData, seData, tcData, varData, expData] = await Promise.all([
      supabase.from('weekly_timesheets').select('type,regime,crew').eq('project_id', pid),
      supabase.from('rate_cards').select('role,rates,laha_sell,meal_sell,fsa_sell').eq('project_id', pid),
      supabase.from('hire_items').select('hire_type,name,customer_total,start_date,end_date').eq('project_id', pid),
      supabase.from('back_office_hours').select('name,role,hours,sell').eq('project_id', pid),
      supabase.from('se_support_costs').select('person,description,sell_price').eq('project_id', pid),
      supabase.from('tooling_costings').select('tv_no,sell_eur,charge_start,charge_end').eq('project_id', pid),
      supabase.from('variations').select('number,title,value,status').eq('project_id', pid).eq('status', 'approved'),
      supabase.from('expenses').select('description,category,sell_price').eq('project_id', pid),
    ])

    const rcs = (rcData.data || []) as { role: string; rates: { sell: Record<string, number> }; laha_sell: number; meal_sell: number; fsa_sell: number }[]
    const getRC = (role: string) => rcs.find(r => r.role.toLowerCase() === role.toLowerCase())

    // Labour sections
    const sheets = (tsData.data || []) as { type: string; regime: string; crew: { name: string; role: string; days: Record<string, { hours?: number; dayType?: string; shiftType?: string; laha?: boolean; meal?: boolean }> }[] }[]

    function calcSheets(type: string) {
      const filtered = sheets.filter(s => !type || s.type === type || (!s.type && type === 'trades'))
      const byPerson: Record<string, { hours: number; sell: number; allowances: number }> = {}
      for (const sheet of filtered) {
        for (const member of sheet.crew) {
          if (!byPerson[member.name]) byPerson[member.name] = { hours: 0, sell: 0, allowances: 0 }
          const rc = getRC(member.role)
          for (const [, d] of Object.entries(member.days || {})) {
            const h = d.hours || 0; if (!h) continue
            const dt = d.dayType || 'weekday'; const st = d.shiftType || 'day'
            // Simplified sell calc
            let rate = rc?.rates?.sell?.dnt || 0
            if (dt === 'saturday') rate = rc?.rates?.sell?.dt15 || rate * 1.5
            if (dt === 'sunday' || dt === 'public_holiday') rate = rc?.rates?.sell?.ddt || rate * 2
            if (st === 'night') rate = rc?.rates?.sell?.nnt || rate * 1.25
            byPerson[member.name].hours += h
            byPerson[member.name].sell += h * rate
            if (d.laha) byPerson[member.name].allowances += rc?.laha_sell || 0
            if (d.meal) byPerson[member.name].allowances += rc?.meal_sell || 0
          }
        }
      }
      return Object.entries(byPerson).map(([name, v]) => ({
        label: name, sub: `${v.hours.toFixed(1)}h${v.allowances > 0 ? ` + ${fmtInt(v.allowances)} allowances` : ''}`,
        value: v.sell + v.allowances
      }))
    }

    const tradesRows = calcSheets('trades')
    const mgmtRows = calcSheets('mgmt')
    const seagRows = calcSheets('seag')
    const subconRows = calcSheets('subcon')

    // Hire
    const hire = (hireData.data || []) as { hire_type: string; name: string; customer_total: number; start_date: string; end_date: string }[]
    const hireRows = hire.filter(h => h.customer_total > 0).map(h => ({
      label: h.name, sub: `${h.hire_type} hire · ${h.start_date || '?'} → ${h.end_date || '?'}`,
      value: h.customer_total
    }))

    // Back Office
    const bo = (boData.data || []) as { name: string; role: string; hours: number; sell: number }[]
    const boByPerson: Record<string, { hours: number; sell: number }> = {}
    for (const e of bo) {
      if (!boByPerson[e.name]) boByPerson[e.name] = { hours: 0, sell: 0 }
      boByPerson[e.name].hours += e.hours || 0
      boByPerson[e.name].sell += e.sell || 0
    }
    const boRows = Object.entries(boByPerson).filter(([, v]) => v.sell > 0).map(([name, v]) => ({
      label: name, sub: `${v.hours.toFixed(1)} back-office hours`, value: v.sell
    }))

    // SE Support
    const seRows = (seData.data || []).filter((e: { sell_price: number }) => e.sell_price > 0).map((e: { person: string; description: string; sell_price: number }) => ({
      label: e.person, sub: e.description, value: e.sell_price
    }))

    // Tooling (EUR)
    const tcRows = (tcData.data || []).filter((c: { sell_eur: number }) => c.sell_eur > 0).map((c: { tv_no: string; sell_eur: number; charge_start: string; charge_end: string }) => ({
      label: `TV${c.tv_no}`, sub: `${c.charge_start || '?'} → ${c.charge_end || '?'}`, value: c.sell_eur
    }))

    // Approved Variations
    const varRows = (varData.data || []).map((v: { number: string; title: string; value: number }) => ({
      label: `VN ${v.number}`, sub: v.title, value: v.value || 0
    }))

    // Expenses
    const expRows = (expData.data || []).filter((e: { sell_price: number }) => e.sell_price > 0).map((e: { description: string; category: string; sell_price: number }) => ({
      label: e.description || e.category, value: e.sell_price
    }))

    const buildSection = (title: string, rows: { label: string; sub?: string; value: number; note?: string }[], currency?: string): Section => ({
      title, rows, total: rows.reduce((s, r) => s + r.value, 0), currency
    })

    const builtSections: Section[] = [
      buildSection('Trades Labour', tradesRows),
      buildSection('Management Labour', mgmtRows),
      buildSection('SE AG Labour', seagRows, '€'),
      buildSection('Subcontractor Labour', subconRows),
      buildSection('Equipment Hire', hireRows),
      buildSection('Back Office Hours', boRows),
      buildSection('SE Support Costs', seRows),
      buildSection('Tooling Rental', tcRows, '€'),
      buildSection('Approved Variations', varRows),
      buildSection('Expenses', expRows),
    ].filter(s => s.total > 0)

    const gt = builtSections.filter(s => !s.currency || s.currency === '$').reduce((s, sec) => s + sec.total, 0)
    setSections(builtSections)
    setGrandTotal(gt)
    setLoading(false)
  }

  return (
    <div style={{ padding: '24px', maxWidth: '900px' }} id="customer-report-print">
      <div className="no-print" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>Customer Report</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
            {activeProject?.name} · Generated {new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
            <input type="checkbox" checked={showGM} onChange={e => setShowGM(e.target.checked)} />
            Show internal details
          </label>
          <button className="btn btn-sm" onClick={() => window.print()}>🖨 Print</button>
        </div>
      </div>

      {/* Report header */}
      <div style={{ padding: '16px 20px', background: 'var(--bg3)', borderRadius: '8px', marginBottom: '20px', border: '1px solid var(--border)' }}>
        <div style={{ fontWeight: 700, fontSize: '16px', marginBottom: '4px' }}>{activeProject?.name}</div>
        <div style={{ fontSize: '12px', color: 'var(--text3)', display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
          {activeProject?.unit && <span>Unit: {activeProject.unit}</span>}
          {activeProject?.client && <span>Client: {activeProject.client}</span>}
          {activeProject?.start_date && <span>Period: {activeProject.start_date} → {activeProject.end_date || 'ongoing'}</span>}
          {activeProject?.pm && <span>PM: {activeProject.pm}</span>}
        </div>
      </div>

      {loading ? <div className="loading-center"><span className="spinner" /></div>
      : sections.length === 0 ? (
        <div className="empty-state"><div className="icon">📊</div><h3>No billable data</h3><p>Add timesheets, hire items, or other costs to generate a customer report.</p></div>
      ) : (
        <>
          {sections.map(section => (
            <div key={section.title} style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', paddingBottom: '6px', borderBottom: '2px solid var(--border2)' }}>
                <div style={{ fontWeight: 700, fontSize: '14px' }}>{section.title}</div>
                <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--accent)' }}>
                  {fmt(section.total, section.currency || '$')}
                </div>
              </div>
              {showGM && (
                <table style={{ width: '100%', fontSize: '12px', marginBottom: '4px' }}>
                  <tbody>
                    {section.rows.map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '5px 8px' }}>
                          <div style={{ fontWeight: 500 }}>{row.label}</div>
                          {row.sub && <div style={{ fontSize: '10px', color: 'var(--text3)' }}>{row.sub}</div>}
                        </td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'var(--mono)' }}>
                          {fmt(row.value, section.currency || '$')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}

          {/* Grand total */}
          <div style={{ marginTop: '24px', padding: '16px 20px', background: 'var(--bg3)', borderRadius: '8px', border: '2px solid var(--accent)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '15px' }}>Total Charges (AUD)</div>
              {sections.some(s => s.currency === '€') && (
                <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>EUR sections shown separately above</div>
              )}
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '22px', fontWeight: 700, color: 'var(--accent)' }}>
              {fmt(grandTotal)}
            </div>
          </div>

          {sections.filter(s => s.currency === '€').length > 0 && (
            <div style={{ marginTop: '8px', padding: '12px 20px', background: 'var(--bg3)', borderRadius: '8px', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 600, fontSize: '13px' }}>Total Charges (EUR)</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '16px', fontWeight: 700, color: '#0891b2' }}>
                {fmt(sections.filter(s => s.currency === '€').reduce((s, sec) => s + sec.total, 0), '€')}
              </div>
            </div>
          )}

          <div style={{ marginTop: '12px', fontSize: '11px', color: 'var(--text3)', fontStyle: 'italic' }}>
            This report was generated from Overhaul Manager v2 on {new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' })} and reflects data as of the report date.
          </div>
        </>
      )}
    </div>
  )
}
