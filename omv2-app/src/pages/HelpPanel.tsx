import { useState, useMemo, useEffect } from 'react'
import { marked } from 'marked'
import { ALL_ARTICLES, getCategories, type Article } from '../help/articles/_index'
import { useHelpNews } from '../hooks/useHelpNews'
import { WhatsNewTab } from './WhatsNewTab'

type HelpTab = 'reference' | 'walkthroughs' | 'whats-new'

// Configure marked once at module load. Synchronous mode keeps render simple.
marked.setOptions({ gfm: true, breaks: false })

export function HelpPanel() {
  const [tab, setTab] = useState<HelpTab>('reference')
  const [selectedSlug, setSelectedSlug] = useState<string>(ALL_ARTICLES[0]?.slug ?? '')
  const [search, setSearch] = useState('')

  const categories = useMemo(() => getCategories(), [])
  const selected = useMemo(() => ALL_ARTICLES.find(a => a.slug === selectedSlug), [selectedSlug])
  const { unreadCount } = useHelpNews()

  // Filter sidebar by search query (matches title or category)
  const filteredCategories = useMemo(() => {
    if (!search.trim()) return categories
    const q = search.toLowerCase()
    return categories
      .map(c => ({
        ...c,
        articles: c.articles.filter(a =>
          a.title.toLowerCase().includes(q) ||
          a.category.toLowerCase().includes(q) ||
          a.body.toLowerCase().includes(q)
        ),
      }))
      .filter(c => c.articles.length > 0)
  }, [categories, search])

  // If a search filters out the currently selected article, jump to first match
  useEffect(() => {
    if (!search.trim()) return
    const stillVisible = filteredCategories.some(c => c.articles.some(a => a.slug === selectedSlug))
    if (!stillVisible && filteredCategories[0]?.articles[0]) {
      setSelectedSlug(filteredCategories[0].articles[0].slug)
    }
  }, [search, filteredCategories, selectedSlug])

  return (
    <div style={{ padding: '20px', height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, margin: 0 }}>Help & Guide</h1>
        <p style={{ fontSize: '13px', color: 'var(--text3)', marginTop: '4px', marginBottom: 0 }}>
          Reference, walkthroughs, and what's new in the Overhaul Manager
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '2px', borderBottom: '1px solid var(--border)', marginBottom: '16px' }}>
        <HelpTabButton label="📖 Reference" active={tab === 'reference'} onClick={() => setTab('reference')} />
        <HelpTabButton label="🎯 Walkthroughs" active={tab === 'walkthroughs'} onClick={() => setTab('walkthroughs')} />
        <HelpTabButton
          label="📰 What's New"
          badge={unreadCount > 0 ? unreadCount : undefined}
          active={tab === 'whats-new'}
          onClick={() => setTab('whats-new')}
        />
      </div>

      {tab === 'reference' && (
        <ReferenceTab
          search={search}
          onSearchChange={setSearch}
          categories={filteredCategories}
          selected={selected}
          selectedSlug={selectedSlug}
          onSelectSlug={setSelectedSlug}
        />
      )}

      {tab === 'walkthroughs' && <WalkthroughsTabPlaceholder />}
      {tab === 'whats-new' && <WhatsNewTab />}
    </div>
  )
}

function HelpTabButton({ label, active, onClick, badge }: { label: string; active: boolean; onClick: () => void; badge?: number }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 16px',
        background: active ? 'var(--bg3)' : 'transparent',
        border: 'none',
        borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
        color: active ? 'var(--text)' : 'var(--text2)',
        cursor: 'pointer',
        fontSize: '13px',
        fontWeight: active ? 600 : 500,
        marginBottom: '-1px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
      }}
    >
      {label}
      {badge !== undefined && (
        <span style={{
          background: 'var(--accent)',
          color: '#fff',
          fontSize: '10px',
          fontWeight: 700,
          padding: '1px 6px',
          borderRadius: '10px',
          minWidth: '16px',
          textAlign: 'center',
        }}>
          {badge}
        </span>
      )}
    </button>
  )
}

