import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from './authStore'
import { useGameStore } from './gameStore'

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
    vi.stubEnv('VITE_API_URL', 'https://api.example.test')
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

    const cached = JSON.parse(localStorage.getItem('wurmple_profile_cache:user-1') ?? '{}')
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

    const cached = JSON.parse(localStorage.getItem('wurmple_profile_cache:user-1') ?? '{}')
    expect(cached.profile?.tier_prompt_dismissed_forever).toBe(true)
  })
})

const API = 'https://api.example.test'
const USER = { id: 'user-1', email: 'ash@example.com', email_confirmed_at: '2026-10-01T00:00:00.000Z' }
const PROFILE = { id: 'user-1', username: 'Ash', avatar_config: {}, display_ball: 'poke-ball', tier_prompt_dismissed_forever: false, created_at: '2020-01-01T00:00:00.000Z' }
const STATS = { current_streak: 3, max_streak: 5, total_participations: 10, total_wins: 7, win_rate: 0.7, avg_guesses: 4, participation_streak: 3, max_participation_streak: 6, total_losses: 3, guess_distribution: {}, best_guess_summary: null }

type Reply = { status: number; body?: unknown }
type Route = (init: RequestInit | undefined) => Reply | Promise<Reply>

/** fetch stub keyed by API path; records every call. */
function mockApi(routes: Record<string, Route>) {
  const calls: Array<{ path: string; init?: RequestInit }> = []
  const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const path = String(url).replace(API, '').split('?')[0]
    calls.push({ path, init })
    const route = routes[path]
    if (!route) return { ok: true, status: 200, json: async () => ({}) }
    const { status, body } = await route(init)
    return { ok: status >= 200 && status < 300, status, json: async () => body ?? {} }
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

const meRoute: Route = () => ({ status: 200, body: { user: USER, profile: PROFILE, stats: STATS } })
const authHeader = (init?: RequestInit) => (init?.headers as Record<string, string> | undefined)?.Authorization

function resetAuthState() {
  useAuthStore.setState({
    user: null,
    session: null,
    profile: null,
    stats: null,
    hasResolvedProfile: false,
    isProfileHydrating: false,
    isLoading: true,
    isGuest: true,
    pendingPasswordRecovery: false,
    pendingEmail: null,
    bootProfile: null,
    cachedAvatar: null,
    authNotice: null,
  })
}

function stubGame() {
  const game = useGameStore.getState()
  vi.spyOn(game, 'initializeGame').mockResolvedValue(undefined as any)
  vi.spyOn(game, 'loadGuestServerSession').mockResolvedValue(undefined as any)
  vi.spyOn(game, 'hasGuestProgress').mockReturnValue(false)
}

function storeSession(token = 'tok-1') {
  localStorage.setItem('wurmple_auth', JSON.stringify({ token, user: USER }))
}

describe('authStore session lifecycle', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', API)
    localStorage.clear()
    window.history.replaceState({}, '', '/')
    resetAuthState()
    stubGame()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('restores the stored session and hydrates profile and stats from get-me', async () => {
    storeSession()
    const calls = mockApi({ '/v1/get-me': meRoute })

    await useAuthStore.getState().initialize()

    const state = useAuthStore.getState()
    expect(state.isGuest).toBe(false)
    expect(state.session?.access_token).toBe('tok-1')
    expect(state.profile?.username).toBe('Ash')
    expect(state.stats?.current_streak).toBe(3)
    expect(state.hasResolvedProfile).toBe(true)
    expect(authHeader(calls[0].init)).toBe('Bearer tok-1')
    expect(JSON.parse(localStorage.getItem('wurmple_profile_cache:user-1') ?? '{}').stats?.current_streak).toBe(3)
  })

  it('stays a guest without a stored session and keeps the profile cache', async () => {
    localStorage.setItem('wurmple_profile_cache:user-1', JSON.stringify({ profile: PROFILE, stats: null, updatedAt: 1 }))
    const calls = mockApi({})
    await useAuthStore.getState().initialize()
    expect(useAuthStore.getState().isGuest).toBe(true)
    expect(useAuthStore.getState().isLoading).toBe(false)
    expect(calls).toHaveLength(0)
    expect(localStorage.getItem('wurmple_profile_cache:user-1')).not.toBeNull()
  })

  it('drops a revoked stored session back to guest', async () => {
    storeSession('dead')
    mockApi({ '/v1/get-me': () => ({ status: 401, body: { error: 'Invalid token' } }) })
    await useAuthStore.getState().initialize()
    expect(useAuthStore.getState().isGuest).toBe(true)
    expect(localStorage.getItem('wurmple_auth')).toBeNull()
  })

  it('signs in with email and password and stores the token', async () => {
    const calls = mockApi({
      '/v1/auth/login': () => ({ status: 200, body: { token: 'tok-2', user: USER } }),
      '/v1/get-me': meRoute,
    })
    const result = await useAuthStore.getState().signIn('ash@example.com', 'pikachu123')
    expect(result.error).toBeNull()
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ email: 'ash@example.com', password: 'pikachu123' })
    expect(useAuthStore.getState().profile?.username).toBe('Ash')
    expect(JSON.parse(localStorage.getItem('wurmple_auth') ?? '{}').token).toBe('tok-2')
  })

  it('reports unconfirmed email on sign-in and remembers it for resend', async () => {
    const calls = mockApi({
      '/v1/auth/login': () => ({ status: 403, body: { error: 'Email not confirmed', code: 'email_not_verified' } }),
      '/v1/auth/resend': () => ({ status: 200, body: { ok: true } }),
    })
    const result = await useAuthStore.getState().signIn('ash@example.com', 'pikachu123')
    expect(result.error).toMatch(/confirm your email/i)
    expect(useAuthStore.getState().isGuest).toBe(true)
    expect((await useAuthStore.getState().resendVerification()).error).toBeNull()
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ email: 'ash@example.com' })
  })

  it('discards a sign-in that finishes after the modal timed out', async () => {
    let release!: (v: Reply) => void
    const calls = mockApi({
      '/v1/auth/login': () => new Promise<Reply>(r => { release = r }),
      '/v1/auth/logout': () => ({ status: 200 }),
    })
    const pending = useAuthStore.getState().signIn('ash@example.com', 'pikachu123')
    await Promise.resolve()
    await useAuthStore.getState().markSignInTimedOut()
    release({ status: 200, body: { token: 'late', user: USER } })
    await pending
    await new Promise(r => setTimeout(r, 0))
    expect(useAuthStore.getState().isGuest).toBe(true)
    expect(localStorage.getItem('wurmple_auth')).toBeNull()
    // The late token is revoked on the server.
    const logout = calls.find(c => c.path === '/v1/auth/logout')
    expect(authHeader(logout?.init)).toBe('Bearer late')
  })

  it('signs up without creating a session and remembers the email', async () => {
    const calls = mockApi({ '/v1/auth/signup': () => ({ status: 200, body: { ok: true } }) })
    const result = await useAuthStore.getState().signUp('new@example.com', 'longenough', 'Misty')
    expect(result.error).toBeNull()
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ email: 'new@example.com', password: 'longenough', username: 'Misty' })
    expect(useAuthStore.getState().pendingEmail).toBe('new@example.com')
    expect(useAuthStore.getState().isGuest).toBe(true)
  })

  it('passes signup errors through', async () => {
    mockApi({ '/v1/auth/signup': () => ({ status: 409, body: { error: 'That Trainer name is already taken' } }) })
    expect((await useAuthStore.getState().signUp('a@b.co', 'longenough', 'Ash')).error).toBe('That Trainer name is already taken')
  })

  it('signs in from a ?verify= link and strips it from the URL', async () => {
    window.history.replaceState({}, '', '/?verify=verify-token-123&x=1')
    const calls = mockApi({
      '/v1/auth/verify': () => ({ status: 200, body: { token: 'tok-v', user: USER } }),
      '/v1/get-me': meRoute,
    })
    await useAuthStore.getState().initialize()
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ token: 'verify-token-123' })
    expect(useAuthStore.getState().session?.access_token).toBe('tok-v')
    expect(window.location.search).toBe('?x=1')
  })

  it('shows a notice for an expired ?verify= link', async () => {
    window.history.replaceState({}, '', '/?verify=old')
    mockApi({ '/v1/auth/verify': () => ({ status: 400, body: { code: 'invalid_token' } }) })
    await useAuthStore.getState().initialize()
    expect(useAuthStore.getState().isGuest).toBe(true)
    expect(useAuthStore.getState().authNotice).toMatch(/invalid or has expired/)
  })

  it('completes Google sign-in from a ?login= code', async () => {
    window.history.replaceState({}, '', '/?login=one-time-code')
    const calls = mockApi({
      '/v1/auth/google/exchange': () => ({ status: 200, body: { token: 'tok-g', user: USER } }),
      '/v1/get-me': () => ({ status: 200, body: { user: USER, profile: null, stats: STATS } }),
    })
    await useAuthStore.getState().initialize()
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ token: 'one-time-code' })
    const state = useAuthStore.getState()
    expect(state.session?.access_token).toBe('tok-g')
    // No Trainer name yet: the setup modal takes over.
    expect(state.profile).toBeNull()
    expect(state.hasResolvedProfile).toBe(true)
    expect(window.location.search).toBe('')
  })

  it('shows a notice when Google sign-in fails', async () => {
    window.history.replaceState({}, '', '/?auth_error=google')
    mockApi({})
    await useAuthStore.getState().initialize()
    expect(useAuthStore.getState().authNotice).toMatch(/Google/)
  })

  it('starts Google sign-in at the API with the site origin', async () => {
    const assign = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ origin: 'http://localhost:5173', assign } as any)
    await useAuthStore.getState().signInWithGoogle()
    expect(assign).toHaveBeenCalledWith(`${API}/v1/auth/google/start?origin=${encodeURIComponent('http://localhost:5173')}`)
  })

  it('resets the password from a ?reset= link and signs in', async () => {
    window.history.replaceState({}, '', '/?reset=reset-token-1')
    const calls = mockApi({
      '/v1/auth/reset': () => ({ status: 200, body: { token: 'tok-r', user: USER } }),
      '/v1/get-me': meRoute,
    })
    await useAuthStore.getState().initialize()
    expect(useAuthStore.getState().pendingPasswordRecovery).toBe(true)
    expect(useAuthStore.getState().isGuest).toBe(true)

    const result = await useAuthStore.getState().confirmPasswordReset('new-password')
    expect(result.error).toBeNull()
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ token: 'reset-token-1', password: 'new-password' })
    expect(useAuthStore.getState().pendingPasswordRecovery).toBe(false)
    expect(useAuthStore.getState().session?.access_token).toBe('tok-r')
  })

  it('surfaces an expired reset link', async () => {
    window.history.replaceState({}, '', '/?reset=expired')
    mockApi({ '/v1/auth/reset': () => ({ status: 400, body: { error: 'Password reset link is invalid or expired.' } }) })
    await useAuthStore.getState().initialize()
    expect((await useAuthStore.getState().confirmPasswordReset('new-password')).error).toMatch(/invalid or expired/)
  })

  it('dedupes concurrent fetchMe requests for the same session token', async () => {
    storeSession()
    mockApi({ '/v1/get-me': meRoute })
    await useAuthStore.getState().initialize()
    const calls = mockApi({ '/v1/get-me': meRoute })
    await Promise.all([useAuthStore.getState().fetchMe(), useAuthStore.getState().fetchMe()])
    expect(calls).toHaveLength(1)
  })

  it('creates the profile from the setup modal and reloads it', async () => {
    storeSession()
    mockApi({ '/v1/get-me': () => ({ status: 200, body: { user: USER, profile: null, stats: STATS } }) })
    await useAuthStore.getState().initialize()
    const calls = mockApi({ '/v1/create-profile': () => ({ status: 200, body: { ok: true } }), '/v1/get-me': meRoute })
    expect((await useAuthStore.getState().setupUsername('Ash')).error).toBeNull()
    expect(calls.map(c => c.path)).toEqual(['/v1/create-profile', '/v1/get-me'])
    expect(useAuthStore.getState().profile?.username).toBe('Ash')
  })

  it('signs out: revokes the token, clears the session, keeps the profile cache', async () => {
    storeSession()
    mockApi({ '/v1/get-me': meRoute })
    await useAuthStore.getState().initialize()
    const calls = mockApi({ '/v1/auth/logout': () => ({ status: 200 }) })

    await useAuthStore.getState().signOut()

    const state = useAuthStore.getState()
    expect(state.isGuest).toBe(true)
    expect(state.session).toBeNull()
    expect(state.profile).toBeNull()
    expect(localStorage.getItem('wurmple_auth')).toBeNull()
    expect(localStorage.getItem('wurmple_profile_cache:user-1')).not.toBeNull()
    expect(authHeader(calls[0].init)).toBe('Bearer tok-1')
  })

  it('writes updated profile cache after avatar update', async () => {
    storeSession()
    mockApi({ '/v1/get-me': meRoute })
    await useAuthStore.getState().initialize()
    mockApi({ '/v1/update-profile': () => ({ status: 200, body: { avatar_config: { avatar_mode: 'pokemon', avatar_pokemon_id: 25 } } }) })
    expect((await useAuthStore.getState().updateAvatar({ avatar_mode: 'pokemon', avatar_pokemon_id: 25 })).error).toBeNull()
    const cached = JSON.parse(localStorage.getItem('wurmple_profile_cache:user-1') ?? '{}')
    expect(cached.profile.avatar_config.avatar_pokemon_id).toBe(25)
  })
})
