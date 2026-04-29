import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGameStore } from './gameStore'

describe('gameStore authenticated submit flow', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    localStorage.clear()
    useGameStore.setState({
      dailyPokemon: { name: 'eevee' } as any,
      pokemonList: ['pikachu', 'eevee'],
      guesses: [],
      hints: [
        { type: 'ability', value: '', revealed: false },
        { type: 'generation', value: '', revealed: false },
        { type: 'type', value: [], revealed: false },
      ],
      gameStatus: 'playing',
      isLoading: false,
      error: null,
      lastPlayedDate: null,
      sessionVersion: 1,
      puzzleDateKey: '2026-04-29',
      isSubmitting: false,
      staleLock: false,
      rateLimitUntil: null,
      newlyUnlockedBalls: [],
      rejectedGuess: null,
      pendingGuess: null,
    } as any)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('uses pendingGuess while submitting and commits guesses only after success', async () => {
    let resolveFetch: ((value: any) => void) | null = null
    const fetchPromise = new Promise<any>((resolve) => {
      resolveFetch = resolve
    })
    const fetchMock = vi.fn().mockImplementation(() => fetchPromise)
    vi.stubGlobal('fetch', fetchMock)

    const submitPromise = useGameStore.getState().submitGuessToServer('pikachu', 'token-1')

    expect(useGameStore.getState().isSubmitting).toBe(true)
    expect(useGameStore.getState().pendingGuess).toBe('pikachu')
    expect(useGameStore.getState().guesses).toEqual([])

    expect(resolveFetch).not.toBeNull()
    if (!resolveFetch) {
      throw new Error('Fetch resolver was not initialized')
    }
    resolveFetch({
      ok: true,
      json: async () => ({
        guesses: ['pikachu'],
        hint_flags: { ability: false, generation: false, type: false },
        hints: {},
        completion_state: 'playing',
        version: 2,
        newly_unlocked_balls: [],
      }),
    })

    const won = await submitPromise
    expect(won).toBe(false)
    expect(useGameStore.getState().isSubmitting).toBe(false)
    expect(useGameStore.getState().pendingGuess).toBeNull()
    expect(useGameStore.getState().guesses).toEqual(['pikachu'])
  })

  it('ignores duplicate submit attempts while request is already in flight', async () => {
    useGameStore.setState({ isSubmitting: true } as any)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const won = await useGameStore.getState().submitGuessToServer('pikachu', 'token-1')

    expect(won).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
