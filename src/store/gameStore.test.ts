import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGameStore, setAccessTokenProvider } from './gameStore'
import { getJSTDateKey } from '../utils/pokemonUtils'
import { getDailyPokemonId } from '../logic/dailyTarget'

const emptyHints = () => [
  { type: 'ability', value: '', revealed: false },
  { type: 'generation', value: '', revealed: false },
  { type: 'type', value: [], revealed: false },
]
const noHintFlags = { ability: false, generation: false, type: false }

// A session response in the server contract (results aligned with guesses).
const session = (over: Record<string, unknown> = {}) => ({
  guesses: [],
  results: [],
  name_length: 5,
  hint_flags: noHintFlags,
  hints: {},
  completion_state: 'playing',
  version: 2,
  newly_unlocked_balls: [],
  ...over,
})

describe('gameStore authenticated submit flow', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.test')
    localStorage.clear()
    const store = useGameStore.getState()
    store.setStorageScope(null)
    // Drops queued guesses and in-flight work left behind by earlier tests.
    store.invalidateServerSessionSync()
    store.setStorageScope('user-1')
    useGameStore.setState({
      dailyPokemon: null,
      pokemonList: ['pikachu', 'eevee', 'bulbasaur'],
      guesses: [],
      guessResults: [],
      nameLength: 5,
      hints: emptyHints(),
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
    setAccessTokenProvider(null)
    useGameStore.getState().setStorageScope(null)
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  function deferredFetch() {
    const calls: Array<{ url: string; body: any; headers: any; resolve: (value: any) => void }> = []
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      // PokéAPI is out of scope here: it just fails.
      if (String(url).includes('pokeapi.co')) return Promise.reject(new Error('offline'))
      return new Promise((resolve) => {
        calls.push({
          url,
          body: init?.body ? JSON.parse(String(init.body)) : null,
          headers: init?.headers,
          resolve,
        })
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    return { calls, fetchMock }
  }

  const okResponse = (body: any) => ({ ok: true, status: 200, json: async () => body })
  const flush = () => new Promise((r) => setTimeout(r, 0))

  it('shows the guess as pending tiles, then colours it from the server results', async () => {
    const { calls } = deferredFetch()

    const submitPromise = useGameStore.getState().submitGuessToServer('pikachu', 'token-1')

    // Instant, but uncoloured: nothing is scored locally.
    expect(useGameStore.getState().guesses).toEqual(['pikachu'])
    expect(useGameStore.getState().guessResults).toEqual([])
    expect(useGameStore.getState().isSubmitting).toBe(true)

    await flush()
    expect(calls).toHaveLength(1)
    const row = ['absent', 'present', 'absent', 'correct', 'absent', 'absent', 'absent']
    calls[0].resolve(okResponse(session({ guesses: ['pikachu'], results: [row] })))

    expect(await submitPromise).toBe(false)
    const state = useGameStore.getState()
    expect(state.isSubmitting).toBe(false)
    expect(state.guesses).toEqual(['pikachu'])
    expect(state.guessResults).toEqual([row])
    expect(state.nameLength).toBe(5)
    expect(state.sessionVersion).toBe(2)
  })

  it('does not mark a win or reveal the answer until the server confirms', async () => {
    useGameStore.setState({ dailyPokemon: null } as any)
    const { calls } = deferredFetch()

    const submitPromise = useGameStore.getState().submitGuessToServer('eevee', 'token-1')
    expect(useGameStore.getState().gameStatus).toBe('playing')
    expect(useGameStore.getState().dailyPokemon).toBeNull()

    await flush()
    calls[0].resolve(okResponse(session({
      guesses: ['eevee'],
      results: [['correct', 'correct', 'correct', 'correct', 'correct']],
      completion_state: 'won',
      pokemon_name: 'eevee',
      pokemon_id: 133,
    })))
    expect(await submitPromise).toBe(true)
    const state = useGameStore.getState()
    expect(state.gameStatus).toBe('won')
    expect(state.dailyPokemon).toMatchObject({ id: 133, name: 'eevee' })
  })

  it('does not unlock hints optimistically', async () => {
    useGameStore.setState({
      pokemonList: ['pikachu', 'eevee', 'bulbasaur'],
      guesses: ['pikachu', 'eevee'],
      guessResults: [['absent'], ['absent']],
    } as any)
    const { calls } = deferredFetch()

    const submitPromise = useGameStore.getState().submitGuessToServer('bulbasaur', 'token-1')
    expect(useGameStore.getState().hints[0].revealed).toBe(false)

    await flush()
    calls[0].resolve(okResponse(session({
      guesses: ['pikachu', 'eevee', 'bulbasaur'],
      results: [['absent'], ['absent'], ['absent']],
      hint_flags: { ...noHintFlags, ability: true },
      hints: { ability: 'overgrow' },
    })))
    await submitPromise
    expect(useGameStore.getState().hints[0]).toMatchObject({ revealed: true, value: 'overgrow' })
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

  it('rolls back with an error message on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    expect(await useGameStore.getState().submitGuessToServer('pikachu', 'token-1')).toBe(false)
    const state = useGameStore.getState()
    expect(state.guesses).toEqual([])
    expect(state.error).toMatch(/connection lost/i)
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
    calls[0].resolve(okResponse(session({ guesses: ['pikachu'], results: [['absent']], version: 2 })))
    await first
    // The second guess stays on screen (pending) while its own request is in flight.
    expect(useGameStore.getState().guesses).toEqual(['pikachu', 'bulbasaur'])
    expect(useGameStore.getState().guessResults).toEqual([['absent']])

    await flush()
    expect(calls).toHaveLength(2)
    expect(calls[1].body.session_version).toBe(2)
    calls[1].resolve(okResponse(session({
      guesses: ['pikachu', 'bulbasaur'], results: [['absent'], ['present']], version: 3,
    })))
    await second
    expect(useGameStore.getState().guesses).toEqual(['pikachu', 'bulbasaur'])
    expect(useGameStore.getState().guessResults).toEqual([['absent'], ['present']])
    expect(useGameStore.getState().sessionVersion).toBe(3)
  })

  it('reads the access token when a queued guess is sent', async () => {
    useGameStore.setState({ pokemonList: ['pikachu', 'eevee', 'bulbasaur'] } as any)
    let token = 'token-old'
    setAccessTokenProvider(() => token)
    const { calls } = deferredFetch()

    const first = useGameStore.getState().submitGuessToServer('pikachu', 'token-old')
    const second = useGameStore.getState().submitGuessToServer('bulbasaur', 'token-old')

    await flush()
    expect(calls[0].headers.Authorization).toBe('Bearer token-old')
    token = 'token-fresh' // refreshed while the first request was in flight
    calls[0].resolve(okResponse(session({ guesses: ['pikachu'], results: [['absent']] })))
    await first

    await flush()
    expect(calls[1].headers.Authorization).toBe('Bearer token-fresh')
    calls[1].resolve(okResponse(session({ guesses: ['pikachu', 'bulbasaur'], results: [['absent'], ['absent']], version: 3 })))
    await second
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

  it('discards guesses queued behind a finishing guess', async () => {
    useGameStore.setState({ pokemonList: ['pikachu', 'eevee', 'bulbasaur'] } as any)
    const { calls } = deferredFetch()

    const first = useGameStore.getState().submitGuessToServer('eevee', 'token-1')
    const second = useGameStore.getState().submitGuessToServer('bulbasaur', 'token-1')

    await flush()
    calls[0].resolve(okResponse(session({
      guesses: ['eevee'], results: [['correct']], completion_state: 'won', pokemon_name: 'eevee', pokemon_id: 133,
    })))
    expect(await first).toBe(true)
    expect(await second).toBe(false)
    expect(calls).toHaveLength(1)
    expect(useGameStore.getState().guesses).toEqual(['eevee'])
    expect(useGameStore.getState().isSubmitting).toBe(false)
  })

  it('waits for the session load instead of dropping an early guess', async () => {
    useGameStore.setState({ puzzleDateKey: null, sessionVersion: null, nameLength: null } as any)
    const { calls } = deferredFetch()

    const init = useGameStore.getState().initializeServerSession('token-1')
    const submitPromise = useGameStore.getState().submitGuessToServer('pikachu', 'token-1')
    expect(useGameStore.getState().guesses).toEqual(['pikachu'])

    await flush()
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/get-session?puzzle_date_key=')
    calls[0].resolve(okResponse(session({ version: 4 })))
    await init
    // The pending guess survives the session load, and name_length is stored.
    expect(useGameStore.getState().guesses).toEqual(['pikachu'])
    expect(useGameStore.getState().nameLength).toBe(5)

    await flush()
    expect(calls).toHaveLength(2)
    expect(calls[1].body.session_version).toBe(4)
    expect(calls[1].body.puzzle_date_key).toBe(getJSTDateKey())
    calls[1].resolve(okResponse(session({ guesses: ['pikachu'], results: [['absent']], version: 5 })))
    expect(await submitPromise).toBe(false)
    expect(useGameStore.getState().guesses).toEqual(['pikachu'])
  })

  it('keeps the answer, locks and rejected guess out of signed-in storage', async () => {
    const { calls } = deferredFetch()

    const init = useGameStore.getState().initializeServerSession('token-1')
    await flush()
    calls[0].resolve(okResponse(session({ guesses: ['pikachu'], results: [['absent']] })))
    await init

    useGameStore.setState({
      dailyPokemon: { id: 133, name: 'eevee' },
      staleLock: true,
      rateLimitUntil: Date.now() + 60000,
      rejectedGuess: 'pikachu',
    } as any)
    // Any persisting action will do; clearing a lock does not persist, so
    // trigger a session reload.
    const again = useGameStore.getState().initializeServerSession('token-1')
    await flush()
    calls[1].resolve(okResponse(session({ guesses: ['pikachu'], results: [['absent']] })))
    await again

    const saved = JSON.parse(localStorage.getItem('wurmple_game:user:user-1') ?? '{}')
    expect(saved.dailyPokemon).toBeNull()
    expect(saved).not.toHaveProperty('staleLock')
    expect(saved).not.toHaveProperty('rateLimitUntil')
    expect(saved).not.toHaveProperty('rejectedGuess')
    expect(saved.guessResults).toEqual([['absent']])
  })

  it('stores the answer only after the game is over', async () => {
    const { calls } = deferredFetch()

    const init = useGameStore.getState().initializeServerSession('token-1')
    await flush()
    calls[0].resolve(okResponse(session({
      guesses: ['eevee'], results: [['correct']], completion_state: 'won', pokemon_name: 'eevee', pokemon_id: 133,
    })))
    await init

    const saved = JSON.parse(localStorage.getItem('wurmple_game:user:user-1') ?? '{}')
    expect(saved.dailyPokemon).toMatchObject({ id: 133, name: 'eevee' })
  })

  it('re-syncs the session after a stale lock is cleared', async () => {
    useGameStore.setState({ staleLock: true, sessionVersion: 1 } as any)
    const { calls } = deferredFetch()

    useGameStore.getState().clearStaleLock()
    const resync = useGameStore.getState().initializeServerSession('token-1')
    await flush()
    calls[0].resolve(okResponse(session({ version: 7 })))
    await resync
    expect(useGameStore.getState().staleLock).toBe(false)
    expect(useGameStore.getState().sessionVersion).toBe(7)
  })
})

describe('gameStore day rollover', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.test')
    localStorage.clear()
    const store = useGameStore.getState()
    store.setStorageScope(null)
    store.invalidateServerSessionSync()
    store.setStorageScope('user-1')
  })

  afterEach(() => {
    useGameStore.getState().setStorageScope(null)
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('reloads the server session when the JST date has changed', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      calls.push(url)
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => ({
          guesses: [], results: [], name_length: 6, hint_flags: { ability: false, generation: false, type: false },
          hints: {}, completion_state: 'playing', version: 1,
        }),
      })
    }))
    useGameStore.setState({
      lastPlayedDate: '2000-01-01',
      puzzleDateKey: '2000-01-01',
      guesses: ['pikachu'],
      guessResults: [['absent']],
      gameStatus: 'won',
      dailyPokemon: { id: 25, name: 'pikachu' },
    } as any)

    useGameStore.getState().checkForNewDay('token-1')
    // Yesterday's board is gone at once.
    expect(useGameStore.getState().guesses).toEqual([])
    expect(useGameStore.getState().gameStatus).toBe('playing')
    expect(useGameStore.getState().dailyPokemon).toBeNull()

    await new Promise(r => setTimeout(r, 0))
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain(`/get-session?puzzle_date_key=${getJSTDateKey()}`)
    expect(useGameStore.getState().puzzleDateKey).toBe(getJSTDateKey())
    expect(useGameStore.getState().nameLength).toBe(6)
  })

  it('does nothing on the same day', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    useGameStore.setState({ lastPlayedDate: getJSTDateKey(), guesses: ['pikachu'] } as any)

    useGameStore.getState().checkForNewDay('token-1')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(useGameStore.getState().guesses).toEqual(['pikachu'])
  })
})

