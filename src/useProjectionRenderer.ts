import { useEffect, useRef, useState } from 'react'
import type { ProjectState } from './types'
import { ProjectionRenderer } from './webglRenderer'

export function useProjectionRenderer(
  state: ProjectState,
  getDrawable: (id: string) => TexImageSource | null,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<ProjectionRenderer | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    try {
      rendererRef.current = new ProjectionRenderer(canvasRef.current, state, getDrawable)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '無法啟動繪圖引擎')
    }
    return () => rendererRef.current?.dispose()
    // Renderer lifetime follows the canvas; updates use setState below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getDrawable])

  useEffect(() => rendererRef.current?.setState(state), [state])
  return { canvasRef, error }
}
