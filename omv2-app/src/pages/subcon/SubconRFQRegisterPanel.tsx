import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'

const STAGES = ['draft', 'issued', 'responses_in', 'awarded', 'contracted', 'cancelled'] as const
const STAGE_LABEL: Record<string, string> = { draft: 'Draft', issued: 'Issued', responses_in: 'Responses In', awarded: 'Awarded', contracted: 'Contracted', cancelled: 'Cancelled' }
const STAGE_COLOR: Record<string, string> = { draft: '#94a3b8', issued: '#3b82f6', responses_in: '#f59e0b', awarded: '#059669', contracted: '#7c3aed', cancelled: '#e11d48' }

interface RFQDoc {
  id: string
  title: string
  stage: string
  deadline: string | null
  start_date: string | null
  end_date: string | null
  vendors_sent: string[]
  awarded_response_id: string | null
  linked_contract_id: string | null
  linked_po_id: string | null
  notes: string | null
  created_at: string
}

interface Response {
  id: string
  rfq_document_id: string
  vendor: string
  total_quote: number | null
  is_awarded: boolean
}

const fmtDate = (s: string | null) => s ? s.split('-').reverse().join('/') : '—'
const todayStr = new Date().toISOString().slice(0, 10)

export function SubconRFQRegisterPanel() {
  const { activeProject, setActivePanel } = useAppStore()
  const [docs, setDocs] = useState<RFQDoc[]>([])
  const [responses, setResponses] = useState<Response[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [docsRes, respRes] = await Promise.all([
      supabase.from('rfq_documents')
        .select('id,title,stage,deadline,start_date,end_date,vendors_sent,awarded_response_id,linked_contract_id,linked_po_id,notes,created_at')
        .eq('project_id', pid)
        .order('created_at', { ascending: false }),
      supabase.from('rfq_responses')
        .select('id,rfq_document_id,vendor,total_quote,is_awarded')
        .eq('project_id', pid),
    ])
    setDocs((docsRes.data || []) as RFQDoc[])
    setResponses((respRes.data || []) as Response[])
    setLoading(false)
  }

  async function updateStage(id: string, stage: string) {
    const { error } = await supabase.from('rfq_documents').update({ stage }).eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    setDocs(docs.map(d => d.id === id ? { ...d, stage } : d))
  }

  async function deleteDoc(id: string) {
    if (!confirm('Delete this RFQ document? Any logged vendor responses will also be deleted.')) return
    const { error } = await supabase.from('rfq_documents').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    setDocs(docs.filter(d => d.id !== id))
    setResponses(responses.filter(r => r.rfq_document_id !== id))
    toast('Deleted', 'success')
  }

  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  // Group responses by doc
  const responsesByDoc: Record<string, Response[]> = {}
  responses.forEach(r => {
    if (!responsesByDoc[r.rfq_document_id]) responsesByDoc[r.rfq_document_id] = []
    responsesByDoc[r.rfq_document_id].push(r)
  })

  const issuedCount = docs.filter(d => d.stage === 'issued').length
  const awardedCount = docs.filter(d => d.stage === 'awarded' || d.stage === 'contracted').length
  const overdue = docs.filter(d => d.deadline && d.deadline < todayStr && d.stage === 'issued').length

  return (
    <div style={{ padding: '24px', maxWidth: '1200px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>RFQ Register</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>Track RFQs from issue through vendor responses to contract award</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-sm" onClick={() => setActivePanel('subcon-contracts')}>📋 Contracts</button>
          <button className="btn btn-primary" onClick={() => setActivePanel('subcon-rfq-doc')}>+ New RFQ</button>
        </div>
      </div>

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
          <p>Build a Request for Quotation, send it to vendors, then log their responses here.</p>
          <button className="btn btn-sm" style={{ background: '#7c3aed', color: '#fff', marginTop: '12px' }} onClick={() => setActivePanel('subcon-rfq-doc')}>Create First RFQ</button>
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
                  <th style={{ textAlign: 'center' }}>Vendors Sent</th>
                  <th style={{ textAlign: 'center' }}>Responses</th>
                  <th>Status</th>
                  <th>Awarded To</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {docs.map(doc => {
                  const isOverdue = doc.deadline && doc.deadline < todayStr && doc.stage === 'issued'
                  const stageColor = STAGE_COLOR[doc.stage] || '#94a3b8'
                  const docResponses = responsesByDoc[doc.id] || []
                  const awardedResp = doc.awarded_response_id
                    ? docResponses.find(r => r.id === doc.awarded_response_id)
                    : docResponses.find(r => r.is_awarded)
                  const sentCount = Array.isArray(doc.vendors_sent) ? doc.vendors_sent.length : 0
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
                      <td style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '13px', fontWeight: 700 }}>
                        {sentCount || <span style={{ color: 'var(--text3)' }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '13px', fontWeight: 700, color: docResponses.length > 0 ? 'var(--green)' : 'var(--text3)' }}>
                        {docResponses.length || '—'}
                      </td>
                      <td>
                        <select style={{ fontSize: '11px', padding: '3px 6px', border: `1px solid ${stageColor}`, borderRadius: '4px', background: 'transparent', color: stageColor, fontWeight: 600, cursor: 'pointer' }}
                          value={doc.stage}
                          onChange={e => updateStage(doc.id, e.target.value)}>
                          {STAGES.map(s => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                        </select>
                      </td>
                      <td>
                        {awardedResp
                          ? <div style={{ fontSize: '11px', fontWeight: 600, color: '#059669' }}>✓ {awardedResp.vendor}</div>
                          : <span style={{ color: 'var(--text3)', fontSize: '11px' }}>—</span>}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button className="btn btn-sm" style={{ fontSize: '10px' }} onClick={() => setActivePanel('subcon-rfq-doc')} title="Open in document builder">✏️</button>
                          <button className="btn btn-sm" style={{ color: 'var(--red)', fontSize: '10px' }} onClick={() => deleteDoc(doc.id)}>✕</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '10px 14px', fontSize: '11px', color: 'var(--text3)', borderTop: '1px solid var(--border)', background: 'var(--bg3)' }}>
            Phase 3 will add: expandable response rows, Add Response modal with full vendor schedule rates, Award + Create PO flow, Link to Contract picker.
          </div>
        </div>
      )}
    </div>
  )
}
