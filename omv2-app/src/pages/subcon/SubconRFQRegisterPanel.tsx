import { useEffect, useState, Fragment } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { RfqResponseModal } from '../../components/subcon/RfqResponseModal'
import { VendorsSentModal } from '../../components/subcon/VendorsSentModal'
import { getQuotePdfSignedUrl, deleteQuotePdf, formatFileSize } from '../../lib/quotePdfStorage'
import type { RfqDocument, RfqResponse, RfqResponseLabour, RfqEquipRow, RateCard } from '../../types'

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
const todayStr = new Date().toISOString().slice(0, 10)

// ─── Wizard row types ─────────────────────────────────────────────────────────

interface ResWizardRow {
  role: string; mob_in: string; mob_out: string; name: string
  shift: string; phone: string; email: string; notes: string; include: boolean
}

interface EquipWizardRow {
  desc: string; rate: number; unit: 'daily' | 'weekly'
  start_date: string; end_date: string
  transport_in: number; transport_out: number; include: boolean
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SubconRFQRegisterPanel() {
  const { activeProject, setActivePanel, setPendingPoId } = useAppStore()
  const [docs, setDocs] = useState<RfqDocument[]>([])
  const [responses, setResponses] = useState<RfqResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Aux data for wizards
  const [rateCards, setRateCards] = useState<RateCard[]>([])

  // Modal state
  const [responseModal, setResponseModal] = useState<{ doc: RfqDocument; existing: RfqResponse | null } | null>(null)
  const [vendorsSentModal, setVendorsSentModal] = useState<RfqDocument | null>(null)

  // Resource import wizard
  const [importWizard, setImportWizard] = useState<{
    doc: RfqDocument; resp: RfqResponse; rows: ResWizardRow[]
  } | null>(null)
  const [importSaving, setImportSaving] = useState(false)

  // Equipment import wizard
  const [equipWizard, setEquipWizard] = useState<{
    doc: RfqDocument; resp: RfqResponse; rows: EquipWizardRow[]
  } | null>(null)
  const [equipSaving, setEquipSaving] = useState(false)

  // Rate card modal
  const [rateCardModal, setRateCardModal] = useState<{
    doc: RfqDocument; resp: RfqResponse
    destination: 'project' | 'global'
  } | null>(null)
  const [rateCardSaving, setRateCardSaving] = useState(false)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [docsRes, respRes, rcRes] = await Promise.all([
      supabase.from('rfq_documents').select('*').eq('project_id', pid).order('created_at', { ascending: false }),
      supabase.from('rfq_responses').select('*').eq('project_id', pid),
      supabase.from('rate_cards').select('*').eq('project_id', pid),
    ])
    setDocs((docsRes.data || []) as RfqDocument[])
    setResponses((respRes.data || []) as RfqResponse[])
    setRateCards((rcRes.data || []) as RateCard[])
    setLoading(false)
  }

  async function updateStage(id: string, stage: string) {
    const { error } = await supabase.from('rfq_documents').update({ stage }).eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    setDocs(docs.map(d => d.id === id ? { ...d, stage: stage as RfqDocument['stage'] } : d))
  }

  async function deleteDoc(id: string) {
    if (!confirm('Delete this RFQ document? All vendor responses will also be deleted.')) return
    const docResponses = responses.filter(r => r.rfq_document_id === id)
    for (const r of docResponses) { if (r.quote_pdf_path) await deleteQuotePdf(r.quote_pdf_path) }
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
    await supabase.from('rfq_responses').update({ is_awarded: false }).eq('rfq_document_id', doc.id)
    const { error: e1 } = await supabase.from('rfq_responses').update({ is_awarded: true }).eq('id', resp.id)
    if (e1) { toast(e1.message, 'error'); return }
    const { error: e2 } = await supabase.from('rfq_documents')
      .update({ awarded_response_id: resp.id, stage: 'awarded' }).eq('id', doc.id)
    if (e2) { toast(e2.message, 'error'); return }
    setResponses(docResponses.map(r => ({ ...r, is_awarded: r.id === resp.id }))
      .concat(responses.filter(r => r.rfq_document_id !== doc.id)))
    setDocs(docs.map(d => d.id === doc.id ? { ...d, awarded_response_id: resp.id, stage: 'awarded' } : d))
    toast(`Awarded to ${resp.vendor}`, 'success')

    // Auto-open resource import wizard if there are labour rows
    const labourRows = (resp.labour || []) as RfqResponseLabour[]
    if (labourRows.length > 0) {
      openResWizard(doc, resp)
    }
  }

  // ── Resource import wizard ─────────────────────────────────────────────────