interface ReferenceTabProps {
  search: string
  onSearchChange: (s: string) => void
  categories: { name: string; articles: Article[] }[]
  selected: Article | undefined
  selectedSlug: string
  onSelectSlug: (slug: string) => void
}

function ReferenceTab({ search, onSearchChange, categories, selected, selectedSlug, onSelectSlug }: ReferenceTabProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: '20px', flex: 1, minHeight: 0 }}>
      {/* Sidebar */}
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <input
          type="text"
          placeholder="🔍 Search articles..."
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          style={{
            padding: '6px 10px', fontSize: '12px', marginBottom: '12px',
            border: '1px solid var(--border)', borderRadius: '4px',
            background: 'var(--bg)', color: 'var(--text)',
          }}
        />
        <div style={{ overflowY: 'auto', flex: 1, paddingRight: '4px' }}>
          {categories.length === 0 && (
            <div style={{ fontSize: '12px', color: 'var(--text3)', padding: '12px', textAlign: 'center' }}>
              No articles match "{search}"
            </div>
          )}
          {categories.map(cat => (
            <div key={cat.name} style={{ marginBottom: '12px' }}>
              <div style={{
                fontSize: '11px', fontWeight: 700, color: 'var(--text3)',
                textTransform: 'uppercase', letterSpacing: '0.5px',
                padding: '4px 8px', marginBottom: '2px',
              }}>
                {cat.name}
              </div>
              {cat.articles.map(a => (
                <button
                  key={a.slug}
                  onClick={() => onSelectSlug(a.slug)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '6px 10px', fontSize: '13px',
                    background: selectedSlug === a.slug ? 'var(--accent-light)' : 'transparent',
                    color: selectedSlug === a.slug ? 'var(--accent)' : 'var(--text2)',
                    border: 'none', borderRadius: '4px', cursor: 'pointer',
                    fontWeight: selectedSlug === a.slug ? 600 : 400,
                  }}
                >
                  {a.title}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Article body */}
      <div style={{ overflowY: 'auto', minHeight: 0, paddingRight: '8px' }}>
        {selected ? <ArticleView article={selected} /> : <EmptyArticleState />}
      </div>
    </div>
  )
}

function ArticleView({ article }: { article: Article }) {
  const html = useMemo(() => marked.parse(article.body) as string, [article.body])
  return (
    <div className="help-article" style={{ maxWidth: '720px' }}>
      <div style={{ fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
        {article.category}
      </div>
      <div
        // Markdown is author-controlled (lives in our repo, never user input).
        // Safe to dangerouslySetInnerHTML here — same trust model as any other source code.
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {article.relatedTour && (
        <div style={{
          marginTop: '24px', padding: '12px 16px',
          background: 'var(--accent-light)', border: '1px solid var(--accent)',
          borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '12px',
        }}>
          <div style={{ fontSize: '13px' }}>
            <div style={{ fontWeight: 600, color: 'var(--accent)' }}>Interactive walkthrough available</div>
            <div style={{ color: 'var(--text2)', fontSize: '12px', marginTop: '2px' }}>
              Step through this workflow with on-screen guidance
            </div>
          </div>
          <button
            className="btn btn-primary"
            disabled
            title="Walkthrough engine arriving in next commit"
          >
            ▶ Run walkthrough
          </button>
        </div>
      )}
    </div>
  )
}

function EmptyArticleState() {
  return (
    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text3)', fontSize: '13px' }}>
      Select an article from the sidebar.
    </div>
  )
}

function WalkthroughsTabPlaceholder() {
  return (
    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text3)', fontSize: '13px' }}>
      <div style={{ fontSize: '32px', marginBottom: '12px' }}>🎯</div>
      <div style={{ fontWeight: 600, marginBottom: '4px', color: 'var(--text2)' }}>Walkthroughs coming soon</div>
      <div>Interactive guided tours will appear here.</div>
    </div>
  )
}
