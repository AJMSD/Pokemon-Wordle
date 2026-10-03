import { describe, it, expect } from 'vitest'
import { filledDotCount } from '../pokedexLights'

describe('filledDotCount', () => {
  it('is empty before any letter is in place', () => {
    expect(filledDotCount([], 'pikachu')).toBe(0)
    expect(filledDotCount(['eevee'], 'pikachu')).toBe(0)
  })

  it('fills at exactly 25% / 50% / 75% / 100% (inclusive thresholds)', () => {
    // 'abra' (4 letters): each correct position is 25%.
    expect(filledDotCount(['axxx'], 'abra')).toBe(1)
    expect(filledDotCount(['abxx'], 'abra')).toBe(2)
    expect(filledDotCount(['abrx'], 'abra')).toBe(3)
    expect(filledDotCount(['abra'], 'abra')).toBe(4)
  })

  it('stays below a threshold until it is reached', () => {
    // 'pikachu' (7): 1/7 < 25%, 2/7 >= 25%, 3/7 < 50%, 4/7 >= 50%, 6/7 >= 75%.
    expect(filledDotCount(['pxxxxxx'], 'pikachu')).toBe(0)
    expect(filledDotCount(['pixxxxx'], 'pikachu')).toBe(1)
    expect(filledDotCount(['pikxxxx'], 'pikachu')).toBe(1)
    expect(filledDotCount(['pikaxxx'], 'pikachu')).toBe(2)
    expect(filledDotCount(['pikachx'], 'pikachu')).toBe(3)
  })

  it('combines positions found across guesses and never empties', () => {
    expect(filledDotCount(['axxx', 'xbxx'], 'abra')).toBe(2)
    expect(filledDotCount(['abxx', 'xxxx'], 'abra')).toBe(2)
    expect(filledDotCount(['abxx', 'xxra'], 'abra')).toBe(4)
  })

  it('counts present-but-misplaced letters as nothing', () => {
    expect(filledDotCount(['arba'], 'abra')).toBe(2) // a..a in place, r/b swapped
  })

  it('fills everything on a win and handles a missing target', () => {
    expect(filledDotCount([], 'abra', true)).toBe(4)
    expect(filledDotCount(['abra'], '')).toBe(0)
  })
})