describe('gameStore restore after a PokéAPI failure', () => {
  const today = () => getJSTDateKey()

  beforeEach(() => {
    localStorage.clear()
    useGameStore.getState().setStorageScope(null)
    useGameStore.getState().invalidateServerSessionSync()
    localStorage.setItem('wurmple_guest_id', 'guest-abc')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function saveStub() {
    const id = getDailyPokemonId(today(), 'guest-abc')
    localStorage.setItem('wurmple_game_last_played:guest', today())
    localStorage.setItem('wurmple_game:guest', JSON.stringify({
      dailyPokemon: { id, name: 'stubmon' },
      guesses: [],
      hints: emptyHints(),
      gameStatus: 'playing',
    }))
    return id
  }

  it('refetches missing details on restore', async () => {
    const id = saveStub()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id, name: 'stubmon',
        abilities: [{ ability: { name: 'static', url: '' }, is_hidden: false }],
        sprites: { front_default: 'sprite.png' },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await useGameStore.getState().initializeGame()

    expect(fetchMock).toHaveBeenCalledWith(`https://pokeapi.co/api/v2/pokemon/${id}`)
    const pokemon = useGameStore.getState().dailyPokemon
    expect(pokemon?.abilities?.[0].ability.name).toBe('static')
    expect(pokemon?.sprites?.front_default).toBe('sprite.png')
  })

  it('keeps the game playable when the refetch fails too', async () => {
    const id = saveStub()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await useGameStore.getState().initializeGame()

    expect(useGameStore.getState().dailyPokemon).toMatchObject({ id, name: 'stubmon' })
    expect(useGameStore.getState().error).toBeNull()
  })

  it('uses the dex id for the generation hint without any species fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    useGameStore.setState({
      dailyPokemon: { id: 25, name: 'pikachu' },
      hints: emptyHints(),
    } as any)

    await useGameStore.getState().revealHint(6)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(useGameStore.getState().hints[1]).toMatchObject({ revealed: true, value: 'generation-i' })
  })
})

