import { beforeEach, describe, expect, it } from 'vitest'
import { createDefaultState, loadProject, normalizeState, persistProject, stateForProjector, STORAGE_KEY } from './projectState'

describe('project persistence', () => {
  beforeEach(() => localStorage.clear())

  it('creates and persists a versioned default project', () => {
    const project = createDefaultState()
    persistProject(project)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').version).toBe(1)
    expect(loadProject().surfaces).toHaveLength(1)
    expect(loadProject().projectors).toHaveLength(1)
    expect(loadProject().surfaces[0].projectorId).toBe(loadProject().projectors[0].id)
  })

  it('marks non-system media disconnected after reload', () => {
    const project = createDefaultState()
    project.sources.push({
      id: 'video-1',
      name: 'demo.mp4',
      type: 'file-video',
      status: 'ready',
      playback: { playing: true, loop: true, monitorAudio: false, volume: 1, currentTime: 8, duration: 20 },
    })
    const loaded = normalizeState(project)
    expect(loaded.sources.find((source) => source.id === 'video-1')?.status).toBe('disconnected')
    expect(loaded.sources.find((source) => source.id === 'video-1')?.playback?.playing).toBe(false)
  })

  it('recovers safely from unsupported data', () => {
    expect(normalizeState({ version: 99 })).toMatchObject({ version: 1, blackout: false })
  })

  it('removes obsolete polygon data from older saved projects', () => {
    const project = createDefaultState()
    const legacy = structuredClone(project) as unknown as { surfaces: Array<Record<string, unknown>> }
    legacy.surfaces[0].mask = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]
    legacy.surfaces[0].maskUvs = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]
    const loadedSurface = normalizeState(legacy).surfaces[0] as unknown as Record<string, unknown>
    expect(loadedSurface.mask).toBeUndefined()
    expect(loadedSurface.maskUvs).toBeUndefined()
  })

  it('migrates a single-output project to the first projector', () => {
    const legacy = structuredClone(createDefaultState()) as unknown as {
      projectors?: unknown
      selectedProjectorId?: unknown
      surfaces: Array<Record<string, unknown>>
    }
    delete legacy.projectors
    delete legacy.selectedProjectorId
    delete legacy.surfaces[0].projectorId
    const loaded = normalizeState(legacy)
    expect(loaded.projectors).toHaveLength(1)
    expect(loaded.surfaces[0].projectorId).toBe(loaded.projectors[0].id)
    expect(loaded.selectedProjectorId).toBe(loaded.projectors[0].id)
  })

  it('keeps surfaces assigned to their own projectors', () => {
    const project = createDefaultState()
    const secondProjector = { id: 'projector-2', name: '投影機 02' }
    project.projectors.push(secondProjector)
    project.surfaces.push({ ...project.surfaces[0], id: 'surface-2', projectorId: secondProjector.id })
    const loaded = normalizeState(project)
    expect(loaded.surfaces.filter((surface) => surface.projectorId === project.projectors[0].id)).toHaveLength(1)
    expect(loaded.surfaces.filter((surface) => surface.projectorId === secondProjector.id)).toHaveLength(1)
    expect(stateForProjector(loaded, secondProjector.id).surfaces.map((surface) => surface.id)).toEqual(['surface-2'])
  })
})
