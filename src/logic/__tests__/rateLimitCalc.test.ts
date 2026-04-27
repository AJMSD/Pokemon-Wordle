import { describe, it, expect } from 'vitest'
import { isWindowExpired, isRateLimited, calcRetryAfterSeconds } from '../rateLimitCalc'

describe('isWindowExpired', () => {
  it('returns true when window start is before the cutoff', () => {
    const now = Date.now()
    const windowStart = new Date(now - 120_000).toISOString() // 2 min ago
    expect(isWindowExpired(windowStart, 60, now)).toBe(true)
  })

  it('returns false when window start is within the window', () => {
    const now = Date.now()
    const windowStart = new Date(now - 30_000).toISOString() // 30s ago
    expect(isWindowExpired(windowStart, 60, now)).toBe(false)
  })

  it('returns false when window start equals the cutoff boundary', () => {
    const now = Date.now()
    const windowStart = new Date(now - 60_000).toISOString() // exactly 60s ago
    expect(isWindowExpired(windowStart, 60, now)).toBe(false)
  })
})

describe('isRateLimited', () => {
  it('returns true when count equals maxRequests', () => {
    expect(isRateLimited(10, 10)).toBe(true)
  })

  it('returns true when count exceeds maxRequests', () => {
    expect(isRateLimited(11, 10)).toBe(true)
  })

  it('returns false when count is below maxRequests', () => {
    expect(isRateLimited(9, 10)).toBe(false)
  })

  it('returns false when count is 0', () => {
    expect(isRateLimited(0, 10)).toBe(false)
  })
})

describe('calcRetryAfterSeconds', () => {
  it('returns seconds until window expires', () => {
    const now = Date.now()
    const windowStart = new Date(now - 30_000).toISOString() // started 30s ago
    const result = calcRetryAfterSeconds(windowStart, 60, now)
    expect(result).toBe(30)
  })

  it('rounds up fractional seconds', () => {
    const now = Date.now()
    const windowStart = new Date(now - 30_500).toISOString() // 30.5s ago
    const result = calcRetryAfterSeconds(windowStart, 60, now)
    expect(result).toBe(30) // ceil((29.5)) = 30
  })

  it('returns 0 or negative when window has already expired', () => {
    const now = Date.now()
    const windowStart = new Date(now - 120_000).toISOString() // 2 min ago
    const result = calcRetryAfterSeconds(windowStart, 60, now)
    expect(result).toBeLessThanOrEqual(0)
  })
})
