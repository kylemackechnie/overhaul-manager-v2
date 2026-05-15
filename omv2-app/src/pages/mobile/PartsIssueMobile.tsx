import { useEffect, useState, lazy, Suspense } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { MobilePanelHeader } from '../../components/mobile/MobilePanelHeader'
import { MobileSearchBar } from '../../components/mobile/ui/MobileSearchBar'
import { MobileCard } from '../../components/mobile/ui/MobileCard'
import { MobileBottomSheet } from '../../components/mobile/ui/MobileBottomSheet'
import { MobileQtyStepper } from '../../components/mobile/ui/MobileQtyStepper'
import { useRegisterRefresh } from '../../components/mobile/ui/RefreshContext'

// Scanner is heavy (~500 KB with zxing) — lazy so the panel itself loads fast
const MobileBarcodeScanner = lazy(() =>
  import('../../components/mobile/ui/MobileBarcodeScanner').then(m => ({ default: m.MobileBarcodeScanner }))
)

interface SparePart {
  id: string; part_number: string; description: string
  qty_on_hand: number; qty_reserved: number; unit: string | null; location: string | null
}
interface WO { id: string; wo_number: string; description: string }

interface HistoryItem {
  id: string; issued_date: string; part_number: string; description: string
  qty: number; wo_number: string | null; purpose: string | null
}

/**
 * Mobile-optimised Issue Parts flow.
 *
 * Different from desktop's "cart" pattern: one part at a time, tap-to-issue.
 * Camera scanning fills the search box; matching parts surface immediately.
 *
 * Flow:
 * 1. Search bar at top (or scan via 📷)
 * 2. Card list of matching parts with available qty
 * 3. Tap a part → bottom sheet opens with qty stepper, WO, purpose, Issue button
 * 4. Confirm → toast → sheet closes → list reflects new available qty
 */
