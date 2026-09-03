import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Aperture,
  ArrowDown,
  ArrowUp,
  CircleStop,
  Copy,
  Eye,
  EyeOff,
  FileDown,
  FileUp,
  Grid3X3,
  ImagePlus,
  Maximize2,
  Minus,
  MonitorUp,
  Pause,
  Play,
  Plus,
  Radio,
  ScreenShare,
  Spline,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { CalibrationCanvas } from './CalibrationCanvas'
import { insertPointOnEdge, isValidQuad, isValidPolygon, longestEdgeIndex, polygonBoundingBoxUvs } from './geometry'
import { makeSurface, loadProject, normalizeState, persistProject, sortSurfaces, TEST_SOURCE } from './projectState'
import { SourceManager } from './sourceManager'
import type { ProjectionMessage, ProjectState, SourceDescriptor, Surface } from './types'

type Notice = { tone: 'info' | 'error'; message: string }

const sourceTypeLabel: Record<SourceDescriptor['type'], string> = {
  'file-video': 'VIDEO',
  'file-image': 'IMAGE',
  'display-capture': 'CAPTURE',
  'test-pattern': 'SYSTEM',
}

function iconButtonLabel(source: SourceDescriptor): string {
  if (source.type === 'test-pattern') return '內建'
  if (source.status === 'ready') return '已連接'
  if (source.status === 'ended') return '已停止'
  return '需重連'
}

