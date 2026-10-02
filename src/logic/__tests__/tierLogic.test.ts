import { describe, it, expect } from 'vitest'
import { getStreakTier, getTierUpgradePrompt, nextTier, tierRank } from '../tierLogic'

describe('getStreakTier', () => {
  it.each([
    [0, 'poke-ball'], [2, 'poke-ball'], [3, 'great-ball'], [6, 'great-ball'],
    [7, 'ultra-ball'], [13, 'ultra-ball'], [14, 'master-ball'], [100, 'master-ball'],
  ])('streak %i is %s', (streak, tier) => {
    expect(getStreakTier(streak)).toBe(tier)
  })
})

describe('nextTier', () => {
  it('points at the next threshold', () => {
    expect(nextTier(0)).toEqual({ tierId: 'great-ball', threshold: 3 })
    expect(nextTier(2)).toEqual({ tierId: 'great-ball', threshold: 3 })
    expect(nextTier(3)).toEqual({ tierId: 'ultra-ball', threshold: 7 })
    expect(nextTier(7)).toEqual({ tierId: 'master-ball', threshold: 14 })
  })

  it('returns null at the max tier', () => {
    expect(nextTier(14)).toBeNull()
  })
})

describe('tierRank', () => {
  it('ranks achievement balls with the base tier', () => {
    expect(tierRank('heal-ball')).toBe(0)
    expect(tierRank('poke-ball')).toBe(0)
    expect(tierRank('ultra-ball')).toBe(2)
  })
})

describe('getTierUpgradePrompt', () => {
  it('never offers Poké Ball when an achievement ball is equipped', () => {
    expect(getTierUpgradePrompt(2, 'heal-ball', false)).toBeNull()
    expect(getTierUpgradePrompt(0, 'quick-ball', false)).toBeNull()
  })

  it('offers Great Ball or above over an achievement ball', () => {
    expect(getTierUpgradePrompt(3, 'heal-ball', false)).toBe('great-ball')
    expect(getTierUpgradePrompt(14, 'net-ball', false)).toBe('master-ball')
  })

  it('offers a higher tier than the equipped tier ball only', () => {
    expect(getTierUpgradePrompt(7, 'great-ball', false)).toBe('ultra-ball')
    expect(getTierUpgradePrompt(7, 'ultra-ball', false)).toBeNull()
    expect(getTierUpgradePrompt(3, 'master-ball', false)).toBeNull()
  })

  it('treats a missing display ball as Poké Ball', () => {
    expect(getTierUpgradePrompt(3, null, false)).toBe('great-ball')
  })

  it('respects tier_prompt_dismissed_forever', () => {
    expect(getTierUpgradePrompt(14, 'poke-ball', true)).toBeNull()
  })
})