describe('gameStore guest migration', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.test')
    localStorage.clear()
    useGameStore.getState().setStorageScope(null)
    useGameStore.getState().invalidateServerSessionSync()
    localStorage.setItem('wurmple_guest_id', 'guest-abc')
    localStorage.setItem('wurmple_game_last_played:guest', getJSTDateKey())
    localStorage.setItem('wurmple_game:guest', JSON.stringify({ guesses: ['pikachu', 'eevee'] }))
    useGameStore.getState().setStorageScope('user-9')
  })

  afterEach(() => {
    useGameStore.getState().setStorageScope(null)
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('posts today\'s guest guesses and adopts the returned session', async () => {
    expect(useGameStore.getState().hasGuestProgress()).toBe(true)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => session({ guesses: ['pikachu', 'eevee'], results: [['absent'], ['present']], version: 3 }),
    })
    vi.stubGlobal('fetch', fetchMock)

    expect(await useGameStore.getState().migrateGuestProgress('token-1')).toBe(true)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.example.test/v1/migrate-guest')
    expect(JSON.parse(init.body)).toEqual({
      puzzle_date_key: getJSTDateKey(), guest_id: 'guest-abc', guesses: ['pikachu', 'eevee'],
    })
    const state = useGameStore.getState()
    expect(state.guesses).toEqual(['pikachu', 'eevee'])
    expect(state.guessResults).toEqual([['absent'], ['present']])
    expect(state.sessionVersion).toBe(3)
    expect(localStorage.getItem('wurmple_game:guest')).toBeNull()
  })

  it('keeps the guest game when the server refuses it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }))

    expect(await useGameStore.getState().migrateGuestProgress('token-1')).toBe(false)
    expect(localStorage.getItem('wurmple_game:guest')).not.toBeNull()
  })

  it('holds the session load until the migration gate opens', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => session() })
    vi.stubGlobal('fetch', fetchMock)

    useGameStore.getState().beginMigrationGate()
    const init = useGameStore.getState().initializeServerSession('token-1')
    await new Promise(r => setTimeout(r, 0))
    expect(fetchMock).not.toHaveBeenCalled()

    useGameStore.getState().endMigrationGate()
    await init
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports no guest progress without guesses', () => {
    localStorage.setItem('wurmple_game:guest', JSON.stringify({ guesses: [] }))
    expect(useGameStore.getState().hasGuestProgress()).toBe(false)
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

