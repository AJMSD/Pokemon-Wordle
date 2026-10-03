import { describe, it, expect } from 'vitest'
import {
  POKEMON_COUNT,
  PER_USER_START_DATE,
  dayNumber,
  getDailyPokemonId,
  legacySharedIndex,
  generationForId,
} from '../dailyTarget'

function addDays(dateKey: string, days: number): string {
  return new Date(Date.UTC(1970, 0, 1 + dayNumber(dateKey) + days)).toISOString().slice(0, 10)
}

describe('dayNumber', () => {
  it('counts whole days since the epoch', () => {
    expect(dayNumber('1970-01-01')).toBe(0)
    expect(dayNumber('1970-01-02')).toBe(1)
    expect(dayNumber('2026-10-04')).toBe(20730)
  })
})

describe('getDailyPokemonId before the per-user start', () => {
  // Outputs of the original arg-less getDailyPokemonIndex() for these JST days.
  const LEGACY = { '2026-04-25': 706, '2026-10-02': 94, '2026-10-03': 611, '2026-10-04': 865 }

  it('keeps the legacy shared index bit-for-bit', () => {
    for (const [date, index] of Object.entries(LEGACY)) {
      expect(legacySharedIndex(date)).toBe(index)
    }
  })

  it('gives every user the shared Pokémon', () => {
    for (const [date, index] of Object.entries(LEGACY)) {
      expect(getDailyPokemonId(date, 'user-a')).toBe(index + 1)
      expect(getDailyPokemonId(date, 'user-b')).toBe(index + 1)
    }
  })
})

describe('getDailyPokemonId from the per-user start', () => {
  it('matches golden vectors so the mapping cannot drift silently', () => {
    expect(getDailyPokemonId('2026-10-05', 'user-a')).toBe(677)
    expect(getDailyPokemonId('2027-01-01', '3f1c2a9e-0000-4000-8000-000000000001')).toBe(456)
  })

  it('is deterministic for the same user and date', () => {
    const first = getDailyPokemonId(PER_USER_START_DATE, 'same-user')
    expect(getDailyPokemonId(PER_USER_START_DATE, 'same-user')).toBe(first)
  })

  it('differs across users', () => {
    const ids = new Set(
      Array.from({ length: 50 }, (_, i) => getDailyPokemonId(PER_USER_START_DATE, `user-${i}`)),
    )
    expect(ids.size).toBeGreaterThan(40)
  })

  it('gives each user every Pokémon exactly once over 1025 consecutive days', () => {
    for (const seed of ['user-a', 'user-b', '3f1c2a9e-0000-4000-8000-000000000001', 'guest-xyz']) {
      const seen = new Set<number>()
      for (let i = 0; i < POKEMON_COUNT; i++) {
        const id = getDailyPokemonId(addDays(PER_USER_START_DATE, i), seed)
        expect(id).toBeGreaterThanOrEqual(1)
        expect(id).toBeLessThanOrEqual(POKEMON_COUNT)
        seen.add(id)
      }
      expect(seen.size).toBe(POKEMON_COUNT)
    }
  })
})

describe('generationForId', () => {
  it('maps dex ids to PokéAPI generation names', () => {
    expect(generationForId(1)).toBe('generation-i')
    expect(generationForId(151)).toBe('generation-i')
    expect(generationForId(152)).toBe('generation-ii')
    expect(generationForId(905)).toBe('generation-viii')
    expect(generationForId(1025)).toBe('generation-ix')
  })
})
