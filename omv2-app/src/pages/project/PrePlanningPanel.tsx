import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'

interface ChecklistItem {
  id: string
  category: string
  item: string
  owner: string
  due_date: string
  status: 'pending' | 'in_progress' | 'complete' | 'na'
  notes: string
}

const DEFAULT_ITEMS: Omit<ChecklistItem, 'id'>[] = [
  // Commercial
  { category: 'Commercial', item: 'Variation notices submitted and approved', owner: 'PM', due_date: '', status: 'pending', notes: '' },
  { category: 'Commercial', item: 'Purchase orders raised for all subcontractors', owner: 'PM', due_date: '', status: 'pending', notes: '' },
  { category: 'Commercial', item: 'Customer cost report issued', owner: 'PM', due_date: '', status: 'pending', notes: '' },
  { category: 'Commercial', item: 'Budget approved (PM100)', owner: 'PM', due_date: '', status: 'pending', notes: '' },
  // Tooling & Parts
  { category: 'Tooling & Parts', item: 'WOSIT / TV export received from Kanlog', owner: 'PM', due_date: '', status: 'pending', notes: '' },
  { category: 'Tooling & Parts', item: 'TV costings entered (charge dates, rates)', owner: 'PM', due_date: '', status: 'pending', notes: '' },
  { category: 'Tooling & Parts', item: 'Kollo manifest reviewed', owner: 'PM', due_date: '', status: 'pending', notes: '' },
  { category: 'Tooling & Parts', item: 'SLI documents generated', owner: 'Logistics', due_date: '', status: 'pending', notes: '' },
  { category: 'Tooling & Parts', item: 'DG declaration completed', owner: 'Logistics', due_date: '', status: 'pending', notes: '' },
  // Resources
  { category: 'Resources', item: 'All crew confirmed and on roster', owner: 'PM', due_date: '', status: 'pending', notes: '' },
  { category: 'Resources', item: 'Inductions submitted to site', owner: 'PM', due_date: '', status: 'pending', notes: '' },
  { category: 'Resources', item: 'LAHA/allowance settings confirmed', owner: 'PM', due_date: '', status: 'pending', notes: '' },
  { category: 'Resources', item: 'Accommodation booked', owner: 'PM', due_date: '', status: 'pending', notes: '' },
  { category: 'Resources', item: 'Car hire booked', owner: 'PM', due_date: '', status: 'pending', notes: '' },
  // Site Readiness
  { category: 'Site Readiness', item: 'Site access approved', owner: 'Site Contact', due_date: '', status: 'pending', notes: '' },
  { category: 'Site Readiness', item: 'Lifting plan reviewed and approved', owner: 'Engineer', due_date: '', status: 'pending', notes: '' },
  { category: 'Site Readiness', item: 'Toolbox talk agenda prepared', owner: 'Supervisor', due_date: '', status: 'pending', notes: '' },
  { category: 'Site Readiness', item: 'HSE documentation complete', owner: 'HSE', due_date: '', status: 'pending', notes: '' },
  // Technical
  { category: 'Technical', item: 'Scope of work document issued', owner: 'Engineer', due_date: '', status: 'pending', notes: '' },
  { category: 'Technical', item: 'Work orders created and assigned', owner: 'Engineer', due_date: '', status: 'pending', notes: '' },
  { category: 'Technical', item: 'Alignment records from previous outage reviewed', owner: 'Engineer', due_date: '', status: 'pending', notes: '' },
  { category: 'Technical', item: 'Test equipment calibration current', owner: 'Engineer', due_date: '', status: 'pending', notes: '' },
]

const STATUS_CONFIG = {
  pending:     { label: 'Pending',     bg: '#f1f5f9', color: '#64748b', icon: '○' },
  in_progress: { label: 'In Progress', bg: '#fef3c7', color: '#92400e', icon: '◑' },
  complete:    { label: 'Complete',    bg: '#d1fae5', color: '#065f46', icon: '●' },
  na:          { label: 'N/A',         bg: '#e5e7eb', color: '#374151', icon: '–' },
}

