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
const TIER_ORDER = ['poke-ball', 'great-ball', 'ultra-ball', 'master-ball']

function getStreakTier(streak: number): string {
  if (streak >= 14) return 'master-ball'
  if (streak >= 7) return 'ultra-ball'
  if (streak >= 3) return 'great-ball'
  return 'poke-ball'
}

const ProfilePage: React.FC<ProfilePageProps> = ({ onBack, onTierUpgradeAvailable }) => {
  const profile = useAuthStore(state => state.profile)
  const stats = useAuthStore(state => state.stats)
  const isGuest = useAuthStore(state => state.isGuest)
  const fetchMe = useAuthStore(state => state.fetchMe)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPicker, setShowPicker] = useState(false)

  useEffect(() => {
    if (isGuest || stats !== null) return
    setLoading(true)
    fetchMe().then(({ error }) => {
      setError(error)
      setLoading(false)
    })
  }, [isGuest])

  useEffect(() => {
    if (isGuest || !stats || !profile) return
    const currentTier = getStreakTier(stats.current_streak)
    if (TIER_ORDER.indexOf(currentTier) > TIER_ORDER.indexOf(profile.display_ball)) {
      const dismissed = localStorage.getItem('tier_prompt_dismissed')
      if (dismissed !== currentTier) {
        onTierUpgradeAvailable?.(currentTier, BALL_NAMES[currentTier])
      }
    }
  }, [stats, profile, isGuest])

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
            <img src={avatarUrl} alt="avatar" className="w-16 h-16 rounded-lg" />
          ) : (
            <DefaultAvatar size={64} />
          )}
          <div className="text-center">
            <p className="text-lg font-bold text-gray-900">{profile?.username ?? '—'}</p>
            <div className="flex items-center justify-center gap-1 mt-0.5">
              <img
                src={`${SPRITE_BASE}/${displayBall}.png`}
                alt={ballName}
                className="w-4 h-4 object-contain"
              />
              <p className="text-xs text-gray-500">{ballName}</p>
            </div>
          </div>
          <button
            onClick={() => setShowPicker(true)}
            className="text-xs text-pokemon-red font-semibold hover:underline"
          >
            Change Avatar
          </button>
        </div>

        {/* Stats section */}
        {isGuest ? (
          <div className="text-center py-4 text-gray-400 text-sm">
            Sign in to track your stats
          </div>
        ) : loading ? (
          <div className="text-center py-4 text-gray-400 text-sm">Loading…</div>
        ) : error ? (
          <div className="text-center py-4">
            <p className="text-sm text-gray-500 mb-2">Could not load profile</p>
            <button
              onClick={() => {
                setError(null)
                setLoading(true)
                fetchMe().then(({ error }) => { setError(error); setLoading(false) })
              }}
              className="text-xs text-pokemon-red font-semibold hover:underline"
            >
              Retry
            </button>
          </div>
        ) : stats ? (
          <>
            <div className="grid grid-cols-4 gap-2 text-center mb-4">
              <div className="bg-gray-50 rounded-lg p-2">
                <p className="text-lg font-bold text-gray-900">{stats.current_streak}</p>
                <p className="text-xs text-gray-500 leading-tight mt-0.5">Streak</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2">
                <p className="text-lg font-bold text-gray-900">{stats.max_streak}</p>
                <p className="text-xs text-gray-500 leading-tight mt-0.5">Best</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2">
                <p className="text-lg font-bold text-gray-900">{winPct}%</p>
                <p className="text-xs text-gray-500 leading-tight mt-0.5">Win Rate</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2">
                <p className="text-lg font-bold text-gray-900">{stats.avg_guesses > 0 ? stats.avg_guesses.toFixed(1) : '—'}</p>
                <p className="text-xs text-gray-500 leading-tight mt-0.5">Avg</p>
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-500 text-center">
              {stats.total_participations} played · {stats.total_wins}W · {totalLosses}L
            </div>
          </>
        ) : null}
      </div>

      {showPicker && <AvatarPicker onClose={() => setShowPicker(false)} />}
    </div>
  )
}

export default ProfilePage
