import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import type { Shipment } from '../../types'
import { downloadCSV } from '../../lib/csv'
import { generateDHLSLI, generateDHLInvoice, generateDHLPackingList } from '../../lib/docGeneration'
import type { KolloData, WositPart, DocData, SLIFields, PandIFields } from '../../lib/docGeneration'

type Direction = 'import' | 'export'

const STATUSES = ['pending','in_transit','customs','delivered','returned'] as const
const STATUS_COLORS: Record<string, {bg:string,color:string}> = {
  pending:{bg:'#f1f5f9',color:'#64748b'}, in_transit:{bg:'#dbeafe',color:'#1e40af'},
  customs:{bg:'#fef3c7',color:'#92400e'}, delivered:{bg:'#d1fae5',color:'#065f46'},
  returned:{bg:'#fee2e2',color:'#7f1d1d'},
}

const EMPTY = {
  direction:'import' as Direction, reference:'', description:'',
  status:'pending', carrier:'', tracking:'', eta:'', shipped_date:'',
  origin:'', notes:''
}

export function ShipmentsPanel({ direction }: { direction: Direction }) {
  const { activeProject } = useAppStore()
  const [items, setItems] = useState<Shipment[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null|'new'|Shipment>(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id, direction])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('shipments').select('*')
      .eq('project_id', activeProject!.id).eq('direction', direction)
      .order('created_at', { ascending: false })
    setItems((data || []) as Shipment[])
    setLoading(false)
  }

  function openNew() { setForm({ ...EMPTY, direction, origin:'' }); setModal('new') }
  function openEdit(s: Shipment) {
    setForm({
      direction: s.direction, reference: s.reference, description: s.description,
      status: s.status, carrier: s.carrier, tracking: s.tracking,
      eta: s.eta || '', shipped_date: s.shipped_date || '',
      origin: (s as typeof s & {origin?:string}).origin || '', notes: s.notes,
    })
    setModal(s)
  }

  async function save() {
    setSaving(true)
    const payload = {
      project_id: activeProject!.id, direction,
      reference: form.reference.trim(), description: form.description,
      status: form.status, carrier: form.carrier, tracking: form.tracking,
      eta: form.eta || null, shipped_date: form.shipped_date || null, notes: form.notes,
    }
    if (modal === 'new') {
      const { error } = await supabase.from('shipments').insert(payload)
      if (error) { toast(error.message,'error'); setSaving(false); return }
      toast('Shipment added','success')
    } else {
      const { error } = await supabase.from('shipments').update(payload).eq('id',(modal as Shipment).id)
      if (error) { toast(error.message,'error'); setSaving(false); return }
      toast('Saved','success')
    }
    setSaving(false); setModal(null); load()
  }

  
  function exportCSV() {
    downloadCSV(
      [["reference", "description", "carrier", "direction", "status", "eta", "shipped_date"], ...items.map(item => [String(item.reference||''), String(item.description||''), String(item.carrier||''), String(item.direction||''), String(item.status||''), String(item.eta||''), String(item.shipped_date||'')])],
      'shipments_' + (activeProject?.name || 'project')
    )
  }

  async function del(s: Shipment) {
    const pid = activeProject!.id
    // Check if this shipment references a TV
    const ref = s.reference || ''
    const tvNo = ref.startsWith('TV') ? ref.slice(2) : null

    if (tvNo) {
      // Check what downstream data exists
      const [tvLink, kollos, wositLines] = await Promise.all([
        supabase.from('project_tvs').select('tv_no').eq('project_id', pid).eq('tv_no', tvNo).maybeSingle(),
        supabase.from('global_kollos').select('kollo_id').eq('tv_no', tvNo),
        supabase.from('wosit_lines').select('id').eq('project_id', pid).eq('tv_no', tvNo),
      ])
      const hasTV = !!tvLink.data
      const kolloCount = kollos.data?.length || 0
      const wositCount = wositLines.data?.length || 0

      const lines = [`Remove shipment ${ref}?`, '']
      if (hasTV) lines.push(`TV${tvNo} will be removed from the TV Register and Costing.`)
      if (kolloCount) lines.push(`${kolloCount} package record(s) for TV${tvNo} will be deleted.`)
      if (wositCount) lines.push(`${wositCount} spare parts line(s) for TV${tvNo} will be deleted.`)
      lines.push('', 'Delete shipment only, or delete everything?')

      const choice = await new Promise<'cancel'|'shiponly'|'all'>(resolve => {
        const overlay = document.createElement('div')
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center'
        overlay.innerHTML = `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:24px;max-width:420px;width:90vw;box-shadow:0 20px 60px rgba(0,0,0,.3)">
          <div style="font-size:16px;font-weight:700;color:var(--red);margin-bottom:12px">🗑 Delete Shipment</div>
          <p style="white-space:pre-line;font-size:13px;color:var(--text2);line-height:1.6;margin-bottom:14px">${lines.join('\n')}</p>
          <div style="background:#fef2f2;border:1px solid #ef4444;border-radius:6px;padding:10px;font-size:11px;color:#ef4444;margin-bottom:16px">⚠ Cascade delete cannot be undone.</div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button id="_dsCancelBtn" style="padding:7px 14px;border:1px solid var(--border);border-radius:6px;background:var(--bg3);cursor:pointer;font-size:13px">Cancel</button>
            <button id="_dsShipOnlyBtn" style="padding:7px 14px;border:1px solid var(--border);border-radius:6px;background:var(--bg3);cursor:pointer;font-size:13px">Shipment Only</button>
            <button id="_dsAllBtn" style="padding:7px 14px;border:none;border-radius:6px;background:#ef4444;color:#fff;cursor:pointer;font-size:13px;font-weight:600">Delete Everything</button>
          </div>
        </div>`
        document.body.appendChild(overlay)
        overlay.querySelector('#_dsCancelBtn')!.addEventListener('click', () => { overlay.remove(); resolve('cancel') })
        overlay.querySelector('#_dsShipOnlyBtn')!.addEventListener('click', () => { overlay.remove(); resolve('shiponly') })
        overlay.querySelector('#_dsAllBtn')!.addEventListener('click', () => { overlay.remove(); resolve('all') })
      })

      if (choice === 'cancel') return

      // Always delete the shipment
      await supabase.from('shipments').delete().eq('id', s.id)

      if (choice === 'all') {
        // Cascade: TV Register, costings, kollos, WOSIT lines
        await supabase.from('project_tvs').delete().eq('project_id', pid).eq('tv_no', tvNo)
        await supabase.from('tooling_costings').delete().eq('project_id', pid).eq('tv_no', tvNo)
        if (kollos.data && kollos.data.length > 0) {
          const kolloIds = kollos.data.map(k => k.kollo_id)
          await supabase.from('project_kollos').delete().eq('project_id', pid).in('kollo_id', kolloIds)
        }
        if (wositCount > 0) {
          await supabase.from('wosit_lines').delete().eq('project_id', pid).eq('tv_no', tvNo)
        }
        toast(`Shipment ${ref} and all related data deleted`, 'info')
      } else {
        toast(`Shipment ${ref} deleted`, 'info')
      }
    } else {
      // Non-TV shipment — simple confirm
      if (!confirm(`Delete shipment "${ref}"?`)) return
      await supabase.from('shipments').delete().eq('id', s.id)
      toast('Deleted', 'info')
    }
    load()
  }

  const label = direction === 'import' ? 'Inbound' : 'Outbound'
  const icon = direction === 'import' ? '📦' : '🚚'

  // ── Create export shipments from imports ───────────────────────────────
  async function createFromImports() {
    const { data: imports } = await supabase.from('shipments').select('*')
      .eq('project_id', activeProject!.id).eq('direction', 'import')
    const existingRefs = new Set(items.map(s => s.reference))
    const available = (imports || []).filter(s => !existingRefs.has(s.reference))
    if (!available.length) { toast('No imports to create exports from', 'info'); return }

    const checked = await new Promise<string[]>(resolve => {
      const overlay = document.createElement('div')
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center'
      const rows = available.map(s => `
        <label style="display:flex;align-items:center;gap:10px;padding:10px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px;cursor:pointer">
          <input type="checkbox" value="${s.id}" style="width:16px;height:16px;accent-color:#d97706">
          <div>
            <div style="font-size:13px;font-weight:600">${s.reference || '—'} — ${s.description || '—'}</div>
            <div style="font-size:11px;color:#64748b">${(s as unknown as Record<string,unknown>).ship_type || '—'} · ${(s as unknown as Record<string,unknown>).packages || 0} pkgs · ${(s as unknown as Record<string,unknown>).gross_kg || 0}kg</div>
          </div>
        </label>`).join('')
      overlay.innerHTML = `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;width:520px;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.3)">
        <div style="padding:14px 20px;border-bottom:1px solid var(--border);font-size:15px;font-weight:700">📤 Create Export Shipments from Imports</div>
        <div style="overflow-y:auto;flex:1;padding:12px 16px">${rows}</div>
        <div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end">
          <button id="_expCancel" style="padding:7px 14px;border:1px solid var(--border);border-radius:6px;background:var(--bg3);cursor:pointer;font-size:13px">Cancel</button>
          <button id="_expCreate" style="padding:7px 14px;border:none;border-radius:6px;background:#d97706;color:#fff;cursor:pointer;font-size:13px;font-weight:600">Create Exports</button>
        </div>
      </div>`
      document.body.appendChild(overlay)
      overlay.querySelector('#_expCancel')!.addEventListener('click', () => { overlay.remove(); resolve([]) })
      overlay.querySelector('#_expCreate')!.addEventListener('click', () => {
        const ids = [...overlay.querySelectorAll('input[type=checkbox]:checked')].map(cb => (cb as HTMLInputElement).value)
        overlay.remove(); resolve(ids)
      })
    })

    if (!checked.length) return
    const toCreate = (imports || []).filter(s => checked.includes(s.id))
    for (const imp of toCreate) {
      await supabase.from('shipments').insert({
        project_id: activeProject!.id, direction: 'export',
        ship_type: (imp as Record<string,unknown>).ship_type as string || 'other',
        reference: imp.reference, description: (imp.description || '') + ' (return)',
        status: 'pending', origin: '', destination: '',
        eta: null, notes: `Return of import ${imp.reference}`,
        carrier: '', tracking: '', hawb: '', mawb: '', flight: '',
      })
    }
    toast(`${toCreate.length} export shipment(s) created`, 'success')
    load()
  }

  // ── Document generators ────────────────────────────────────────────────
  async function openSLI(s: Shipment) {
    const tvNo = s.reference?.startsWith('TV') ? s.reference.slice(2) : null
    const [tvRes, kolloRes, deptRes, projRes] = await Promise.all([
      tvNo ? supabase.from('global_tvs').select('*').eq('tv_no', tvNo).maybeSingle() : Promise.resolve({ data: null }),
      tvNo ? supabase.from('global_kollos').select('*').eq('tv_no', tvNo) : Promise.resolve({ data: [] }),
      supabase.from('global_departments').select('*'),
      supabase.from('projects').select('*').eq('id', activeProject!.id).single(),
    ])
    const tv = tvRes.data as Record<string,unknown> | null
    const kollos = kolloRes.data || []
    const depts = deptRes.data || []
    const proj = projRes.data as Record<string,unknown> | null
    const dept = tv?.department_id ? (depts.find((d: Record<string,unknown>) => d.id === tv.department_id) as Record<string,unknown> | undefined) : null
    const rates = (dept?.rates || {}) as Record<string,unknown>
    const totalPkgs = kollos.length || (s as unknown as Record<string,unknown>).packages || 0
    const totalWeight = kollos.reduce((sum: number, k: Record<string,unknown>) => sum + (Number(k.gross_kg) || 0), 0) || Number((s as unknown as Record<string,unknown>).gross_kg) || 0
    const hasDG = kollos.some((k: Record<string,unknown>) => k.dangerous_goods)
    const goodsDesc = s.description?.replace(/ \(return\)$/, '') || ''
    const today = new Date().toISOString().slice(0,10)

    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;overflow-y:auto;padding:20px'
    overlay.innerHTML = `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;width:700px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.3)" onclick="event.stopPropagation()">
      <div style="padding:14px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:15px;font-weight:700">📄 Shipper's Letter of Instruction — ${s.reference}</div>
        <button id="_sliClose" style="border:none;background:none;font-size:18px;cursor:pointer;color:var(--text3)">✕</button>
      </div>
      <div style="overflow-y:auto;flex:1;padding:16px 20px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div style="grid-column:span 2;font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Sender / Shipper</div>
        <div><label style="font-size:11px">Company</label><input id="sli-sender-co" class="input" value="${(proj?.settings as Record<string,unknown>)?.clientName || 'Siemens Energy Pty Ltd'}"></div>
        <div><label style="font-size:11px">DHL Account No.</label><input id="sli-acct" class="input" placeholder="DHL account number"></div>
        <div style="grid-column:span 2"><label style="font-size:11px">Address</label><input id="sli-sender-addr" class="input" value=""></div>
        <div><label style="font-size:11px">Contact Name</label><input id="sli-contact" class="input" value=""></div>
        <div><label style="font-size:11px">Telephone</label><input id="sli-phone" class="input" value=""></div>
        <div><label style="font-size:11px">Pickup Date</label><input id="sli-pickup" type="date" class="input" value="${today}"></div>
        <div><label style="font-size:11px">Shipper's Reference</label><input id="sli-ref" class="input" value="${s.reference} — ${goodsDesc} — Export"></div>
        <div style="grid-column:span 2;font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin:8px 0 4px">Receiver / Consignee</div>
        <div style="grid-column:span 2"><label style="font-size:11px">Company</label><input id="sli-recv-co" class="input" value="${rates.consigneeCompany || dept?.name || ''}"></div>
        <div style="grid-column:span 2"><label style="font-size:11px">Address</label><input id="sli-recv-addr" class="input" value="${rates.shippingAddress || ''}"></div>
        <div><label style="font-size:11px">City / Post Code</label><input id="sli-recv-city" class="input" value="${rates.consigneeCity || ''}"></div>
        <div><label style="font-size:11px">Country</label><input id="sli-recv-country" class="input" value="${rates.consigneeCountry || 'Germany'}"></div>
        <div><label style="font-size:11px">Contact Name</label><input id="sli-recv-contact" class="input" value="${rates.contact || ''}"></div>
        <div><label style="font-size:11px">Telephone</label><input id="sli-recv-phone" class="input" value="${rates.consigneePhone || ''}"></div>
        <div style="grid-column:span 2;font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin:8px 0 4px">Shipment Details</div>
        <div><label style="font-size:11px">Airport of Destination</label><input id="sli-airport" class="input" value="${rates.destinationAirport || ''}"></div>
        <div><label style="font-size:11px">Service Type</label>
          <select id="sli-service" class="input"><option>Air Value — Consol service</option><option>Airfreight Plus</option><option>Air First — Priority</option></select></div>
        <div><label style="font-size:11px">Description of Goods</label><input id="sli-goods" class="input" value="${goodsDesc}"></div>
        <div><label style="font-size:11px">Country of Manufacture</label><input id="sli-mfg" class="input" value="DE"></div>
        <div><label style="font-size:11px">HS Code</label><input id="sli-hs" class="input" placeholder="e.g. 8411.99"></div>
        <div><label style="font-size:11px">Declared Customs Value</label><input id="sli-customs" class="input" placeholder="e.g. EUR 15,000"></div>
        <div><label style="font-size:11px">EDN</label><input id="sli-edn" class="input" placeholder="Export Declaration Number"></div>
        <div><label style="font-size:11px">Insurance</label><select id="sli-ins" class="input"><option>No</option><option>Yes</option></select></div>
        <div><label style="font-size:11px">Total Pieces</label><input id="sli-pieces" class="input" value="${totalPkgs}"></div>
        <div><label style="font-size:11px">Total Gross Weight (kg)</label><input id="sli-weight" class="input" value="${typeof totalWeight === 'number' ? totalWeight.toFixed(1) : totalWeight}"></div>
        <div style="grid-column:span 2"><label style="font-size:11px">Dangerous Goods</label>
          <select id="sli-dg" class="input"><option value="No" ${!hasDG?'selected':''}>No</option><option value="Yes" ${hasDG?'selected':''}>Yes</option></select></div>
        <div style="grid-column:span 2"><label style="font-size:11px">Notes / Special Instructions</label><textarea id="sli-notes" class="input" rows="2" style="resize:vertical">${s.notes || ''}</textarea></div>
      </div>
      <div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end">
        <button id="_sliCancel" style="padding:7px 14px;border:1px solid var(--border);border-radius:6px;background:var(--bg3);cursor:pointer;font-size:13px">Cancel</button>
        <button id="_sliPrint" style="padding:7px 14px;border:none;border-radius:6px;background:#c2185b;color:#fff;cursor:pointer;font-size:13px;font-weight:600">📄 Generate SLI</button>
      </div>
    </div>`
    document.body.appendChild(overlay)
    const gv = (id: string) => (overlay.querySelector('#' + id) as HTMLInputElement)?.value || ''
    overlay.querySelector('#_sliClose')!.addEventListener('click', () => overlay.remove())
    overlay.querySelector('#_sliCancel')!.addEventListener('click', () => overlay.remove())
    overlay.querySelector('#_sliPrint')!.addEventListener('click', async () => {
      const btn = overlay.querySelector('#_sliPrint') as HTMLButtonElement
      btn.disabled = true
      btn.textContent = 'Generating…'
      try {
        const kolloData: KolloData[] = (kollos as Record<string,unknown>[]).map(k => ({
          kolloId:  String(k.kollo_id || ''),
          crateNo:  String(k.crate_no || ''),
          vbNo:     String(k.vb_no || ''),
          ucrNo:    String(k.ucr_no || ''),
          packagingType: String(k.packaging_type || 'Crate (CH)'),
          fertigmeldung: String(k.fertigmeldung || ''),
          masterKollo: String(k.master_kollo || ''),
          lengthCm: String(k.length_cm || ''),
          widthCm:  String(k.width_cm || ''),
          heightCm: String(k.height_cm || ''),
          grossKg:  Number(k.gross_kg || 0),
          netKg:    Number(k.net_kg || 0),
          volM3:    Number(k.vol_m3 || 0),
        }))
        const fields: SLIFields = {
          acct:          gv('sli-acct'),
          senderCo:      gv('sli-sender-co'),
          senderAddr:    gv('sli-sender-addr'),
          senderContact: gv('sli-contact'),
          senderPhone:   gv('sli-phone'),
          pickupDate:    gv('sli-pickup'),
          pickupAddr:    gv('sli-sender-addr'),
          shipperRef:    gv('sli-ref'),
          recvCo:        gv('sli-recv-co'),
          recvAddr:      gv('sli-recv-addr'),
          recvCity:      gv('sli-recv-city'),
          recvCountry:   gv('sli-recv-country'),
          recvContact:   gv('sli-recv-contact'),
          recvPhone:     gv('sli-recv-phone'),
          notes:         gv('sli-notes'),
          consigneeRef:  gv('sli-recv-co'),
          airport:       gv('sli-airport'),
          serviceType:   gv('sli-service'),
          goodsDesc:     gv('sli-goods'),
          countryMfg:    gv('sli-mfg'),
          hsCode:        gv('sli-hs'),
          customsVal:    gv('sli-customs'),
          edn:           gv('sli-edn'),
          insurance:     gv('sli-ins'),
          pieces:        gv('sli-pieces'),
          weight:        gv('sli-weight'),
          dg:            gv('sli-dg'),
          kollos:        kolloData,
        }
        await generateDHLSLI(fields, s.reference || 'SLI', today)
        overlay.remove()
        toast('DHL SLI downloaded', 'success')
      } catch (err) {
        console.error('SLI generation failed:', err)
        toast('Failed to generate SLI: ' + String(err), 'error')
        btn.disabled = false
        btn.textContent = '📄 Generate SLI'
      }
    })
  }

  async function openPackingOrInvoice(s: Shipment, showPrices: boolean) {
    const tvNo = s.reference?.startsWith('TV') ? s.reference.slice(2) : null
    const [tvRes, kolloRes, deptRes, wositRes] = await Promise.all([
      tvNo ? supabase.from('global_tvs').select('*').eq('tv_no', tvNo).maybeSingle() : Promise.resolve({ data: null }),
      tvNo ? supabase.from('global_kollos').select('*').eq('tv_no', tvNo) : Promise.resolve({ data: [] }),
      supabase.from('global_departments').select('*'),
      tvNo ? supabase.from('wosit_lines').select('*').eq('project_id', activeProject!.id).eq('tv_no', tvNo) : Promise.resolve({ data: [] }),
    ])
    const tv = tvRes.data as Record<string,unknown> | null
    const kollos = (kolloRes.data || []) as Record<string,unknown>[]
    const depts = deptRes.data || []
    const wositParts = (wositRes.data || []) as Record<string,unknown>[]
    const dept = tv?.department_id ? (depts.find((d: Record<string,unknown>) => d.id === tv.department_id) as Record<string,unknown> | undefined) : null
    const rates = (dept?.rates || {}) as Record<string,unknown>
    const totalGross = kollos.reduce((sum, k) => sum + Number(k.gross_kg || 0), 0)
    const totalNet = kollos.reduce((sum, k) => sum + Number(k.net_kg || 0), 0)
    const totalVol = kollos.reduce((sum, k) => sum + Number(k.vol_m3 || 0), 0)
    const replVal = Number(tv?.replacement_value_eur || 0)
    const today = new Date().toISOString().slice(0, 10)
    const docTitle = showPrices ? 'Commercial Invoice' : 'Packing List'

    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px'
    overlay.innerHTML = `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;width:620px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.3)" onclick="event.stopPropagation()">
      <div style="padding:14px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:15px;font-weight:700">${showPrices ? '💰' : '📦'} ${docTitle} — ${s.reference}</div>
        <button id="_docClose" style="border:none;background:none;font-size:18px;cursor:pointer;color:var(--text3)">✕</button>
      </div>
      <div style="overflow-y:auto;flex:1;padding:16px 20px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div><label style="font-size:11px">Shipper Company</label><input id="pl-shipper-co" class="input" value="Siemens Energy Pty Ltd"></div>
        <div><label style="font-size:11px">Shipper Address</label><input id="pl-shipper-addr" class="input" value=""></div>
        <div><label style="font-size:11px">Consignee Company</label><input id="pl-recv-co" class="input" value="${rates.consigneeCompany || 'Siemens Energy Global GmbH & Co. KG'}"></div>
        <div><label style="font-size:11px">Consignee Address</label><input id="pl-recv-addr" class="input" value="${rates.shippingAddress || ''}"></div>
        <div><label style="font-size:11px">City / Post Code</label><input id="pl-recv-city" class="input" value="${rates.consigneeCity || ''}"></div>
        <div><label style="font-size:11px">Country</label><input id="pl-recv-country" class="input" value="${rates.consigneeCountry || 'Germany'}"></div>
        <div><label style="font-size:11px">Project</label><input id="pl-project" class="input" value="${activeProject!.name}"></div>
        <div><label style="font-size:11px">PO Number</label><input id="pl-po" class="input" value=""></div>
        <div><label style="font-size:11px">Lot / TV No.</label><input id="pl-lot" class="input" value="${s.reference}"></div>
        <div><label style="font-size:11px">Date</label><input id="pl-date" type="date" class="input" value="${today}"></div>
        <div><label style="font-size:11px">Transport Mode</label><input id="pl-transport" class="input" value="Airfreight"></div>
        <div><label style="font-size:11px">Incoterms</label><input id="pl-incoterms" class="input" value="CIP ${rates.destinationAirport || 'Berlin Airport'}"></div>
        ${showPrices ? `
        <div><label style="font-size:11px">Invoice Number</label><input id="pl-invno" class="input" value="${s.reference}-INV"></div>
        <div><label style="font-size:11px">Currency</label><input id="pl-currency" class="input" value="EUR"></div>
        <div style="grid-column:span 2"><label style="font-size:11px">Reason for Export</label>
          <select id="pl-reason" class="input">
            <option value="Return to country of origin for repair/refurbishment">Return for repair/refurbishment</option>
            <option value="Permanent export - sale of goods">Sale of goods</option>
            <option value="Temporary export - will be re-imported">Temporary export</option>
          </select></div>` : ''}
        <div style="grid-column:span 2;font-size:11px;color:var(--text3)">${kollos.length} packages · ${wositParts.length} line items${showPrices && replVal ? ` · Replacement value: €${replVal.toLocaleString('en-AU', {minimumFractionDigits:2})}` : ''}</div>
      </div>
      <div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end">
        <button id="_docCancel" style="padding:7px 14px;border:1px solid var(--border);border-radius:6px;background:var(--bg3);cursor:pointer;font-size:13px">Cancel</button>
        <button id="_docPrint" style="padding:7px 14px;border:none;border-radius:6px;background:${showPrices?'#d97706':'#0284c7'};color:#fff;cursor:pointer;font-size:13px;font-weight:600">${showPrices ? '💰' : '📦'} Generate ${docTitle}</button>
      </div>
    </div>`
    document.body.appendChild(overlay)
    const gv = (id: string) => (overlay.querySelector('#' + id) as HTMLInputElement)?.value || ''
    overlay.querySelector('#_docClose')!.addEventListener('click', () => overlay.remove())
    overlay.querySelector('#_docCancel')!.addEventListener('click', () => overlay.remove())
    overlay.querySelector('#_docPrint')!.addEventListener('click', async () => {
      const btn = overlay.querySelector('#_docPrint') as HTMLButtonElement
      btn.disabled = true
      btn.textContent = 'Generating…'
      try {
        const kolloData: KolloData[] = kollos.map(k => ({
          kolloId:  String(k.kollo_id || ''),
          crateNo:  String(k.crate_no || ''),
          vbNo:     String(k.vb_no || ''),
          ucrNo:    String(k.ucr_no || ''),
          packagingType: String(k.packaging_type || 'Crate (CH)'),
          fertigmeldung: String(k.fertigmeldung || ''),
          masterKollo: String(k.master_kollo || ''),
          lengthCm: String(k.length_cm || ''),
          widthCm:  String(k.width_cm || ''),
          heightCm: String(k.height_cm || ''),
          grossKg:  Number(k.gross_kg || 0),
          netKg:    Number(k.net_kg || 0),
          volM3:    Number(k.vol_m3 || 0),
        }))
        const parts: WositPart[] = wositParts.map(p => ({
          description: String(p.description || ''),
          materialNo:  String(p.material_no || ''),
          qty:         Number(p.qty_required || 1),
          unit:        String(p.unit || 'ST'),
          hsCode:      String(p.hs_code || ''),
          countryOfOrigin: String(p.country_of_origin || 'DE'),
        }))
        const docData: DocData = {
          kollos: kolloData,
          wositParts: parts,
          totalGross,
          totalNet,
          totalVol,
          replacementValue: replVal,
        }
        const fields: PandIFields = {
          shipperCo:    gv('pl-shipper-co'),
          shipperAddr:  gv('pl-shipper-addr'),
          recvCo:       gv('pl-recv-co'),
          recvAddr:     gv('pl-recv-addr'),
          recvCity:     gv('pl-recv-city'),
          recvCountry:  gv('pl-recv-country'),
          poNumber:     gv('pl-po'),
          date:         gv('pl-date'),
          transport:    gv('pl-transport'),
          incoterms:    gv('pl-incoterms'),
          lot:          gv('pl-lot'),
          currency:     gv('pl-currency') || 'EUR',
        }
        const sRec = s as unknown as Record<string, unknown>
        const projRec = (activeProject || {}) as Record<string, unknown>
        if (showPrices) {
          await generateDHLInvoice(fields, sRec, projRec, docData)
          toast('Invoice .docx downloaded', 'success')
        } else {
          await generateDHLPackingList(fields, sRec, projRec, docData)
          toast('Packing List .docx downloaded', 'success')
        }
        overlay.remove()
      } catch (err) {
        console.error('Document generation failed:', err)
        toast('Failed to generate document: ' + String(err), 'error')
        btn.disabled = false
        btn.textContent = `${showPrices ? '💰' : '📦'} Generate ${docTitle}`
      }
    })
  }

  return (
    <div style={{ padding:'24px', maxWidth:'1000px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'16px' }}>
        <div>
          <h1 style={{ fontSize:'18px', fontWeight:700 }}>{icon} {label} Shipments</h1>
          <p style={{ fontSize:'12px', color:'var(--text3)', marginTop:'2px' }}>{items.length} shipments</p>
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          {direction === 'export' && (
            <button className="btn btn-sm" style={{ background:'#d97706', color:'#fff', border:'none' }} onClick={createFromImports}>
              📤 Create from Imports
            </button>
          )}
          <button className="btn btn-primary" onClick={openNew}>+ Add Shipment</button>
          <button className="btn btn-sm" onClick={exportCSV}>⬇ CSV</button>
        </div>
      </div>

      {loading ? <div className="loading-center"><span className="spinner"/> Loading...</div>
      : items.length === 0 ? (
        <div className="empty-state">
          <div className="icon">{icon}</div>
          <h3>No {label.toLowerCase()} shipments</h3>
          <p>{direction === 'export' ? 'Use "Create from Imports" to generate return shipments for tooling TVs.' : 'Track tooling, equipment and parts shipments here.'}</p>
        </div>
      ) : (
        <div className="card" style={{ padding:0, overflow:'hidden' }}>
          <table>
            <thead>
              <tr><th>Reference</th><th>Description</th><th>Status</th><th>Carrier</th><th>Tracking</th><th>ETA</th><th></th></tr>
            </thead>
            <tbody>
              {items.map(s => {
                const sc = STATUS_COLORS[s.status] || STATUS_COLORS.pending
                return (
                  <tr key={s.id}>
                    <td style={{ fontFamily:'var(--mono)', fontWeight:600, fontSize:'12px' }}>{s.reference || '—'}</td>
                    <td style={{ color:'var(--text2)', maxWidth:'200px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.description || '—'}</td>
                    <td><span className="badge" style={sc}>{s.status.replace('_',' ')}</span></td>
                    <td style={{ fontSize:'12px' }}>{s.carrier || '—'}</td>
                    <td style={{ fontFamily:'var(--mono)', fontSize:'11px', color:'var(--text3)' }}>{s.tracking || '—'}</td>
                    <td style={{ fontFamily:'var(--mono)', fontSize:'12px' }}>{s.eta || '—'}</td>
                    <td style={{ whiteSpace:'nowrap' }}>
                      <button className="btn btn-sm" onClick={() => openEdit(s)}>Edit</button>
                      {direction === 'export' && (<>
                        <button className="btn btn-sm" style={{ marginLeft:'4px' }} title="SLI" onClick={() => openSLI(s)}>📄</button>
                        <button className="btn btn-sm" style={{ marginLeft:'2px' }} title="Packing List" onClick={() => openPackingOrInvoice(s, false)}>📦</button>
                        <button className="btn btn-sm" style={{ marginLeft:'2px' }} title="Commercial Invoice" onClick={() => openPackingOrInvoice(s, true)}>💰</button>
                      </>)}
                      <button className="btn btn-sm" style={{ marginLeft:'4px', color:'var(--red)' }} onClick={() => del(s)}>✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth:'520px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal==='new' ? `New ${label} Shipment` : `Edit Shipment`}</h3>
              <button className="btn btn-sm" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg-row">
                <div className="fg">
                  <label>Reference</label>
                  <input className="input" value={form.reference} onChange={e=>setForm(f=>({...f,reference:e.target.value}))} placeholder="e.g. TV482, PO-1234" autoFocus />
                </div>
                <div className="fg">
                  <label>Status</label>
                  <select className="input" value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>
                    {STATUSES.map(s=><option key={s} value={s}>{s.replace('_',' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>)}
                  </select>
                </div>
              </div>
              <div className="fg">
                <label>Description</label>
                <input className="input" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="What's being shipped" />
              </div>
              <div className="fg-row">
                <div className="fg">
                  <label>Carrier</label>
                  <input className="input" value={form.carrier} onChange={e=>setForm(f=>({...f,carrier:e.target.value}))} placeholder="e.g. DHL, Toll" />
                </div>
                <div className="fg" style={{ flex:2 }}>
                  <label>Tracking Number</label>
                  <input className="input" value={form.tracking} onChange={e=>setForm(f=>({...f,tracking:e.target.value}))} />
                </div>
              </div>
              <div className="fg-row">
                <div className="fg">
                  <label>{direction==='import' ? 'ETA' : 'Ship Date'}</label>
                  <input type="date" className="input" value={direction==='import' ? form.eta : form.shipped_date}
                    onChange={e=>setForm(f=>direction==='import' ? {...f,eta:e.target.value} : {...f,shipped_date:e.target.value})} />
                </div>
                <div className="fg">
                  <label>{direction==='import' ? 'Ship Date' : 'ETA'}</label>
                  <input type="date" className="input" value={direction==='import' ? form.shipped_date : form.eta}
                    onChange={e=>setForm(f=>direction==='import' ? {...f,shipped_date:e.target.value} : {...f,eta:e.target.value})} />
                </div>
              </div>
              <div className="fg">
                <label>Notes</label>
                <textarea className="input" rows={2} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} style={{ resize:'vertical' }} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving?<span className="spinner" style={{width:'14px',height:'14px'}}/>:null} Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
// cast fix 1777206221
