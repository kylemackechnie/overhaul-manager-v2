/**
 * PayrollRulesPanel
 *
 * Admin-editable, globally-visible panel for payroll rules.
 * Rules are stored in payroll_rules (single row, id=1) and loaded into
 * the costEngine on app boot. Changes here take effect after the next
 * page reload (or immediately if the engine is re-seeded).
 *
 * Layout:
 *   1. Hour Rate Rules — matrix: situations × shift types
 *   2. Threshold Values — numeric band widths
 *   3. Allowance Behaviour — toggles / values
 *   4. Rate Band Reference — legend
 *   5. Audit info
 */

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { setPayrollRules } from '../../engines/costEngine'
import { toast } from '../../components/ui/Toast'
import type { PayrollRules } from '../../types'
import { PAYROLL_RULES_DEFAULTS } from '../../types'

// ── Labels ────────────────────────────────────────────────────────────────────

const BUCKET_LABELS: Record<string, string> = {
  dnt:   'NT',
  dt15:  'T1.5',
  ddt:   'DT (2×)',
  ddt15: 'DT1.5 (2.5×)',
  nnt:   'Night NT',
  ndt:   'Night DT',
  ndt15: 'Night DT1.5',
}

const BUCKET_COLORS: Record<string, string> = {
  dnt:   'var(--accent)',
  dt15:  'var(--orange, #f97316)',
  ddt:   'var(--red)',
  ddt15: '#9333ea',
  nnt:   '#8b5cf6',
  ndt:   '#8b5cf6',
  ndt15: '#9333ea',
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontWeight: 700, fontSize: '13px', borderBottom: '2px solid var(--accent)', paddingBottom: '6px', marginBottom: '14px', color: 'var(--accent)' }}>
      {children}
    </div>
  )
}

function BucketPill({ bucket }: { bucket: string }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
      background: `${BUCKET_COLORS[bucket] || 'var(--text3)'}22`,
      color: BUCKET_COLORS[bucket] || 'var(--text3)',
      border: `1px solid ${BUCKET_COLORS[bucket] || 'var(--border)'}55`,
    }}>
      {BUCKET_LABELS[bucket] ?? bucket}
    </span>
  )
}

function RuleSelect({ value, options, onChange, locked }: {
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
  locked?: boolean
}) {
  if (locked) {
    return <BucketPill bucket={value} />
  }
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{ fontSize: '11px', padding: '3px 6px', border: '1px solid var(--border)', borderRadius: '4px', background: 'var(--bg2)', color: 'var(--text)', cursor: 'pointer' }}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function RuleNum({ value, onChange, min, max, step, locked }: {
  value: number; onChange: (v: number) => void
  min?: number; max?: number; step?: number; locked?: boolean
}) {
  if (locked) return <span style={{ fontFamily: 'var(--mono)', fontSize: '12px' }}>{value}h</span>
  return (
    <input type="number" value={value} min={min ?? 0} max={max ?? 24} step={step ?? 0.1}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      style={{ width: '60px', fontSize: '11px', padding: '3px 6px', border: '1px solid var(--border)', borderRadius: '4px', background: 'var(--bg2)', color: 'var(--text)', fontFamily: 'var(--mono)', textAlign: 'right' }}
    />
  )
}

function InfoCell({ text }: { text: string }) {
  return <span style={{ fontSize: '11px', color: 'var(--text3)', fontStyle: 'italic' }}>{text}</span>
}

// ── Matrix row helpers ────────────────────────────────────────────────────────

function MatrixHeader({ cols }: { cols: string[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `200px repeat(${cols.length}, 1fr)`, gap: '0', marginBottom: '2px' }}>
      <div />
      {cols.map(c => (
        <div key={c} style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)', textAlign: 'center', padding: '4px 8px' }}>{c}</div>
      ))}
    </div>
  )
}

