import { useEffect, useState, Fragment } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { RfqResponseModal } from '../../components/subcon/RfqResponseModal'
import { VendorsSentModal } from '../../components/subcon/VendorsSentModal'
import { LinkContractModal } from '../../components/subcon/LinkContractModal'
import { getQuotePdfSignedUrl, deleteQuotePdf, formatFileSize } from '../../lib/quotePdfStorage'
import type { RfqDocument, RfqResponse } from '../../types'

const STAGES = ['draft', 'issued', 'responses_in', 'awarded', 'contracted', 'cancelled'] as const
const STAGE_LABEL: Record<string, string> = {
  draft: 'Draft', issued: 'Issued', responses_in: 'Responses In',
  awarded: 'Awarded', contracted: 'Contracted', cancelled: 'Cancelled',
}
const STAGE_COLOR: Record<string, string> = {
  draft: '#94a3b8', issued: '#3b82f6', responses_in: '#f59e0b',
  awarded: '#059669', contracted: '#7c3aed', cancelled: '#e11d48',
}

const fmtDate = (s: string | null) => s ? s.split('-').reverse().join('/') : '—'
const fmtMoney = (n: number | null) => n ? '$' + Number(n).toLocaleString('en-AU', { maximumFractionDigits: 2 }) : '—'
const todayStr = new Date().toISOString().slice(0, 10)

