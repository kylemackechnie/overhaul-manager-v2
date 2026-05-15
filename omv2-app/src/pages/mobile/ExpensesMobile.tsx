import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { MobilePanelHeader } from '../../components/mobile/MobilePanelHeader'
import { MobileBottomSheet } from '../../components/mobile/ui/MobileBottomSheet'
import { MobileQtyStepper } from '../../components/mobile/ui/MobileQtyStepper'
import { useRegisterRefresh } from '../../components/mobile/ui/RefreshContext'
import { uploadReceipt, getSignedUrl, fileIcon, fileName } from '../../lib/receiptStorage'

// Compact categories list. Same as desktop — kept in sync intentionally.
const CATEGORIES = [
  'Travel', 'Meals', 'Accommodation', 'Equipment', 'Tools',
  'Freight', 'Consumables', 'PPE', 'Credit', 'Upfront Payment',
  'Fixed Cost', 'Other',
]

interface RecentExpense {
  id: string
  description: string
  vendor: string
  category: string
  date: string | null
  cost_ex_gst: number
  amount: number
  expense_ref: string | null
  receipt_paths: string[]
}

// ════════════════════════════════════════════════════════════════════════
// Helpers — kept inline (small, panel-specific)
// ════════════════════════════════════════════════════════════════════════

/** Build a description-slug for the EXP-#### filing reference. Mirrors
 *  desktop logic so the slug format is consistent across shells. */
function buildRefSlug(description: string, amount: number): string {
  const clean = (s: string) => s.trim().replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '-').slice(0, 40)
  const descSlug = clean(description) || 'Desc'
  const amtSlug = amount ? amount.toFixed(2) : ''
  return [descSlug, amtSlug].filter(Boolean).join('_')
}

