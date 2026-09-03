import type { ProjectState, SourceDescriptor, Surface } from './types'

export const STORAGE_KEY = 'quadcast:project:v1'

export const TEST_SOURCE: SourceDescriptor = {
  id: 'source-test-pattern',
  type: 'test-pattern',
  name: '校正格線',
  status: 'ready',
}

export function makeSurface(index: number, sourceId: string | null = TEST_SOURCE.id): Surface {
  const offset = Math.min(index * 0.025, 0.16)
  return {
    id: crypto.randomUUID(),
    name: `投影面 ${String(index + 1).padStart(2, '0')}`,
    sourceId,
    corners: [
      { x: 0.16 + offset, y: 0.18 + offset },
      { x: 0.84 - offset, y: 0.18 + offset },
      { x: 0.84 - offset, y: 0.82 - offset },
      { x: 0.16 + offset, y: 0.82 - offset },
    ],
    mask: null,
    opacity: 1,
    visible: true,
    zIndex: index,
  }
}

export function createDefaultState(): ProjectState {
  const surface = makeSurface(0)
  return {
    version: 1,
    outputBackground: '#000000',
    surfaces: [surface],
    sources: [TEST_SOURCE],
    selectedSurfaceId: surface.id,
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
  return {
    version: 1,
    outputBackground: typeof value.outputBackground === 'string' ? value.outputBackground : '#000000',
    surfaces: value.surfaces.map((surface) => ({
      ...surface,
      mask: Array.isArray(surface.mask) ? surface.mask : null,
    })),
    sources,
    selectedSurfaceId: value.surfaces.some((surface) => surface.id === value.selectedSurfaceId)
      ? value.selectedSurfaceId ?? null
      : value.surfaces[0]?.id ?? null,
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
