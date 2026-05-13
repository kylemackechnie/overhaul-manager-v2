/**
 * PersonProfileDrawer.tsx
 * Right-side drawer showing full person details with tabs:
 * Details | Inductions | Visas | Assets | Project History
 */
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { toast } from '../../components/ui/Toast'
import { usePermissions } from '../../lib/permissions'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PersonFull {
  id: string
  full_name: string
  legal_name: string | null
  preferred_name: string | null
  email: string | null
  phone: string | null
  gid: string | null
  default_role: string | null
  default_category: string | null
  status: string | null
  home_address: string | null
  induction_ehs_date: string | null
  induction_qual_date: string | null
  induction_notes: string | null
  medical_date: string | null
  medical_notes: string | null
  availability_notes: string | null
  notes: string | null
}

interface Visa {
  id: string
  country: string | null
  visa_type: string | null
  project_name: string | null
  from_date: string | null
  to_date: string | null
  current_status: string | null
}

interface Asset {
  id: string
  asset_type: string
  asset_number: string | null
  asset_status: string | null
  start_date: string | null
  first_project: string | null
  notes: string | null
}

interface Deployment {
  id: string
  mob_in: string | null
  mob_out: string | null
  role: string | null
  project: { id: string; name: string; client: string | null } | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

function inductionTrafficLight(date: string | null): 'green' | 'amber' | 'red' | 'none' {
  if (!date) return 'none'
  const d = new Date(date)
  const now = new Date()
  const diffMonths = (d.getFullYear() - now.getFullYear()) * 12 + d.getMonth() - now.getMonth()
  if (d < now) return 'red'
  if (diffMonths < 3) return 'amber'
  return 'green'
}

const LIGHT_COLORS = {
  green: 'bg-green-100 text-green-800',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-800',
  none: 'bg-slate-100 text-slate-500',
}

function Badge({ color, children }: { color: keyof typeof LIGHT_COLORS; children: React.ReactNode }) {
  return <span className={`text-xs px-2 py-0.5 rounded font-medium ${LIGHT_COLORS[color]}`}>{children}</span>
}

// ── Field editor ──────────────────────────────────────────────────────────────

function EditField({
  label, value, field, personId, onUpdated, type = 'text', options,
}: {
  label: string
  value: string | null
  field: string
  personId: string
  onUpdated: (field: string, value: string | null) => void
  type?: 'text' | 'date' | 'select' | 'textarea'
  options?: string[]
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value || '')
  const { canWrite } = usePermissions()

  async function save() {
    const val = draft.trim() || null
    const { error } = await supabase.from('persons').update({ [field]: val }).eq('id', personId)
    if (error) { toast('Save failed: ' + error.message, 'error'); return }
    onUpdated(field, val)
    setEditing(false)
    toast('Saved', 'success')
  }

  if (!canWrite('personnel')) {
    return (
      <div>
        <div className="text-xs text-slate-400 mb-0.5">{label}</div>
        <div className="text-sm">{value || <span className="text-slate-400 italic">—</span>}</div>
      </div>
    )
  }

  if (!editing) {
    return (
      <div className="group">
        <div className="text-xs text-slate-400 mb-0.5">{label}</div>
        <div
          className="text-sm cursor-pointer rounded px-1 -mx-1 group-hover:bg-slate-100 transition-colors"
          onClick={() => { setDraft(value || ''); setEditing(true) }}
        >
          {value || <span className="text-slate-400 italic">click to edit</span>}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="text-xs text-slate-400 mb-0.5">{label}</div>
      {type === 'select' && options ? (
        <select
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={save}
          className="text-sm border border-blue-400 rounded px-1 py-0.5 w-full"
        >
          <option value="">—</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : type === 'textarea' ? (
        <textarea
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          rows={3}
          className="text-sm border border-blue-400 rounded px-1 py-0.5 w-full resize-none"
          onBlur={save}
        />
      ) : (
        <input
          autoFocus
          type={type}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
          className="text-sm border border-blue-400 rounded px-1 py-0.5 w-full"
        />
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

type Tab = 'details' | 'inductions' | 'visas' | 'assets' | 'history'
const TABS: { id: Tab; label: string }[] = [
  { id: 'details', label: 'Details' },
  { id: 'inductions', label: 'Inductions' },
  { id: 'visas', label: 'Visas' },
  { id: 'assets', label: 'Assets' },
  { id: 'history', label: 'History' },
]

interface Props {
  personId: string
  onClose: () => void
  onNavigateToProject?: (projectId: string) => void
}

export function PersonProfileDrawer({ personId, onClose, onNavigateToProject }: Props) {
  const [person, setPerson] = useState<PersonFull | null>(null)
  const [visas, setVisas] = useState<Visa[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [deployments, setDeployments] = useState<Deployment[]>([])
  const [tab, setTab] = useState<Tab>('details')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      supabase.from('persons').select('*').eq('id', personId).single(),
      supabase.from('person_visas').select('*').eq('person_id', personId).order('from_date', { ascending: false }),
      supabase.from('person_assets').select('*').eq('person_id', personId),
      supabase.from('resources')
        .select('id,mob_in,mob_out,role,project:projects(id,name,client)')
        .eq('person_id', personId)
        .order('mob_in', { ascending: false }),
    ]).then(([p, v, a, d]) => {
      if (p.data) setPerson(p.data as PersonFull)
      setVisas((v.data || []) as Visa[])
      setAssets((a.data || []) as Asset[])
      setDeployments((d.data || []) as unknown as Deployment[])
      setLoading(false)
    })
  }, [personId])

  function handleUpdated(field: string, value: string | null) {
    setPerson(prev => prev ? { ...prev, [field]: value } : prev)
  }

  if (loading || !person) {
    return (
      <div className="fixed inset-y-0 right-0 w-[480px] bg-white shadow-2xl border-l border-slate-200 z-50 flex items-center justify-center">
        <div className="text-slate-400">Loading…</div>
      </div>
    )
  }

  const ehsLight = inductionTrafficLight(person.induction_ehs_date)
  const qualLight = inductionTrafficLight(person.induction_qual_date)
  const medLight = inductionTrafficLight(person.medical_date)

  return (
    <div className="fixed inset-y-0 right-0 w-[480px] bg-white shadow-2xl border-l border-slate-200 z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between p-4 border-b border-slate-200 bg-slate-50">
        <div>
          <div className="font-semibold text-slate-800 text-lg leading-tight">{person.full_name}</div>
          {person.legal_name && person.legal_name !== person.full_name && (
            <div className="text-xs text-slate-500 mt-0.5">Legal: {person.legal_name}</div>
          )}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {person.default_role && <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">{person.default_role}</span>}
            {person.default_category && <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded capitalize">{person.default_category}</span>}
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${person.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
              {person.status || 'active'}
            </span>
          </div>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none p-1">✕</button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 bg-white px-2">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
            {t.id === 'visas' && visas.length > 0 && (
              <span className="ml-1 bg-blue-100 text-blue-700 text-xs px-1 rounded">{visas.length}</span>
            )}
            {t.id === 'assets' && assets.length > 0 && (
              <span className="ml-1 bg-slate-100 text-slate-600 text-xs px-1 rounded">{assets.length}</span>
            )}
            {t.id === 'history' && deployments.length > 0 && (
              <span className="ml-1 bg-slate-100 text-slate-600 text-xs px-1 rounded">{deployments.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* ── DETAILS ── */}
        {tab === 'details' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <EditField label="Full Name" value={person.full_name} field="full_name" personId={personId} onUpdated={handleUpdated} />
              <EditField label="Legal Name" value={person.legal_name} field="legal_name" personId={personId} onUpdated={handleUpdated} />
              <EditField label="Preferred Name" value={person.preferred_name} field="preferred_name" personId={personId} onUpdated={handleUpdated} />
              <EditField label="GID" value={person.gid} field="gid" personId={personId} onUpdated={handleUpdated} />
              <EditField label="Email" value={person.email} field="email" personId={personId} onUpdated={handleUpdated} />
              <EditField label="Phone" value={person.phone} field="phone" personId={personId} onUpdated={handleUpdated} />
              <EditField label="Default Role" value={person.default_role} field="default_role" personId={personId} onUpdated={handleUpdated} />
              <EditField
                label="Category"
                value={person.default_category}
                field="default_category"
                personId={personId}
                onUpdated={handleUpdated}
                type="select"
                options={['trades', 'management', 'seag', 'subcontractor']}
              />
              <EditField
                label="Status"
                value={person.status}
                field="status"
                personId={personId}
                onUpdated={handleUpdated}
                type="select"
                options={['active', 'inactive']}
              />
            </div>
            <EditField label="Home Address" value={person.home_address} field="home_address" personId={personId} onUpdated={handleUpdated} type="textarea" />
            <EditField label="Availability Notes" value={person.availability_notes} field="availability_notes" personId={personId} onUpdated={handleUpdated} type="textarea" />
            <EditField label="General Notes" value={person.notes} field="notes" personId={personId} onUpdated={handleUpdated} type="textarea" />
          </div>
        )}

        {/* ── INDUCTIONS ── */}
        {tab === 'inductions' && (
          <div className="space-y-4">
            <div className="bg-slate-50 rounded-lg p-3 space-y-3">
              <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Induction Passport</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-slate-400 mb-1">EHS Date</div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{fmtDate(person.induction_ehs_date)}</span>
                    <Badge color={ehsLight}>{ehsLight === 'none' ? 'Missing' : ehsLight === 'red' ? 'Expired' : ehsLight === 'amber' ? 'Expiring' : 'Current'}</Badge>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-400 mb-1">QUAL Date</div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{fmtDate(person.induction_qual_date)}</span>
                    <Badge color={qualLight}>{qualLight === 'none' ? 'Missing' : qualLight === 'red' ? 'Expired' : qualLight === 'amber' ? 'Expiring' : 'Current'}</Badge>
                  </div>
                </div>
              </div>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 space-y-3">
              <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Medical</div>
              <div>
                <div className="text-xs text-slate-400 mb-1">Medical Date</div>
                <div className="flex items-center gap-2">
                  <span className="text-sm">{fmtDate(person.medical_date)}</span>
                  <Badge color={medLight}>{medLight === 'none' ? 'Missing' : medLight === 'red' ? 'Expired' : medLight === 'amber' ? 'Expiring' : 'Current'}</Badge>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <EditField label="Induction Notes" value={person.induction_notes} field="induction_notes" personId={personId} onUpdated={handleUpdated} type="textarea" />
              <EditField label="Medical Notes" value={person.medical_notes} field="medical_notes" personId={personId} onUpdated={handleUpdated} type="textarea" />
            </div>
            {/* Edit dates */}
            <div className="grid grid-cols-3 gap-3">
              <EditField label="EHS Date" value={person.induction_ehs_date} field="induction_ehs_date" personId={personId} onUpdated={handleUpdated} type="date" />
              <EditField label="QUAL Date" value={person.induction_qual_date} field="induction_qual_date" personId={personId} onUpdated={handleUpdated} type="date" />
              <EditField label="Medical Date" value={person.medical_date} field="medical_date" personId={personId} onUpdated={handleUpdated} type="date" />
            </div>
          </div>
        )}

        {/* ── VISAS ── */}
        {tab === 'visas' && (
          <div className="space-y-3">
            {visas.length === 0 ? (
              <div className="text-slate-400 text-sm italic text-center py-8">No visa records</div>
            ) : visas.map(v => (
              <div key={v.id} className="border border-slate-200 rounded-lg p-3 space-y-1">
                <div className="flex items-start justify-between">
                  <div className="font-medium text-sm">{v.country || '—'}</div>
                  <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{v.visa_type}</span>
                </div>
                {v.project_name && <div className="text-xs text-slate-500">{v.project_name}</div>}
                <div className="text-xs text-slate-400">{fmtDate(v.from_date)} → {fmtDate(v.to_date)}</div>
                {v.current_status && <div className="text-xs text-slate-600 mt-1 border-t border-slate-100 pt-1">{v.current_status}</div>}
              </div>
            ))}
          </div>
        )}

        {/* ── ASSETS ── */}
        {tab === 'assets' && (
          <div className="space-y-3">
            {assets.length === 0 ? (
              <div className="text-slate-400 text-sm italic text-center py-8">No assets assigned</div>
            ) : assets.map(a => (
              <div key={a.id} className="border border-slate-200 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{a.asset_type === 'laptop' ? '💻' : '📱'}</span>
                    <span className="font-medium text-sm capitalize">{a.asset_type}</span>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded ${a.asset_status === 'active' ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                    {a.asset_status || 'active'}
                  </span>
                </div>
                {a.asset_number && <div className="text-xs text-slate-500 font-mono">{a.asset_number}</div>}
                {a.first_project && <div className="text-xs text-slate-400">Project: {a.first_project}</div>}
                {a.start_date && <div className="text-xs text-slate-400">Since: {fmtDate(a.start_date)}</div>}
                {a.notes && <div className="text-xs text-slate-500 mt-1 italic">{a.notes}</div>}
              </div>
            ))}
          </div>
        )}

        {/* ── HISTORY ── */}
        {tab === 'history' && (
          <div className="space-y-2">
            {deployments.length === 0 ? (
              <div className="text-slate-400 text-sm italic text-center py-8">No project deployments</div>
            ) : deployments.map(d => {
              const proj = d.project as { id: string; name: string; client: string | null } | null
              return (
                <div
                  key={d.id}
                  className="flex items-center justify-between border border-slate-200 rounded-lg p-3 hover:bg-slate-50 cursor-pointer transition-colors"
                  onClick={() => proj && onNavigateToProject?.(proj.id)}
                >
                  <div>
                    <div className="text-sm font-medium">{proj?.name || 'Unknown project'}</div>
                    {proj?.client && <div className="text-xs text-slate-400">{proj.client}</div>}
                    {d.role && <div className="text-xs text-blue-600">{d.role}</div>}
                  </div>
                  <div className="text-right text-xs text-slate-400">
                    <div>{fmtDate(d.mob_in)}</div>
                    <div>{fmtDate(d.mob_out)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
