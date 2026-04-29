import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGameStore } from './gameStore'
import { getJSTDateKey } from '../utils/pokemonUtils'

describe('gameStore authenticated submit flow', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    localStorage.clear()
    useGameStore.getState().setStorageScope(null)
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
    const resolver: { current: ((value: any) => void) | null } = { current: null }
    const fetchPromise = new Promise<any>((resolve) => {
      resolver.current = resolve
    })
    const fetchMock = vi.fn().mockImplementation(() => fetchPromise)
    vi.stubGlobal('fetch', fetchMock)

    const submitPromise = useGameStore.getState().submitGuessToServer('pikachu', 'token-1')

    expect(useGameStore.getState().isSubmitting).toBe(true)
    expect(useGameStore.getState().pendingGuess).toBe('pikachu')
    expect(useGameStore.getState().guesses).toEqual([])

    expect(resolver.current).not.toBeNull()
    if (!resolver.current) {
      throw new Error('Fetch resolver was not initialized')
    }
    resolver.current({
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

describe('gameStore scoped local persistence', () => {
  beforeEach(() => {
    localStorage.clear()
    useGameStore.getState().setStorageScope(null)
    useGameStore.setState({
      dailyPokemon: { name: 'eevee' } as any,
      pokemonList: ['pikachu', 'eevee', 'bulbasaur'],
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
      sessionVersion: null,
      puzzleDateKey: null,
      isSubmitting: false,
      staleLock: false,
      rateLimitUntil: null,
      newlyUnlockedBalls: [],
      rejectedGuess: null,
      pendingGuess: null,
    } as any)
  })

  it('persists guest guesses under guest-scoped keys', async () => {
    const won = await useGameStore.getState().makeGuess('pikachu')
    expect(won).toBe(false)
    const saved = localStorage.getItem('wurmple_game:guest')
    expect(saved).toBeTruthy()
    expect(JSON.parse(saved ?? '{}').guesses).toEqual(['pikachu'])
  })

  it('keeps guest and signed-in progress in separate storage keys', async () => {
    await useGameStore.getState().makeGuess('pikachu')

    useGameStore.getState().setStorageScope('user-123')
    useGameStore.setState({
      dailyPokemon: { name: 'eevee' } as any,
      pokemonList: ['pikachu', 'eevee', 'bulbasaur'],
      guesses: [],
      gameStatus: 'playing',
      hints: [
        { type: 'ability', value: '', revealed: false },
        { type: 'generation', value: '', revealed: false },
        { type: 'type', value: [], revealed: false },
      ],
      error: null,
    } as any)

    await useGameStore.getState().makeGuess('bulbasaur')

    const guestSaved = JSON.parse(localStorage.getItem('wurmple_game:guest') ?? '{}')
    const userSaved = JSON.parse(localStorage.getItem('wurmple_game:user:user-123') ?? '{}')
    expect(guestSaved.guesses).toEqual(['pikachu'])
    expect(userSaved.guesses).toEqual(['bulbasaur'])
  })

  it('migrates legacy guest keys to scoped keys on initialize', async () => {
    const today = getJSTDateKey()
    localStorage.setItem('lastPlayedDate', today)
    localStorage.setItem('gameState', JSON.stringify({
      dailyPokemon: { name: 'eevee' },
      pokemonList: ['pikachu', 'eevee'],
      guesses: ['pikachu'],
      hints: [
        { type: 'ability', value: '', revealed: false },
        { type: 'generation', value: '', revealed: false },
        { type: 'type', value: [], revealed: false },
      ],
      gameStatus: 'playing',
      lastPlayedDate: today,
    }))

    await useGameStore.getState().initializeGame()

    expect(localStorage.getItem('gameState')).toBeNull()
    expect(localStorage.getItem('lastPlayedDate')).toBeNull()
    const migrated = JSON.parse(localStorage.getItem('wurmple_game:guest') ?? '{}')
    expect(migrated.guesses).toEqual(['pikachu'])
    expect(useGameStore.getState().guesses).toEqual(['pikachu'])
  })
})
