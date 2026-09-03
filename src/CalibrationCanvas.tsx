import { useMemo, useState } from 'react'
import { clampPoint, clampTranslation, isValidQuad, translatePoints } from './geometry'
import type { Point, ProjectState, Surface } from './types'
import { useProjectionRenderer } from './useProjectionRenderer'

const VIEW_WIDTH = 1000
const VIEW_HEIGHT = 562.5
const cornerLabels = ['TL', 'TR', 'BR', 'BL']

type DragState =
  | { surfaceId: string; pointIndex: number; kind: 'warp' }
  | { surfaceId: string; kind: 'surface'; origin: Point; corners: Surface['corners'] }

interface CalibrationCanvasProps {
  state: ProjectState
  getDrawable: (id: string) => TexImageSource | null
  onSelect: (id: string) => void
  onCornersChange: (id: string, corners: Surface['corners']) => void
}

export function CalibrationCanvas({ state, getDrawable, onSelect, onCornersChange }: CalibrationCanvasProps) {
  const { canvasRef, error } = useProjectionRenderer(state, getDrawable)
  const [dragging, setDragging] = useState<DragState | null>(null)
  const orderedSurfaces = useMemo(
    () => [...state.surfaces].sort((left, right) => left.zIndex - right.zIndex),
    [state.surfaces],
  )

  const updateFromPointer = (event: React.PointerEvent<SVGCircleElement>, surface: Surface, cornerIndex: number) => {
    const svg = event.currentTarget.ownerSVGElement
    if (!svg) return
    const bounds = svg.getBoundingClientRect()
    const point = clampPoint({
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height,
    })
    const corners = surface.corners.map((corner) => ({ ...corner })) as Surface['corners']
    corners[cornerIndex] = point
    if (isValidQuad(corners)) onCornersChange(surface.id, corners)
  }

  const normalizedPointer = (event: React.PointerEvent<SVGElement>): Point | null => {
    const svg = event.currentTarget.ownerSVGElement
    if (!svg) return null
    const bounds = svg.getBoundingClientRect()
    return {
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height,
    }
  }

  const moveSurfaceFromPointer = (event: React.PointerEvent<SVGPolygonElement>) => {
    if (!dragging || dragging.kind !== 'surface') return
    const point = normalizedPointer(event)
    if (!point) return
    const delta = clampTranslation(dragging.corners, {
      x: point.x - dragging.origin.x,
      y: point.y - dragging.origin.y,
    })
    const corners = translatePoints(dragging.corners, delta) as Surface['corners']
    onCornersChange(dragging.surfaceId, corners)
  }

  return (
    <div className="calibration-stage" data-testid="calibration-stage">
      <canvas ref={canvasRef} className="render-canvas" aria-label="投影內容預覽" />
      {state.showGrid ? <div className="editor-grid" aria-hidden="true" /> : null}
      <svg
        className="calibration-overlay"
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        preserveAspectRatio="none"
        aria-label="四角校正區域"
      >
        {orderedSurfaces.map((surface) => {
          const selected = surface.id === state.selectedSurfaceId
          const points = surface.corners.map((corner) => `${corner.x * VIEW_WIDTH},${corner.y * VIEW_HEIGHT}`).join(' ')
          return (
            <g key={surface.id} className={selected ? 'surface-shape selected' : 'surface-shape'}>
              <polygon
                points={points}
                onPointerDown={(event) => {
                  const origin = normalizedPointer(event)
                  if (!origin) return
                  event.currentTarget.setPointerCapture(event.pointerId)
                  onSelect(surface.id)
                  setDragging({
                    surfaceId: surface.id,
                    kind: 'surface',
                    origin,
                    corners: surface.corners.map((corner) => ({ ...corner })) as Surface['corners'],
                  })
                }}
                onPointerMove={moveSurfaceFromPointer}
                onPointerUp={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
                  setDragging(null)
                }}
                onPointerCancel={() => setDragging(null)}
                aria-label={`拖曳 ${surface.name}`}
              />
              {selected
                ? surface.corners.map((corner, cornerIndex) => (
                    <g key={cornerLabels[cornerIndex]}>
                      <circle
                        cx={corner.x * VIEW_WIDTH}
                        cy={corner.y * VIEW_HEIGHT}
                        r="11"
                        onPointerDown={(event) => {
                          event.stopPropagation()
                          event.currentTarget.setPointerCapture(event.pointerId)
                          setDragging({ surfaceId: surface.id, pointIndex: cornerIndex, kind: 'warp' })
                          updateFromPointer(event, surface, cornerIndex)
                        }}
                        onPointerMove={(event) => {
                          if (dragging?.kind === 'warp' && dragging.surfaceId === surface.id && dragging.pointIndex === cornerIndex) {
                            updateFromPointer(event, surface, cornerIndex)
                          }
                        }}
                        onPointerUp={(event) => {
                          event.currentTarget.releasePointerCapture(event.pointerId)
                          setDragging(null)
                        }}
                      />
                      <text x={corner.x * VIEW_WIDTH + 17} y={corner.y * VIEW_HEIGHT - 15}>
                        {cornerLabels[cornerIndex]}
                      </text>
                    </g>
                  ))
                : null}
            </g>
          )
        })}
      </svg>
      {error ? <div className="canvas-error">{error}</div> : null}
      <div className="preview-ruler preview-ruler-x">0&nbsp;&nbsp;&nbsp;&nbsp;25&nbsp;&nbsp;&nbsp;&nbsp;50&nbsp;&nbsp;&nbsp;&nbsp;75&nbsp;&nbsp;&nbsp;&nbsp;100</div>
      <div className="stage-readout">LIVE / 16:9</div>
    </div>
  )
}