describe('gameStore guest server play (per-user days)', () => {
  const GUEST_ID = '3f1c2a9e-0000-4000-8000-0000000000aa'

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // 2026-10-06 12:00 JST: a per-user day.
    vi.setSystemTime(new Date('2026-10-06T03:00:00Z'))
    vi.stubEnv('VITE_API_URL', 'https://api.example.test')
    localStorage.clear()
    localStorage.setItem('wurmple_guest_id', GUEST_ID)
    const store = useGameStore.getState()
    store.setStorageScope('someone')
    store.invalidateServerSessionSync()
    store.setStorageScope(null)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  function mockFetch(responder: (url: string, init?: RequestInit) => unknown) {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      if (String(url).includes('pokeapi.co')) throw new Error('offline')
      return { ok: true, status: 200, json: async () => responder(url, init) }
    })
    vi.stubGlobal('fetch', fetchMock)
    return calls
  }

  it('never derives the answer locally', async () => {
    mockFetch(() => session())
    await useGameStore.getState().initializeGame()
    expect(useGameStore.getState().usesServer()).toBe(true)
    expect(useGameStore.getState().dailyPokemon).toBeNull()
    const saved = localStorage.getItem('wurmple_game:guest') ?? ''
    const answer = (await import('../data/pokemonNames')).POKEMON_NAMES[getDailyPokemonId('2026-10-06', GUEST_ID) - 1]
    expect(saved.includes(`"${answer}"`)).toBe(false)
  })

  it('loads the session by guest id without Authorization, and submits guesses to the server', async () => {
    const calls = mockFetch((url) =>
      String(url).includes('submit-guess')
        ? session({ guesses: ['pikachu'], results: [['absent', 'absent', 'absent', 'absent', 'absent', 'absent', 'absent']], version: 3 })
        : session({ name_length: 7 })
    )
    await useGameStore.getState().initializeGame()
    await useGameStore.getState().loadGuestServerSession()

    const get = calls.find(c => c.url.includes('/get-session'))!
    expect(get.url).toContain('puzzle_date_key=2026-10-06')
    expect(get.url).toContain(`guest_id=${GUEST_ID}`)
    expect((get.init?.headers as Record<string, string>).Authorization).toBeUndefined()
    expect(useGameStore.getState().nameLength).toBe(7)

    await useGameStore.getState().submitGuessToServer('pikachu')
    const post = calls.find(c => c.url.includes('/submit-guess'))!
    expect(JSON.parse(String(post.init?.body))).toMatchObject({ guess: 'pikachu', guest_id: GUEST_ID, puzzle_date_key: '2026-10-06' })
    expect((post.init?.headers as Record<string, string>).Authorization).toBeUndefined()
    expect(useGameStore.getState().guessResults).toHaveLength(1)
  })

  it('drops a guest response that lands after the player signed in', async () => {
    let release: (v: unknown) => void = () => {}
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(r => { release = r })))
    await useGameStore.getState().initializeGame()
    const load = useGameStore.getState().loadGuestServerSession()
    useGameStore.getState().setStorageScope('user-9')
    release({ ok: true, status: 200, json: async () => session({ guesses: ['eevee'], results: [['absent']] }) })
    await load
    expect(useGameStore.getState().guesses).toEqual([])
  })

  it('keeps shared-puzzle days local for guests', async () => {
    vi.setSystemTime(new Date('2026-10-03T03:00:00Z'))
    const calls = mockFetch(() => session())
    await useGameStore.getState().initializeGame()
    await useGameStore.getState().loadGuestServerSession()
    expect(useGameStore.getState().usesServer()).toBe(false)
    expect(useGameStore.getState().dailyPokemon?.id).toBe(getDailyPokemonId('2026-10-03', GUEST_ID))
    expect(calls.some(c => c.url.includes('get-session'))).toBe(false)
  })
})
