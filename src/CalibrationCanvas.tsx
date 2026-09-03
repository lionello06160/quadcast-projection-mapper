import { useMemo, useState } from 'react'
import { clampPoint, isValidPolygon, isValidQuad } from './geometry'
import type { Point, ProjectState, Surface } from './types'
import { useProjectionRenderer } from './useProjectionRenderer'

const VIEW_WIDTH = 1000
const VIEW_HEIGHT = 562.5
const cornerLabels = ['TL', 'TR', 'BR', 'BL']

interface CalibrationCanvasProps {
  state: ProjectState
  getDrawable: (id: string) => TexImageSource | null
  onSelect: (id: string) => void
  onCornersChange: (id: string, corners: Surface['corners']) => void
  editMode: 'warp' | 'mask'
  selectedMaskVertex: number
  onMaskVertexSelect: (index: number) => void
  onMaskChange: (id: string, mask: Point[]) => void
}

export function CalibrationCanvas({ state, getDrawable, onSelect, onCornersChange, editMode, selectedMaskVertex, onMaskVertexSelect, onMaskChange }: CalibrationCanvasProps) {
  const { canvasRef, error } = useProjectionRenderer(state, getDrawable)
  const [dragging, setDragging] = useState<{ surfaceId: string; pointIndex: number; kind: 'warp' | 'mask' } | null>(null)
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

  const updateMaskFromPointer = (event: React.PointerEvent<SVGCircleElement>, surface: Surface, pointIndex: number) => {
    const svg = event.currentTarget.ownerSVGElement
    if (!svg || !surface.mask) return
    const bounds = svg.getBoundingClientRect()
    const point = clampPoint({
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height,
    })
    const mask = surface.mask.map((maskPoint) => ({ ...maskPoint }))
    mask[pointIndex] = point
    if (isValidPolygon(mask)) onMaskChange(surface.id, mask)
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
                onPointerDown={() => onSelect(surface.id)}
                aria-label={`選取 ${surface.name}`}
              />
              {surface.mask ? (
                <polygon
                  className="mask-outline"
                  points={surface.mask.map((point) => `${point.x * VIEW_WIDTH},${point.y * VIEW_HEIGHT}`).join(' ')}
                />
              ) : null}
              {selected && editMode === 'warp'
                ? surface.corners.map((corner, cornerIndex) => (
                    <g key={cornerLabels[cornerIndex]}>
                      <circle
                        cx={corner.x * VIEW_WIDTH}
                        cy={corner.y * VIEW_HEIGHT}
                        r="11"
                        onPointerDown={(event) => {
                          event.currentTarget.setPointerCapture(event.pointerId)
                          setDragging({ surfaceId: surface.id, pointIndex: cornerIndex, kind: 'warp' })
                          updateFromPointer(event, surface, cornerIndex)
                        }}
                        onPointerMove={(event) => {
                          if (dragging?.surfaceId === surface.id && dragging.pointIndex === cornerIndex && dragging.kind === 'warp') {
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
              {selected && editMode === 'mask' && surface.mask
                ? surface.mask.map((point, pointIndex) => (
                    <g key={`mask-${pointIndex}`} className={pointIndex === selectedMaskVertex ? 'mask-handle active' : 'mask-handle'}>
                      <circle
                        cx={point.x * VIEW_WIDTH}
                        cy={point.y * VIEW_HEIGHT}
                        r="9"
                        onPointerDown={(event) => {
                          event.currentTarget.setPointerCapture(event.pointerId)
                          onMaskVertexSelect(pointIndex)
                          setDragging({ surfaceId: surface.id, pointIndex, kind: 'mask' })
                          updateMaskFromPointer(event, surface, pointIndex)
                        }}
                        onPointerMove={(event) => {
                          if (dragging?.surfaceId === surface.id && dragging.pointIndex === pointIndex && dragging.kind === 'mask') {
                            updateMaskFromPointer(event, surface, pointIndex)
                          }
                        }}
                        onPointerUp={(event) => {
                          event.currentTarget.releasePointerCapture(event.pointerId)
                          setDragging(null)
                        }}
                      />
                      <text x={point.x * VIEW_WIDTH + 14} y={point.y * VIEW_HEIGHT - 12}>P{pointIndex + 1}</text>
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
