import { beforeEach, describe, expect, it } from 'vitest'
import {
  migrateLegacyUserCache,
  readProfileCache,
  writeCachedAvatar,
  writeProfileCache,
} from './profileCache'
import { readBootProfile } from '../store/authStore'
import { clearStoredSession, writeStoredSession } from './api'

const profile = (id: string) => ({
  id,
  username: `Trainer ${id}`,
  avatar_config: {},
  display_ball: 'heal-ball',
})

function index() {
  return JSON.parse(localStorage.getItem('wurmple_profile_cache_index') ?? '[]')
}

describe('profile LRU cache', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('keeps the 3 most recent users and evicts the oldest with its balls cache', () => {
    for (const id of ['a', 'b', 'c']) {
      writeProfileCache(id, profile(id), null)
      localStorage.setItem(`wurmple_balls_cache:${id}`, '{}')
    }
    expect(index()).toEqual(['c', 'b', 'a'])

    writeProfileCache('d', profile('d'), null)

    expect(index()).toEqual(['d', 'c', 'b'])
    expect(readProfileCache('a')).toBeNull()
    expect(localStorage.getItem('wurmple_balls_cache:a')).toBeNull()
    expect(readProfileCache('b')?.profile?.username).toBe('Trainer b')
    expect(localStorage.getItem('wurmple_balls_cache:b')).toBe('{}')
  })

  it('moves a re-written user to the front without duplicating', () => {
    writeProfileCache('a', profile('a'), null)
    writeProfileCache('b', profile('b'), null)
    writeProfileCache('a', profile('a'), null)
    expect(index()).toEqual(['a', 'b'])
  })

  it('preserves the cached avatar when profile data is rewritten', () => {
    writeProfileCache('a', profile('a'), null)
    writeCachedAvatar('a', 'https://img/25.png', 'data:image/png;base64,AAA')
    writeProfileCache('a', profile('a'), { current_streak: 2 } as any)

    const entry = readProfileCache('a')
    expect(entry?.avatarSrc).toBe('https://img/25.png')
    expect(entry?.avatarDataUrl).toBe('data:image/png;base64,AAA')
    expect(entry?.stats?.current_streak).toBe(2)
  })

  it('migrates the legacy single-user cache once and deletes it', () => {
    localStorage.setItem('wurmple_user_cache', JSON.stringify({
      userId: 'old',
      profile: profile('old'),
      stats: { current_streak: 4 },
    }))

    migrateLegacyUserCache()

    expect(localStorage.getItem('wurmple_user_cache')).toBeNull()
    expect(readProfileCache('old')?.stats?.current_streak).toBe(4)
    expect(index()).toEqual(['old'])
  })

  it('stores no tokens or emails', () => {
    writeProfileCache('a', profile('a'), null)
    const raw = localStorage.getItem('wurmple_profile_cache:a') ?? ''
    expect(raw).not.toMatch(/token|email/i)
  })
})

describe('readBootProfile', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  function persistSession(userId: string) {
    writeStoredSession({ access_token: 'x', user: { id: userId, email: `${userId}@example.com`, email_confirmed_at: null } })
  }

  it('returns cached display data for the persisted session user', () => {
    writeProfileCache('u1', profile('u1'), { current_streak: 2 } as any)
    persistSession('u1')

    const boot = readBootProfile()
    expect(boot?.userId).toBe('u1')
    expect(boot?.profile.display_ball).toBe('heal-ball')
    expect(boot?.stats?.current_streak).toBe(2)
  })

  it('returns null after sign-out clears the session', () => {
    writeProfileCache('u1', profile('u1'), null)
    persistSession('u1')
    clearStoredSession()
    expect(readBootProfile()).toBeNull()
  })

  it('returns null when there is no persisted session', () => {
    writeProfileCache('u1', profile('u1'), null)
    expect(readBootProfile()).toBeNull()
  })

  it('returns null for a session user with no cached profile', () => {
    persistSession('someone-else')
    writeProfileCache('u1', profile('u1'), null)
    expect(readBootProfile()).toBeNull()
  })
})