function MatrixRow({ label, sub, cols, style }: { label: string; sub?: string; cols: React.ReactNode[]; style?: React.CSSProperties }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `200px repeat(${cols.length}, 1fr)`, gap: '0', borderTop: '1px solid var(--border)', ...style }}>
      <div style={{ padding: '10px 8px 10px 0' }}>
        <div style={{ fontSize: '12px', fontWeight: 600 }}>{label}</div>
        {sub && <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '2px' }}>{sub}</div>}
      </div>
      {cols.map((c, i) => (
        <div key={i} style={{ padding: '10px 8px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderLeft: '1px solid var(--border)' }}>
          {c}
        </div>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function PayrollRulesPanel() {
  const { currentUser } = useAppStore()
  const isAdmin = currentUser?.role === 'admin'

  const [rules, setRules] = useState<PayrollRules>({ ...PAYROLL_RULES_DEFAULTS })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [meta, setMeta] = useState<{ updated_at: string; updated_by: string } | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('payroll_rules').select('rules,updated_at,updated_by').eq('id', 1).single()
    if (data) {
      setRules({ ...PAYROLL_RULES_DEFAULTS, ...(data.rules as Partial<PayrollRules>) })
      if (data.updated_at) setMeta({ updated_at: data.updated_at, updated_by: data.updated_by || 'Unknown' })
    }
    setLoading(false)
  }

  function update<K extends keyof PayrollRules>(key: K, value: PayrollRules[K]) {
    setRules(r => ({ ...r, [key]: value }))
    setDirty(true)
  }

  async function save() {
    setSaving(true)
    const { error } = await supabase.from('payroll_rules').upsert({
      id: 1,
      rules,
      updated_at: new Date().toISOString(),
      updated_by: currentUser?.name || currentUser?.email || 'Unknown',
    })
    setSaving(false)
    if (error) { toast('Failed to save: ' + error.message, 'error'); return }
    setPayrollRules(rules)
    setDirty(false)
    setMeta({ updated_at: new Date().toISOString(), updated_by: currentUser?.name || currentUser?.email || 'Unknown' })
    toast('Payroll rules saved', 'success')
  }

  function reset() {
    setRules({ ...PAYROLL_RULES_DEFAULTS })
    setDirty(true)
  }

  const locked = !isAdmin

  const dayOpts    = (opts: [string, string][]) => opts.map(([v, l]) => ({ value: v, label: l }))
  const bucketOpt  = (b: string) => ({ value: b, label: BUCKET_LABELS[b] ?? b })

  if (loading) return <div className="loading-center"><span className="spinner" /></div>

  return (
    <div style={{ padding: '24px', maxWidth: '900px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '4px' }}>Payroll Rules</h1>
          <div style={{ fontSize: '12px', color: 'var(--text3)' }}>
            Global rules applied to all hour-rate calculations across every project.
            {!isAdmin && ' View only — admin access required to edit.'}
          </div>
        </div>
        {isAdmin && (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {dirty && <span style={{ fontSize: '11px', color: 'var(--amber)' }}>● Unsaved changes</span>}
            <button className="btn btn-sm" onClick={reset}>Reset to defaults</button>
            <button className="btn btn-sm" style={{ background: dirty ? 'var(--accent)' : undefined, color: dirty ? '#fff' : undefined }}
              onClick={save} disabled={saving || !dirty}>
              {saving ? 'Saving…' : 'Save Rules'}
            </button>
          </div>
        )}
      </div>

      {/* ── 1. Hour Rate Rules ─────────────────────────────────────────── */}
      <div className="card" style={{ padding: '20px', marginBottom: '16px' }}>
        <SectionTitle>Hour Rate Rules — Trades & Subcontractors</SectionTitle>

        <MatrixHeader cols={['Day Shift', 'Night Shift']} />

        <MatrixRow label="Weekday" sub={`First ${rules.wd_nt_hours}h NT → next ${rules.wd_t15_hours}h T1.5 → DT`}
          cols={[
            <InfoCell text="NT → T1.5 → DT (thresholds below)" />,
            <InfoCell text="NNT → NDT (threshold below)" />,
          ]} />

        <MatrixRow label="Saturday" sub={`First ${rules.sat_t15_hours}h T1.5, then DT`}
          cols={[
            <InfoCell text="T1.5 → DT (threshold below)" />,
            <BucketPill bucket="ndt" />,
          ]} />

        <MatrixRow label="Sunday" cols={[
          <RuleSelect value={rules.sunday_rate} locked={locked}
            options={dayOpts([['ddt', 'DT (2×)'], ['ddt15', 'DT1.5 (2.5×)'], ['dt15', 'T1.5']])}
            onChange={v => update('sunday_rate', v as PayrollRules['sunday_rate'])} />,
          <RuleSelect value={rules.night_sat_sun_rate} locked={locked}
            options={dayOpts([['ndt', 'Night DT'], ['ndt15', 'Night DT1.5']])}
            onChange={v => update('night_sat_sun_rate', v as PayrollRules['night_sat_sun_rate'])} />,
        ]} />

        <MatrixRow label="Public Holiday" cols={[
          <RuleSelect value={rules.ph_rate} locked={locked}
            options={dayOpts([['ddt15', 'DT1.5 (2.5×)'], ['ddt', 'DT (2×)'], ['dt15', 'T1.5']])}
            onChange={v => update('ph_rate', v as PayrollRules['ph_rate'])} />,
          <RuleSelect value={rules.night_ph_rate} locked={locked}
            options={dayOpts([['ndt15', 'Night DT1.5'], ['ndt', 'Night DT']])}
            onChange={v => update('night_ph_rate', v as PayrollRules['night_ph_rate'])} />,
        ]} />

        <MatrixRow label="Rest / Fatigue" sub="Capped at rest threshold"
          cols={[
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <RuleSelect value={rules.rest_rate} locked={locked}
                options={[bucketOpt('dnt'), bucketOpt('dt15')]}
                onChange={v => update('rest_rate', v as PayrollRules['rest_rate'])} />
              <span style={{ fontSize: '11px', color: 'var(--text3)' }}>cap</span>
              <RuleNum value={rules.rest_nt_hours} locked={locked} min={0} max={24} step={0.1}
                onChange={v => update('rest_nt_hours', v)} />
            </div>,
            <InfoCell text="Night NT (same cap)" />,
          ]} />

        <MatrixRow label="Direct Travel" sub="Weekday" cols={[
          <RuleSelect value={rules.travel_weekday_rate} locked={locked}
            options={[bucketOpt('dnt'), bucketOpt('dt15')]}
            onChange={v => update('travel_weekday_rate', v as PayrollRules['travel_weekday_rate'])} />,
          <InfoCell text="Same as day shift" />,
        ]} />

        <MatrixRow label="Direct Travel" sub="Sunday" cols={[
          <RuleSelect value={rules.travel_sunday_rate} locked={locked}
            options={dayOpts([['dt15', 'T1.5'], ['ddt', 'DT (2×)'], ['dnt', 'NT']])}
            onChange={v => update('travel_sunday_rate', v as PayrollRules['travel_sunday_rate'])} />,
          <InfoCell text="Same as day shift" />,
        ]} />

        <MatrixRow label="Direct Travel" sub="Public Holiday" cols={[
          <RuleSelect value={rules.travel_ph_rate} locked={locked}
            options={dayOpts([['dt15', 'T1.5'], ['ddt15', 'DT1.5 (2.5×)'], ['dnt', 'NT']])}
            onChange={v => update('travel_ph_rate', v as PayrollRules['travel_ph_rate'])} />,
          <InfoCell text="Same as day shift" />,
        ]} />

        <MatrixRow label="SEA Travel" sub="Weekday / Sun / PH" cols={[
          <InfoCell text="Same rates as Direct Travel — no allowance paid" />,
          <InfoCell text="Same as day shift" />,
        ]} />

        <MatrixRow label="Mob / Demob" sub="Weekday" cols={[
          <RuleSelect value={rules.mob_weekday_rate} locked={locked}
            options={[bucketOpt('dnt'), bucketOpt('dt15')]}
            onChange={v => update('mob_weekday_rate', v as PayrollRules['mob_weekday_rate'])} />,
          <InfoCell text="Same as day shift" />,
        ]} />

        <MatrixRow label="Mob / Demob" sub="Sunday" cols={[
          <RuleSelect value={rules.mob_sunday_rate} locked={locked}
            options={dayOpts([['dt15', 'T1.5'], ['ddt', 'DT (2×)'], ['dnt', 'NT']])}
            onChange={v => update('mob_sunday_rate', v as PayrollRules['mob_sunday_rate'])} />,
          <InfoCell text="Same as day shift" />,
        ]} />

        <MatrixRow label="Mob / Demob" sub="Public Holiday" cols={[
          <RuleSelect value={rules.mob_ph_rate} locked={locked}
            options={dayOpts([['dt15', 'T1.5'], ['ddt15', 'DT1.5 (2.5×)'], ['dnt', 'NT']])}
            onChange={v => update('mob_ph_rate', v as PayrollRules['mob_ph_rate'])} />,
          <InfoCell text="Same as day shift" />,
        ]} />
      </div>

      {/* ── 2. SE AG (informational) ────────────────────────────────────── */}
      <div className="card" style={{ padding: '20px', marginBottom: '16px' }}>
        <SectionTitle>SE AG Contracted Rates</SectionTitle>
        <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '12px' }}>
          SE AG personnel are billed at contracted day rates, not EBA penalty rates. These are configured per rate card and are not governed by the rules above.
        </div>
        <MatrixHeader cols={['Day / Night (same)', 'Note']} />
        {[
          ['Mon–Fri (first 8h)', 'NT bucket (dnt)', 'Contracted rate'],
          ['Mon–Fri (extra hours)', 'T1.5 bucket (dt15)', 'No DT band'],
          ['Saturday (all hours)', 'DT bucket (ddt)', 'Contracted 2T rate'],
          ['Sunday & Public Holiday', 'DT1.5 bucket (ddt15)', 'Contracted 2.5T rate'],
        ].map(([label, rate, note]) => (
          <div key={label} style={{ display: 'grid', gridTemplateColumns: '200px 1fr 1fr', borderTop: '1px solid var(--border)', padding: '8px 0' }}>
            <div style={{ fontSize: '12px', fontWeight: 600 }}>{label}</div>
            <div style={{ padding: '0 8px', borderLeft: '1px solid var(--border)', fontSize: '11px', fontFamily: 'var(--mono)', color: 'var(--text2)' }}>{rate}</div>
            <div style={{ padding: '0 8px', borderLeft: '1px solid var(--border)', fontSize: '11px', color: 'var(--text3)' }}>{note}</div>
          </div>
        ))}
      </div>

      {/* ── 3. Threshold Values ─────────────────────────────────────────── */}
      <div className="card" style={{ padding: '20px', marginBottom: '16px' }}>
        <SectionTitle>Band Thresholds</SectionTitle>
        <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '14px' }}>
          Default thresholds used when a rate card does not specify its own regime. Rate-card-level overrides always take precedence.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          {([
            ['wd_nt_hours',   'Weekday NT band',         'Hours at NT rate before T1.5 starts'],
            ['wd_t15_hours',  'Weekday T1.5 band',       'Hours at T1.5 before DT starts (0 = skip to DT)'],
            ['sat_t15_hours', 'Saturday T1.5 band',      'Hours at T1.5 before DT starts (0 = all DT)'],
            ['night_nt_hours','Night shift NT band',      'Hours at Night NT before Night DT starts'],
          ] as [keyof PayrollRules, string, string][]).map(([key, label, desc]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'var(--bg3)', borderRadius: '6px' }}>
              <div>
                <div style={{ fontSize: '12px', fontWeight: 600 }}>{label}</div>
                <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '2px' }}>{desc}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <RuleNum value={rules[key] as number} locked={locked} min={0} max={24} step={0.1}
                  onChange={v => update(key, v as never)} />
                {!locked && <span style={{ fontSize: '10px', color: 'var(--text3)' }}>h</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 4. Allowance Behaviour ─────────────────────────────────────── */}
      <div className="card" style={{ padding: '20px', marginBottom: '16px' }}>
        <SectionTitle>Allowance Behaviour</SectionTitle>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'var(--bg3)', borderRadius: '6px' }}>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600 }}>EBA Meal Break Adjustment</div>
              <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '2px' }}>Added to effective hours for cost/sell calculation only — not payroll. Trades & Subcon only.</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <RuleNum value={rules.meal_break_adj_hours} locked={locked} min={0} max={2} step={0.25}
                onChange={v => update('meal_break_adj_hours', v)} />
              {!locked && <span style={{ fontSize: '10px', color: 'var(--text3)' }}>h per worked day</span>}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'var(--bg3)', borderRadius: '6px' }}>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600 }}>Management LAHA treated as FSA</div>
              <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '2px' }}>When LAHA is ticked for a management/SE AG person, apply the FSA rate instead.</div>
            </div>
            {locked
              ? <BucketPill bucket={rules.mgmt_laha_uses_fsa ? 'dnt' : 'ddt'} />
              : <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={rules.mgmt_laha_uses_fsa}
                    onChange={e => update('mgmt_laha_uses_fsa', e.target.checked)}
                    style={{ accentColor: 'var(--accent)', width: '14px', height: '14px' }} />
                  <span style={{ fontSize: '11px' }}>{rules.mgmt_laha_uses_fsa ? 'Enabled' : 'Disabled'}</span>
                </label>
            }
          </div>

          {[
            ['Direct Travel', 'Auto-ticks the Travel Allowance checkbox when day type is set to Direct Travel.', true],
            ['SEA Travel', 'Never pays travel allowance — SEA books and pays travel directly.', false],
          ].map(([label, desc, value]) => (
            <div key={label as string} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'var(--bg3)', borderRadius: '6px', opacity: 0.8 }}>
              <div>
                <div style={{ fontSize: '12px', fontWeight: 600 }}>{label as string} — Travel Allowance</div>
                <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '2px' }}>{desc as string}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '10px', color: 'var(--text3)', fontStyle: 'italic' }}>🔒 Fixed rule</span>
                <span style={{ fontSize: '11px', fontWeight: 600, color: value ? 'var(--green)' : 'var(--red)' }}>{value ? 'On' : 'Off'}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 5. Rate Band Reference ──────────────────────────────────────── */}
      <div className="card" style={{ padding: '20px', marginBottom: '16px' }}>
        <SectionTitle>Rate Band Reference</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' }}>
          {(Object.entries(BUCKET_LABELS) as [string, string][]).map(([key, label]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'var(--bg3)', borderRadius: '6px', borderLeft: `3px solid ${BUCKET_COLORS[key] || 'var(--border)'}` }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', fontWeight: 700, color: BUCKET_COLORS[key] }}>{key}</span>
              <span style={{ fontSize: '11px', color: 'var(--text2)' }}>{label}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: '10px', fontSize: '11px', color: 'var(--text3)' }}>
          Dollar amounts for each bucket are set per rate card in each project. These rules determine which bucket is used — the rate card determines what it costs.
        </div>
      </div>

      {/* ── Audit ───────────────────────────────────────────────────────── */}
      {meta && (
        <div style={{ fontSize: '11px', color: 'var(--text3)', textAlign: 'right' }}>
          Last modified by <strong>{meta.updated_by}</strong> on {new Date(meta.updated_at).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </div>
      )}

    </div>
  )
}
