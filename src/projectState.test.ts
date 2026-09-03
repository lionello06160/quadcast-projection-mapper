import { beforeEach, describe, expect, it } from 'vitest'
import { createDefaultState, loadProject, normalizeState, persistProject, STORAGE_KEY } from './projectState'

describe('project persistence', () => {
  beforeEach(() => localStorage.clear())

  it('creates and persists a versioned default project', () => {
    const project = createDefaultState()
    persistProject(project)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').version).toBe(1)
    expect(loadProject().surfaces).toHaveLength(1)
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
})
