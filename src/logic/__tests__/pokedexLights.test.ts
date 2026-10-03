import { describe, it, expect } from 'vitest'
import { litLightCount } from '../pokedexLights'

describe('litLightCount', () => {
  it('is dark before any letter is in place', () => {
    expect(litLightCount([], 'pikachu')).toBe(0)
    expect(litLightCount(['eevee'], 'pikachu')).toBe(0)
  })

  it('lights at exactly 25% / 50% / 75% (inclusive thresholds)', () => {
    // 'abra' (4 letters): each correct position is 25%.
    expect(litLightCount(['axxx'], 'abra')).toBe(1)
    expect(litLightCount(['abxx'], 'abra')).toBe(2)
    expect(litLightCount(['abrx'], 'abra')).toBe(3)
  })

  it('stays below a threshold until it is reached', () => {
    // 'pikachu' (7): 1/7 < 25%, 2/7 >= 25%, 3/7 < 50%, 4/7 >= 50%.
    expect(litLightCount(['pxxxxxx'], 'pikachu')).toBe(0)
    expect(litLightCount(['pixxxxx'], 'pikachu')).toBe(1)
    expect(litLightCount(['pikxxxx'], 'pikachu')).toBe(1)
    expect(litLightCount(['pikaxxx'], 'pikachu')).toBe(2)
  })

  it('combines positions found across guesses and never switches off', () => {
    expect(litLightCount(['axxx', 'xbxx'], 'abra')).toBe(2)
    expect(litLightCount(['abxx', 'xxxx'], 'abra')).toBe(2)
  })

  it('counts present-but-misplaced letters as nothing', () => {
    expect(litLightCount(['arba'], 'abra')).toBe(2) // a..a in place, r/b swapped
  })

  it('lights everything on a win and handles a missing target', () => {
    expect(litLightCount([], 'abra', true)).toBe(3)
    expect(litLightCount(['abra'], '')).toBe(0)
  })
})
