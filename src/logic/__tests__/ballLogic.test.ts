import { describe, it, expect } from 'vitest'
import { checkBallUnlocks, BallCheckInput } from '../ballLogic'

const base: BallCheckInput = {
  completionState: 'won',
  guessCount: 5,
  partStreak: 0,
  waterBugCount: 0,
  isWaterOrBug: false,
  winsAfterLoss: 0,
  hasProfile: false,
}

describe('checkBallUnlocks', () => {
  describe('quick-ball', () => {
    it('unlocks when won with 1 guess', () => {
      expect(checkBallUnlocks({ ...base, guessCount: 1 })).toContain('quick-ball')
    })
    it('unlocks when won with 2 guesses', () => {
      expect(checkBallUnlocks({ ...base, guessCount: 2 })).toContain('quick-ball')
    })
    it('does not unlock when won with 3 guesses', () => {
      expect(checkBallUnlocks({ ...base, guessCount: 3 })).not.toContain('quick-ball')
    })
    it('does not unlock on loss even with 1 guess', () => {
      expect(checkBallUnlocks({ ...base, completionState: 'lost', guessCount: 1 })).not.toContain('quick-ball')
    })
  })

  describe('timer-ball', () => {
    it('unlocks when won with exactly 10 guesses', () => {
      expect(checkBallUnlocks({ ...base, guessCount: 10 })).toContain('timer-ball')
    })
    it('does not unlock when won with 9 guesses', () => {
      expect(checkBallUnlocks({ ...base, guessCount: 9 })).not.toContain('timer-ball')
    })
    it('does not unlock on loss with 10 guesses', () => {
      expect(checkBallUnlocks({ ...base, completionState: 'lost', guessCount: 10 })).not.toContain('timer-ball')
    })
  })

  describe('net-ball', () => {
    it('unlocks when water/bug and count reaches 10', () => {
      expect(checkBallUnlocks({ ...base, isWaterOrBug: true, waterBugCount: 10 })).toContain('net-ball')
    })
    it('unlocks when count exceeds 10', () => {
      expect(checkBallUnlocks({ ...base, isWaterOrBug: true, waterBugCount: 15 })).toContain('net-ball')
    })
    it('does not unlock when count is 9', () => {
      expect(checkBallUnlocks({ ...base, isWaterOrBug: true, waterBugCount: 9 })).not.toContain('net-ball')
    })
    it('does not unlock when not water/bug even with count 10', () => {
      expect(checkBallUnlocks({ ...base, isWaterOrBug: false, waterBugCount: 10 })).not.toContain('net-ball')
    })
  })

  describe('luxury-ball', () => {
    it('unlocks when partStreak >= 7 and hasProfile', () => {
      expect(checkBallUnlocks({ ...base, partStreak: 7, hasProfile: true })).toContain('luxury-ball')
    })
    it('unlocks when partStreak is 10 and hasProfile', () => {
      expect(checkBallUnlocks({ ...base, partStreak: 10, hasProfile: true })).toContain('luxury-ball')
    })
    it('does not unlock when partStreak is 6', () => {
      expect(checkBallUnlocks({ ...base, partStreak: 6, hasProfile: true })).not.toContain('luxury-ball')
    })
    it('does not unlock when partStreak is 7 but no profile', () => {
      expect(checkBallUnlocks({ ...base, partStreak: 7, hasProfile: false })).not.toContain('luxury-ball')
    })
  })

  describe('heal-ball', () => {
    it('unlocks when winsAfterLoss >= 3', () => {
      expect(checkBallUnlocks({ ...base, winsAfterLoss: 3 })).toContain('heal-ball')
    })
    it('unlocks when winsAfterLoss exceeds 3', () => {
      expect(checkBallUnlocks({ ...base, winsAfterLoss: 5 })).toContain('heal-ball')
    })
    it('does not unlock when winsAfterLoss is 2', () => {
      expect(checkBallUnlocks({ ...base, winsAfterLoss: 2 })).not.toContain('heal-ball')
    })
  })

  it('returns empty array when no conditions met', () => {
    expect(checkBallUnlocks({ ...base, completionState: 'playing', guessCount: 5 })).toEqual([])
  })

  it('returns multiple balls when multiple conditions met', () => {
    const result = checkBallUnlocks({
      completionState: 'won',
      guessCount: 1,
      partStreak: 7,
      waterBugCount: 10,
      isWaterOrBug: true,
      winsAfterLoss: 3,
      hasProfile: true,
    })
    expect(result).toContain('quick-ball')
    expect(result).toContain('net-ball')
    expect(result).toContain('luxury-ball')
    expect(result).toContain('heal-ball')
  })
})
