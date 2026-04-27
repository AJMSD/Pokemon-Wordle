import { describe, it, expect } from 'vitest'
import { isStaleSession } from '../staleDeviceCheck'

describe('isStaleSession', () => {
  it('returns false when requestVersion is undefined', () => {
    expect(isStaleSession(undefined, 5)).toBe(false)
  })

  it('returns false when versions match', () => {
    expect(isStaleSession(5, 5)).toBe(false)
  })

  it('returns true when versions do not match', () => {
    expect(isStaleSession(3, 5)).toBe(true)
  })

  it('returns true when requestVersion is lower than session', () => {
    expect(isStaleSession(1, 10)).toBe(true)
  })

  it('returns true when requestVersion is higher than session', () => {
    expect(isStaleSession(10, 1)).toBe(true)
  })
})
