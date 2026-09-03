import type { Point, Surface } from './types'

const EPSILON = 1e-7

export function clampPoint(point: Point): Point {
  return {
    x: Math.min(1, Math.max(0, point.x)),
    y: Math.min(1, Math.max(0, point.y)),
  }
}

export function clampTranslation(points: readonly Point[], delta: Point): Point {
  if (!points.length) return { x: 0, y: 0 }
  const minX = Math.min(...points.map((point) => point.x))
  const maxX = Math.max(...points.map((point) => point.x))
  const minY = Math.min(...points.map((point) => point.y))
  const maxY = Math.max(...points.map((point) => point.y))
  return {
    x: Math.max(-minX, Math.min(delta.x, 1 - maxX)),
    y: Math.max(-minY, Math.min(delta.y, 1 - maxY)),
  }
}

export function translatePoints(points: readonly Point[], delta: Point): Point[] {
  return points.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y }))
}

export function polygonBoundingBoxUvs(points: readonly Point[]): Point[] {
  if (!points.length) return []
  const minX = Math.min(...points.map((point) => point.x))
  const maxX = Math.max(...points.map((point) => point.x))
  const minY = Math.min(...points.map((point) => point.y))
  const maxY = Math.max(...points.map((point) => point.y))
  const width = Math.max(maxX - minX, 0.000001)
  const height = Math.max(maxY - minY, 0.000001)
  return points.map((point) => ({ x: (point.x - minX) / width, y: (point.y - minY) / height }))
}

function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

export function polygonArea(points: readonly Point[]): number {
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const next = (index + 1) % points.length
    area += points[index].x * points[next].y - points[next].x * points[index].y
  }
  return Math.abs(area) / 2
}

export function isValidQuad(points: readonly Point[]): points is [Point, Point, Point, Point] {
  if (points.length !== 4 || polygonArea(points) < 0.001) return false
  const directions = points.map((point, index) =>
    cross(point, points[(index + 1) % 4], points[(index + 2) % 4]),
  )
  const positive = directions.every((value) => value > EPSILON)
  const negative = directions.every((value) => value < -EPSILON)
  return positive || negative
}

function orientation(a: Point, b: Point, c: Point): number {
  const value = cross(a, b, c)
  if (Math.abs(value) < EPSILON) return 0
  return value > 0 ? 1 : -1
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  return orientation(a, b, c) !== orientation(a, b, d) && orientation(c, d, a) !== orientation(c, d, b)
}

export function isValidPolygon(points: readonly Point[]): boolean {
  if (points.length < 3 || points.length > 32 || polygonArea(points) < 0.001) return false
  for (let first = 0; first < points.length; first += 1) {
    const firstNext = (first + 1) % points.length
    for (let second = first + 1; second < points.length; second += 1) {
      const secondNext = (second + 1) % points.length
      if (first === second || firstNext === second || secondNext === first) continue
      if (first === 0 && secondNext === 0) continue
      if (segmentsIntersect(points[first], points[firstNext], points[second], points[secondNext])) return false
    }
  }
  return true
}

export function insertPointOnLongestEdge(points: readonly Point[]): Point[] {
  if (points.length >= 32) return [...points]
  return insertPointOnEdge(points, longestEdgeIndex(points))
}

export function longestEdgeIndex(points: readonly Point[]): number {
  let longestIndex = 0
  let longestLength = -1
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length]
    const length = (points[index].x - next.x) ** 2 + (points[index].y - next.y) ** 2
    if (length > longestLength) {
      longestLength = length
      longestIndex = index
    }
  }
  return longestIndex
}

export function insertPointOnEdge(points: readonly Point[], edgeIndex: number): Point[] {
  if (points.length >= 32 || !points.length) return [...points]
  const normalizedIndex = ((edgeIndex % points.length) + points.length) % points.length
  const next = points[(normalizedIndex + 1) % points.length]
  const midpoint = { x: (points[normalizedIndex].x + next.x) / 2, y: (points[normalizedIndex].y + next.y) / 2 }
  const result = [...points]
  result.splice(normalizedIndex + 1, 0, midpoint)
  return result
}

function signedPolygonArea(points: readonly Point[]): number {
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length]
    area += points[index].x * next.y - next.x * points[index].y
  }
  return area / 2
}

