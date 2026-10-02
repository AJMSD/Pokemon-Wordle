import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGameStore } from './gameStore'
import { getJSTDateKey } from '../utils/pokemonUtils'

describe('gameStore authenticated submit flow', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.test')
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
    } as any)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  function deferredFetch() {
    const calls: Array<{ url: string; body: any; resolve: (value: any) => void }> = []
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) =>
      new Promise((resolve) => {
        calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null, resolve })
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    return { calls, fetchMock }
  }

  const okResponse = (body: any) => ({ ok: true, status: 200, json: async () => body })
  const flush = () => new Promise((r) => setTimeout(r, 0))

  it('shows the guess at once and reconciles with the server reply', async () => {
    const { calls } = deferredFetch()

    const submitPromise = useGameStore.getState().submitGuessToServer('pikachu', 'token-1')

    expect(useGameStore.getState().guesses).toEqual(['pikachu'])
    expect(useGameStore.getState().isSubmitting).toBe(true)

    await flush()
    expect(calls).toHaveLength(1)
    calls[0].resolve(okResponse({
      guesses: ['pikachu'],
      hint_flags: { ability: false, generation: false, type: false },
      hints: {},
      completion_state: 'playing',
      version: 2,
      newly_unlocked_balls: [],
    }))

    expect(await submitPromise).toBe(false)
    expect(useGameStore.getState().isSubmitting).toBe(false)
    expect(useGameStore.getState().guesses).toEqual(['pikachu'])
    expect(useGameStore.getState().sessionVersion).toBe(2)
  })

  it('marks a winning guess won before the server answers', async () => {
    const { calls } = deferredFetch()

    const submitPromise = useGameStore.getState().submitGuessToServer('eevee', 'token-1')
    expect(useGameStore.getState().gameStatus).toBe('won')

    await flush()
    calls[0].resolve(okResponse({
      guesses: ['eevee'],
      hint_flags: { ability: false, generation: false, type: false },
      hints: {},
      completion_state: 'won',
      version: 2,
      pokemon_name: 'eevee',
      newly_unlocked_balls: [],
    }))
    expect(await submitPromise).toBe(true)
    expect(useGameStore.getState().gameStatus).toBe('won')
  })

  it('rolls back and flags the guess when the server rejects it', async () => {
    const { calls } = deferredFetch()

    const submitPromise = useGameStore.getState().submitGuessToServer('pikachu', 'token-1')
    expect(useGameStore.getState().guesses).toEqual(['pikachu'])

    await flush()
    calls[0].resolve({ ok: false, status: 409, json: async () => ({ error: 'stale_session' }) })

    expect(await submitPromise).toBe(false)
    const state = useGameStore.getState()
    expect(state.guesses).toEqual([])
    expect(state.gameStatus).toBe('playing')
    expect(state.staleLock).toBe(true)
    expect(state.rejectedGuess).toBe('pikachu')
    expect(state.isSubmitting).toBe(false)
  })

  it('queues back-to-back guesses so each sends the latest version', async () => {
    useGameStore.setState({ pokemonList: ['pikachu', 'eevee', 'bulbasaur'] } as any)
    const { calls } = deferredFetch()

    const first = useGameStore.getState().submitGuessToServer('pikachu', 'token-1')
    const second = useGameStore.getState().submitGuessToServer('bulbasaur', 'token-1')
    expect(useGameStore.getState().guesses).toEqual(['pikachu', 'bulbasaur'])

    await flush()
    expect(calls).toHaveLength(1)
    expect(calls[0].body.session_version).toBe(1)
    calls[0].resolve(okResponse({
      guesses: ['pikachu'],
      hint_flags: { ability: false, generation: false, type: false },
      hints: {},
      completion_state: 'playing',
      version: 2,
    }))
    await first
    // The second guess stays on screen while its own request is in flight.
    expect(useGameStore.getState().guesses).toEqual(['pikachu', 'bulbasaur'])

    await flush()
    expect(calls).toHaveLength(2)
    expect(calls[1].body.session_version).toBe(2)
    calls[1].resolve(okResponse({
      guesses: ['pikachu', 'bulbasaur'],
      hint_flags: { ability: false, generation: false, type: false },
      hints: {},
      completion_state: 'playing',
      version: 3,
    }))
    await second
    expect(useGameStore.getState().guesses).toEqual(['pikachu', 'bulbasaur'])
    expect(useGameStore.getState().sessionVersion).toBe(3)
  })

  it('drops queued guesses when an earlier one rolls back', async () => {
    useGameStore.setState({ pokemonList: ['pikachu', 'eevee', 'bulbasaur'] } as any)
    const { calls } = deferredFetch()

    const first = useGameStore.getState().submitGuessToServer('pikachu', 'token-1')
    const second = useGameStore.getState().submitGuessToServer('bulbasaur', 'token-1')

    await flush()
    calls[0].resolve({ ok: false, status: 429, json: async () => ({ retry_after: 30 }) })
    expect(await first).toBe(false)
    expect(await second).toBe(false)
    expect(calls).toHaveLength(1)
    expect(useGameStore.getState().guesses).toEqual([])
    expect(useGameStore.getState().rateLimitUntil).not.toBeNull()
  })

  it('waits for the session load instead of dropping an early guess', async () => {
    useGameStore.setState({ puzzleDateKey: null, sessionVersion: null } as any)
    const { calls } = deferredFetch()

    const init = useGameStore.getState().initializeServerSession('token-1')
    const submitPromise = useGameStore.getState().submitGuessToServer('pikachu', 'token-1')
    expect(useGameStore.getState().guesses).toEqual(['pikachu'])

    await flush()
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/get-session?puzzle_date_key=')
    calls[0].resolve(okResponse({
      guesses: [],
      hint_flags: { ability: false, generation: false, type: false },
      hints: {},
      completion_state: 'playing',
      version: 4,
    }))
    await init
    // The optimistic guess survives the session load.
    expect(useGameStore.getState().guesses).toEqual(['pikachu'])

    await flush()
    expect(calls).toHaveLength(2)
    expect(calls[1].body.session_version).toBe(4)
    expect(calls[1].body.puzzle_date_key).toBe(getJSTDateKey())
    calls[1].resolve(okResponse({
      guesses: ['pikachu'],
      hint_flags: { ability: false, generation: false, type: false },
      hints: {},
      completion_state: 'playing',
      version: 5,
    }))
    expect(await submitPromise).toBe(false)
    expect(useGameStore.getState().guesses).toEqual(['pikachu'])
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
