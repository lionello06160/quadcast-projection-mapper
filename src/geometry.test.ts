import { describe, expect, it } from 'vitest'
import { clampTranslation, invertMatrix3, isValidQuad, polygonArea, quadHomography, transformPoint, translatePoints } from './geometry'
import type { Surface } from './types'

const rectangle: Surface['corners'] = [
  { x: 0.1, y: 0.2 },
  { x: 0.9, y: 0.2 },
  { x: 0.9, y: 0.8 },
  { x: 0.1, y: 0.8 },
]

describe('quadrilateral validation', () => {
  it('accepts a convex rectangle', () => {
    expect(isValidQuad(rectangle)).toBe(true)
    expect(polygonArea(rectangle)).toBeCloseTo(0.48)
  })

  it('rejects crossed and degenerate corners', () => {
    expect(isValidQuad([rectangle[0], rectangle[2], rectangle[1], rectangle[3]])).toBe(false)
    expect(isValidQuad([{ x: 0, y: 0 }, { x: 0.1, y: 0 }, { x: 0.2, y: 0 }, { x: 0.3, y: 0 }])).toBe(false)
  })
})

describe('surface translation', () => {
  it('moves every point by the same amount', () => {
    const translated = translatePoints(rectangle, { x: 0.05, y: -0.1 })
    translated.forEach((point, index) => {
      expect(point.x - rectangle[index].x).toBeCloseTo(0.05)
      expect(point.y - rectangle[index].y).toBeCloseTo(-0.1)
    })
  })

  it('clamps a whole-surface move to the output bounds', () => {
    const bottomRight = clampTranslation(rectangle, { x: 0.5, y: 0.5 })
    expect(bottomRight.x).toBeCloseTo(0.1)
    expect(bottomRight.y).toBeCloseTo(0.2)
    const topLeft = clampTranslation(rectangle, { x: -0.5, y: -0.5 })
    expect(topLeft.x).toBeCloseTo(-0.1)
    expect(topLeft.y).toBeCloseTo(-0.2)
  })
})

describe('homography', () => {
  it('maps every unit-square corner to the requested output corner', () => {
    const trapezoid: Surface['corners'] = [
      { x: 0.18, y: 0.12 },
      { x: 0.82, y: 0.22 },
      { x: 0.94, y: 0.86 },
      { x: 0.07, y: 0.73 },
    ]
    const matrix = quadHomography(trapezoid)
    const inputs = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
    inputs.forEach((input, index) => {
      const result = transformPoint(matrix, input)
      expect(result.x).toBeCloseTo(trapezoid[index].x, 6)
      expect(result.y).toBeCloseTo(trapezoid[index].y, 6)
    })
  })

  it('inverts the mapping', () => {
    const matrix = quadHomography(rectangle)
    const inverse = invertMatrix3(matrix)
    const mapped = transformPoint(matrix, { x: 0.37, y: 0.62 })
    const restored = transformPoint(inverse, mapped)
    expect(restored.x).toBeCloseTo(0.37, 6)
    expect(restored.y).toBeCloseTo(0.62, 6)
  })
})