async function assignExpenseRef(
  projectId: string, expenseId: string, description: string, costExGst: number,
): Promise<string> {
  const { data } = await supabase
    .from('expenses')
    .select('expense_ref')
    .eq('project_id', projectId)
    .not('expense_ref', 'is', null)
  const nums = (data || [])
    .map(e => { const m = (e.expense_ref || '').match(/EXP-(\d+)/); return m ? parseInt(m[1]) : 0 })
    .filter(n => n > 0)
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1
  const ref = `EXP-${String(next).padStart(4, '0')}_${buildRefSlug(description, costExGst)}`
  await supabase.from('expenses').update({ expense_ref: ref }).eq('id', expenseId)
  return ref
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

// ════════════════════════════════════════════════════════════════════════
// Main component
// ════════════════════════════════════════════════════════════════════════

/**
 * Mobile Expenses — quick receipt capture in the field.
 *
 * Optimised for the killer use case: engineer has a paper receipt in hand,
 * wants to capture it before they lose it. The minimum-viable flow:
 *
 *   tap "+ Receipt" → camera opens → snap → fill 4 fields → save
 *
 * Bulk editing (GM%, WBS, TCE link, vendor cleanup, etc.) happens later
 * on desktop. The mobile form deliberately omits these to keep the form
 * short — they all have sensible defaults from activeProject.
 *
 * Receipt photos are uploaded to the existing 'receipts' Supabase Storage
 * bucket and the path stored in expenses.receipt_paths[] — same model as
 * desktop, so receipts captured on mobile are visible/manageable from
 * desktop and vice versa.
 */
export function ExpensesMobile() {
  const { activeProject } = useAppStore()
  const [recent, setRecent] = useState<RecentExpense[]>([])
  const [loading, setLoading] = useState(true)

  // Form state
  const [sheetOpen, setSheetOpen]   = useState(false)
  const [description, setDescription] = useState('')
  const [vendor, setVendor]         = useState('')
  const [category, setCategory]     = useState<string>('')
  const [date, setDate]             = useState(new Date().toISOString().slice(0, 10))
  const [amountIncGst, setAmountIncGst] = useState(0)  // primary entry — what's on the receipt
  const [notes, setNotes]           = useState('')
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingPreview, setPendingPreview] = useState<string | null>(null)
  const [saving, setSaving]         = useState(false)

  // Detail sheet for tapping a recent expense
  const [detailExp, setDetailExp]   = useState<RecentExpense | null>(null)
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})

  const cameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])
  useRegisterRefresh(load)

  async function load() {
    if (!activeProject) return
    setLoading(true)
    const { data } = await supabase
      .from('expenses')
      .select('id,description,vendor,category,date,cost_ex_gst,amount,expense_ref,receipt_paths')
      .eq('project_id', activeProject.id)
      .order('created_at', { ascending: false })
      .limit(50)
    setRecent((data || []) as RecentExpense[])
    setLoading(false)
  }

  // Reset all form fields to defaults
  function resetForm() {
    setDescription('')
    setVendor('')
    setCategory('')
    setDate(new Date().toISOString().slice(0, 10))
    setAmountIncGst(0)
    setNotes('')
    setPendingFile(null)
    if (pendingPreview) URL.revokeObjectURL(pendingPreview)
    setPendingPreview(null)
  }

  function openNewWithCamera() {
    resetForm()
    setSheetOpen(true)
    // Trigger camera immediately — single-step capture. iOS Safari needs
    // a synchronous click off a user gesture, so we defer slightly to let
    // the sheet mount first.
    setTimeout(() => cameraInputRef.current?.click(), 50)
  }
  function openNewBlank() {
    resetForm()
    setSheetOpen(true)
  }

  function closeSheet() {
    if (saving) return
    setSheetOpen(false)
    if (pendingPreview) URL.revokeObjectURL(pendingPreview)
    setPendingPreview(null)
  }

  /**
   * File input handler — works for both camera (capture=environment) and
   * gallery (no capture attribute). Generates an object URL for instant
   * preview without uploading.
   */
  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (pendingPreview) URL.revokeObjectURL(pendingPreview)
    setPendingFile(file)
    // Preview only works for images. PDFs etc. fall back to icon.
    if (file.type.startsWith('image/')) {
      setPendingPreview(URL.createObjectURL(file))
    } else {
      setPendingPreview(null)
    }
    // Reset the input so picking the same file again still fires onChange
    e.target.value = ''
  }

  async function save() {
    if (!activeProject) return
    if (!description.trim()) { toast('Description required', 'error'); return }
    if (amountIncGst <= 0)    { toast('Amount must be > 0', 'error'); return }

    setSaving(true)
    const defaultGm = (activeProject.default_gm ?? 15) as number
    const costExGst = parseFloat((amountIncGst / 1.1).toFixed(2))
    // Sell price = cost / (1 - gm/100). Pre-fills the desktop's automated
    // formula so when a PM opens this later it Just Works.
    const sellPrice = defaultGm > 0 && defaultGm < 100
      ? parseFloat((costExGst / (1 - defaultGm / 100)).toFixed(2))
      : costExGst

    const payload = {
      project_id: activeProject.id,
      resource_id: null,
      category: category || 'Other',
      description: description.trim(),
      vendor: vendor.trim(),
      date: date || null,
      amount: amountIncGst,
      cost_ex_gst: costExGst,
      sell_price: sellPrice,
      gm_pct: defaultGm,
      currency: 'AUD',
      wbs: '',
      notes: notes.trim(),
      tce_item_id: null,
      chargeable: true,
    }

    // Insert expense
    const { data, error } = await supabase.from('expenses').insert(payload).select('id').single()
    if (error || !data) {
      setSaving(false)
      toast(`Save failed: ${error?.message || 'unknown'}`, 'error')
      return
    }
    const expenseId = data.id as string

    // Assign ISO filing reference (EXP-NNNN_slug)
    const ref = await assignExpenseRef(activeProject.id, expenseId, description, costExGst)

    // Upload receipt if any
    let receiptPaths: string[] = []
    if (pendingFile) {
      const { path, error: upErr } = await uploadReceipt(activeProject.id, expenseId, pendingFile)
      if (upErr) {
        // Soft-fail: expense was saved, but receipt couldn't upload. Tell
        // the user; they can retry the photo on desktop. Don't roll back
        // the expense — entering the data is the harder part.
        toast(`Saved ${ref} but photo upload failed: ${upErr}`, 'error')
      } else if (path) {
        receiptPaths = [path]
        await supabase.from('expenses').update({ receipt_paths: receiptPaths }).eq('id', expenseId)
      }
    }

    setSaving(false)
    toast(`${ref} saved`, 'success')
    closeSheet()
    load()
  }

  /**
   * When user taps a recent expense to view detail. Pre-fetch signed URLs
   * for any receipts attached so they render immediately.
   */
  async function openDetail(exp: RecentExpense) {
    setDetailExp(exp)
    if (exp.receipt_paths?.length) {
      // Fetch signed URLs for each path in parallel
      const urls: Record<string, string> = {}
      await Promise.all(exp.receipt_paths.map(async p => {
        const url = await getSignedUrl(p)
        if (url) urls[p] = url
      }))
      setSignedUrls(prev => ({ ...prev, ...urls }))
    }
  }

  return (
    <>
      <MobilePanelHeader
        title="Receipts"
        subtitle={loading ? 'Loading…' : `${recent.length} recent`}
      />

      {/* Action buttons — camera-first, with gallery + blank options */}
      <div className="mobile-receipt-actions">
        <button
          type="button"
          className="mobile-receipt-primary"
          onClick={openNewWithCamera}
        >
          <span style={{ fontSize: 22 }}>📸</span>
          <span>Snap receipt</span>
        </button>
        <button
          type="button"
          className="mobile-receipt-secondary"
          onClick={() => { resetForm(); setSheetOpen(true); setTimeout(() => galleryInputRef.current?.click(), 50) }}
          aria-label="Pick from gallery"
          title="Pick from gallery"
        >
          🖼
        </button>
        <button
          type="button"
          className="mobile-receipt-secondary"
          onClick={openNewBlank}
          aria-label="Enter without photo"
          title="Enter without photo"
        >
          ✎
        </button>
      </div>

      {/* Hidden file inputs — one for camera, one for gallery. capture=environment
          triggers the back camera directly. Without capture, iOS shows a chooser
          (camera / library / files) which is what we want for the gallery button. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleFile}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*,.pdf"
        style={{ display: 'none' }}
        onChange={handleFile}
      />

      {/* Recent list */}
      {loading ? (
        <div className="mobile-loading"><span className="spinner" /> Loading…</div>
      ) : recent.length === 0 ? (
        <div className="mobile-empty">
          <div className="mobile-empty-icon">🧾</div>
          <h3>No receipts yet</h3>
          <p>Tap <strong>Snap receipt</strong> above to capture your first.</p>
        </div>
      ) : (
        <div className="mobile-list">
          <div className="mobile-section-header">Recent</div>
          {recent.map(e => {
            const hasReceipt = (e.receipt_paths || []).length > 0
            return (
              <button
                key={e.id}
                className="mobile-card mobile-receipt-card"
                onClick={() => openDetail(e)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>
                      {e.description || '—'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
                      {e.category}
                      {e.vendor ? <span style={{ color: 'var(--text3)' }}> · {e.vendor}</span> : null}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{fmtMoney(e.amount)}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>{fmtDate(e.date)}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, fontSize: 11, color: 'var(--text3)' }}>
                  {e.expense_ref ? (
                    <span style={{ fontFamily: 'var(--mono)' }}>{e.expense_ref.split('_')[0]}</span>
                  ) : null}
                  {hasReceipt ? (
                    <span style={{ color: 'var(--green)' }}>📎 {e.receipt_paths.length}</span>
                  ) : (
                    <span style={{ color: 'var(--amber)' }}>⚠ No photo</span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* Capture / entry sheet */}
      <MobileBottomSheet
        open={sheetOpen}
        onClose={closeSheet}
        title="New receipt"
        preventBackdropClose={saving}
        height="full"
        footer={(
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%', height: 48, fontWeight: 600 }}
            onClick={save}
            disabled={saving || !description.trim() || amountIncGst <= 0}
          >
            {saving ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Save receipt'}
          </button>
        )}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Photo preview / re-snap */}
          <div className="mobile-receipt-photo-slot">
            {pendingPreview ? (
              <div style={{ position: 'relative' }}>
                <img src={pendingPreview} alt="Receipt preview" className="mobile-receipt-preview" />
                <button
                  type="button"
                  className="mobile-receipt-retake"
                  onClick={() => cameraInputRef.current?.click()}
                >
                  📸 Retake
                </button>
              </div>
            ) : pendingFile ? (
              // Non-image file (PDF) — show icon
              <div className="mobile-receipt-file-icon">
                <span style={{ fontSize: 36 }}>{fileIcon(pendingFile.name)}</span>
                <span style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>{pendingFile.name}</span>
                <button
                  type="button"
                  className="mobile-receipt-retake"
                  onClick={() => cameraInputRef.current?.click()}
                  style={{ marginTop: 8 }}
                >
                  📸 Take photo instead
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="mobile-receipt-attach"
                onClick={() => cameraInputRef.current?.click()}
              >
                <span style={{ fontSize: 36 }}>📸</span>
                <span style={{ marginTop: 6 }}>Tap to snap receipt</span>
                <span style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>or fill in below without a photo</span>
              </button>
            )}
          </div>

          <div>
            <label className="mobile-form-label">What was this for? *</label>
            <input
              className="input"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="e.g. fuel BP Echuca"
              style={{ width: '100%', height: 44 }}
              autoFocus
            />
          </div>

          <div>
            <label className="mobile-form-label">Amount (inc GST) *</label>
            <MobileQtyStepper
              value={amountIncGst}
              onChange={setAmountIncGst}
              min={0}
              step={1}
              size="lg"
            />
            {amountIncGst > 0 && (
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>
                ex GST: {fmtMoney(parseFloat((amountIncGst / 1.1).toFixed(2)))}
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label className="mobile-form-label">Category</label>
              <select
                className="input"
                value={category}
                onChange={e => setCategory(e.target.value)}
                style={{ width: '100%', height: 44 }}
              >
                <option value="">— Pick —</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="mobile-form-label">Date</label>
              <input
                type="date"
                className="input"
                value={date}
                onChange={e => setDate(e.target.value)}
                style={{ width: '100%', height: 44 }}
              />
            </div>
          </div>

          <div>
            <label className="mobile-form-label">Vendor <span style={{ color: 'var(--text3)', fontWeight: 400 }}>(optional)</span></label>
            <input
              className="input"
              value={vendor}
              onChange={e => setVendor(e.target.value)}
              placeholder="e.g. BP, Bunnings"
              style={{ width: '100%', height: 44 }}
            />
          </div>

          <div>
            <label className="mobile-form-label">Notes <span style={{ color: 'var(--text3)', fontWeight: 400 }}>(optional)</span></label>
            <textarea
              className="input"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Any context"
              style={{ width: '100%', resize: 'vertical', minHeight: 50 }}
            />
          </div>

          <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.5, padding: '10px 12px', background: 'var(--bg3)', borderRadius: 6, borderLeft: '3px solid var(--accent)' }}>
            💡 GM %, WBS, TCE link, and sell price are filled with project defaults
            ({(activeProject?.default_gm ?? 15)}% GM). Edit them on desktop when you're ready to charge.
          </div>
        </div>
      </MobileBottomSheet>

      {/* Detail sheet — view a recent expense + its receipts */}
      <MobileBottomSheet
        open={!!detailExp}
        onClose={() => setDetailExp(null)}
        title={detailExp?.expense_ref?.split('_')[0] || 'Receipt'}
        height="full"
      >
        {detailExp && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text)' }}>{detailExp.description}</div>
              <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
                {detailExp.category}
                {detailExp.vendor ? ` · ${detailExp.vendor}` : ''}
              </div>
              <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--text3)', marginTop: 8 }}>
                <span>{fmtDate(detailExp.date)}</span>
                <span style={{ fontWeight: 600, color: 'var(--text)' }}>{fmtMoney(detailExp.amount)}</span>
                <span>ex GST {fmtMoney(detailExp.cost_ex_gst)}</span>
              </div>
            </div>

            {detailExp.receipt_paths.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text3)', fontSize: 13 }}>
                ⚠ No receipt photo attached
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {detailExp.receipt_paths.map(p => {
                  const url = signedUrls[p]
                  const isImage = /\.(jpg|jpeg|png|webp|heic)$/i.test(p)
                  return (
                    <div key={p}>
                      {isImage && url ? (
                        <a href={url} target="_blank" rel="noopener noreferrer">
                          <img src={url} alt={fileName(p)} style={{ width: '100%', borderRadius: 8, border: '1px solid var(--border)' }} />
                        </a>
                      ) : url ? (
                        <a href={url} target="_blank" rel="noopener noreferrer" className="mobile-receipt-link">
                          {fileIcon(p)} {fileName(p)}
                        </a>
                      ) : (
                        <div className="mobile-receipt-link" style={{ color: 'var(--text3)' }}>
                          <span className="spinner" style={{ width: 12, height: 12 }} /> Loading {fileName(p)}…
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.5, padding: '10px 12px', background: 'var(--bg3)', borderRadius: 6 }}>
              💡 Edit GM %, WBS, vendor, or attach more photos on desktop (Cost → Expenses).
            </div>
          </div>
        )}
      </MobileBottomSheet>
    </>
  )
}
