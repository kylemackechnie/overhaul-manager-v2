import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { MobilePanelHeader } from '../../components/mobile/MobilePanelHeader'
import { MobileCard } from '../../components/mobile/ui/MobileCard'
import { MobileQtyStepper } from '../../components/mobile/ui/MobileQtyStepper'
import { MobileBarcodeScanner } from '../../components/mobile/ui/MobileBarcodeScanner'

interface WositLine {
  id: string
  tv_no: string | null
  vb_no: string | null
  delivery_package: string | null
  material_no: string | null
  install_location: string | null
  description: string | null
  qty_required: number
  qty_received: number | null
  status: string | null
}

type Step = 1 | 2 | 3

interface SessionItem {
  desc: string
  matNo: string
  location: string
  qty: number
  at: number  // timestamp for sort
}

/**
 * Mobile-optimised Receive Parts flow — 3-step wizard.
 *
 * Same data model as desktop PartsReceivingPanel:
 * - Step 1: scan/type Material # → matches against wosit_lines by material_no
 * - Step 2: if multiple matches, pick by install location
 * - Step 3: enter Box # + Qty → write site_inventory row, update wosit_lines
 *
 * After confirming, returns to step 1 with a session list of what's been
 * received in this sitting — useful for chaining through a delivery.
 */
