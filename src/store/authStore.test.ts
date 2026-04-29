import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from './authStore'
import { useGameStore } from './gameStore'
import { supabase } from '../lib/supabase'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('authStore display ball sync', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    localStorage.clear()

    useAuthStore.setState({
      user: { id: 'user-1' } as any,
      session: { access_token: 'token-1', user: { id: 'user-1' } } as any,
      profile: {
        id: 'user-1',
        username: 'Ash',
        avatar_config: {},
        display_ball: 'poke-ball',
      },
      stats: null,
      displayBallSync: {
        inFlight: false,
        pendingBallId: null,
        requestId: 0,
      },
      isLoading: false,
      isGuest: false,
      pendingPasswordRecovery: false,
      pendingEmail: null,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('keeps local selected ball while fetchMe returns stale server ball during in-flight update', async () => {
    const setDisplayDeferred = deferred<any>()

    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => setDisplayDeferred.promise)
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({
          profile: {
            username: 'Ash',
            avatar_config: {},
            display_ball: 'poke-ball',
          },
          stats: null,
        }),
      })

    vi.stubGlobal('fetch', fetchMock)

    const updatePromise = useAuthStore.getState().updateDisplayBall('quick-ball')

    expect(useAuthStore.getState().profile?.display_ball).toBe('quick-ball')
    expect(useAuthStore.getState().displayBallSync.inFlight).toBe(true)

    const fetchMeResult = await useAuthStore.getState().fetchMe()
    expect(fetchMeResult.error).toBeNull()
    expect(useAuthStore.getState().profile?.display_ball).toBe('quick-ball')

    setDisplayDeferred.resolve({
      ok: true,
      json: async () => ({ display_ball: 'quick-ball' }),
    })

    await updatePromise

    const state = useAuthStore.getState()
    expect(state.profile?.display_ball).toBe('quick-ball')
    expect(state.displayBallSync.inFlight).toBe(false)
    expect(state.displayBallSync.pendingBallId).toBeNull()

    const cached = JSON.parse(localStorage.getItem('wurmple_user_cache') ?? '{}')
    expect(cached.profile?.display_ball).toBe('quick-ball')
  })

  it('persists tier prompt dismissal and caches the profile flag', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tier_prompt_dismissed_forever: true }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await useAuthStore.getState().dismissTierPromptForever()
    expect(result.error).toBeNull()
    expect(useAuthStore.getState().profile?.tier_prompt_dismissed_forever).toBe(true)

    const cached = JSON.parse(localStorage.getItem('wurmple_user_cache') ?? '{}')
    expect(cached.profile?.tier_prompt_dismissed_forever).toBe(true)
  })
})

describe('authStore stats hydration', () => {
  const session = { access_token: 'token-1', user: { id: 'user-1' } } as any
  const profile = {
    id: 'user-1',
    username: 'Ash',
    avatar_config: {},
    display_ball: 'poke-ball',
  }

  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    localStorage.clear()
    useAuthStore.setState({
      user: null,
      session: null,
      profile: null,
      stats: null,
      displayBallSync: {
        inFlight: false,
        pendingBallId: null,
        requestId: 0,
      },
      isLoading: false,
      isGuest: true,
      pendingPasswordRecovery: false,
      pendingEmail: null,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('hydrates stats during initialize when a session already exists', async () => {
    const authAny = supabase.auth as any
    authAny.getSession = vi.fn().mockResolvedValue({ data: { session } })
    authAny.onAuthStateChange = vi.fn()
    ;(supabase as any).from = vi.fn().mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: profile }),
        }),
      }),
    })

    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        profile,
        stats: { current_streak: 7 },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await useAuthStore.getState().initialize()

    await vi.waitFor(() => {
      expect(useAuthStore.getState().stats?.current_streak).toBe(7)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('hydrates stats after auth state change without needing profile page', async () => {
    const authAny = supabase.auth as any
    let authCallback: any = null

    authAny.getSession = vi.fn().mockResolvedValue({ data: { session: null } })
    authAny.onAuthStateChange = vi.fn((cb: any) => {
      authCallback = cb
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    })
    ;(supabase as any).from = vi.fn().mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: profile }),
        }),
      }),
    })

    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        profile,
        stats: { current_streak: 4 },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await useAuthStore.getState().initialize()
    if (!authCallback) {
      throw new Error('Expected auth state callback to be registered')
    }
    await authCallback('SIGNED_IN', session)

    await vi.waitFor(() => {
      expect(useAuthStore.getState().stats?.current_streak).toBe(4)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('dedupes concurrent fetchMe requests for the same session token', async () => {
    useAuthStore.setState({
      user: { id: 'user-1' } as any,
      session,
      profile,
      stats: null,
      isGuest: false,
    })

    const fetchDeferred = deferred<any>()
    const fetchMock = vi.fn().mockImplementation(() => fetchDeferred.promise)
    vi.stubGlobal('fetch', fetchMock)

    const first = useAuthStore.getState().fetchMe()
    const second = useAuthStore.getState().fetchMe()

    expect(fetchMock).toHaveBeenCalledTimes(1)

    fetchDeferred.resolve({
      status: 200,
      ok: true,
      json: async () => ({
        profile,
        stats: { current_streak: 9 },
      }),
    })

    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(firstResult.error).toBeNull()
    expect(secondResult.error).toBeNull()
    expect(useAuthStore.getState().stats?.current_streak).toBe(9)
  })
})