export function App() {
  const managerRef = useRef<SourceManager | null>(null)
  if (!managerRef.current) managerRef.current = new SourceManager()
  const manager = managerRef.current
  const [state, setState] = useState<ProjectState>(loadProject)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [outputOpen, setOutputOpen] = useState(false)
  const [editMode, setEditMode] = useState<'warp' | 'mask'>('warp')
  const [selectedMaskVertex, setSelectedMaskVertex] = useState(0)
  const outputWindowRef = useRef<Window | null>(null)
  const stateRef = useRef(state)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const reconnectSourceIdRef = useRef<string | undefined>(undefined)

  const selectedSurface = state.surfaces.find((surface) => surface.id === state.selectedSurfaceId) ?? null
  const selectedSource = state.sources.find((source) => source.id === selectedSurface?.sourceId) ?? null

  const updateState = useCallback((updater: (current: ProjectState) => ProjectState) => {
    setState((current) => updater(current))
  }, [])

  useEffect(() => {
    stateRef.current = state
    const timer = window.setTimeout(() => persistProject(state), 180)
    const output = outputWindowRef.current
    if (output && !output.closed) {
      output.postMessage({ type: 'projection:state', state } satisfies ProjectionMessage, window.location.origin)
    }
    return () => window.clearTimeout(timer)
  }, [state])

  useEffect(() => {
    state.sources.forEach((source) => manager.updatePlayback(source))
  }, [manager, state.sources])

  useEffect(() => {
    window.__projectionBridge = { getDrawable: manager.getDrawable, getState: () => state }
    return () => {
      delete window.__projectionBridge
    }
  }, [manager, state])

  useEffect(() => {
    const receive = (event: MessageEvent<ProjectionMessage>) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type === 'projection:ready') {
        setOutputOpen(true)
        outputWindowRef.current?.postMessage(
          { type: 'projection:state', state: stateRef.current } satisfies ProjectionMessage,
          window.location.origin,
        )
      }
      if (event.data?.type === 'projection:closed') setOutputOpen(false)
    }
    window.addEventListener('message', receive)
    const interval = window.setInterval(() => {
      if (outputWindowRef.current?.closed) setOutputOpen(false)
    }, 1000)
    return () => {
      window.removeEventListener('message', receive)
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => () => manager.dispose(), [manager])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return
      if (event.key.toLowerCase() === 'b') updateState((current) => ({ ...current, blackout: !current.blackout }))
      if (event.key.toLowerCase() === 'g') updateState((current) => ({ ...current, showGrid: !current.showGrid }))
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [updateState])

  const replaceSource = (descriptor: SourceDescriptor) => {
    updateState((current) => {
      const exists = current.sources.some((source) => source.id === descriptor.id)
      return {
        ...current,
        sources: exists
          ? current.sources.map((source) => (source.id === descriptor.id ? descriptor : source))
          : [...current.sources, descriptor],
      }
    })
  }

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return
    const reconnectId = reconnectSourceIdRef.current
    reconnectSourceIdRef.current = undefined
    for (const [index, file] of [...files].entries()) {
      try {
        const descriptor = await manager.addFile(file, index === 0 ? reconnectId : undefined)
        replaceSource(descriptor)
      } catch (reason) {
        setNotice({ tone: 'error', message: reason instanceof Error ? reason.message : '媒體載入失敗' })
      }
    }
  }

  const capture = async (existingId?: string) => {
    try {
      const descriptor = await manager.captureDisplay(existingId)
      replaceSource(descriptor)
      manager.onCaptureEnded(descriptor.id, () => {
        updateState((current) => ({
          ...current,
          sources: current.sources.map((source) =>
            source.id === descriptor.id
              ? { ...source, status: 'ended', playback: source.playback ? { ...source.playback, playing: false } : undefined }
              : source,
          ),
        }))
      })
      setNotice({ tone: 'info', message: `已連接：${descriptor.name}` })
    } catch (reason) {
      const message = reason instanceof DOMException && reason.name === 'NotAllowedError'
        ? '未取得畫面擷取權限；請重新點選並允許分享'
        : reason instanceof Error ? reason.message : '無法開始畫面擷取'
      setNotice({ tone: 'error', message })
    }
  }

  const reconnect = (source: SourceDescriptor) => {
    if (source.type === 'display-capture') {
      void capture(source.id)
      return
    }
    reconnectSourceIdRef.current = source.id
    fileInputRef.current?.click()
  }

  const openOutput = () => {
    if (outputWindowRef.current && !outputWindowRef.current.closed) {
      outputWindowRef.current.focus()
      return
    }
    const popup = window.open('/?view=output', 'quadcast-output', 'popup,width=1280,height=720')
    if (!popup) {
      setNotice({ tone: 'error', message: '瀏覽器封鎖了輸出視窗，請允許此網站開啟彈出式視窗' })
      return
    }
    outputWindowRef.current = popup
    setOutputOpen(true)
    popup.focus()
  }

  const addSurface = () => {
    updateState((current) => {
      const surface = makeSurface(current.surfaces.length, current.sources[0]?.id ?? null)
      return { ...current, surfaces: [...current.surfaces, surface], selectedSurfaceId: surface.id }
    })
  }

  const updateSurface = (id: string, patch: Partial<Surface>) => {
    updateState((current) => ({
      ...current,
      surfaces: current.surfaces.map((surface) => (surface.id === id ? { ...surface, ...patch } : surface)),
    }))
  }

  const duplicateSurface = (surface: Surface) => {
    const maxX = Math.max(...surface.corners.map((point) => point.x))
    const maxY = Math.max(...surface.corners.map((point) => point.y))
    const shiftX = Math.min(0.03, 1 - maxX)
    const shiftY = Math.min(0.03, 1 - maxY)
    const copy: Surface = {
      ...surface,
      id: crypto.randomUUID(),
      name: `${surface.name} COPY`,
      corners: surface.corners.map((point) => ({ x: point.x + shiftX, y: point.y + shiftY })) as Surface['corners'],
      mask: surface.mask?.map((point) => ({ x: point.x + shiftX, y: point.y + shiftY })) ?? null,
      maskUvs: surface.maskUvs?.map((point) => ({ ...point })) ?? null,
      zIndex: state.surfaces.length,
    }
    updateState((current) => ({ ...current, surfaces: [...current.surfaces, copy], selectedSurfaceId: copy.id }))
  }

  const deleteSurface = (id: string) => {
    updateState((current) => {
      const surfaces = current.surfaces.filter((surface) => surface.id !== id)
      return { ...current, surfaces, selectedSurfaceId: surfaces[0]?.id ?? null }
    })
  }

  const moveSurface = (id: string, direction: -1 | 1) => {
    updateState((current) => {
      const ordered = sortSurfaces(current.surfaces)
      const index = ordered.findIndex((surface) => surface.id === id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= ordered.length) return current
      const first = ordered[index]
      const second = ordered[target]
      return {
        ...current,
        surfaces: current.surfaces.map((surface) => {
          if (surface.id === first.id) return { ...surface, zIndex: second.zIndex }
          if (surface.id === second.id) return { ...surface, zIndex: first.zIndex }
          return surface
        }),
      }
    })
  }

  const removeSource = (sourceId: string) => {
    manager.remove(sourceId)
    updateState((current) => ({
      ...current,
      sources: current.sources.filter((source) => source.id !== sourceId),
      surfaces: current.surfaces.map((surface) =>
        surface.sourceId === sourceId ? { ...surface, sourceId: TEST_SOURCE.id } : surface,
      ),
    }))
  }

  const exportProject = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `quadcast-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const importProject = async (file: File | undefined) => {
    if (!file) return
    try {
      const imported = normalizeState(JSON.parse(await file.text()))
      manager.dispose()
      setState(imported)
      setNotice({ tone: 'info', message: '設定已匯入；媒體來源需要重新連接' })
    } catch {
      setNotice({ tone: 'error', message: '設定檔格式無效' })
    }
  }

  const updatePlayback = (source: SourceDescriptor, patch: Partial<NonNullable<SourceDescriptor['playback']>>) => {
    updateState((current) => ({
      ...current,
      sources: current.sources.map((item) =>
        item.id === source.id && item.playback ? { ...item, playback: { ...item.playback, ...patch } } : item,
      ),
    }))
  }

  const setCornerCoordinate = (cornerIndex: number, axis: 'x' | 'y', rawValue: string) => {
    if (!selectedSurface) return
    const value = Math.min(1, Math.max(0, Number(rawValue)))
    if (!Number.isFinite(value)) return
    const corners = selectedSurface.corners.map((point) => ({ ...point })) as Surface['corners']
    corners[cornerIndex][axis] = value
    if (isValidQuad(corners)) updateSurface(selectedSurface.id, { corners })
  }

  const enableMask = () => {
    if (!selectedSurface) return
    updateSurface(selectedSurface.id, {
      mask: selectedSurface.corners.map((point) => ({ ...point })),
      maskUvs: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
    })
    setEditMode('mask')
    setSelectedMaskVertex(0)
  }

  const addMaskPoint = () => {
    if (!selectedSurface?.mask || selectedSurface.mask.length >= 32) return
    const edgeIndex = longestEdgeIndex(selectedSurface.mask)
    const mask = insertPointOnEdge(selectedSurface.mask, edgeIndex)
    const currentUvs = selectedSurface.maskUvs?.length === selectedSurface.mask.length
      ? selectedSurface.maskUvs
      : polygonBoundingBoxUvs(selectedSurface.mask)
    const maskUvs = insertPointOnEdge(currentUvs, edgeIndex)
    updateSurface(selectedSurface.id, { mask, maskUvs })
    setSelectedMaskVertex(edgeIndex + 1)
  }

  const removeMaskPoint = () => {
    if (!selectedSurface?.mask || selectedSurface.mask.length <= 3) return
    const mask = selectedSurface.mask.filter((_, index) => index !== selectedMaskVertex)
    if (!isValidPolygon(mask)) return
    const maskUvs = selectedSurface.maskUvs?.filter((_, index) => index !== selectedMaskVertex) ?? null
    updateSurface(selectedSurface.id, { mask, maskUvs })
    setSelectedMaskVertex(Math.max(0, Math.min(selectedMaskVertex, mask.length - 1)))
  }

  const surfaceCountLabel = useMemo(() => `${state.surfaces.length.toString().padStart(2, '0')} SURFACES`, [state.surfaces.length])

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <Aperture size={26} strokeWidth={1.6} />
          <div><strong>QUADCAST</strong><span>PROJECTION MAPPER / 01</span></div>
        </div>
        <div className="system-status"><Radio size={14} /><span>LOCAL ENGINE</span><b>WEBGL2</b></div>
        <div className="top-actions">
          <button className={state.showGrid ? 'tool-button active' : 'tool-button'} onClick={() => updateState((current) => ({ ...current, showGrid: !current.showGrid }))}>
            <Grid3X3 size={16} /> 格線 <kbd>G</kbd>
          </button>
          <button
            className={state.blackout ? 'tool-button blackout-button active' : 'tool-button blackout-button'}
            aria-pressed={state.blackout}
            aria-label={state.blackout ? '恢復投影畫面' : '一鍵黑畫面'}
            onClick={() => updateState((current) => ({ ...current, blackout: !current.blackout }))}
          >
            <CircleStop size={16} /> {state.blackout ? '恢復畫面' : '一鍵黑畫面'} <kbd>B</kbd>
          </button>
          <button className="primary-button" onClick={openOutput}>
            <MonitorUp size={17} /> {outputOpen ? '查看輸出視窗' : '開啟投影輸出'}
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="left-panel panel">
          <section className="panel-section sources-section">
            <div className="section-heading"><span>01 / SOURCES</span><em>{state.sources.length.toString().padStart(2, '0')}</em></div>
            <div className="source-add-grid">
              <button onClick={() => fileInputRef.current?.click()}><ImagePlus size={18} /><span>本機媒體</span></button>
              <button onClick={() => void capture()}><ScreenShare size={18} /><span>擷取畫面</span></button>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple hidden onChange={(event) => {
              void handleFiles(event.target.files)
              event.currentTarget.value = ''
            }} />
            <div className="item-list source-list">
              {state.sources.map((source) => (
                <article key={source.id} className={selectedSource?.id === source.id ? 'source-item selected' : 'source-item'}>
                  <div className={`source-icon ${source.type}`}><span>{sourceTypeLabel[source.type]}</span></div>
                  <button className="source-main" onClick={() => selectedSurface && updateSurface(selectedSurface.id, { sourceId: source.id })}>
                    <strong title={source.name}>{source.name}</strong>
                    <small className={`status-${source.status}`}>{iconButtonLabel(source)}</small>
                  </button>
                  {source.type !== 'test-pattern' ? (
                    <div className="source-actions">
                      {source.status !== 'ready' ? (
                        <button className="icon-button" title="重新連接來源" aria-label={`重新連接 ${source.name}`} onClick={() => reconnect(source)}><ScreenShare size={15} /></button>
                      ) : null}
                      <button className="icon-button remove-source" title="刪除來源" aria-label={`刪除來源 ${source.name}`} onClick={() => removeSource(source.id)}><Trash2 size={14} /></button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </section>

          <section className="panel-section surfaces-section">
            <div className="section-heading"><span>02 / SURFACES</span><em>{surfaceCountLabel}</em></div>
            <button className="wide-add" onClick={addSurface}><Plus size={16} /> 新增投影面</button>
            <div className="item-list surface-list">
              {sortSurfaces(state.surfaces).map((surface, index) => (
                <article key={surface.id} className={surface.id === state.selectedSurfaceId ? 'surface-item selected' : 'surface-item'}>
                  <button className="surface-index" onClick={() => updateState((current) => ({ ...current, selectedSurfaceId: surface.id }))}>
                    {String(index + 1).padStart(2, '0')}
                  </button>
                  <button className="surface-name" onClick={() => updateState((current) => ({ ...current, selectedSurfaceId: surface.id }))}>
                    <strong>{surface.name}</strong>
                    <small>{state.sources.find((source) => source.id === surface.sourceId)?.name ?? '未指定來源'}</small>
                  </button>
                  <button className="icon-button" aria-label={surface.visible ? '隱藏投影面' : '顯示投影面'} onClick={() => updateSurface(surface.id, { visible: !surface.visible })}>
                    {surface.visible ? <Eye size={15} /> : <EyeOff size={15} />}
                  </button>
                </article>
              ))}
            </div>
          </section>
        </aside>

        <section className="center-stage">
          <div className="stage-header">
            <div><span className="live-dot" /> OUTPUT PREVIEW</div>
            <span>{editMode === 'warp' ? 'DRAG SURFACE OR CORNERS' : 'DRAG SURFACE OR EDIT MASK'}</span>
          </div>
          <div className="stage-wrap">
            <CalibrationCanvas
              state={state}
              getDrawable={manager.getDrawable}
              onSelect={(id) => updateState((current) => ({ ...current, selectedSurfaceId: id }))}
              onCornersChange={(id, corners) => updateSurface(id, { corners })}
              editMode={editMode}
              selectedMaskVertex={selectedMaskVertex}
              onMaskVertexSelect={setSelectedMaskVertex}
              onMaskChange={(id, mask) => updateSurface(id, { mask })}
            />
          </div>
          <footer className="stage-footer">
            <span>OUTPUT SPACE <b>1000 × 562.5</b></span>
            <span>CTRL <b>POINTER</b></span>
            <span>ENGINE <b>GPU / LIVE</b></span>
          </footer>
        </section>

        <aside className="right-panel panel">
          <div className="section-heading"><span>03 / INSPECTOR</span><em>{selectedSurface ? 'ACTIVE' : 'EMPTY'}</em></div>
          {selectedSurface ? (
            <>
              <section className="inspector-block">
                <label className="field-label" htmlFor="surface-name">投影面名稱</label>
                <input id="surface-name" className="text-field" value={selectedSurface.name} onChange={(event) => updateSurface(selectedSurface.id, { name: event.target.value })} />
                <label className="field-label" htmlFor="source-select">影像來源</label>
                <select id="source-select" className="select-field" value={selectedSurface.sourceId ?? ''} onChange={(event) => updateSurface(selectedSurface.id, { sourceId: event.target.value || null })}>
                  <option value="">未指定</option>
                  {state.sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
                </select>
              </section>

              <section className="inspector-block">
                <div className="block-title"><span>EDIT GEOMETRY</span><small>{selectedSurface.mask ? `${selectedSurface.mask.length} POINTS` : 'QUAD'}</small></div>
                <div className="mode-switch">
                  <button className={editMode === 'warp' ? 'active' : ''} onClick={() => setEditMode('warp')}><Maximize2 size={14} /> 四角透視</button>
                  <button className={editMode === 'mask' ? 'active' : ''} onClick={() => selectedSurface.mask ? setEditMode('mask') : enableMask()}><Spline size={14} /> 多邊形</button>
                </div>
                {editMode === 'mask' ? (
                  <div className="mask-controls">
                    <button onClick={addMaskPoint} disabled={!selectedSurface.mask || selectedSurface.mask.length >= 32}><Plus size={14} /> 增加節點</button>
                    <button onClick={removeMaskPoint} disabled={!selectedSurface.mask || selectedSurface.mask.length <= 3}><Minus size={14} /> 刪除 P{selectedMaskVertex + 1}</button>
                    <button className="reset-mask" onClick={() => { updateSurface(selectedSurface.id, { mask: null, maskUvs: null }); setEditMode('warp') }}>清除遮罩</button>
                  </div>
                ) : null}
              </section>

              <section className="inspector-block">
                <div className="block-title"><span>CORNER MATRIX</span><small>NORMALIZED</small></div>
                <div className="corner-table">
                  {selectedSurface.corners.map((corner, index) => (
                    <div className="corner-row" key={index}>
                      <b>{['TL', 'TR', 'BR', 'BL'][index]}</b>
                      <label>X <input type="number" min="0" max="1" step="0.001" value={corner.x.toFixed(3)} onChange={(event) => setCornerCoordinate(index, 'x', event.target.value)} /></label>
                      <label>Y <input type="number" min="0" max="1" step="0.001" value={corner.y.toFixed(3)} onChange={(event) => setCornerCoordinate(index, 'y', event.target.value)} /></label>
                    </div>
                  ))}
                </div>
              </section>

              <section className="inspector-block">
                <div className="block-title"><span>COMPOSITE</span><small>{Math.round(selectedSurface.opacity * 100)}%</small></div>
                <input className="range-field" type="range" min="0" max="1" step="0.01" value={selectedSurface.opacity} onChange={(event) => updateSurface(selectedSurface.id, { opacity: Number(event.target.value) })} />
                <div className="button-row">
                  <button onClick={() => moveSurface(selectedSurface.id, 1)}><ArrowUp size={14} /> 往前</button>
                  <button onClick={() => moveSurface(selectedSurface.id, -1)}><ArrowDown size={14} /> 往後</button>
                  <button onClick={() => duplicateSurface(selectedSurface)}><Copy size={14} /> 複製</button>
                </div>
              </section>

              {selectedSource?.playback ? (
                <section className="inspector-block media-controls">
                  <div className="block-title"><span>PLAYBACK</span><small>{selectedSource.type === 'display-capture' ? 'LIVE' : 'MEDIA'}</small></div>
                  <div className="transport-row">
                    <button className="transport-main" aria-label={selectedSource.playback.playing ? '暫停影片' : '播放影片'} onClick={() => updatePlayback(selectedSource, { playing: !selectedSource.playback?.playing })}>
                      {selectedSource.playback.playing ? <Pause size={17} /> : <Play size={17} />}
                    </button>
                    <button aria-pressed={selectedSource.playback.loop} className={selectedSource.playback.loop ? 'transport-toggle active' : 'transport-toggle'} onClick={() => updatePlayback(selectedSource, { loop: !selectedSource.playback?.loop })}>LOOP</button>
                    <button aria-label={selectedSource.playback.monitorAudio ? '關閉聲音監聽' : '開啟聲音監聽'} aria-pressed={selectedSource.playback.monitorAudio} className={selectedSource.playback.monitorAudio ? 'transport-audio active' : 'transport-audio'} onClick={() => updatePlayback(selectedSource, { monitorAudio: !selectedSource.playback?.monitorAudio })}>
                      {selectedSource.playback.monitorAudio ? <Volume2 size={16} /> : <VolumeX size={16} />}
                    </button>
                  </div>
                  {selectedSource.type === 'file-video' ? (
                    <input className="range-field" aria-label="影片進度" type="range" min="0" max={selectedSource.playback.duration || 1} step="0.1" value={selectedSource.playback.currentTime} onChange={(event) => updatePlayback(selectedSource, { currentTime: Number(event.target.value) })} />
                  ) : null}
                </section>
              ) : null}

              <section className="inspector-block danger-zone">
                <button onClick={() => deleteSurface(selectedSurface.id)}><Trash2 size={15} /> 刪除這個投影面</button>
              </section>
            </>
          ) : <div className="empty-inspector"><Maximize2 size={28} /><p>新增或選擇一個投影面</p></div>}

          <section className="project-tools">
            <button onClick={exportProject}><FileDown size={15} /> 匯出設定</button>
            <button onClick={() => importInputRef.current?.click()}><FileUp size={15} /> 匯入設定</button>
            <input ref={importInputRef} hidden type="file" accept="application/json" onChange={(event) => {
              void importProject(event.target.files?.[0])
              event.currentTarget.value = ''
            }} />
          </section>
        </aside>
      </div>

      {notice ? (
        <div className={`notice ${notice.tone}`} role="status">
          <span>{notice.message}</span><button onClick={() => setNotice(null)}>關閉</button>
        </div>
      ) : null}
    </main>
  )
}
