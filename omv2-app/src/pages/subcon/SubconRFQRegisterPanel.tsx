import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'

const STAGES = ['draft', 'issued', 'responses_in', 'awarded', 'contracted', 'cancelled'] as const
const STAGE_LABEL: Record<string, string> = { draft: 'Draft', issued: 'Issued', responses_in: 'Responses In', awarded: 'Awarded', contracted: 'Contracted', cancelled: 'Cancelled' }
const STAGE_COLOR: Record<string, string> = { draft: '#94a3b8', issued: '#3b82f6', responses_in: '#f59e0b', awarded: '#059669', contracted: '#7c3aed', cancelled: '#e11d48' }

interface RFQDoc {
  id: string; title: string; stage: string
  deadline: string | null; start_date: string | null; end_date: string | null
  vendor: string | null; quoted_amount: number | null; awarded: boolean
  response_notes: string | null; notes: string | null
  created_at: string
}

const fmt = (n: number) => '$' + Math.round(n).toLocaleString('en-AU')
const fmtDate = (s: string | null) => s ? s.split('-').reverse().join('/') : '—'
const todayStr = new Date().toISOString().slice(0, 10)

export function SubconRFQRegisterPanel() {
  const { activeProject, setActivePanel } = useAppStore()
  const [docs, setDocs] = useState<RFQDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [editStage, setEditStage] = useState<Record<string, string>>({})

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('rfq_documents')
      .select('id,title,stage,deadline,start_date,end_date,vendor,quoted_amount,awarded,response_notes,notes,created_at')
      .eq('project_id', activeProject!.id)
      .order('created_at', { ascending: false })
    setDocs((data || []) as RFQDoc[])
    setLoading(false)
  }

  async function updateStage(id: string, stage: string) {
    const { error } = await supabase.from('rfq_documents').update({ stage }).eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    setDocs(docs.map(d => d.id === id ? { ...d, stage } : d))
  }

  async function deleteDoc(id: string) {
    if (!confirm('Delete this RFQ document?')) return
    await supabase.from('rfq_documents').delete().eq('id', id)
    setDocs(docs.filter(d => d.id !== id))
    toast('Deleted', 'success')
  }

  async function awardAndCreatePO(doc: RFQDoc) {
    if (!confirm(`Award to ${doc.vendor || 'this vendor'} and create a PO?`)) return
    await supabase.from('rfq_documents').update({ awarded: true, stage: 'awarded' }).eq('id', doc.id)
    const { data: po, error } = await supabase.from('purchase_orders').insert({
      project_id: activeProject!.id,
      vendor: doc.vendor || '',
      description: doc.title || 'Subcontract work',
      status: 'raised',
      currency: 'AUD',
      po_value: doc.quoted_amount || null,
      notes: `Created from RFQ: ${doc.title}`,
    }).select().single()
    if (error) { toast(error.message, 'error'); return }
    toast(`PO created: ${(po as { po_number?: string }).po_number || 'New PO'}`, 'success')
    load()
  }

  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  const issuedCount = docs.filter(d => d.stage === 'issued').length
  const awardedCount = docs.filter(d => d.stage === 'awarded' || d.awarded).length
  const overdue = docs.filter(d => d.deadline && d.deadline < todayStr && d.stage === 'issued').length

  return (
    <div style={{ padding: '24px', maxWidth: '1200px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>RFQ Register</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>All RFQ documents for this project</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-sm" onClick={() => setActivePanel('subcon-rfq')}>📋 Contracts</button>
          <button className="btn btn-primary" onClick={() => setActivePanel('subcon-dashboard')}>+ New RFQ</button>
        </div>
      </div>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px', marginBottom: '16px' }}>
        {[
          { label: 'Total RFQs', value: docs.length, color: '#7c3aed' },
          { label: 'Issued', value: issuedCount, color: '#3b82f6' },
          { label: 'Awarded', value: awardedCount, color: 'var(--green)' },
          { label: 'Overdue', value: overdue, color: overdue > 0 ? 'var(--red)' : 'var(--text3)' },
        ].map(t => (
          <div key={t.label} className="card" style={{ padding: '12px', borderTop: `3px solid ${t.color}` }}>
            <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--mono)', color: t.color }}>{t.value}</div>
            <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '2px' }}>{t.label}</div>
          </div>
        ))}
      </div>

      {docs.length === 0 ? (
        <div className="empty-state">
          <div className="icon">📝</div>
          <h3>No RFQ documents yet</h3>
          <p>Create RFQ documents in the Subcontractors section to track vendor responses.</p>
          <button className="btn btn-sm" style={{ background: '#7c3aed', color: '#fff', marginTop: '12px' }} onClick={() => setActivePanel('subcon-dashboard')}>Create First RFQ</button>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ fontSize: '12px', minWidth: '900px' }}>
              <thead>
                <tr>
                  <th>RFQ Title</th>
                  <th>Scope Period</th>
                  <th style={{ textAlign: 'center' }}>Response By</th>
                  <th>Status</th>
                  <th>Vendor</th>
                  <th style={{ textAlign: 'right' }}>Quoted</th>
                  <th>Awarded</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {docs.map(doc => {
                  const isOverdue = doc.deadline && doc.deadline < todayStr && doc.stage === 'issued'
                  const stageColor = STAGE_COLOR[doc.stage] || '#94a3b8'
                  return (
                    <tr key={doc.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{doc.title || 'Untitled'}</div>
                        {doc.notes && <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '2px' }}>{doc.notes.slice(0, 60)}{doc.notes.length > 60 ? '…' : ''}</div>}
                      </td>
                      <td style={{ fontSize: '11px', color: 'var(--text2)' }}>
                        {fmtDate(doc.start_date)}{doc.end_date ? ' → ' + fmtDate(doc.end_date) : ''}
                      </td>
                      <td style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '11px', color: isOverdue ? 'var(--red)' : 'var(--text2)', fontWeight: isOverdue ? 600 : 400 }}>
                        {fmtDate(doc.deadline)}{isOverdue ? ' ⚠' : ''}
                      </td>
                      <td>
                        <select style={{ fontSize: '11px', padding: '3px 6px', border: `1px solid ${stageColor}`, borderRadius: '4px', background: 'transparent', color: stageColor, fontWeight: 600, cursor: 'pointer' }}
                          value={doc.stage}
                          onChange={e => updateStage(doc.id, e.target.value)}>
                          {STAGES.map(s => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                        </select>
                      </td>
                      <td style={{ fontSize: '11px' }}>{doc.vendor || <span style={{ color: 'var(--text3)' }}>—</span>}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--green)', fontWeight: 600 }}>
                        {doc.quoted_amount ? fmt(doc.quoted_amount) : '—'}
                      </td>
                      <td>
                        {doc.awarded
                          ? <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '3px', background: '#d1fae5', color: '#065f46', fontWeight: 600 }}>✓ Awarded</span>
                          : <span style={{ color: 'var(--text3)', fontSize: '11px' }}>—</span>}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          {!doc.awarded && doc.vendor && (
                            <button className="btn btn-sm" style={{ background: '#059669', color: '#fff', fontSize: '10px' }} onClick={() => awardAndCreatePO(doc)}>🏆 Award + PO</button>
                          )}
                          <button className="btn btn-sm" style={{ color: 'var(--red)', fontSize: '10px' }} onClick={() => deleteDoc(doc.id)}>✕</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