export function PrePlanningPanel() {
  const { activeProject } = useAppStore()
  const [items, setItems] = useState<ChecklistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('pre_planning')
      .select('*').eq('project_id', activeProject!.id).order('category').order('created_at')
    if (data && data.length > 0) {
      setItems(data as ChecklistItem[])
    } else {
      // First load — seed with defaults
      setItems(DEFAULT_ITEMS.map((item, i) => ({ ...item, id: `temp-${i}` })))
    }
    setLoading(false)
  }

  async function ensureSaved(item: ChecklistItem): Promise<string> {
    if (!item.id.startsWith('temp-')) return item.id
    // Save to DB
    const { data, error } = await supabase.from('pre_planning').insert({
      project_id: activeProject!.id,
      category: item.category, item: item.item, owner: item.owner,
      due_date: item.due_date || null, status: item.status, notes: item.notes,
    }).select('id').single()
    if (error) throw error
    return (data as { id: string }).id
  }

  async function updateField(item: ChecklistItem, field: keyof ChecklistItem, value: string) {
    setSaving(item.id)
    try {
      const realId = await ensureSaved(item)
      await supabase.from('pre_planning').update({ [field]: value }).eq('id', realId)
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, id: realId, [field]: value } : i))
    } catch (e) { toast((e as Error).message, 'error') }
    setSaving(null)
  }

  async function cycleStatus(item: ChecklistItem) {
    const order: ChecklistItem['status'][] = ['pending', 'in_progress', 'complete', 'na']
    const next = order[(order.indexOf(item.status) + 1) % order.length]
    await updateField(item, 'status', next)
  }

  async function addItem() {
    const newItem: ChecklistItem = {
      id: `temp-${Date.now()}`, category: 'Custom', item: 'New checklist item',
      owner: '', due_date: '', status: 'pending', notes: ''
    }
    setItems(prev => [...prev, newItem])
    setEditingId(newItem.id)
  }

  async function deleteItem(item: ChecklistItem) {
    if (!item.id.startsWith('temp-')) {
      await supabase.from('pre_planning').delete().eq('id', item.id)
    }
    setItems(prev => prev.filter(i => i.id !== item.id))
  }

  // Group by category
  const categories = [...new Set(items.map(i => i.category))]
  const complete = items.filter(i => i.status === 'complete' || i.status === 'na').length
  const pct = items.length > 0 ? Math.round(complete / items.length * 100) : 0

  return (
    <div style={{ padding: '24px', maxWidth: '900px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>Pre-Outage Planning</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
            {complete}/{items.length} items complete · {pct}% ready
          </p>
        </div>
        <button className="btn btn-primary" onClick={addItem}>+ Add Item</button>
      </div>

      {/* Progress bar */}
      <div className="card" style={{ padding: '12px 16px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
          <span style={{ fontWeight: 600 }}>Overall Readiness</span>
          <span style={{ fontFamily: 'var(--mono)', color: pct >= 100 ? 'var(--green)' : pct >= 70 ? 'var(--amber)' : 'var(--red)' }}>{pct}%</span>
        </div>
        <div style={{ background: 'var(--border2)', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: pct + '%', background: pct >= 100 ? 'var(--green)' : pct >= 70 ? 'var(--amber)' : 'var(--red)', borderRadius: '4px', transition: 'width .3s' }} />
        </div>
        <div style={{ display: 'flex', gap: '16px', marginTop: '8px', fontSize: '11px', color: 'var(--text3)' }}>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => {
            const count = items.filter(i => i.status === k).length
            return count > 0 ? (
              <span key={k}><span style={{ color: v.color, fontWeight: 600 }}>{v.icon} {count}</span> {v.label}</span>
            ) : null
          })}
        </div>
      </div>

      {loading ? <div className="loading-center"><span className="spinner" /></div>
      : categories.map(cat => {
        const catItems = items.filter(i => i.category === cat)
        const catDone = catItems.filter(i => i.status === 'complete' || i.status === 'na').length
        return (
          <div key={cat} style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{cat}</div>
              <div style={{ fontSize: '11px', color: 'var(--text3)' }}>{catDone}/{catItems.length}</div>
              <div style={{ flex: 1, height: '3px', background: 'var(--border2)', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: (catItems.length > 0 ? catDone / catItems.length * 100 : 0) + '%', background: 'var(--accent)', borderRadius: '2px' }} />
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {catItems.map(item => {
                const sc = STATUS_CONFIG[item.status]
                const isEditing = editingId === item.id
                return (
                  <div key={item.id} className="card" style={{ padding: '10px 12px', borderLeft: `3px solid ${sc.color}`, opacity: item.status === 'na' ? 0.6 : 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {/* Status toggle */}
                      <button style={{ background: sc.bg, color: sc.color, border: 'none', borderRadius: '4px', padding: '3px 8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600, minWidth: '90px', textAlign: 'center' }}
                        onClick={() => cycleStatus(item)}>
                        {sc.icon} {sc.label}
                      </button>
                      {/* Item name */}
                      <div style={{ flex: 1 }}>
                        {isEditing ? (
                          <input className="input" defaultValue={item.item} style={{ fontSize: '13px' }}
                            onBlur={e => { updateField(item, 'item', e.target.value); setEditingId(null) }}
                            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                            autoFocus />
                        ) : (
                          <span style={{ fontSize: '13px', cursor: 'text', textDecoration: item.status === 'na' ? 'line-through' : 'none' }}
                            onClick={() => setEditingId(item.id)}>{item.item}</span>
                        )}
                        {item.notes && <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>{item.notes}</div>}
                      </div>
                      {/* Owner */}
                      <input defaultValue={item.owner} placeholder="Owner" style={{ width: '100px', fontSize: '11px', padding: '2px 6px', border: '1px solid var(--border2)', borderRadius: '4px', background: 'transparent' }}
                        onBlur={e => { if (e.target.value !== item.owner) updateField(item, 'owner', e.target.value) }}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
                      {/* Due date */}
                      <input type="date" defaultValue={item.due_date} style={{ width: '120px', fontSize: '11px', padding: '2px 6px', border: '1px solid var(--border2)', borderRadius: '4px', background: 'transparent', fontFamily: 'var(--mono)' }}
                        onBlur={e => { if (e.target.value !== item.due_date) updateField(item, 'due_date', e.target.value) }} />
                      {saving === item.id && <span className="spinner" style={{ width: '12px', height: '12px' }} />}
                      <button className="btn btn-sm" style={{ color: 'var(--red)', padding: '2px 6px' }} onClick={() => deleteItem(item)}>✕</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
