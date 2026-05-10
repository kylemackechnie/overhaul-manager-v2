interface Props {
  editMode: boolean
  onCustomise: () => void
  onAddWidget: () => void
  onReset: () => void
  onDone: () => void
  onRefresh: () => void
}

export function DashboardToolbar({ editMode, onCustomise, onAddWidget, onReset, onDone, onRefresh }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: '8px',
        marginBottom: '12px',
      }}
    >
      {editMode ? (
        <>
          <button
            className="btn btn-sm"
            style={{ background: 'var(--accent)', color: '#fff' }}
            onClick={onAddWidget}
          >
            + Add Widget
          </button>
          <button className="btn btn-sm" onClick={onReset}>
            Reset Layout
          </button>
          <button
            className="btn btn-sm"
            style={{ background: 'var(--green)', color: '#fff' }}
            onClick={onDone}
          >
            ✓ Done
          </button>
        </>
      ) : (
        <>
          <button className="btn btn-sm" onClick={onRefresh} title="Refresh all data">
            ↺ Refresh
          </button>
          <button className="btn btn-sm" onClick={onCustomise} title="Customise dashboard layout">
            ✎ Customise
          </button>
        </>
      )}
    </div>
  )
}
