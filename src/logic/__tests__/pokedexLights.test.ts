import { describe, it, expect } from 'vitest'
import { filledDotCount } from '../pokedexLights'
import { getLetterMatchResult } from '../../utils/pokemonUtils'

// Results come from the server in play; here they are derived from the target.
const dots = (guesses: string[], target: string, won = false) =>
  filledDotCount(guesses.map(g => getLetterMatchResult(g, target)), target.length || null, won)

describe('filledDotCount', () => {
  it('is empty before any letter is in place', () => {
    expect(dots([], 'pikachu')).toBe(0)
    expect(dots(['eevee'], 'pikachu')).toBe(0)
  })

  it('fills at exactly 25% / 50% / 75% / 100% (inclusive thresholds)', () => {
    // 'abra' (4 letters): each correct position is 25%.
    expect(dots(['axxx'], 'abra')).toBe(1)
    expect(dots(['abxx'], 'abra')).toBe(2)
    expect(dots(['abrx'], 'abra')).toBe(3)
    expect(dots(['abra'], 'abra')).toBe(4)
  })

  it('stays below a threshold until it is reached', () => {
    // 'pikachu' (7): 1/7 < 25%, 2/7 >= 25%, 3/7 < 50%, 4/7 >= 50%, 6/7 >= 75%.
    expect(dots(['pxxxxxx'], 'pikachu')).toBe(0)
    expect(dots(['pixxxxx'], 'pikachu')).toBe(1)
    expect(dots(['pikxxxx'], 'pikachu')).toBe(1)
    expect(dots(['pikaxxx'], 'pikachu')).toBe(2)
    expect(dots(['pikachx'], 'pikachu')).toBe(3)
  })

  it('combines positions found across guesses and never empties', () => {
    expect(dots(['axxx', 'xbxx'], 'abra')).toBe(2)
    expect(dots(['abxx', 'xxxx'], 'abra')).toBe(2)
    expect(dots(['abxx', 'xxra'], 'abra')).toBe(4)
  })

  it('counts present-but-misplaced letters as nothing', () => {
    expect(dots(['arba'], 'abra')).toBe(2) // a..a in place, r/b swapped
  })

  it('fills everything on a win and handles a missing target', () => {
    expect(dots([], 'abra', true)).toBe(4)
    expect(dots(['abra'], '')).toBe(0)
  })
})
