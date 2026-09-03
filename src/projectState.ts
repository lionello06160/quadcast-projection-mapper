import type { Projector, ProjectState, SourceDescriptor, Surface } from './types'

export const STORAGE_KEY = 'quadcast:project:v1'

export const TEST_SOURCE: SourceDescriptor = {
  id: 'source-test-pattern',
  type: 'test-pattern',
  name: '校正格線',
  status: 'ready',
}

export function makeProjector(index: number): Projector {
  return {
    id: crypto.randomUUID(),
    name: `投影機 ${String(index + 1).padStart(2, '0')}`,
  }
}

export function makeSurface(index: number, projectorId: string, sourceId: string | null = TEST_SOURCE.id): Surface {
  const offset = Math.min(index * 0.025, 0.16)
  return {
    id: crypto.randomUUID(),
    name: `投影面 ${String(index + 1).padStart(2, '0')}`,
    projectorId,
    sourceId,
    corners: [
      { x: 0.16 + offset, y: 0.18 + offset },
      { x: 0.84 - offset, y: 0.18 + offset },
      { x: 0.84 - offset, y: 0.82 - offset },
      { x: 0.16 + offset, y: 0.82 - offset },
    ],
    opacity: 1,
    visible: true,
    zIndex: index,
  }
}

export function createDefaultState(): ProjectState {
  const projector = makeProjector(0)
  const surface = makeSurface(0, projector.id)
  return {
    version: 1,
    outputBackground: '#000000',
    projectors: [projector],
    surfaces: [surface],
    sources: [TEST_SOURCE],
    selectedSurfaceId: surface.id,
    selectedProjectorId: projector.id,
    blackout: false,
    showGrid: true,
  }
}

export function normalizeState(candidate: unknown): ProjectState {
  if (!candidate || typeof candidate !== 'object') return createDefaultState()
  const value = candidate as Partial<ProjectState>
  if (value.version !== 1 || !Array.isArray(value.surfaces) || !Array.isArray(value.sources)) {
    return createDefaultState()
  }
  const sources: SourceDescriptor[] = value.sources.map((source): SourceDescriptor => {
    const status: SourceDescriptor['status'] = source.type === 'test-pattern' ? 'ready' : 'disconnected'
    return {
      ...source,
      status,
      error: undefined,
      playback: source.playback ? { ...source.playback, playing: false } : undefined,
    }
  })
  if (!sources.some((source) => source.id === TEST_SOURCE.id)) sources.unshift(TEST_SOURCE)
  const projectors = Array.isArray(value.projectors) && value.projectors.length
    ? value.projectors
    : [makeProjector(0)]
  const selectedProjectorId = projectors.some((projector) => projector.id === value.selectedProjectorId)
    ? value.selectedProjectorId!
    : projectors[0].id
  const surfaces = value.surfaces.map((surface) => {
    const { mask: _mask, maskUvs: _maskUvs, ...cleanSurface } = surface as Surface & {
      mask?: unknown
      maskUvs?: unknown
    }
    return {
      ...cleanSurface,
      projectorId: projectors.some((projector) => projector.id === cleanSurface.projectorId)
        ? cleanSurface.projectorId
        : projectors[0].id,
    }
  })
  const selectedProjectorSurfaces = surfaces.filter((surface) => surface.projectorId === selectedProjectorId)
  return {
    version: 1,
    outputBackground: typeof value.outputBackground === 'string' ? value.outputBackground : '#000000',
    projectors,
    surfaces,
    sources,
    selectedSurfaceId: selectedProjectorSurfaces.some((surface) => surface.id === value.selectedSurfaceId)
      ? value.selectedSurfaceId ?? null
      : selectedProjectorSurfaces[0]?.id ?? null,
    selectedProjectorId,
    blackout: false,
    showGrid: value.showGrid ?? true,
  }
}

export function loadProject(): ProjectState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? normalizeState(JSON.parse(saved)) : createDefaultState()
  } catch {
    return createDefaultState()
  }
}

export function persistProject(state: ProjectState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function sortSurfaces(surfaces: readonly Surface[]): Surface[] {
  return [...surfaces].sort((left, right) => left.zIndex - right.zIndex)
}

export function stateForProjector(state: ProjectState, projectorId: string): ProjectState {
  const surfaces = state.surfaces.filter((surface) => surface.projectorId === projectorId)
  return {
    ...state,
    surfaces,
    selectedProjectorId: projectorId,
    selectedSurfaceId: surfaces.some((surface) => surface.id === state.selectedSurfaceId)
      ? state.selectedSurfaceId
      : sortSurfaces(surfaces)[0]?.id ?? null,
  }
}
