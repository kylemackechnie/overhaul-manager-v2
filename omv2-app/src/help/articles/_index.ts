// Auto-generated registry of all help articles.
// Drop a new .md file in this folder with frontmatter — it appears in the help panel.
//
// Frontmatter shape:
//   ---
//   slug: tce-register
//   title: TCE Register
//   category: Cost Tracking
//   order: 20
//   relatedTour: tce-register-tour     (optional)
//   relatedPanels: [nrg-tce, tce-forecast]    (optional)
//   ---

export interface ArticleMeta {
  slug: string
  title: string
  category: string
  order: number
  relatedTour?: string
  relatedPanels?: string[]
}

export interface Article extends ArticleMeta {
  body: string
}

// Tiny YAML-ish frontmatter parser. Supports string, number, and string-array values.
// Not a full YAML implementation — by design. Keeps bundle small and frontmatter dialect predictable.
function parseFrontmatter(raw: string): { meta: Partial<ArticleMeta>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) return { meta: {}, body: raw }
  const [, fmText, body] = match
  const meta: Record<string, unknown> = {}
  for (const line of fmText.split(/\r?\n/)) {
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/)
    if (!m) continue
    const [, key, valRaw] = m
    const val = valRaw.trim()
    if (!val) continue
    if (val.startsWith('[') && val.endsWith(']')) {
      meta[key] = val.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean)
    } else if (/^-?\d+(\.\d+)?$/.test(val)) {
      meta[key] = Number(val)
    } else {
      // Strip surrounding quotes if present
      meta[key] = val.replace(/^["']|["']$/g, '')
    }
  }
  return { meta: meta as Partial<ArticleMeta>, body }
}

// Vite glob import — eager + raw so we get the file contents at build time.
const rawArticles = import.meta.glob('./*.md', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>

const articles: Article[] = []
for (const path in rawArticles) {
  const raw = rawArticles[path]
  const { meta, body } = parseFrontmatter(raw)
  if (!meta.slug || !meta.title || !meta.category) {
    // Skip malformed articles silently in prod, but log in dev so the author notices.
    if (import.meta.env.DEV) {
      console.warn(`[help] Skipping ${path} — missing slug/title/category in frontmatter`)
    }
    continue
  }
  articles.push({
    slug: String(meta.slug),
    title: String(meta.title),
    category: String(meta.category),
    order: typeof meta.order === 'number' ? meta.order : 999,
    relatedTour: meta.relatedTour ? String(meta.relatedTour) : undefined,
    relatedPanels: Array.isArray(meta.relatedPanels) ? meta.relatedPanels.map(String) : undefined,
    body: body.trim(),
  })
}

// Stable sort: category, then order, then title
articles.sort((a, b) => {
  if (a.category !== b.category) return a.category.localeCompare(b.category)
  if (a.order !== b.order) return a.order - b.order
  return a.title.localeCompare(b.title)
})

export const ALL_ARTICLES: Article[] = articles

export function getArticle(slug: string): Article | undefined {
  return articles.find(a => a.slug === slug)
}

export function getArticlesForPanel(panelId: string): Article[] {
  return articles.filter(a => a.relatedPanels?.includes(panelId))
}

export function getCategories(): { name: string; articles: Article[] }[] {
  const map = new Map<string, Article[]>()
  for (const a of articles) {
    const list = map.get(a.category) ?? []
    list.push(a)
    map.set(a.category, list)
  }
  return Array.from(map.entries()).map(([name, articles]) => ({ name, articles }))
}