describe('authStore cache lifecycle', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('retains cached user cache when initialize runs without a session', async () => {
    localStorage.setItem('wurmple_user_cache', JSON.stringify({
      userId: 'stale-user',
      profile: { username: 'Stale' },
      stats: { current_streak: 99 },
    }))

    const authAny = supabase.auth as any
    authAny.getSession = vi.fn().mockResolvedValue({ data: { session: null } })
    authAny.onAuthStateChange = vi.fn(() => ({
      data: { subscription: { unsubscribe: vi.fn() } },
    }))

    await useAuthStore.getState().initialize()

    expect(localStorage.getItem('wurmple_user_cache')).not.toBeNull()
  })

  it('writes updated profile cache after avatar update', async () => {
    useAuthStore.setState({
      user: { id: 'user-1' } as any,
      session: { access_token: 'token-1', user: { id: 'user-1' } } as any,
      profile: {
        id: 'user-1',
        username: 'Ash',
        avatar_config: { avatar_pokemon_id: 1, avatar_is_shiny: false },
        display_ball: 'poke-ball',
      },
      stats: { current_streak: 5 } as any,
      isGuest: false,
      isLoading: false,
    } as any)

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        avatar_config: { avatar_pokemon_id: 25, avatar_is_shiny: true },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await useAuthStore.getState().updateAvatar({
      avatar_pokemon_id: 25,
      avatar_is_shiny: true,
    })

    expect(result.error).toBeNull()
    const cached = JSON.parse(localStorage.getItem('wurmple_user_cache') ?? '{}')
    expect(cached.userId).toBe('user-1')
    expect(cached.profile?.avatar_config?.avatar_pokemon_id).toBe(25)
    expect(cached.profile?.avatar_config?.avatar_is_shiny).toBe(true)
  })

  it('clears user cache on explicit sign-out', async () => {
    localStorage.setItem('wurmple_user_cache', JSON.stringify({
      userId: 'user-1',
      profile: { username: 'Ash' },
      stats: { current_streak: 7 },
    }))

    useAuthStore.setState({
      user: { id: 'user-1' } as any,
      session: { access_token: 'token-1', user: { id: 'user-1' } } as any,
      profile: {
        id: 'user-1',
        username: 'Ash',
        avatar_config: {},
        display_ball: 'poke-ball',
      },
      stats: null,
      isGuest: false,
      isLoading: false,
    } as any)
    useGameStore.setState({
      guesses: ['pikachu', 'bulbasaur'],
      gameStatus: 'won',
      sessionVersion: 3,
      puzzleDateKey: '2026-04-28',
      staleLock: true,
      rejectedGuess: 'pikachu',
    } as any)

    const authAny = supabase.auth as any
    authAny.signOut = vi.fn().mockResolvedValue(undefined)

    await useAuthStore.getState().signOut()

    expect(localStorage.getItem('wurmple_user_cache')).toBeNull()
    const gameState = useGameStore.getState()
    expect(gameState.guesses).toEqual([])
    expect(gameState.gameStatus).toBe('playing')
    expect(gameState.sessionVersion).toBeNull()
    expect(gameState.puzzleDateKey).toBeNull()
    expect(gameState.staleLock).toBe(false)
    expect(gameState.rejectedGuess).toBeNull()
  })
})
