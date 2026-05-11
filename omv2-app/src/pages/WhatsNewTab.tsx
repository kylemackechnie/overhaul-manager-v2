import { useState, useMemo } from 'react'
import { marked } from 'marked'
import { useHelpNews, type NewsItemWithDismissed } from '../hooks/useHelpNews'
import { usePermissions } from '../lib/permissions'
import type { HelpNewsCategory } from '../types'

const CATEGORY_LABELS: Record<HelpNewsCategory, { label: string; icon: string; color: string }> = {
  update:       { label: 'Update',       icon: '🆕', color: 'var(--accent)' },
  tip:          { label: 'Tip',          icon: '💡', color: 'var(--amber, #f59e0b)' },
  announcement: { label: 'Announcement', icon: '📣', color: 'var(--blue, #2563eb)' },
}

export function WhatsNewTab() {
  const { isAdmin } = usePermissions()
  const news = useHelpNews()
  const [showDismissed, setShowDismissed] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const visibleItems = useMemo(() => {
    if (showDismissed) return news.items
    return news.items.filter(n => !n.dismissed || !n.published)
  }, [news.items, showDismissed])

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
        <label style={{ fontSize: '12px', color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showDismissed}
            onChange={e => setShowDismissed(e.target.checked)}
          />
          Show dismissed
        </label>
        <div style={{ flex: 1 }} />
        {isAdmin && (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => { setCreating(true); setEditingId(null) }}
            disabled={creating}
          >
            + New post
          </button>
        )}
      </div>

      {/* Editor (admin only) */}
      {creating && isAdmin && (
        <NewsEditor
          mode="create"
          onCancel={() => setCreating(false)}
          onSave={async (payload) => {
            const result = await news.create(payload)
            if (result) setCreating(false)
          }}
        />
      )}
      {editingId && isAdmin && (() => {
        const item = news.items.find(n => n.id === editingId)
        if (!item) return null
        return (
          <NewsEditor
            mode="edit"
            initial={item}
            onCancel={() => setEditingId(null)}
            onSave={async (payload) => {
              const result = await news.update(editingId, payload)
              if (result) setEditingId(null)
            }}
            onDelete={async () => {
              if (!confirm('Delete this post? This cannot be undone.')) return
              const ok = await news.remove(editingId)
              if (ok) setEditingId(null)
            }}
          />
        )
      })()}

      {/* List */}
      <div style={{ overflowY: 'auto', flex: 1, paddingRight: '8px' }}>
        {news.loading && <EmptyState message="Loading…" />}
        {news.error && (
          <div style={{ padding: '12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '4px', color: '#991b1b', fontSize: '12px' }}>
            {news.error}
          </div>
        )}
        {!news.loading && visibleItems.length === 0 && (
          <EmptyState message={news.items.length === 0 ? "Nothing here yet. Check back later." : "Nothing new — toggle 'Show dismissed' to see past posts."} />
        )}
        {visibleItems.map(item => (
          <NewsCard
            key={item.id}
            item={item}
            isAdmin={isAdmin}
            onDismiss={() => void news.dismiss(item.id)}
            onUndismiss={() => void news.undismiss(item.id)}
            onEdit={() => { setEditingId(item.id); setCreating(false) }}
          />
        ))}
      </div>
    </div>
  )
}

function NewsCard({
  item, isAdmin, onDismiss, onUndismiss, onEdit,
}: {
  item: NewsItemWithDismissed
  isAdmin: boolean
  onDismiss: () => void
  onUndismiss: () => void
  onEdit: () => void
}) {
  const cat = CATEGORY_LABELS[item.category]
  const html = useMemo(() => marked.parse(item.body_md) as string, [item.body_md])
  const dateStr = item.published_at
    ? new Date(item.published_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'Draft'

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderLeft: `4px solid ${cat.color}`,
      borderRadius: '6px',
      padding: '14px 16px',
      marginBottom: '12px',
      background: item.dismissed ? 'var(--bg3)' : 'var(--bg)',
      opacity: item.dismissed ? 0.7 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '8px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '2px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: cat.color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {cat.icon} {cat.label}
            </span>
            {item.pinned && (
              <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text3)', background: 'var(--bg3)', padding: '1px 6px', borderRadius: '3px' }}>
                📌 PINNED
              </span>
            )}
            {!item.published && (
              <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--red, #dc2626)', background: 'var(--bg3)', padding: '1px 6px', borderRadius: '3px' }}>
                DRAFT
              </span>
            )}
            <span style={{ fontSize: '11px', color: 'var(--text3)' }}>{dateStr}</span>
          </div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text)' }}>{item.title}</div>
        </div>
        <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
          {isAdmin && (
            <button className="btn btn-sm" onClick={onEdit}>Edit</button>
          )}
          {item.published && (
            item.dismissed
              ? <button className="btn btn-sm" onClick={onUndismiss}>Unread</button>
              : <button className="btn btn-sm" onClick={onDismiss}>Dismiss</button>
          )}
        </div>
      </div>
      <div className="help-article" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}

