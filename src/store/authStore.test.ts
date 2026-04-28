import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from './authStore'

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
})
