import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  fetchPokemonSpecies,
  msUntilNextJstMidnight,
  normalizePokemonName,
  isCorrectGuess,
  isValidPokemonName,
  getLetterMatchResult,
} from '../pokemonUtils'
import type { Pokemon } from '../../types'

describe('normalizePokemonName', () => {
  it('lowercases the name', () => {
    expect(normalizePokemonName('PIKACHU')).toBe('pikachu')
  })

  it('strips spaces', () => {
    expect(normalizePokemonName('mr mime')).toBe('mrmime')
  })

  it('strips -mega suffix', () => {
    expect(normalizePokemonName('charizard-mega')).toBe('charizard')
  })

  it('strips -gmax suffix', () => {
    expect(normalizePokemonName('gengar-gmax')).toBe('gengar')
  })

  it('strips -alola suffix', () => {
    expect(normalizePokemonName('raichu-alola')).toBe('raichu')
  })

  it('strips -galar suffix', () => {
    expect(normalizePokemonName('ponyta-galar')).toBe('ponyta')
  })

  it('strips -hisui suffix', () => {
    expect(normalizePokemonName('typhlosion-hisui')).toBe('typhlosion')
  })

  it('preserves hyphens that are part of the base name', () => {
    expect(normalizePokemonName('ho-oh')).toBe('ho-oh')
  })

  it('preserves porygon-z', () => {
    expect(normalizePokemonName('porygon-z')).toBe('porygon-z')
  })
})

describe('isCorrectGuess', () => {
  const pokemon = { name: 'charizard-mega' } as Pokemon

  it('returns true for exact normalized match', () => {
    expect(isCorrectGuess('charizard', pokemon)).toBe(true)
  })

  it('returns true for case-insensitive match', () => {
    expect(isCorrectGuess('CHARIZARD', pokemon)).toBe(true)
  })

  it('returns false for wrong name', () => {
    expect(isCorrectGuess('pikachu', pokemon)).toBe(false)
  })
})

describe('isValidPokemonName', () => {
  const list = ['pikachu', 'bulbasaur', 'charmander']

  it('returns true for a name in the list', () => {
    expect(isValidPokemonName('pikachu', list)).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isValidPokemonName('PIKACHU', list)).toBe(true)
  })

  it('returns false for a name not in the list', () => {
    expect(isValidPokemonName('digimon', list)).toBe(false)
  })
})

describe('getLetterMatchResult', () => {
  it('marks all correct for exact match', () => {
    expect(getLetterMatchResult('cat', 'cat')).toEqual(['correct', 'correct', 'correct'])
  })

  it('marks absent for letters not in target', () => {
    expect(getLetterMatchResult('xyz', 'cat')).toEqual(['absent', 'absent', 'absent'])
  })

  it('marks present for letter in wrong position', () => {
    const result = getLetterMatchResult('act', 'cat')
    expect(result[0]).toBe('present') // 'a' is in 'cat' but wrong position
    expect(result[1]).toBe('present') // 'c' is in 'cat' but wrong position
    expect(result[2]).toBe('correct') // 't' is correct
  })

  it('does not double-count duplicate letters', () => {
    // target = 'cat', guess = 'caa' — only one 'a' in target
    const result = getLetterMatchResult('caa', 'cat')
    expect(result[0]).toBe('correct')  // 'c' correct
    expect(result[1]).toBe('correct')  // 'a' correct
    expect(result[2]).toBe('absent')   // second 'a' — already consumed
  })

  it('handles guess longer than target', () => {
    const result = getLetterMatchResult('pikachu', 'pika')
    expect(result[0]).toBe('correct')
    expect(result[1]).toBe('correct')
    expect(result[2]).toBe('correct')
    expect(result[3]).toBe('correct')
    expect(result[4]).toBe('absent')
    expect(result[5]).toBe('absent')
    expect(result[6]).toBe('absent')
  })

  it('returns empty array for empty inputs', () => {
    expect(getLetterMatchResult('', 'cat')).toEqual([])
    expect(getLetterMatchResult('cat', '')).toEqual([])
  })
})

describe('msUntilNextJstMidnight', () => {
  it('counts down to 00:00 JST (15:00 UTC)', () => {
    // 14:00 UTC is 23:00 JST: one hour to go.
    expect(msUntilNextJstMidnight(Date.UTC(2026, 9, 5, 14, 0, 0))).toBe(3600 * 1000)
    // Exactly at midnight JST a full day remains.
    expect(msUntilNextJstMidnight(Date.UTC(2026, 9, 5, 15, 0, 0))).toBe(24 * 3600 * 1000)
  })
})

describe('fetchPokemonSpecies', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('throws on a non-OK response instead of parsing the error body', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }))
    await expect(fetchPokemonSpecies('https://pokeapi.co/x')).rejects.toThrow(/503/)
  })
})