export function SubconRFQRegisterPanel() {
  const { activeProject, setActivePanel } = useAppStore()
  const [docs, setDocs] = useState<RfqDocument[]>([])
  const [responses, setResponses] = useState<RfqResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Modal state
  const [responseModal, setResponseModal] = useState<{ doc: RfqDocument; existing: RfqResponse | null } | null>(null)
  const [vendorsSentModal, setVendorsSentModal] = useState<RfqDocument | null>(null)
  const [linkContractModal, setLinkContractModal] = useState<{ doc: RfqDocument; vendor: string } | null>(null)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [docsRes, respRes] = await Promise.all([
      supabase.from('rfq_documents')
        .select('*')
        .eq('project_id', pid)
        .order('created_at', { ascending: false }),
      supabase.from('rfq_responses')
        .select('*')
        .eq('project_id', pid),
    ])
    setDocs((docsRes.data || []) as RfqDocument[])
    setResponses((respRes.data || []) as RfqResponse[])
    setLoading(false)
  }

  async function updateStage(id: string, stage: string) {
    const { error } = await supabase.from('rfq_documents').update({ stage }).eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    setDocs(docs.map(d => d.id === id ? { ...d, stage: stage as RfqDocument['stage'] } : d))
  }

  async function deleteDoc(id: string) {
    if (!confirm('Delete this RFQ document? Any logged vendor responses (and their PDFs) will also be deleted.')) return
    // Storage cleanup is best-effort
    const docResponses = responses.filter(r => r.rfq_document_id === id)
    for (const r of docResponses) {
      if (r.quote_pdf_path) await deleteQuotePdf(r.quote_pdf_path)
    }
    const { error } = await supabase.from('rfq_documents').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    setDocs(docs.filter(d => d.id !== id))
    setResponses(responses.filter(r => r.rfq_document_id !== id))
    toast('Deleted', 'success')
  }

  async function deleteResponse(resp: RfqResponse) {
    if (!confirm(`Delete ${resp.vendor}'s response?`)) return
    if (resp.quote_pdf_path) await deleteQuotePdf(resp.quote_pdf_path)
    const { error } = await supabase.from('rfq_responses').delete().eq('id', resp.id)
    if (error) { toast(error.message, 'error'); return }
    setResponses(responses.filter(r => r.id !== resp.id))
    toast('Response deleted', 'success')
  }

  async function awardResponse(doc: RfqDocument, resp: RfqResponse) {
    if (!confirm(`Award this RFQ to ${resp.vendor}?`)) return
    const docResponses = responses.filter(r => r.rfq_document_id === doc.id)
    // Clear is_awarded on all responses for this doc, set on the chosen one
    await supabase.from('rfq_responses').update({ is_awarded: false }).eq('rfq_document_id', doc.id)
    const { error: e1 } = await supabase.from('rfq_responses').update({ is_awarded: true }).eq('id', resp.id)
    if (e1) { toast(e1.message, 'error'); return }
    const { error: e2 } = await supabase.from('rfq_documents')
      .update({ awarded_response_id: resp.id, stage: 'awarded' })
      .eq('id', doc.id)
    if (e2) { toast(e2.message, 'error'); return }
    setResponses(docResponses.map(r => ({ ...r, is_awarded: r.id === resp.id }))
      .concat(responses.filter(r => r.rfq_document_id !== doc.id)))
    setDocs(docs.map(d => d.id === doc.id ? { ...d, awarded_response_id: resp.id, stage: 'awarded' } : d))
    toast(`Awarded to ${resp.vendor}`, 'success')
  }

  async function createPOFromRFQ(doc: RfqDocument, resp: RfqResponse) {
    if (!confirm(`Create a PO for ${resp.vendor} from this RFQ?`)) return
    const { data: po, error } = await supabase.from('purchase_orders').insert({
      project_id: activeProject!.id,
      vendor: resp.vendor,
      description: doc.title || 'Subcontract work',
      status: 'draft',
      currency: resp.currency || 'AUD',
      po_value: resp.total_quote || null,
      notes: `Created from RFQ: ${doc.title}`,
      quote_source: { type: 'rfq', rfqId: doc.id, responseId: resp.id, docTitle: doc.title },
    }).select().single()
    if (error) { toast(error.message, 'error'); return }
    // Write linked_po_id back on the RFQ doc
    await supabase.from('rfq_documents').update({ linked_po_id: po.id }).eq('id', doc.id)
    setDocs(docs.map(d => d.id === doc.id ? { ...d, linked_po_id: po.id } : d))
    toast(`PO created: ${(po as { po_number?: string }).po_number || 'New PO'}`, 'success')
  }

  async function viewPdf(path: string) {
    try {
      const url = await getQuotePdfSignedUrl(path)
      window.open(url, '_blank')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  function toggleExpand(id: string) {
    setExpanded(e => {
      const next = new Set(e)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  // Group responses by doc
  const responsesByDoc: Record<string, RfqResponse[]> = {}
  responses.forEach(r => {
    if (!responsesByDoc[r.rfq_document_id]) responsesByDoc[r.rfq_document_id] = []
    responsesByDoc[r.rfq_document_id].push(r)
  })

  const issuedCount = docs.filter(d => d.stage === 'issued').length
  const awardedCount = docs.filter(d => d.stage === 'awarded' || d.stage === 'contracted').length
  const overdue = docs.filter(d => d.deadline && d.deadline < todayStr && d.stage === 'issued').length

  return (
    <div style={{ padding: '24px', maxWidth: '1280px' }}>
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
            <table style={{ fontSize: '12px', minWidth: '1100px', width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ width: '24px' }}></th>
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
                  const isExpanded = expanded.has(doc.id)
                  return (
                    <Fragment key={doc.id}>
                      <tr>
                        <td style={{ textAlign: 'center' }}>
                          <button onClick={() => toggleExpand(doc.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', color: 'var(--text2)', padding: '2px 4px' }} title={isExpanded ? 'Collapse' : 'Expand'}>
                            {isExpanded ? '▼' : '▶'}
                          </button>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{doc.title || 'Untitled'}</div>
                          <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '2px' }}>
                            {(doc.labour_rows || []).length} labour role{(doc.labour_rows || []).length !== 1 ? 's' : ''}
                            {' · '}
                            {(doc.equip_rows || []).length} equip item{(doc.equip_rows || []).length !== 1 ? 's' : ''}
                          </div>
                        </td>
                        <td style={{ fontSize: '11px', color: 'var(--text2)' }}>
                          {fmtDate(doc.start_date)}{doc.end_date ? ' → ' + fmtDate(doc.end_date) : ''}
                        </td>
                        <td style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '11px', color: isOverdue ? 'var(--red)' : 'var(--text2)', fontWeight: isOverdue ? 600 : 400 }}>
                          {fmtDate(doc.deadline)}{isOverdue ? ' ⚠' : ''}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                            <span style={{ fontSize: '13px', fontWeight: 700, fontFamily: 'var(--mono)' }}>{sentCount || 0}</span>
                            <button onClick={() => setVendorsSentModal(doc)} style={{
                              padding: '1px 6px', fontSize: '10px', border: '1px solid var(--border)', borderRadius: '3px',
                              background: 'transparent', color: 'var(--text3)', cursor: 'pointer',
                            }}>Edit</button>
                          </div>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                            <span style={{ fontSize: '13px', fontWeight: 700, fontFamily: 'var(--mono)', color: docResponses.length > 0 ? 'var(--green)' : 'var(--text3)' }}>{docResponses.length}</span>
                            <button onClick={() => setResponseModal({ doc, existing: null })} style={{
                              padding: '1px 6px', fontSize: '10px', border: '1px solid #7c3aed', borderRadius: '3px',
                              background: 'transparent', color: '#7c3aed', cursor: 'pointer',
                            }}>+ Add</button>
                          </div>
                        </td>
                        <td>
                          <select style={{
                            fontSize: '11px', padding: '3px 6px',
                            border: `1px solid ${stageColor}`, borderRadius: '4px',
                            background: 'transparent', color: stageColor, fontWeight: 600, cursor: 'pointer',
                          }} value={doc.stage} onChange={e => updateStage(doc.id, e.target.value)}>
                            {STAGES.map(s => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                          </select>
                        </td>
                        <td>
                          {awardedResp ? (
                            <div>
                              <div style={{ fontSize: '11px', fontWeight: 600, color: '#059669' }}>✓ {awardedResp.vendor}</div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '3px' }}>
                                {doc.linked_contract_id ? (
                                  <span style={{ fontSize: '10px', color: 'var(--text3)' }}>Contract linked</span>
                                ) : (
                                  <button onClick={() => setLinkContractModal({ doc, vendor: awardedResp.vendor })} style={{
                                    fontSize: '10px', padding: '2px 6px', border: '1px solid var(--border)', borderRadius: '3px',
                                    background: 'transparent', color: 'var(--text3)', cursor: 'pointer',
                                  }}>Link contract →</button>
                                )}
                                {doc.linked_po_id ? (
                                  <button onClick={() => setActivePanel('purchase-orders')} style={{
                                    fontSize: '10px', padding: '2px 6px', border: '1px solid #1e40af', borderRadius: '3px',
                                    background: '#eff6ff', color: '#1e40af', cursor: 'pointer',
                                  }}>🔗 PO linked</button>
                                ) : (
                                  <button onClick={() => createPOFromRFQ(doc, awardedResp)} style={{
                                    fontSize: '10px', padding: '2px 6px', border: '1px solid #1e40af', borderRadius: '3px',
                                    background: 'transparent', color: '#1e40af', cursor: 'pointer', fontWeight: 600,
                                  }}>💼 Create PO →</button>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text3)', fontSize: '11px' }}>—</span>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <button className="btn btn-sm" style={{ fontSize: '10px' }} onClick={() => setActivePanel('subcon-rfq-doc')} title="Open in document builder">✏️</button>
                            <button className="btn btn-sm" style={{ color: 'var(--red)', fontSize: '10px' }} onClick={() => deleteDoc(doc.id)}>✕</button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={9} style={{ padding: 0, background: 'var(--bg3)', borderTop: '1px solid var(--border)' }}>
                            <ResponsesInline
                              doc={doc}
                              responses={docResponses}
                              awardedResp={awardedResp || null}
                              onAddResponse={() => setResponseModal({ doc, existing: null })}
                              onEditResponse={(r) => setResponseModal({ doc, existing: r })}
                              onDeleteResponse={deleteResponse}
                              onAward={(r) => awardResponse(doc, r)}
                              onViewPdf={viewPdf}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modals */}
      {responseModal && (
        <RfqResponseModal
          doc={responseModal.doc}
          projectId={activeProject!.id}
          vendorsSent={responseModal.doc.vendors_sent || []}
          existingResponse={responseModal.existing}
          onClose={() => setResponseModal(null)}
          onSaved={load}
        />
      )}
      {vendorsSentModal && (
        <VendorsSentModal
          docId={vendorsSentModal.id}
          initialVendors={vendorsSentModal.vendors_sent || []}
          onClose={() => setVendorsSentModal(null)}
          onSaved={(vendors) => setDocs(docs.map(d => d.id === vendorsSentModal.id ? { ...d, vendors_sent: vendors } : d))}
        />
      )}
      {linkContractModal && (
        <LinkContractModal
          docId={linkContractModal.doc.id}
          projectId={activeProject!.id}
          awardedVendor={linkContractModal.vendor}
          onClose={() => setLinkContractModal(null)}
          onLinked={(contractId) => setDocs(docs.map(d => d.id === linkContractModal.doc.id ? { ...d, linked_contract_id: contractId, stage: 'contracted' } : d))}
        />
      )}
    </div>
  )
}

// ─── Inline expanded response list ────────────────────────────────────────────

interface InlineProps {
  doc: RfqDocument
  responses: RfqResponse[]
  awardedResp: RfqResponse | null
  onAddResponse: () => void
  onEditResponse: (r: RfqResponse) => void
  onDeleteResponse: (r: RfqResponse) => void
  onAward: (r: RfqResponse) => void
  onViewPdf: (path: string) => void
}

function ResponsesInline({ doc, responses, awardedResp, onAddResponse, onEditResponse, onDeleteResponse, onAward, onViewPdf }: InlineProps) {
  if (!responses.length) {
    return (
      <div style={{ padding: '14px 20px' }}>
        <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '8px' }}>No responses recorded yet.</div>
        <button onClick={onAddResponse} style={{
          fontSize: '11px', padding: '4px 10px', border: '1px solid #7c3aed', borderRadius: '4px',
          background: 'transparent', color: '#7c3aed', cursor: 'pointer',
        }}>+ Add Response</button>
      </div>
    )
  }

  return (
    <div style={{ padding: '14px 20px' }}>
      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '10px' }}>
        Vendor Responses — {doc.title}
      </div>
      <div style={{ display: 'grid', gap: '8px' }}>
        {responses.map(r => {
          const isAwarded = awardedResp?.id === r.id
          return (
            <div key={r.id} style={{
              padding: '10px 14px',
              border: `2px solid ${isAwarded ? '#059669' : 'var(--border)'}`,
              borderRadius: '6px',
              background: isAwarded ? '#f0fdf4' : 'var(--bg2)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <div style={{ fontWeight: 700, fontSize: '12px' }}>
                  {r.vendor}
                  {isAwarded && (
                    <span style={{ fontSize: '10px', background: '#d1fae5', color: '#065f46', padding: '1px 6px', borderRadius: '10px', marginLeft: '6px' }}>
                      ✓ AWARDED
                    </span>
                  )}
                </div>
                {r.received_date && (
                  <div style={{ fontSize: '10px', color: 'var(--text3)' }}>Received {fmtDate(r.received_date)}</div>
                )}
                {r.total_quote != null && (
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '13px', fontWeight: 700, color: isAwarded ? '#059669' : 'var(--text)' }}>
                    {fmtMoney(r.total_quote)} {r.currency || ''}
                  </div>
                )}
                {r.notes && <div style={{ fontSize: '11px', color: 'var(--text2)', flex: 1 }}>{r.notes}</div>}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {r.quote_pdf_path && (
                    <button onClick={() => onViewPdf(r.quote_pdf_path!)} title={r.quote_pdf_name || 'View quote PDF'} style={{
                      fontSize: '10px', padding: '3px 8px', border: '1px solid #0891b2', borderRadius: '4px',
                      background: '#f0f9ff', color: '#0369a1', cursor: 'pointer', fontWeight: 600,
                    }}>📄 PDF</button>
                  )}
                  {!isAwarded && doc.stage !== 'contracted' && doc.stage !== 'cancelled' && (
                    <button onClick={() => onAward(r)} style={{
                      fontSize: '10px', padding: '3px 8px', border: '1px solid #059669', borderRadius: '4px',
                      background: 'transparent', color: '#059669', cursor: 'pointer', fontWeight: 600,
                    }}>Award →</button>
                  )}
                  <button onClick={() => onEditResponse(r)} style={{
                    fontSize: '10px', padding: '3px 8px', border: '1px solid var(--border)', borderRadius: '4px',
                    background: 'transparent', color: 'var(--text3)', cursor: 'pointer',
                  }}>Edit</button>
                  <button onClick={() => onDeleteResponse(r)} style={{
                    fontSize: '10px', padding: '3px 8px', border: '1px solid var(--red)', borderRadius: '4px',
                    background: 'transparent', color: 'var(--red)', cursor: 'pointer',
                  }}>✕</button>
                </div>
              </div>
              {/* Rate summary chips */}
              {(r.labour?.length > 0 || r.equip?.length > 0) && (
                <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {r.labour.map((l, i) => (
                    <div key={`l${i}`} style={{
                      fontSize: '10px', padding: '3px 8px', background: 'var(--bg3)',
                      border: '1px solid var(--border)', borderRadius: '4px',
                    }}>
                      <span style={{ fontWeight: 600 }}>{l.role}</span>
                      {l.rates.rateMode === 'flat' ? (
                        <>
                          {l.rates.flatDs ? ` · DS $${l.rates.flatDs}/shift` : ''}
                          {l.rates.flatNs ? ` · NS $${l.rates.flatNs}/shift` : ''}
                        </>
                      ) : (
                        <>
                          {l.rates.dnt ? ` · NT $${l.rates.dnt}/hr` : ''}
                          {l.rates.dt15 ? ` · T1.5 $${l.rates.dt15}/hr` : ''}
                          {l.rates.ddt ? ` · DT $${l.rates.ddt}/hr` : ''}
                        </>
                      )}
                      {l.rates.laha ? ` · LAHA $${l.rates.laha}/day` : ''}
                    </div>
                  ))}
                  {r.equip.map((e, i) => (
                    <div key={`e${i}`} style={{
                      fontSize: '10px', padding: '3px 8px', background: 'var(--bg3)',
                      border: '1px solid var(--border)', borderRadius: '4px',
                    }}>
                      <span style={{ fontWeight: 600 }}>{e.desc}</span>
                      {e.rate ? ` · $${e.rate}/${e.unit || 'day'}` : ''}
                    </div>
                  ))}
                </div>
              )}
              {r.quote_pdf_path && r.quote_pdf_name && (
                <div style={{ marginTop: '6px', fontSize: '10px', color: 'var(--text3)' }}>
                  📎 {r.quote_pdf_name} {r.quote_pdf_size_bytes ? `(${formatFileSize(r.quote_pdf_size_bytes)})` : ''}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div style={{ marginTop: '10px', display: 'flex', gap: '8px' }}>
        <button onClick={onAddResponse} style={{
          fontSize: '11px', padding: '4px 10px', border: '1px solid #7c3aed', borderRadius: '4px',
          background: 'transparent', color: '#7c3aed', cursor: 'pointer',
        }}>+ Add Response</button>
      </div>
    </div>
  )
}