function pointInTriangle(point: Point, a: Point, b: Point, c: Point): boolean {
  const first = cross(a, b, point)
  const second = cross(b, c, point)
  const third = cross(c, a, point)
  const hasNegative = first < -EPSILON || second < -EPSILON || third < -EPSILON
  const hasPositive = first > EPSILON || second > EPSILON || third > EPSILON
  return !(hasNegative && hasPositive)
}

/** Ear-clipping triangulation for simple clockwise or counter-clockwise polygons. */
export function triangulatePolygon(points: readonly Point[]): number[] {
  if (!isValidPolygon(points)) return []
  const orientationSign = signedPolygonArea(points) > 0 ? 1 : -1
  const remaining = points.map((_, index) => index)
  const triangles: number[] = []
  let guard = points.length * points.length

  while (remaining.length > 3 && guard > 0) {
    let clipped = false
    for (let index = 0; index < remaining.length; index += 1) {
      const previous = remaining[(index - 1 + remaining.length) % remaining.length]
      const current = remaining[index]
      const next = remaining[(index + 1) % remaining.length]
      if (cross(points[previous], points[current], points[next]) * orientationSign <= EPSILON) continue
      const containsPoint = remaining.some((candidate) =>
        candidate !== previous && candidate !== current && candidate !== next &&
        pointInTriangle(points[candidate], points[previous], points[current], points[next]),
      )
      if (containsPoint) continue
      triangles.push(previous, current, next)
      remaining.splice(index, 1)
      clipped = true
      break
    }
    if (!clipped) return []
    guard -= 1
  }
  if (remaining.length === 3) triangles.push(...remaining)
  return triangles
}

/** Matrix mapping unit-square UV coordinates to normalized output coordinates. */
export function quadHomography([p0, p1, p2, p3]: Surface['corners']): number[] {
  const sx = p0.x - p1.x + p2.x - p3.x
  const sy = p0.y - p1.y + p2.y - p3.y
  let a: number
  let b: number
  let d: number
  let e: number
  let g: number
  let h: number

  if (Math.abs(sx) < EPSILON && Math.abs(sy) < EPSILON) {
    a = p1.x - p0.x
    b = p3.x - p0.x
    d = p1.y - p0.y
    e = p3.y - p0.y
    g = 0
    h = 0
  } else {
    const dx1 = p1.x - p2.x
    const dx2 = p3.x - p2.x
    const dy1 = p1.y - p2.y
    const dy2 = p3.y - p2.y
    const denominator = dx1 * dy2 - dx2 * dy1
    if (Math.abs(denominator) < EPSILON) throw new Error('Invalid quadrilateral')
    g = (sx * dy2 - dx2 * sy) / denominator
    h = (dx1 * sy - sx * dy1) / denominator
    a = p1.x - p0.x + g * p1.x
    b = p3.x - p0.x + h * p3.x
    d = p1.y - p0.y + g * p1.y
    e = p3.y - p0.y + h * p3.y
  }

  return [a, b, p0.x, d, e, p0.y, g, h, 1]
}

export function invertMatrix3(matrix: readonly number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = matrix
  const A = e * i - f * h
  const B = f * g - d * i
  const C = d * h - e * g
  const determinant = a * A + b * B + c * C
  if (Math.abs(determinant) < EPSILON) throw new Error('Singular homography')
  const inverse = 1 / determinant
  return [
    A * inverse,
    (c * h - b * i) * inverse,
    (b * f - c * e) * inverse,
    B * inverse,
    (a * i - c * g) * inverse,
    (c * d - a * f) * inverse,
    C * inverse,
    (b * g - a * h) * inverse,
    (a * e - b * d) * inverse,
  ]
}

export function toGlMatrix3(rowMajor: readonly number[]): Float32Array {
  return new Float32Array([
    rowMajor[0], rowMajor[3], rowMajor[6],
    rowMajor[1], rowMajor[4], rowMajor[7],
    rowMajor[2], rowMajor[5], rowMajor[8],
  ])
}

export function transformPoint(matrix: readonly number[], point: Point): Point {
  const w = matrix[6] * point.x + matrix[7] * point.y + matrix[8]
  return {
    x: (matrix[0] * point.x + matrix[1] * point.y + matrix[2]) / w,
    y: (matrix[3] * point.x + matrix[4] * point.y + matrix[5]) / w,
  }
}