export function PartsReceiveMobile() {
  const { activeProject } = useAppStore()

  const [lines,    setLines]    = useState<WositLine[]>([])
  const [loading,  setLoading]  = useState(true)

  const [step,     setStep]     = useState<Step>(1)
  const [matInput, setMatInput] = useState('')
  const [matches,  setMatches]  = useState<WositLine[]>([])
  const [chosen,   setChosen]   = useState<WositLine | null>(null)
  const [supersession, setSupersession] = useState(false)
  const [boxNo,    setBoxNo]    = useState('')
  const [qty,      setQty]      = useState(1)
  const [step1Err, setStep1Err] = useState('')
  const [saving,   setSaving]   = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [session,  setSession]  = useState<SessionItem[]>([])
  const [recentBanner, setRecentBanner] = useState<string | null>(null)

  const matRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  // Auto-focus material input on step 1
  useEffect(() => {
    if (step === 1) setTimeout(() => matRef.current?.focus(), 100)
    if (step === 3) setTimeout(() => boxRef.current?.focus(), 100)
  }, [step])

  async function load() {
    if (!activeProject) return
    setLoading(true)
    const { data } = await supabase
      .from('wosit_lines')
      .select('id,tv_no,vb_no,delivery_package,material_no,install_location,description,qty_required,qty_received,status')
      .eq('project_id', activeProject.id)
      .order('tv_no')
    setLines((data || []) as WositLine[])
    setLoading(false)
  }

  // Counts for the panel header — quick orientation
  const stats = {
    total: lines.length,
    pending: lines.filter(l => (l.status || 'pending') !== 'received').length,
    received: lines.filter(l => l.status === 'received').length,
  }

  function onMatSubmit() {
    const val = matInput.trim()
    if (!val) return
    const m = lines.filter(l => (l.material_no || '').toUpperCase() === val.toUpperCase())
    if (!m.length) {
      setStep1Err(`⚠ Material ${val} not found in WOSIT`)
      return
    }
    setStep1Err('')
    setMatches(m)
    if (m.length === 1) {
      // Single match — go straight to step 3
      setChosen(m[0])
      setQty(m[0].qty_required || 1)
      setSupersession(false)
      setStep(3)
    } else {
      // Multiple matches — disambiguate by install location
      setStep(2)
    }
  }

  function pickLine(line: WositLine, supers: boolean = false) {
    setChosen(line)
    setQty(line.qty_required || 1)
    setSupersession(supers)
    setStep(3)
  }

  async function confirmReceive() {
    if (!chosen || !activeProject) return
    if (!boxNo.trim()) { toast('Enter a box number', 'error'); boxRef.current?.focus(); return }
    if (qty < 1) { toast('Qty must be ≥ 1', 'error'); return }

    setSaving(true)
    const tv    = chosen.tv_no || ''
    const crate = chosen.delivery_package || chosen.vb_no || ''
    const location = `TV${tv} — Crate ${crate} — Box ${boxNo.trim()}`

    const { error } = await supabase.from('site_inventory').insert({
      project_id: activeProject.id,
      wosit_line_id: chosen.id,
      tv_no: tv || null,
      crate_no: crate || null,
      vb_no: chosen.vb_no || null,
      box_no: boxNo.trim(),
      location,
      material_no: chosen.material_no,
      install_location: chosen.install_location,
      description: chosen.description,
      qty_delivered: qty,
      qty_remaining: qty,
      qty_issued: 0,
    })
    if (error) {
      setSaving(false)
      toast('Receive failed: ' + error.message, 'error')
      return
    }
    const prev = Number(chosen.qty_received || 0)
    const newTotal = prev + qty
    const newStatus = newTotal >= (chosen.qty_required || 0) ? 'received' : 'partial'
    await supabase.from('wosit_lines')
      .update({ qty_received: newTotal, status: newStatus })
      .eq('id', chosen.id)

    const desc = chosen.description || chosen.material_no || '—'
    setSession(s => [{ desc, matNo: chosen.material_no || '—', location, qty, at: Date.now() }, ...s])
    setRecentBanner(`✓ Received ${qty}× ${desc}`)
    toast(`Received ${qty}× ${desc}`, 'success')

    setSaving(false)
    reset(false)  // keep banner + session list
    load()
  }

  function reset(clearBanner = true) {
    setMatInput('')
    setMatches([])
    setChosen(null)
    setSupersession(false)
    setBoxNo('')
    setQty(1)
    setStep1Err('')
    setStep(1)
    if (clearBanner) setRecentBanner(null)
  }

  function handleScan(text: string) {
    setScanOpen(false)
    setMatInput(text.trim())
    // Auto-submit after scan — that's the whole point of scanning, no need
    // to ask for a second tap. Wait a tick so the input value updates first.
    setTimeout(() => {
      const val = text.trim()
      const m = lines.filter(l => (l.material_no || '').toUpperCase() === val.toUpperCase())
      if (!m.length) {
        setStep1Err(`⚠ Material ${val} not found in WOSIT`)
        return
      }
      setStep1Err('')
      setMatches(m)
      if (m.length === 1) {
        setChosen(m[0])
        setQty(m[0].qty_required || 1)
        setSupersession(false)
        setStep(3)
      } else {
        setStep(2)
      }
    }, 50)
  }

  return (
    <>
      <MobilePanelHeader
        title="Receive Parts"
        subtitle={loading ? 'Loading…' : `${stats.pending} pending · ${stats.received} received · ${stats.total} total`}
      />

      {/* Step indicator */}
      <div className="mobile-stepper">
        {[1, 2, 3].map(n => (
          <div key={n} className={`mobile-stepper-pip${step >= n ? ' mobile-stepper-pip-done' : ''}${step === n ? ' mobile-stepper-pip-active' : ''}`}>
            {n}
          </div>
        ))}
        <div className="mobile-stepper-label">
          {step === 1 && 'Scan or enter Material #'}
          {step === 2 && 'Select install location'}
          {step === 3 && 'Box # and quantity'}
        </div>
      </div>

      {/* Recent banner — appears after a successful receive */}
      {recentBanner && step === 1 && (
        <div className="mobile-receive-banner" onClick={() => setRecentBanner(null)}>
          <span>{recentBanner}</span>
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>Tap to dismiss</span>
        </div>
      )}

      {/* STEP 1 — Material # */}
      {step === 1 && (
        <div className="mobile-step-body">
          <label className="mobile-form-label">Material #</label>
          <div className="mobile-searchscan-row">
            <input
              ref={matRef}
              className="input mobile-step-input"
              value={matInput}
              onChange={e => setMatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') onMatSubmit() }}
              placeholder="Type or scan…"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
            <button
              type="button"
              className="mobile-scan-btn"
              onClick={() => setScanOpen(true)}
              aria-label="Scan barcode"
            >
              📷
            </button>
          </div>

          {step1Err && <div className="mobile-step-error">{step1Err}</div>}

          <button
            className="btn btn-primary mobile-step-submit"
            onClick={onMatSubmit}
            disabled={!matInput.trim()}
          >
            Continue →
          </button>

          {/* Session list — items received in this sitting */}
          {session.length > 0 && (
            <div className="mobile-session-list">
              <div className="mobile-session-list-title">This session ({session.length})</div>
              {session.slice(0, 6).map((s, i) => (
                <div key={i} className="mobile-session-item">
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{s.qty}× {s.desc}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>{s.matNo} · {s.location}</div>
                </div>
              ))}
              {session.length > 6 && (
                <div style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'center', padding: 6 }}>
                  + {session.length - 6} more
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* STEP 2 — pick install location among matches */}
      {step === 2 && (
        <div className="mobile-step-body">
          <div className="mobile-form-help">
            Multiple WOSIT lines have material # <strong>{matInput}</strong>. Select the install location:
          </div>
          <div className="mobile-list" style={{ marginTop: 12 }}>
            {matches.map(line => (
              <MobileCard
                key={line.id}
                title={line.install_location || '— No install location —'}
                subtitle={line.description || ''}
                meta={`Qty ${line.qty_required}`}
                metaSub={`TV${line.tv_no || '—'}`}
                onClick={() => pickLine(line)}
              />
            ))}
          </div>
          <button
            className="btn btn-secondary mobile-step-submit"
            onClick={() => { setStep(1); setMatches([]) }}
          >
            ← Back
          </button>
        </div>
      )}

      {/* STEP 3 — box # and qty */}
      {step === 3 && chosen && (
        <div className="mobile-step-body">
          <div className="mobile-receive-summary">
            <div style={{ fontSize: 13, fontWeight: 600 }}>{chosen.description || '—'}</div>
            <div style={{ fontSize: 12, color: 'var(--text2)', fontFamily: 'var(--mono)', marginTop: 2 }}>
              {chosen.material_no} · {chosen.install_location || 'no location'}
            </div>
            <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>
              <span>TV{chosen.tv_no || '—'}</span>
              <span>Crate {chosen.delivery_package || chosen.vb_no || '—'}</span>
              <span>Required: {chosen.qty_required}</span>
            </div>
            {supersession && (
              <div style={{ fontSize: 12, color: 'var(--orange)', marginTop: 8 }}>
                ⚠ Possible supersession — check before confirming
              </div>
            )}
          </div>

          <label className="mobile-form-label" style={{ marginTop: 16 }}>Box #</label>
          <input
            ref={boxRef}
            className="input mobile-step-input"
            value={boxNo}
            onChange={e => setBoxNo(e.target.value)}
            placeholder="e.g. 1, 2A, 3"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />

          <label className="mobile-form-label" style={{ marginTop: 16 }}>Quantity</label>
          <MobileQtyStepper value={qty} onChange={setQty} min={1} size="lg" />

          <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ flex: 1, height: 48 }}
              onClick={() => reset(false)}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              style={{ flex: 2, height: 48, fontWeight: 600 }}
              onClick={confirmReceive}
              disabled={saving || !boxNo.trim() || qty < 1}
            >
              {saving ? <span className="spinner" style={{ width: 14, height: 14 }} /> : `📥 Receive ${qty}×`}
            </button>
          </div>
        </div>
      )}

      <MobileBarcodeScanner
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onScan={handleScan}
        title="Scan Material #"
        hint="Point camera at material label"
      />
    </>
  )
}
