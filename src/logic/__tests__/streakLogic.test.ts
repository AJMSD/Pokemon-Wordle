import { describe, it, expect } from 'vitest'
import { calcWinStreak, calcParticipationStreak, calcWinsAfterLoss } from '../streakLogic'

describe('calcWinStreak', () => {
  it('increments streak when won and last played yesterday', () => {
    expect(calcWinStreak('2026-04-25', '2026-04-25', 3, true)).toBe(4)
  })

  it('resets to 1 when won but last played before yesterday', () => {
    expect(calcWinStreak('2026-04-24', '2026-04-25', 3, true)).toBe(1)
  })

  it('returns 0 on loss regardless of last played date', () => {
    expect(calcWinStreak('2026-04-25', '2026-04-25', 5, false)).toBe(0)
  })

  it('returns 0 on loss even when streak was high', () => {
    expect(calcWinStreak('2026-04-25', '2026-04-25', 100, false)).toBe(0)
  })

  it('starts at 1 when won with no prior streak', () => {
    expect(calcWinStreak('2026-04-24', '2026-04-25', 0, true)).toBe(1)
  })
})

describe('calcParticipationStreak', () => {
  it('increments when last participation was yesterday', () => {
    expect(calcParticipationStreak('2026-04-25', '2026-04-25', 5)).toBe(6)
  })

  it('resets to 1 when last participation was before yesterday', () => {
    expect(calcParticipationStreak('2026-04-23', '2026-04-25', 5)).toBe(1)
  })

  it('resets to 1 when no prior participation', () => {
    expect(calcParticipationStreak('2026-04-01', '2026-04-25', 0)).toBe(1)
  })
})

describe('calcWinsAfterLoss', () => {
  it('increments on win', () => {
    expect(calcWinsAfterLoss(2, true)).toBe(3)
  })

  it('resets to 0 on loss', () => {
    expect(calcWinsAfterLoss(2, false)).toBe(0)
  })

  it('starts at 1 from zero on win', () => {
    expect(calcWinsAfterLoss(0, true)).toBe(1)
  })

  it('returns 0 when already 0 and loses', () => {
    expect(calcWinsAfterLoss(0, false)).toBe(0)
  })
})
