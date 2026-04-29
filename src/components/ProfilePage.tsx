import React, { useState, useEffect } from 'react'
import { useAuthStore, BALL_NAMES } from '../store/authStore'
import { getAvatarUrl } from '../utils/avatarUtils'
import DefaultAvatar from './DefaultAvatar'
import AvatarPicker from './AvatarPicker'

interface ProfilePageProps {
  onBack: () => void
  onTierUpgradeAvailable?: (tierId: string, tierName: string) => void
}

const SPRITE_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items'

const ProfilePage: React.FC<ProfilePageProps> = ({ onBack }) => {
  const profile = useAuthStore(state => state.profile)
  const stats = useAuthStore(state => state.stats)
  const isGuest = useAuthStore(state => state.isGuest)
  const fetchMe = useAuthStore(state => state.fetchMe)

  const [isInitialLoading, setIsInitialLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPicker, setShowPicker] = useState(false)

  const refreshProfile = () => {
    const hasCachedData = Boolean(profile || stats)
    setError(null)
    setIsInitialLoading(!hasCachedData)
    setIsRefreshing(hasCachedData)
    return fetchMe().then(({ error }) => {
      setError(error)
      setIsInitialLoading(false)
      setIsRefreshing(false)
    })
  }

  useEffect(() => {
    if (isGuest) return
    void refreshProfile()
    // fetchMe is stable from Zustand; mount-time refresh is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest, fetchMe])

  const avatarUrl = profile?.avatar_config ? getAvatarUrl(profile.avatar_config) : null
  const displayBall = profile?.display_ball ?? 'poke-ball'
  const ballName = BALL_NAMES[displayBall] ?? displayBall

  const winPct = stats ? Math.round(stats.win_rate * 100) : 0
  const totalLosses = stats ? stats.total_participations - stats.total_wins : 0

  return (
    <div className="max-w-sm mx-auto py-6">
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6 transition-colors"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Back to Game
      </button>

      <div className="bg-white rounded-xl shadow p-6">
        {/* Avatar + username */}
        <div className="flex flex-col items-center gap-3 mb-6">
          {avatarUrl ? (
            <img src={avatarUrl} alt="avatar" className="w-24 h-24 rounded-xl border-2 border-gray-100 shadow-sm" loading="lazy" decoding="async" width={96} height={96} />
          ) : (
            <DefaultAvatar size={96} />
          )}
          <div className="text-center">
            <p className="text-xl font-bold text-gray-900">{profile?.username ?? '—'}</p>
            <div className="flex items-center justify-center gap-1 mt-1">
              <img
                src={`${SPRITE_BASE}/${displayBall}.png`}
                alt={ballName}
                className="w-4 h-4 object-contain"
                loading="lazy"
                decoding="async"
                width={16}
                height={16}
              />
              <p className="text-xs text-gray-500 font-medium">{ballName}</p>
            </div>
          </div>
          <button
            onClick={() => setShowPicker(true)}
            className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold px-3 py-1.5 rounded-full transition-colors"
          >
            Change Avatar
          </button>
        </div>

        {/* Stats section */}
        {isGuest ? (
          <div className="text-center py-6 bg-gray-50 rounded-xl">
            <p className="text-sm font-semibold text-gray-700 mb-0.5">Sign in to track your stats</p>
            <p className="text-xs text-gray-400">Win streaks, guesses, and more</p>
          </div>
        ) : isInitialLoading ? (
          <div className="animate-pulse space-y-2">
            <div className="grid grid-cols-4 gap-2">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-12 bg-gray-100 rounded-lg" />
              ))}
            </div>
            <div className="h-8 bg-gray-100 rounded-lg" />
          </div>
        ) : (
          <>
            {error && (
              <div className="text-center py-4">
                <p className="text-sm text-gray-500 mb-2">Could not load profile</p>
                <button
                  onClick={() => {
                    void refreshProfile()
                  }}
                  className="text-xs text-pokemon-red font-semibold hover:underline"
                >
                  Retry
                </button>
              </div>
            )}

            {stats ? (
              <>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-gray-900">{stats.current_streak}</p>
                    <p className="text-xs text-gray-500 mt-0.5">Current Streak</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-gray-900">{stats.max_streak}</p>
                    <p className="text-xs text-gray-500 mt-0.5">Best Streak</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-gray-900">{winPct}%</p>
                    <p className="text-xs text-gray-500 mt-0.5">Win Rate</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-gray-900">{stats.avg_guesses > 0 ? stats.avg_guesses.toFixed(1) : '—'}</p>
                    <p className="text-xs text-gray-500 mt-0.5">Avg Guesses</p>
                  </div>
                </div>
                <div className="bg-gray-50 rounded-xl px-3 py-2.5 text-xs text-gray-500 text-center font-medium">
                  {stats.total_participations} played · {stats.total_wins}W · {totalLosses}L
                </div>
              </>
            ) : null}

            {isRefreshing && (
              <p className="text-center text-xs text-gray-400 mt-3">Refreshing profile...</p>
            )}
          </>
        )}
      </div>

      {showPicker && <AvatarPicker onClose={() => setShowPicker(false)} />}
    </div>
  )
}

export default ProfilePage