  function openResWizard(doc: RfqDocument, resp: RfqResponse) {
    const labourRows = (resp.labour || []) as RfqResponseLabour[]
    const docLabour = (doc.labour_rows || [])
    const rows: ResWizardRow[] = labourRows.flatMap((l, li) => {
      const docRow = docLabour[li]
      const qty = docRow?.qty ? parseInt(String(docRow.qty)) || 1 : 1
      return Array.from({ length: qty }, () => ({
        role: l.role || '',
        mob_in: doc.start_date || '',
        mob_out: doc.end_date || '',
        name: '', shift: 'day', phone: '', email: '', notes: '',
        include: true,
      }))
    })
    setImportWizard({ doc, resp, rows })
  }

  function updateResRow<K extends keyof ResWizardRow>(i: number, field: K, val: ResWizardRow[K]) {
    setImportWizard(w => w ? { ...w, rows: w.rows.map((r, j) => j === i ? { ...r, [field]: val } : r) } : w)
  }

  async function execImportResources() {
    if (!importWizard || !activeProject) return
    setImportSaving(true)
    const toInsert = importWizard.rows.filter(r => r.include && r.name.trim()).map(r => ({
      project_id: activeProject.id,
      name: r.name.trim(),
      role: r.role,
      company: importWizard.resp.vendor,
      category: 'subcontractor',
      shift: r.shift || 'day',
      mob_in: r.mob_in || null,
      mob_out: r.mob_out || null,
      phone: r.phone.trim() || null,
      email: r.email.trim() || null,
      notes: r.notes.trim() || null,
      imported_from_rfq: importWizard.doc.id,
    }))
    if (!toInsert.length) { toast('Fill in at least one name to import', 'info'); setImportSaving(false); return }
    const { error } = await supabase.from('resources').insert(toInsert)
    setImportSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`${toInsert.length} resource${toInsert.length !== 1 ? 's' : ''} imported from ${importWizard.resp.vendor}`, 'success')
    setImportWizard(null)
  }

  // ── Equipment import wizard ────────────────────────────────────────────────

  function openEquipWizard(doc: RfqDocument, resp: RfqResponse) {
    const docEquip = (doc.equip_rows || []) as RfqEquipRow[]
    if (!docEquip.length) { toast('No equipment items in this RFQ', 'info'); return }
    const respEquip = resp.equip || []
    const rows: EquipWizardRow[] = docEquip.map(item => {
      const re = respEquip.find(e => e.desc === item.desc)
      return {
        desc: item.desc,
        rate: re?.rate || 0,
        unit: (item.unit === 'weeks' ? 'weekly' : 'daily') as 'daily' | 'weekly',
        start_date: item.dateStart || doc.start_date || '',
        end_date: item.dateEnd || doc.end_date || '',
        transport_in: re?.transportIn || 0,
        transport_out: re?.transportOut || 0,
        include: true,
      }
    })
    setEquipWizard({ doc, resp, rows })
  }

  function updateEquipRow<K extends keyof EquipWizardRow>(i: number, field: K, val: EquipWizardRow[K]) {
    setEquipWizard(w => w ? { ...w, rows: w.rows.map((r, j) => j === i ? { ...r, [field]: val } : r) } : w)
  }

  async function execEquipImport() {
    if (!equipWizard || !activeProject) return
    setEquipSaving(true)
    const toImport = equipWizard.rows.filter(r => r.include)
    if (!toImport.length) { toast('No items selected', 'info'); setEquipSaving(false); return }

    const inserts = toImport.map(r => {
      const days = r.start_date && r.end_date
        ? Math.max(0, Math.ceil((new Date(r.end_date).getTime() - new Date(r.start_date).getTime()) / 86400000))
        : 0
      const periods = r.unit === 'weekly' ? Math.ceil(days / 7) : days
      const hireCost = r.rate * periods
      const totalCost = hireCost + r.transport_in + r.transport_out
      return {
        project_id: activeProject.id,
        hire_type: 'dry',
        name: r.desc,
        vendor: equipWizard.resp.vendor,
        description: `Imported from RFQ — ${equipWizard.doc.title || ''}`,
        start_date: r.start_date || null,
        end_date: r.end_date || null,
        daily_rate: r.unit === 'daily' ? r.rate : null,
        weekly_rate: r.unit === 'weekly' ? r.rate : null,
        charge_unit: r.unit,
        transport_in: r.transport_in,
        transport_out: r.transport_out,
        hire_cost: totalCost,
        customer_total: 0,
        gm_pct: activeProject.default_gm || 15,
        currency: 'AUD', qty: 1, notes: '',
        wbs: '',
      }
    })
    const { error } = await supabase.from('hire_items').insert(inserts)
    setEquipSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`${inserts.length} item${inserts.length !== 1 ? 's' : ''} added to Dry Hire`, 'success')
    setEquipWizard(null)
  }

  // ── Rate card ──────────────────────────────────────────────────────────────

  async function execAddToRateCard() {
    if (!rateCardModal || !activeProject) return
    const { resp, doc, destination } = rateCardModal
    const labour = resp.labour || []
    if (!labour.length) { toast('No labour rates in this response', 'info'); return }
    setRateCardSaving(true)

    // Find best-matching role from rate card for regime defaults
    const findRegime = (role: string) => {
      const existing = rateCards.find(rc => rc.role.toLowerCase() === role.toLowerCase())
      return existing?.regime || null
    }

    if (destination === 'project') {
      const inserts = labour.filter(l => l.rates?.dnt).map(l => ({
        project_id: activeProject.id,
        role: l.role || resp.vendor,
        category: 'subcontractor',
        currency: 'AUD',
        subcon_vendor: resp.vendor,
        rates: {
          cost: {
            dnt: l.rates.dnt, dt15: l.rates.dt15, ddt: l.rates.ddt,
            ddt15: l.rates.ddt15, nnt: l.rates.nnt, ndt: l.rates.ndt, ndt15: l.rates.ndt15,
          },
          sell: {
            dnt: l.rates.dnt, dt15: l.rates.dt15, ddt: l.rates.ddt,
            ddt15: l.rates.ddt15, nnt: l.rates.nnt, ndt: l.rates.ndt, ndt15: l.rates.ndt15,
          },
        },
        regime: findRegime(l.role || '') || { wdNT: l.rates.ntHrs || 7.2, wdT15: l.rates.ot1Hrs || 3.3 },
        laha_cost: l.rates.laha || 0, laha_sell: l.rates.laha || 0,
        fsa_cost: 0, fsa_sell: 0, meal_cost: 0, meal_sell: 0, camp: 0,
      }))
      if (!inserts.length) { toast('No hourly rates to add (dnt is required)', 'info'); setRateCardSaving(false); return }
      const { error } = await supabase.from('rate_cards').insert(inserts)
      setRateCardSaving(false)
      if (error) { toast(error.message, 'error'); return }
      toast(`${inserts.length} role${inserts.length !== 1 ? 's' : ''} added to project rate card`, 'success')
      setRateCards(prev => [...prev]) // trigger refresh
    } else {
      // Global — submit for approval
      const submissions = labour.filter(l => l.rates?.dnt).map(l => ({
        project_id: activeProject.id,
        rfq_document_id: doc.id,
        role: l.role || resp.vendor,
        category: 'subcontractor',
        subcon_vendor: resp.vendor,
        rates: {
          cost: {
            dnt: l.rates.dnt, dt15: l.rates.dt15, ddt: l.rates.ddt,
            ddt15: l.rates.ddt15, nnt: l.rates.nnt, ndt: l.rates.ndt, ndt15: l.rates.ndt15,
          },
          sell: {
            dnt: l.rates.dnt, dt15: l.rates.dt15, ddt: l.rates.ddt,
            ddt15: l.rates.ddt15, nnt: l.rates.nnt, ndt: l.rates.ndt, ndt15: l.rates.ndt15,
          },
        },
        laha: l.rates.laha || 0,
        status: 'pending',
        submitted_at: new Date().toISOString(),
      }))
      if (!submissions.length) { toast('No hourly rates to submit', 'info'); setRateCardSaving(false); return }
      const { error } = await supabase.from('global_rate_card_submissions').insert(submissions)
      setRateCardSaving(false)
      if (error) { toast(error.message, 'error'); return }
      toast(`${submissions.length} role${submissions.length !== 1 ? 's' : ''} submitted for global rate card approval`, 'success')
    }
    setRateCardModal(null)
  }

  // ── PO creation ────────────────────────────────────────────────────────────

  async function createPOFromRFQ(doc: RfqDocument, resp: RfqResponse) {
    if (!confirm(`Create a PO for ${resp.vendor} from this RFQ?`)) return
    const lineItems = [
      ...(resp.labour || []).map(l => ({
        id: Math.random().toString(36).slice(2),
        description: l.role || 'Labour', wbs: '', value: 0, notes: '',
      })),
      ...(resp.equip || []).map(e => ({
        id: Math.random().toString(36).slice(2),
        description: e.desc || 'Equipment', wbs: '', value: e.rate || 0, notes: '',
      })),
    ]
    if (!lineItems.length) lineItems.push({
      id: Math.random().toString(36).slice(2),
      description: doc.title || 'Subcontract', wbs: '', value: resp.total_quote || 0, notes: '',
    })
    const { data: po, error } = await supabase.from('purchase_orders').insert({
      project_id: activeProject!.id,
      vendor: resp.vendor,
      description: doc.title || 'Subcontract work',
      status: 'quoted',
      currency: resp.currency || 'AUD',
      po_value: resp.total_quote || null,
      po_type: 'rates',
      effective_start: doc.start_date || null,
      effective_end: doc.end_date || null,
      notes: `Created from RFQ: ${doc.title}`,
      quote_source: { type: 'rfq', rfqId: doc.id, responseId: resp.id, docTitle: doc.title },
      line_items: lineItems,
    }).select().single()
    if (error) { toast(error.message, 'error'); return }
    await supabase.from('rfq_documents').update({ linked_po_id: (po as { id: string }).id }).eq('id', doc.id)
    setDocs(docs.map(d => d.id === doc.id ? { ...d, linked_po_id: (po as { id: string }).id } : d))
    toast('PO created — opening editor…', 'success')
    setPendingPoId((po as { id: string }).id)
    setActivePanel('purchase-orders')
  }

  async function viewPdf(path: string) {
    try { window.open(await getQuotePdfSignedUrl(path), '_blank') }
    catch (e) { toast((e as Error).message, 'error') }
  }

  function toggleExpand(id: string) {
    setExpanded(e => { const next = new Set(e); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  if (loading) return <div style={{ padding: '24px' }}><div className="loading-center"><span className="spinner" /></div></div>

  const responsesByDoc: Record<string, RfqResponse[]> = {}
  responses.forEach(r => {
    if (!responsesByDoc[r.rfq_document_id]) responsesByDoc[r.rfq_document_id] = []
    responsesByDoc[r.rfq_document_id].push(r)
  })

  const issuedCount  = docs.filter(d => d.stage === 'issued').length
  const awardedCount = docs.filter(d => d.stage === 'awarded' || d.stage === 'contracted').length
  const overdue      = docs.filter(d => d.deadline && d.deadline < todayStr && d.stage === 'issued').length

  return (
    <div style={{ padding: '24px', maxWidth: '1280px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>RFQ Register</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>Track RFQs from issue through vendor responses to PO award</p>
        </div>
        <button className="btn btn-primary" onClick={() => setActivePanel('subcon-rfq-doc')}>+ New RFQ</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px', marginBottom: '16px' }}>
        {[
          { label: 'Total RFQs', value: docs.length,   color: '#7c3aed' },
          { label: 'Issued',     value: issuedCount,   color: '#3b82f6' },
          { label: 'Awarded',    value: awardedCount,  color: 'var(--green)' },
          { label: 'Overdue',    value: overdue,       color: overdue > 0 ? 'var(--red)' : 'var(--text3)' },
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
          <p>Build a Request for Quotation, send to vendors, log responses, then create a PO.</p>
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
                          <button onClick={() => toggleExpand(doc.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', color: 'var(--text2)', padding: '2px 4px' }}>
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
                            <span style={{ fontSize: '13px', fontWeight: 700, fontFamily: 'var(--mono)' }}>{sentCount}</span>
                            <button onClick={() => setVendorsSentModal(doc)} style={{ padding: '1px 6px', fontSize: '10px', border: '1px solid var(--border)', borderRadius: '3px', background: 'transparent', color: 'var(--text3)', cursor: 'pointer' }}>Edit</button>
                          </div>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                            <span style={{ fontSize: '13px', fontWeight: 700, fontFamily: 'var(--mono)', color: docResponses.length > 0 ? 'var(--green)' : 'var(--text3)' }}>{docResponses.length}</span>
                            <button onClick={() => setResponseModal({ doc, existing: null })} style={{ padding: '1px 6px', fontSize: '10px', border: '1px solid #7c3aed', borderRadius: '3px', background: 'transparent', color: '#7c3aed', cursor: 'pointer' }}>+ Add</button>
                          </div>
                        </td>
                        <td>
                          <select style={{ fontSize: '11px', padding: '3px 6px', border: `1px solid ${stageColor}`, borderRadius: '4px', background: 'transparent', color: stageColor, fontWeight: 600, cursor: 'pointer' }}
                            value={doc.stage} onChange={e => updateStage(doc.id, e.target.value)}>
                            {STAGES.map(s => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                          </select>
                        </td>
                        <td>
                          {awardedResp ? (
                            <div>
                              <div style={{ fontSize: '11px', fontWeight: 600, color: '#059669' }}>✓ {awardedResp.vendor}</div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '3px' }}>
                                {doc.linked_po_id ? (
                                  <button onClick={() => setActivePanel('purchase-orders')} style={{ fontSize: '10px', padding: '2px 6px', border: '1px solid #1e40af', borderRadius: '3px', background: '#eff6ff', color: '#1e40af', cursor: 'pointer' }}>
                                    🔗 PO linked
                                  </button>
                                ) : (
                                  <button onClick={() => createPOFromRFQ(doc, awardedResp)} style={{ fontSize: '10px', padding: '2px 6px', border: '1px solid #1e40af', borderRadius: '3px', background: 'transparent', color: '#1e40af', cursor: 'pointer', fontWeight: 600 }}>
                                    💼 Create PO →
                                  </button>
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
                            {docResponses.length > 0 && (
                              <button className="btn btn-sm" style={{ fontSize: '10px', background: '#7c3aed', color: '#fff' }} onClick={() => setActivePanel('subcon-rfq')} title="Model costs">📈</button>
                            )}
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
                              onImportResources={(r) => openResWizard(doc, r)}
                              onImportEquip={(r) => openEquipWizard(doc, r)}
                              onAddToRateCard={(r) => setRateCardModal({ doc, resp: r, destination: 'project' })}
                              onModelCosts={() => setActivePanel('subcon-rfq')}
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

      {/* ── Modals ─────────────────────────────────────────────────────────── */}

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

      {/* Resource Import Wizard */}
      {importWizard && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '960px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>👥 Import Resources from Award</h3>
              <button className="btn btn-sm" onClick={() => setImportWizard(null)}>✕</button>
            </div>
            <div className="modal-body" style={{ flex: 1, overflowY: 'auto' }}>
              <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '12px' }}>
                Vendor: <strong style={{ color: '#7c3aed' }}>{importWizard.resp.vendor}</strong> · {importWizard.rows.length} position{importWizard.rows.length !== 1 ? 's' : ''}. Fill in names — leave blank to skip. Imported as <strong>Subcontractor</strong> type.
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg3)' }}>
                      <th style={{ padding: '7px 6px', width: '28px', textAlign: 'center' }}>
                        <input type="checkbox" checked={importWizard.rows.every(r => r.include)} style={{ accentColor: '#7c3aed' }}
                          onChange={e => setImportWizard(w => w ? { ...w, rows: w.rows.map(r => ({ ...r, include: e.target.checked })) } : w)} />
                      </th>
                      <th style={{ padding: '7px 6px', textAlign: 'left' }}>Role / Name</th>
                      <th style={{ padding: '7px 6px', textAlign: 'left', width: '90px' }}>Shift</th>
                      <th style={{ padding: '7px 6px', textAlign: 'left', width: '110px' }}>Mob In</th>
                      <th style={{ padding: '7px 6px', textAlign: 'left', width: '110px' }}>Mob Out</th>
                      <th style={{ padding: '7px 6px', textAlign: 'left', width: '110px' }}>Phone</th>
                      <th style={{ padding: '7px 6px', textAlign: 'left', width: '150px' }}>Email</th>
                      <th style={{ padding: '7px 6px', textAlign: 'left', width: '120px' }}>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importWizard.rows.map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)', opacity: row.include ? 1 : 0.4 }}>
                        <td style={{ padding: '5px 6px', textAlign: 'center' }}>
                          <input type="checkbox" checked={row.include} style={{ accentColor: '#7c3aed' }}
                            onChange={e => updateResRow(i, 'include', e.target.checked)} />
                        </td>
                        <td style={{ padding: '5px 6px' }}>
                          <div style={{ fontSize: '10px', fontWeight: 600, color: '#7c3aed', marginBottom: '2px' }}>{row.role || '—'}</div>
                          <input className="input" placeholder="Full name" value={row.name}
                            onChange={e => updateResRow(i, 'name', e.target.value)}
                            style={{ fontSize: '11px', padding: '3px 6px' }} />
                        </td>
                        <td style={{ padding: '5px 6px' }}>
                          <select className="input" value={row.shift} onChange={e => updateResRow(i, 'shift', e.target.value)}
                            style={{ fontSize: '11px', padding: '3px 6px' }}>
                            <option value="day">Day</option>
                            <option value="night">Night</option>
                            <option value="both">Both</option>
                          </select>
                        </td>
                        <td style={{ padding: '5px 6px' }}>
                          <input type="date" className="input" value={row.mob_in}
                            onChange={e => updateResRow(i, 'mob_in', e.target.value)}
                            style={{ fontSize: '11px', padding: '3px 4px' }} />
                        </td>
                        <td style={{ padding: '5px 6px' }}>
                          <input type="date" className="input" value={row.mob_out}
                            onChange={e => updateResRow(i, 'mob_out', e.target.value)}
                            style={{ fontSize: '11px', padding: '3px 4px' }} />
                        </td>
                        <td style={{ padding: '5px 6px' }}>
                          <input className="input" placeholder="Phone" value={row.phone}
                            onChange={e => updateResRow(i, 'phone', e.target.value)}
                            style={{ fontSize: '11px', padding: '3px 6px' }} />
                        </td>
                        <td style={{ padding: '5px 6px' }}>
                          <input className="input" placeholder="Email" value={row.email}
                            onChange={e => updateResRow(i, 'email', e.target.value)}
                            style={{ fontSize: '11px', padding: '3px 6px' }} />
                        </td>
                        <td style={{ padding: '5px 6px' }}>
                          <input className="input" placeholder="Notes" value={row.notes}
                            onChange={e => updateResRow(i, 'notes', e.target.value)}
                            style={{ fontSize: '11px', padding: '3px 6px' }} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setImportWizard(null)}>Cancel</button>
              <button className="btn btn-primary" style={{ background: '#7c3aed' }} onClick={execImportResources} disabled={importSaving}>
                {importSaving ? <span className="spinner" style={{ width: '14px', height: '14px' }} /> : null}
                Import Selected
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Equipment Import Wizard */}
      {equipWizard && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '860px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>🚜 Import Equipment to Dry Hire</h3>
              <button className="btn btn-sm" onClick={() => setEquipWizard(null)}>✕</button>
            </div>
            <div className="modal-body" style={{ flex: 1, overflowY: 'auto' }}>
              <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '12px' }}>
                RFQ: <strong>{equipWizard.doc.title}</strong> · Vendor: <strong style={{ color: 'var(--mod-hire, #d97706)' }}>{equipWizard.resp.vendor}</strong><br />
                Tick items to import. Adjust rates and dates. All items import as Dry Hire.
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg3)' }}>
                      <th style={{ padding: '6px 8px', border: '1px solid var(--border2)', textAlign: 'center', width: '28px' }}>
                        <input type="checkbox" checked={equipWizard.rows.every(r => r.include)}
                          onChange={e => setEquipWizard(w => w ? { ...w, rows: w.rows.map(r => ({ ...r, include: e.target.checked })) } : w)} />
                      </th>
                      <th style={{ padding: '6px 8px', border: '1px solid var(--border2)', textAlign: 'left' }}>Equipment</th>
                      <th style={{ padding: '6px 8px', border: '1px solid var(--border2)', textAlign: 'left', width: '80px' }}>Rate ($)</th>
                      <th style={{ padding: '6px 8px', border: '1px solid var(--border2)', textAlign: 'left', width: '80px' }}>Unit</th>
                      <th style={{ padding: '6px 8px', border: '1px solid var(--border2)', textAlign: 'left', width: '115px' }}>Start</th>
                      <th style={{ padding: '6px 8px', border: '1px solid var(--border2)', textAlign: 'left', width: '115px' }}>End</th>
                      <th style={{ padding: '6px 8px', border: '1px solid var(--border2)', textAlign: 'left', width: '80px' }}>Trans In</th>
                      <th style={{ padding: '6px 8px', border: '1px solid var(--border2)', textAlign: 'left', width: '80px' }}>Trans Out</th>
                    </tr>
                  </thead>
                  <tbody>
                    {equipWizard.rows.map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)', opacity: row.include ? 1 : 0.5 }}>
                        <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                          <input type="checkbox" checked={row.include}
                            onChange={e => updateEquipRow(i, 'include', e.target.checked)} />
                        </td>
                        <td style={{ padding: '5px 8px', fontWeight: 600 }}>{row.desc}</td>
                        <td style={{ padding: '5px 8px' }}>
                          <input type="number" className="input" value={row.rate || ''} step="0.01"
                            onChange={e => updateEquipRow(i, 'rate', parseFloat(e.target.value) || 0)}
                            style={{ width: '72px', padding: '3px 5px', fontSize: '11px' }} />
                        </td>
                        <td style={{ padding: '5px 8px' }}>
                          <select className="input" value={row.unit}
                            onChange={e => updateEquipRow(i, 'unit', e.target.value as 'daily' | 'weekly')}
                            style={{ padding: '3px 5px', fontSize: '11px' }}>
                            <option value="daily">Daily</option>
                            <option value="weekly">Weekly</option>
                          </select>
                        </td>
                        <td style={{ padding: '5px 8px' }}>
                          <input type="date" className="input" value={row.start_date}
                            onChange={e => updateEquipRow(i, 'start_date', e.target.value)}
                            style={{ padding: '3px 4px', fontSize: '11px' }} />
                        </td>
                        <td style={{ padding: '5px 8px' }}>
                          <input type="date" className="input" value={row.end_date}
                            onChange={e => updateEquipRow(i, 'end_date', e.target.value)}
                            style={{ padding: '3px 4px', fontSize: '11px' }} />
                        </td>
                        <td style={{ padding: '5px 8px' }}>
                          <input type="number" className="input" value={row.transport_in || ''} step="0.01" placeholder="0"
                            onChange={e => updateEquipRow(i, 'transport_in', parseFloat(e.target.value) || 0)}
                            style={{ width: '70px', padding: '3px 5px', fontSize: '11px' }} />
                        </td>
                        <td style={{ padding: '5px 8px' }}>
                          <input type="number" className="input" value={row.transport_out || ''} step="0.01" placeholder="0"
                            onChange={e => updateEquipRow(i, 'transport_out', parseFloat(e.target.value) || 0)}
                            style={{ width: '70px', padding: '3px 5px', fontSize: '11px' }} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setEquipWizard(null)}>Cancel</button>
              <button className="btn btn-primary" style={{ background: '#d97706', borderColor: '#d97706' }} onClick={execEquipImport} disabled={equipSaving}>
                {equipSaving ? <span className="spinner" style={{ width: '14px', height: '14px' }} /> : null}
                Import Selected →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rate Card Modal */}
      {rateCardModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '460px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>📋 Add to Rate Card</h3>
              <button className="btn btn-sm" onClick={() => setRateCardModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '14px' }}>
                Vendor: <strong>{rateCardModal.resp.vendor}</strong> · {(rateCardModal.resp.labour || []).filter(l => l.rates?.dnt).length} role{(rateCardModal.resp.labour || []).filter(l => l.rates?.dnt).length !== 1 ? 's' : ''} with hourly rates will be added.
              </div>
              {/* Rate preview */}
              <div style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {(rateCardModal.resp.labour || []).filter(l => l.rates?.dnt).map((l, i) => (
                  <div key={i} style={{ fontSize: '11px', padding: '5px 10px', background: 'var(--bg3)', borderRadius: '4px', border: '1px solid var(--border)' }}>
                    <span style={{ fontWeight: 600 }}>{l.role}</span>
                    {l.rates.dnt ? ` · NT $${l.rates.dnt}` : ''}
                    {l.rates.dt15 ? ` · T1.5 $${l.rates.dt15}` : ''}
                    {l.rates.ddt ? ` · DT $${l.rates.ddt}` : ''}
                    {l.rates.laha ? ` · LAHA $${l.rates.laha}/day` : ''}
                  </div>
                ))}
              </div>
              {/* Destination picker */}
              <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px' }}>Where should these rates be added?</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {([
                  { val: 'project', label: '📁 This project only', desc: 'Rates appear immediately in this project\'s Rate Card register. Only visible here.' },
                  { val: 'global',  label: '🌐 Global rate card (pending approval)', desc: 'Submitted for admin approval. Once approved, rates appear across all projects as reference data.' },
                ] as const).map(opt => (
                  <label key={opt.val} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 12px', border: `1px solid ${rateCardModal.destination === opt.val ? '#7c3aed' : 'var(--border)'}`, borderRadius: '6px', cursor: 'pointer', background: rateCardModal.destination === opt.val ? '#f3e8ff' : 'var(--bg2)' }}>
                    <input type="radio" name="rcDest" value={opt.val} checked={rateCardModal.destination === opt.val}
                      onChange={() => setRateCardModal(m => m ? { ...m, destination: opt.val } : m)}
                      style={{ marginTop: '2px', accentColor: '#7c3aed' }} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '12px' }}>{opt.label}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>{opt.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setRateCardModal(null)}>Cancel</button>
              <button className="btn btn-primary" style={{ background: '#7c3aed' }} onClick={execAddToRateCard} disabled={rateCardSaving}>
                {rateCardSaving ? <span className="spinner" style={{ width: '14px', height: '14px' }} /> : null}
                {rateCardModal.destination === 'project' ? 'Add to Rate Card' : 'Submit for Approval'}
              </button>
            </div>
          </div>
        </div>
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
  onImportResources: (r: RfqResponse) => void
  onImportEquip: (r: RfqResponse) => void
  onAddToRateCard: (r: RfqResponse) => void
  onModelCosts: () => void
}

function ResponsesInline({ doc, responses, awardedResp, onAddResponse, onEditResponse, onDeleteResponse, onAward, onViewPdf, onImportResources, onImportEquip, onAddToRateCard, onModelCosts }: InlineProps) {
  if (!responses.length) {
    return (
      <div style={{ padding: '14px 20px' }}>
        <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '8px' }}>No responses recorded yet.</div>
        <button onClick={onAddResponse} style={{ fontSize: '11px', padding: '4px 10px', border: '1px solid #7c3aed', borderRadius: '4px', background: 'transparent', color: '#7c3aed', cursor: 'pointer' }}>+ Add Response</button>
      </div>
    )
  }

  const hasEquip = (doc.equip_rows || []).length > 0
    const fmtDate  = (s: string | null) => s ? s.split('-').reverse().join('/') : '—'

  return (
    <div style={{ padding: '14px 20px' }}>
      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '10px' }}>
        Vendor Responses — {doc.title}
      </div>
      <div style={{ display: 'grid', gap: '8px' }}>
        {responses.map(r => {
          const isAwarded = awardedResp?.id === r.id
          const hasLabour = (r.labour || []).length > 0 && (r.labour || []).some(l => l.rates?.dnt)
          return (
            <div key={r.id} style={{ padding: '10px 14px', border: `2px solid ${isAwarded ? '#059669' : 'var(--border)'}`, borderRadius: '6px', background: isAwarded ? '#f0fdf4' : 'var(--bg2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <div style={{ fontWeight: 700, fontSize: '12px' }}>
                  {r.vendor}
                  {isAwarded && <span style={{ fontSize: '10px', background: '#d1fae5', color: '#065f46', padding: '1px 6px', borderRadius: '10px', marginLeft: '6px' }}>✓ AWARDED</span>}
                </div>
                {r.received_date && <div style={{ fontSize: '10px', color: 'var(--text3)' }}>Received {fmtDate(r.received_date)}</div>}
                {r.total_quote != null && (
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '13px', fontWeight: 700, color: isAwarded ? '#059669' : 'var(--text)' }}>
                    {'$' + Number(r.total_quote).toLocaleString('en-AU', { maximumFractionDigits: 2 })} {r.currency || ''}
                  </div>
                )}
                {r.notes && <div style={{ fontSize: '11px', color: 'var(--text2)', flex: 1 }}>{r.notes}</div>}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {/* PDF */}
                  {r.quote_pdf_path && (
                    <button onClick={() => onViewPdf(r.quote_pdf_path!)} title={r.quote_pdf_name || 'View quote PDF'} style={{ fontSize: '10px', padding: '3px 8px', border: '1px solid #0891b2', borderRadius: '4px', background: '#f0f9ff', color: '#0369a1', cursor: 'pointer', fontWeight: 600 }}>📄 PDF</button>
                  )}
                  {/* Award → (non-awarded only) */}
                  {!isAwarded && doc.stage !== 'contracted' && doc.stage !== 'cancelled' && (
                    <button onClick={() => onAward(r)} style={{ fontSize: '10px', padding: '3px 8px', border: '1px solid #059669', borderRadius: '4px', background: 'transparent', color: '#059669', cursor: 'pointer', fontWeight: 600 }}>Award →</button>
                  )}
                  {/* Awarded-only actions */}
                  {isAwarded && hasLabour && (
                    <button onClick={() => onAddToRateCard(r)} style={{ fontSize: '10px', padding: '3px 8px', border: '1px solid #7c3aed', borderRadius: '4px', background: '#f3e8ff', color: '#7c3aed', cursor: 'pointer', fontWeight: 600 }}>📋 Add to Rate Card</button>
                  )}
                  {isAwarded && (doc.labour_rows || []).length > 0 && (
                    <button onClick={() => onImportResources(r)} style={{ fontSize: '10px', padding: '3px 8px', border: '1px solid #059669', borderRadius: '4px', background: '#f0fdf4', color: '#059669', cursor: 'pointer', fontWeight: 600 }}>👥 Import Resources</button>
                  )}
                  {isAwarded && hasEquip && (
                    <button onClick={() => onImportEquip(r)} style={{ fontSize: '10px', padding: '3px 8px', border: '1px solid #d97706', borderRadius: '4px', background: '#fffbeb', color: '#d97706', cursor: 'pointer', fontWeight: 600 }}>🚜 Import Equipment</button>
                  )}
                  {/* Edit / Delete */}
                  <button onClick={() => onEditResponse(r)} style={{ fontSize: '10px', padding: '3px 8px', border: '1px solid var(--border)', borderRadius: '4px', background: 'transparent', color: 'var(--text3)', cursor: 'pointer' }}>Edit</button>
                  <button onClick={() => onDeleteResponse(r)} style={{ fontSize: '10px', padding: '3px 8px', border: '1px solid var(--red)', borderRadius: '4px', background: 'transparent', color: 'var(--red)', cursor: 'pointer' }}>✕</button>
                </div>
              </div>
              {/* Rate chips */}
              {(r.labour?.length > 0 || r.equip?.length > 0) && (
                <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {(r.labour || []).map((l, i) => (
                    <div key={`l${i}`} style={{ fontSize: '10px', padding: '3px 8px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '4px' }}>
                      <span style={{ fontWeight: 600 }}>{l.role}</span>
                      {l.rates.rateMode === 'flat' ? (
                        <>{l.rates.flatDs ? ` · DS $${l.rates.flatDs}/shift` : ''}{l.rates.flatNs ? ` · NS $${l.rates.flatNs}/shift` : ''}</>
                      ) : (
                        <>{l.rates.dnt ? ` · NT $${l.rates.dnt}/hr` : ''}{l.rates.dt15 ? ` · T1.5 $${l.rates.dt15}/hr` : ''}{l.rates.ddt ? ` · DT $${l.rates.ddt}/hr` : ''}</>
                      )}
                      {l.rates.laha ? ` · LAHA $${l.rates.laha}/day` : ''}
                    </div>
                  ))}
                  {(r.equip || []).map((e, i) => (
                    <div key={`e${i}`} style={{ fontSize: '10px', padding: '3px 8px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '4px' }}>
                      <span style={{ fontWeight: 600 }}>{e.desc}</span>{e.rate ? ` · $${e.rate}/${e.unit || 'day'}` : ''}
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
      {/* Bottom row: Add Response + Model Costs */}
      <div style={{ marginTop: '10px', display: 'flex', gap: '8px', alignItems: 'center' }}>
        <button onClick={onAddResponse} style={{ fontSize: '11px', padding: '4px 10px', border: '1px solid #7c3aed', borderRadius: '4px', background: 'transparent', color: '#7c3aed', cursor: 'pointer' }}>+ Add Response</button>
        <button onClick={onModelCosts} style={{ fontSize: '11px', padding: '4px 10px', border: '1px solid #7c3aed', borderRadius: '4px', background: '#7c3aed', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>📈 Model Costs</button>
      </div>
    </div>
  )
}
