/**
 * LabourSCurveTile
 *
 * Extracts the canvas S-curve chart from HRDashboardPanel into a self-contained
 * full-width tile. Uses the shared useLabourStats hook (no duplicate network requests).
 */

import { useEffect, useRef, useState } from 'react'
import { useLabourStats } from '../../../../hooks/useLabourStats'
import { TileLoading, TileEmpty } from '../../primitives'
import type { TileComponent, DashboardContext } from '../../../../types/dashboard'

const def = {
  id: 's-curve',
  icon: '📈',
  title: 'Labour S-Curve',
  description: 'Cumulative or weekly labour hours / sell value by category',
  category: 'Labour',
  defaultSize: 'lg' as const,
  defaultVisible: true,
}

function SCurveComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading } = useLabourStats(ctx.projectId)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [scCategory, setScCategory] = useState<'all' | 'trades' | 'mgmt'>('all')
  const [scUnit, setScUnit] = useState<'hours' | 'aud'>('hours')
  const [scMode, setScMode] = useState<'cumulative' | 'weekly'>('cumulative')

  const weeklyData = data?.byWeek || []

  useEffect(() => { drawChart() }, [weeklyData, scCategory, scUnit, scMode])

  function drawChart() {
    const canvas = canvasRef.current
    if (!canvas || !weeklyData.length) return
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) return

    const dpr = window.devicePixelRatio || 1
    const W = canvas.offsetWidth
    const H = 200
    canvas.width = W * dpr; canvas.height = H * dpr
    ctx2d.scale(dpr, dpr); canvas.style.height = H + 'px'
    ctx2d.clearRect(0, 0, W, H)

    const pad = { l: 60, r: 20, t: 16, b: 32 }
    const chartW = W - pad.l - pad.r
    const chartH = H - pad.t - pad.b

    const getCat = (wk: typeof weeklyData[0]) => {
      if (scCategory === 'trades') return scUnit === 'hours' ? wk.tradesHrs : wk.tradeSell
      if (scCategory === 'mgmt') return scUnit === 'hours' ? wk.mgmtHrs : wk.mgmtSell
      return scUnit === 'hours' ? wk.tradesHrs + wk.mgmtHrs : wk.tradeSell + wk.mgmtSell
    }

    const values = weeklyData.map(getCat)
    const cumulative = values.reduce((acc: number[], v, i) => { acc.push((acc[i - 1] || 0) + v); return acc }, [])
    const display = scMode === 'cumulative' ? cumulative : values
    const maxVal = Math.max(...display, 1)

    const x = (i: number) => pad.l + (i / (weeklyData.length - 1 || 1)) * chartW
    const y = (v: number) => pad.t + (1 - v / maxVal) * chartH

    // Grid lines
    ctx2d.strokeStyle = 'rgba(148,163,184,0.15)'; ctx2d.lineWidth = 1
    for (let i = 0; i <= 4; i++) {
      const yy = pad.t + (i / 4) * chartH
      ctx2d.beginPath(); ctx2d.moveTo(pad.l, yy); ctx2d.lineTo(W - pad.r, yy); ctx2d.stroke()
      ctx2d.fillStyle = 'rgba(100,116,139,0.7)'; ctx2d.font = '9px Arial'; ctx2d.textAlign = 'right'
      const v = maxVal * (1 - i / 4)
      ctx2d.fillText(scUnit === 'hours' ? v.toFixed(0) + 'h' : '$' + Math.round(v).toLocaleString(), pad.l - 4, yy + 3)
    }

    if (weeklyData.length > 1) {
      // Line
      ctx2d.beginPath(); ctx2d.strokeStyle = 'var(--mod-hr, #0f766e)'; ctx2d.lineWidth = 2; ctx2d.lineJoin = 'round'
      weeklyData.forEach((_, i) => { i === 0 ? ctx2d.moveTo(x(i), y(display[i])) : ctx2d.lineTo(x(i), y(display[i])) })
      ctx2d.stroke()

      // Fill
      ctx2d.beginPath(); ctx2d.moveTo(x(0), y(display[0]))
      weeklyData.forEach((_, i) => ctx2d.lineTo(x(i), y(display[i])))
      ctx2d.lineTo(x(weeklyData.length - 1), pad.t + chartH)
      ctx2d.lineTo(x(0), pad.t + chartH)
      ctx2d.closePath(); ctx2d.fillStyle = 'rgba(15,118,110,0.08)'; ctx2d.fill()
    }

    // X labels
    ctx2d.fillStyle = 'rgba(100,116,139,0.8)'; ctx2d.font = '9px Arial'; ctx2d.textAlign = 'center'
    const step = Math.max(1, Math.ceil(weeklyData.length / 8))
    weeklyData.forEach((wk, i) => { if (i % step === 0) ctx2d.fillText(wk.week.slice(5), x(i), H - 8) })
  }

  if (isLoading) return <TileLoading />
  if (!weeklyData.length) return <TileEmpty icon="📈" label="No timesheet data yet" />

  return (
    <div className="card" style={{ padding: '14px 16px', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '13px' }}>Labour Progress Curve</div>
          <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>Cumulative tracking of labour commitments</div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <select className="input" style={{ width: '130px', fontSize: '11px', padding: '4px 6px' }}
            value={scCategory} onChange={e => setScCategory(e.target.value as typeof scCategory)}>
            <option value="all">All categories</option>
            <option value="trades">Trades only</option>
            <option value="mgmt">Management only</option>
          </select>
          <select className="input" style={{ width: '90px', fontSize: '11px', padding: '4px 6px' }}
            value={scUnit} onChange={e => setScUnit(e.target.value as typeof scUnit)}>
            <option value="hours">Hours</option>
            <option value="aud">Cost ($)</option>
          </select>
          <select className="input" style={{ width: '110px', fontSize: '11px', padding: '4px 6px' }}
            value={scMode} onChange={e => setScMode(e.target.value as typeof scMode)}>
            <option value="cumulative">Cumulative</option>
            <option value="weekly">Per week</option>
          </select>
        </div>
      </div>
      <canvas ref={canvasRef} style={{ width: '100%', display: 'block' }} />
    </div>
  )
}

export const LabourSCurveTile: TileComponent = { def, Component: SCurveComp }