export function PartsIssueMobile() {
  const { activeProject } = useAppStore()

  const [parts,    setParts]    = useState<SparePart[]>([])
  const [wos,      setWos]      = useState<WO[]>([])
  const [history,  setHistory]  = useState<HistoryItem[]>([])
  const [loading,  setLoading]  = useState(true)
  const [tab,      setTab]      = useState<'issue' | 'history'>('issue')
  const [search,   setSearch]   = useState('')
  const [scanOpen, setScanOpen] = useState(false)

  // Issue sheet state
  const [activePart, setActivePart] = useState<SparePart | null>(null)
  const [qty,        setQty]        = useState(1)
  const [woId,       setWoId]       = useState('')
  const [purpose,    setPurpose]    = useState('')
  const [saving,     setSaving]     = useState(false)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])
  useRegisterRefresh(load)

  async function load() {
    if (!activeProject) return
    setLoading(true)
    const pid = activeProject.id
    const [pRes, woRes, hRes] = await Promise.all([
      supabase.from('spare_parts').select('id,part_number,description,qty_on_hand,qty_reserved,unit,location').eq('project_id', pid).order('part_number'),
      supabase.from('work_orders').select('id,wo_number,description').eq('project_id', pid).order('wo_number'),
      supabase.from('parts_issues').select('id,issued_date,qty,purpose,spare_part:spare_parts(part_number,description),work_order:work_orders(wo_number)').eq('project_id', pid).order('issued_date', { ascending: false }).limit(50),
    ])
    setParts((pRes.data || []) as SparePart[])
    setWos((woRes.data || []) as WO[])
    const h = (hRes.data || []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      issued_date: r.issued_date as string,
      part_number: (r.spare_part as { part_number: string } | null)?.part_number || '—',
      description: (r.spare_part as { description: string } | null)?.description || '—',
      qty: r.qty as number,
      wo_number: (r.work_order as { wo_number: string } | null)?.wo_number || null,
      purpose: r.purpose as string | null,
    }))
    setHistory(h)
    setLoading(false)
  }

  function openIssue(part: SparePart) {
    const available = (part.qty_on_hand || 0) - (part.qty_reserved || 0)
    if (available <= 0) {
      toast(`${part.part_number} has no available stock`, 'error')
      return
    }
    setActivePart(part)
    setQty(1)
    setWoId('')
    setPurpose('')
  }

  function closeSheet() {
    if (saving) return
    setActivePart(null)
  }

  async function confirmIssue() {
    if (!activePart || !activeProject) return
    const available = (activePart.qty_on_hand || 0) - (activePart.qty_reserved || 0)
    if (qty <= 0) { toast('Qty must be > 0', 'error'); return }
    if (qty > available) { toast(`Only ${available} available`, 'error'); return }

    setSaving(true)
    const { error: iErr } = await supabase.from('parts_issues').insert({
      project_id: activeProject.id,
      spare_part_id: activePart.id,
      work_order_id: woId || null,
      issued_date: new Date().toISOString().slice(0, 10),
      qty,
      purpose: purpose.trim() || null,
    })
    if (iErr) {
      setSaving(false)
      toast(`Issue failed: ${iErr.message}`, 'error')
      return
    }
    // Decrement on-hand. Pattern matches desktop — non-atomic update is
    // acceptable here because RLS is per-project and concurrent issues on
    // the same part are rare in practice.
    await supabase.from('spare_parts')
      .update({ qty_on_hand: Math.max(0, (activePart.qty_on_hand || 0) - qty) })
      .eq('id', activePart.id)

    toast(`Issued ${qty}× ${activePart.part_number}`, 'success')
    setSaving(false)
    setActivePart(null)
    load()
  }

  function handleScan(text: string) {
    setScanOpen(false)
    // Drop the scanned value into the search box. Whatever logic matches
    // typed input also matches scanned input — no separate code path.
    setSearch(text.trim())
    // If exactly one match with available stock, open it directly.
    const t = text.trim().toLowerCase()
    const exact = parts.filter(p => {
      const avail = (p.qty_on_hand || 0) - (p.qty_reserved || 0)
      return avail > 0 && (p.part_number || '').toLowerCase() === t
    })
    if (exact.length === 1) {
      openIssue(exact[0])
    }
  }

  // Filter parts by search. Match against part_number OR description, only
  // show parts with available stock (you can't issue what you don't have).
  const q = search.trim().toLowerCase()
  const available = (p: SparePart) => (p.qty_on_hand || 0) - (p.qty_reserved || 0)
  const filtered = parts.filter(p => {
    if (available(p) <= 0) return false
    if (!q) return true
    return (p.part_number || '').toLowerCase().includes(q)
        || (p.description || '').toLowerCase().includes(q)
  })

  return (
    <>
      <MobilePanelHeader title="Issue Parts" subtitle={`${parts.length} parts in inventory`} />

      <div className="mobile-tabs-row">
        <button
          className={`mobile-tab ${tab === 'issue' ? 'mobile-tab-active' : ''}`}
          onClick={() => setTab('issue')}
        >
          Issue
        </button>
        <button
          className={`mobile-tab ${tab === 'history' ? 'mobile-tab-active' : ''}`}
          onClick={() => setTab('history')}
        >
          Recent ({history.length})
        </button>
      </div>

      {tab === 'issue' && (
        <>
          <div className="mobile-searchscan-row">
            <div style={{ flex: 1 }}>
              <MobileSearchBar
                value={search}
                onChange={setSearch}
                placeholder="Part # or description"
              />
            </div>
            <button
              type="button"
              className="mobile-scan-btn"
              onClick={() => setScanOpen(true)}
              aria-label="Scan barcode"
            >
              📷
            </button>
          </div>

          {loading ? (
            <div className="mobile-loading"><span className="spinner" /> Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="mobile-empty">
              <div className="mobile-empty-icon">📦</div>
              <h3>{q ? 'No matching parts' : 'No parts available'}</h3>
              <p>{q ? 'Try a different search.' : 'Receive parts first to populate inventory.'}</p>
            </div>
          ) : (
            <div className="mobile-list">
              {filtered.map(p => (
                <MobileCard
                  key={p.id}
                  title={<span style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{p.part_number}</span>}
                  subtitle={p.description}
                  meta={<span style={{ color: 'var(--green)', fontWeight: 600 }}>{available(p)} avail</span>}
                  metaSub={p.location || ''}
                  onClick={() => openIssue(p)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'history' && (
        <>
          {loading ? (
            <div className="mobile-loading"><span className="spinner" /> Loading…</div>
          ) : history.length === 0 ? (
            <div className="mobile-empty">
              <div className="mobile-empty-icon">📋</div>
              <h3>No issues yet</h3>
              <p>Issues you record will appear here.</p>
            </div>
          ) : (
            <div className="mobile-list">
              {history.map(h => (
                <MobileCard
                  key={h.id}
                  title={<span style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{h.part_number}</span>}
                  subtitle={h.description}
                  meta={<span style={{ fontWeight: 600 }}>−{h.qty}</span>}
                  metaSub={h.issued_date}
                  footer={(h.wo_number || h.purpose) ? (
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', fontSize: '11px', color: 'var(--text2)' }}>
                      {h.wo_number && <span>WO: {h.wo_number}</span>}
                      {h.purpose && <span>· {h.purpose}</span>}
                    </div>
                  ) : undefined}
                  chevron={false}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Issue bottom sheet */}
      <MobileBottomSheet
        open={!!activePart}
        onClose={closeSheet}
        title={activePart ? `Issue ${activePart.part_number}` : ''}
        preventBackdropClose={saving}
        footer={activePart && (
          <button
            className="btn btn-primary"
            style={{ width: '100%', height: '48px', fontSize: '15px', fontWeight: 600 }}
            onClick={confirmIssue}
            disabled={saving || qty <= 0 || qty > available(activePart)}
          >
            {saving ? <span className="spinner" style={{ width: 14, height: 14 }} /> : `📤 Issue ${qty}× ${activePart.part_number}`}
          </button>
        )}
      >
        {activePart && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 4 }}>{activePart.description}</div>
              <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--text3)' }}>
                <span>Available: <strong style={{ color: 'var(--green)' }}>{available(activePart)}</strong></span>
                {activePart.location && <span>Location: {activePart.location}</span>}
                {activePart.unit && <span>Unit: {activePart.unit}</span>}
              </div>
            </div>

            <div>
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 8 }}>Quantity</label>
              <MobileQtyStepper
                value={qty}
                onChange={setQty}
                min={1}
                max={available(activePart)}
                size="lg"
                invalid={qty > available(activePart)}
              />
              {qty > available(activePart) && (
                <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 6 }}>
                  Exceeds available stock ({available(activePart)})
                </div>
              )}
            </div>

            <div>
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 6 }}>
                Work Order <span style={{ color: 'var(--text3)', fontWeight: 400 }}>(optional)</span>
              </label>
              <select
                className="input"
                value={woId}
                onChange={e => setWoId(e.target.value)}
                style={{ width: '100%', height: 44 }}
              >
                <option value="">— No WO —</option>
                {wos.map(w => (
                  <option key={w.id} value={w.id}>{w.wo_number} — {w.description}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 6 }}>
                Purpose <span style={{ color: 'var(--text3)', fontWeight: 400 }}>(optional)</span>
              </label>
              <input
                className="input"
                value={purpose}
                onChange={e => setPurpose(e.target.value)}
                placeholder="e.g. installed during inspection"
                style={{ width: '100%', height: 44 }}
              />
            </div>
          </div>
        )}
      </MobileBottomSheet>

      {/* Mount scanner only when user taps the camera button. This means
          zxing-js is fetched on-demand (200-500 ms over a connection) and
          the Suspense fallback is invisible inside the fullscreen overlay. */}
      {scanOpen && (
        <Suspense fallback={null}>
          <MobileBarcodeScanner
            open={scanOpen}
            onClose={() => setScanOpen(false)}
            onScan={handleScan}
            title="Scan Part #"
            hint="Point camera at part barcode"
          />
        </Suspense>
      )}
    </>
  )
}
