import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { TileLayoutEntry } from '../../types/dashboard'

interface Props {
  tile: TileLayoutEntry
  editMode: boolean
  children: React.ReactNode
  gridCols?: number
}

export function SortableTile({ tile, editMode, children, gridCols = 4 }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tile.id,
  })

  const colSpan = tile.size === 'full' ? gridCols : (tile.size === 'lg' || tile.size === 'xl') ? 2 : 1

  return (
    <div
      ref={setNodeRef}
      style={{
        gridColumn: `span ${colSpan}`,
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.45 : 1,
        position: 'relative',
      }}
    >
      {editMode && (
        <div
          {...attributes}
          {...listeners}
          style={{
            position: 'absolute',
            top: 6,
            left: 6,
            zIndex: 10,
            background: 'rgba(0,0,0,0.6)',
            borderRadius: '4px',
            padding: '3px 6px',
            cursor: 'grab',
            fontSize: '13px',
            color: '#fff',
            userSelect: 'none',
            lineHeight: 1,
          }}
          title="Drag to reorder"
        >
          ⠿
        </div>
      )}
      {children}
    </div>
  )
}