interface EditorPayload {
  title: string
  body_md: string
  category: HelpNewsCategory
  pinned: boolean
  published: boolean
}

interface NewsEditorProps {
  mode: 'create' | 'edit'
  initial?: NewsItemWithDismissed
  onCancel: () => void
  onSave: (payload: EditorPayload) => Promise<void>
  onDelete?: () => Promise<void>
}

function NewsEditor({ mode, initial, onCancel, onSave, onDelete }: NewsEditorProps) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [body, setBody] = useState(initial?.body_md ?? '')
  const [category, setCategory] = useState<HelpNewsCategory>(initial?.category ?? 'update')
  const [pinned, setPinned] = useState(initial?.pinned ?? false)
  const [published, setPublished] = useState(initial?.published ?? false)
  const [saving, setSaving] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  const canSave = title.trim().length > 0 && body.trim().length > 0 && !saving

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    await onSave({ title: title.trim(), body_md: body.trim(), category, pinned, published })
    setSaving(false)
  }

  const previewHtml = useMemo(() => marked.parse(body || '*(empty)*') as string, [body])

  return (
    <div style={{
      border: '2px solid var(--accent)',
      borderRadius: '6px',
      padding: '14px 16px',
      marginBottom: '16px',
      background: 'var(--accent-light)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--accent)' }}>
          {mode === 'create' ? 'New post' : 'Edit post'}
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button className="btn btn-sm" onClick={() => setShowPreview(p => !p)}>
            {showPreview ? 'Edit' : 'Preview'}
          </button>
          {onDelete && (
            <button className="btn btn-sm btn-danger" onClick={() => void onDelete()}>Delete</button>
          )}
          <button className="btn btn-sm" onClick={onCancel}>Cancel</button>
          <button className="btn btn-sm btn-primary" disabled={!canSave} onClick={() => void handleSave()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {!showPreview && (
        <>
          <input
            type="text"
            placeholder="Title"
            value={title}
            onChange={e => setTitle(e.target.value)}
            style={{
              width: '100%', padding: '8px 10px', fontSize: '14px', fontWeight: 600,
              border: '1px solid var(--border)', borderRadius: '4px', marginBottom: '8px',
              background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box',
            }}
          />
          <textarea
            placeholder="Body (markdown supported)"
            value={body}
            onChange={e => setBody(e.target.value)}
            style={{
              width: '100%', padding: '8px 10px', fontSize: '13px', minHeight: '160px',
              border: '1px solid var(--border)', borderRadius: '4px', marginBottom: '8px',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box', resize: 'vertical',
            }}
          />
        </>
      )}

      {showPreview && (
        <div style={{
          padding: '12px', minHeight: '160px',
          background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '4px',
          marginBottom: '8px',
        }}>
          <div style={{ fontSize: '15px', fontWeight: 700, marginBottom: '8px' }}>{title || '(no title)'}</div>
          <div className="help-article" dangerouslySetInnerHTML={{ __html: previewHtml }} />
        </div>
      )}

      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center', fontSize: '12px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          Category:
          <select
            value={category}
            onChange={e => setCategory(e.target.value as HelpNewsCategory)}
            style={{ padding: '4px 6px', fontSize: '12px', border: '1px solid var(--border)', borderRadius: '4px', background: 'var(--bg)', color: 'var(--text)' }}
          >
            <option value="update">🆕 Update</option>
            <option value="tip">💡 Tip</option>
            <option value="announcement">📣 Announcement</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
          <input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} />
          📌 Pinned
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
          <input type="checkbox" checked={published} onChange={e => setPublished(e.target.checked)} />
          Published (visible to all users)
        </label>
      </div>
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text3)', fontSize: '13px' }}>
      <div style={{ fontSize: '32px', marginBottom: '12px' }}>📰</div>
      <div>{message}</div>
    </div>
  )
}
