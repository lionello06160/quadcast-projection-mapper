import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadProject, stateForProjector } from './projectState'
import type { ProjectionMessage, ProjectState } from './types'
import { useProjectionRenderer } from './useProjectionRenderer'

export function OutputView() {
  const [state, setState] = useState<ProjectState>(() => window.opener?.__projectionBridge?.getState() ?? loadProject())
  const [projectorId] = useState(() => new URLSearchParams(window.location.search).get('projector') ?? state.selectedProjectorId)
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement))
  const [connected, setConnected] = useState(Boolean(window.opener?.__projectionBridge))
  const getDrawable = useCallback(
    (sourceId: string) => window.opener?.__projectionBridge?.getDrawable(sourceId) ?? null,
    [],
  )
  const outputState = useMemo(
    () => stateForProjector(state, projectorId),
    [projectorId, state],
  )
  const projectorName = state.projectors.find((projector) => projector.id === projectorId)?.name ?? '投影機輸出'
  const { canvasRef, error } = useProjectionRenderer(outputState, getDrawable)

  useEffect(() => {
    const receive = (event: MessageEvent<ProjectionMessage>) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'projection:state' || event.data.projectorId !== projectorId) return
      setState(event.data.state)
      setConnected(true)
    }
    const fullscreenChange = () => setFullscreen(Boolean(document.fullscreenElement))
    window.addEventListener('message', receive)
    document.addEventListener('fullscreenchange', fullscreenChange)
    window.opener?.postMessage({ type: 'projection:ready', projectorId } satisfies ProjectionMessage, window.location.origin)
    return () => {
      window.removeEventListener('message', receive)
      document.removeEventListener('fullscreenchange', fullscreenChange)
      window.opener?.postMessage({ type: 'projection:closed', projectorId } satisfies ProjectionMessage, window.location.origin)
    }
  }, [projectorId])

  const enterFullscreen = async () => {
    try {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
    } catch {
      // Browser will keep the output window usable if fullscreen is denied.
    }
  }

  return (
    <main className={fullscreen ? 'output-view fullscreen' : 'output-view'}>
      <canvas ref={canvasRef} className="output-canvas" aria-label="投影輸出" />
      {!fullscreen ? (
        <section className="output-launcher">
          <span className={connected ? 'status-dot online' : 'status-dot'} />
          <p>{connected ? '控制台已連線' : '等待控制台連線'}</p>
          <h1>{projectorName}</h1>
          <strong>將此視窗移至對應投影機</strong>
          <button type="button" onClick={enterFullscreen}>進入全螢幕輸出</button>
          <small>按 ESC 可離開全螢幕</small>
        </section>
      ) : null}
      {error ? <div className="output-error">{error}</div> : null}
    </main>
  )
}
