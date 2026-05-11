/**
 * HelpButton — small `?` icon for panel headers. Opens a tooltip popover
 * showing related article(s) for the current panel, with deep-links into
 * the full article or its associated walkthrough.
 *
 * Renders nothing if no article in the registry has this panel in its
 * `relatedPanels:` frontmatter — graceful degradation as panels get
 * documentation coverage over time.
 *
 * Usage in any panel:
 *   import { HelpButton } from '../../components/HelpButton'
 *   <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
 *     <h2>My Panel</h2>
 *     <HelpButton panelId="my-panel" />
 *   </div>
 */

import { useState, useRef, useEffect } from 'react'
import { getArticlesForPanel } from '../help/articles/_index'
import { getTour } from '../help/tours/_index'
import { useAppStore } from '../store/appStore'

interface HelpButtonProps {
  /** The panel ID — matches values in articles' `relatedPanels:` frontmatter. */
  panelId: string
  /** Optional size override. Default 'sm' fits inside compact panel headers. */
  size?: 'sm' | 'md'
}

export function HelpButton({ panelId, size = 'sm' }: HelpButtonProps) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const setActivePanel = useAppStore(s => s.setActivePanel)
  const setHelpTargetSlug = useAppStore(s => s.setHelpTargetSlug)
  const setHelpTourId = useAppStore(s => s.setHelpTourId)

  // Find articles related to this panel. Usually one, but support multiple.
  const articles = getArticlesForPanel(panelId)

  // Close on click-outside or Escape
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node
      if (
        buttonRef.current && !buttonRef.current.contains(target) &&
        popoverRef.current && !popoverRef.current.contains(target)
      ) {
        setOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // No articles tagged for this panel → render nothing (graceful degradation)
  if (articles.length === 0) return null

  const dim = size === 'sm' ? 20 : 24
  const fontSize = size === 'sm' ? 12 : 14

  function openFullArticle(slug: string) {
    setHelpTargetSlug(slug)
    setActivePanel('help')
    setOpen(false)
  }

  function runRelatedTour(tourId: string) {
    // Setting helpTourId + activating help panel lets HelpPanel kick off the
    // tour on mount, then clear the intent. Keeps tour-launch concerns out
    // of this component.
    setHelpTourId(tourId)
    setActivePanel('help')
    setOpen(false)
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        ref={buttonRef}
        onClick={() => setOpen(o => !o)}
        title="Help for this panel"
        style={{
          width: dim, height: dim,
          padding: 0,
          border: '1px solid var(--border)',
          borderRadius: '50%',
          background: open ? 'var(--accent)' : 'var(--bg)',
          color: open ? '#fff' : 'var(--text2)',
          cursor: 'pointer',
          fontSize,
          fontWeight: 700,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          lineHeight: 1,
          transition: 'background 120ms, color 120ms',
        }}
        aria-label="Help for this panel"
        aria-expanded={open}
      >
        ?
      </button>
      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 6,
            zIndex: 1000,
            minWidth: 280,
            maxWidth: 360,
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            padding: '12px 14px',
            fontSize: 13,
            color: 'var(--text)',
          }}
        >
          {articles.map((article, idx) => {
            const tour = article.relatedTour ? getTour(article.relatedTour) : undefined
            return (
              <div
                key={article.slug}
                style={{
                  paddingTop: idx === 0 ? 0 : 10,
                  marginTop: idx === 0 ? 0 : 10,
                  borderTop: idx === 0 ? 'none' : '1px solid var(--border)',
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{article.title}</div>
                {article.summary && (
                  <div style={{
                    fontSize: 12,
                    color: 'var(--text2)',
                    lineHeight: 1.45,
                    marginBottom: 10,
                  }}>
                    {article.summary}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => openFullArticle(article.slug)}
                  >
                    Open full article →
                  </button>
                  {tour && (
                    <button
                      className="btn btn-sm"
                      onClick={() => runRelatedTour(tour.id)}
                      title={`Run ${tour.title} walkthrough${tour.estimatedSeconds ? ` (~${tour.estimatedSeconds}s)` : ''}`}
                    >
                      ▶ Walkthrough
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
