import React, { useState, useEffect } from 'react'
import { useAuthStore, BALL_NAMES } from '../store/authStore'

interface CollectionPageProps {
  onBack: () => void
}

interface BallEntry {
  id: string
  display_name: string
  category: 'standard' | 'achievement'
  status: 'past_tier' | 'current_tier' | 'future_tier' | 'unlocked' | 'locked'
  hint: string | null
}

interface BallsResponse {
  current_streak_tier: string
  display_ball: string
  balls: BallEntry[]
}

const SPRITE_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items'
const STANDARD_ORDER = ['poke-ball', 'great-ball', 'ultra-ball', 'master-ball']

const GUEST_STANDARD: BallEntry[] = STANDARD_ORDER.map(id => ({
  id,
  display_name: BALL_NAMES[id],
  category: 'standard',
  status: 'locked',
  hint: null,
}))

const GUEST_ACHIEVEMENT: BallEntry[] = [
  { id: 'quick-ball',  display_name: 'Quick Ball',  category: 'achievement', status: 'locked', hint: 'Solve a puzzle in 1 or 2 guesses' },
  { id: 'timer-ball',  display_name: 'Timer Ball',  category: 'achievement', status: 'locked', hint: 'Win on your very last guess (10th)' },
  { id: 'luxury-ball', display_name: 'Luxury Ball', category: 'achievement', status: 'locked', hint: 'Build a 7-day participation streak' },
  { id: 'net-ball',    display_name: 'Net Ball',    category: 'achievement', status: 'locked', hint: 'Participate on 10 Water or Bug-type days' },
  { id: 'heal-ball',   display_name: 'Heal Ball',   category: 'achievement', status: 'locked', hint: 'Win 3 times in a row after a loss' },
]

function isSelectable(ball: BallEntry): boolean {
  return ball.status === 'current_tier' || ball.status === 'past_tier' || ball.status === 'unlocked'
}

const CollectionPage: React.FC<CollectionPageProps> = ({ onBack }) => {
  const session = useAuthStore(state => state.session)
  const profile = useAuthStore(state => state.profile)
  const isGuest = useAuthStore(state => state.isGuest)
  const updateDisplayBall = useAuthStore(state => state.updateDisplayBall)

  const [ballData, setBallData] = useState<BallsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedBall, setSelectedBall] = useState<string | null>(null)
  const [settingBall, setSettingBall] = useState(false)

  useEffect(() => {
    if (isGuest) { setLoading(false); return }

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
    fetch(`${supabaseUrl}/functions/v1/get-balls`, {
      headers: { 'Authorization': `Bearer ${session!.access_token}` },
    })
      .then(r => r.json())
      .then(data => { setBallData(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [isGuest, session])

  async function handleSetBall(ballId: string) {
    setSettingBall(true)
    await updateDisplayBall(ballId)
    setSettingBall(false)
    setSelectedBall(null)
  }

  const standardBalls: BallEntry[] = isGuest
    ? GUEST_STANDARD
    : (ballData?.balls.filter(b => b.category === 'standard') ?? [])

  const achievementBalls: BallEntry[] = isGuest
    ? GUEST_ACHIEVEMENT
    : (ballData?.balls.filter(b => b.category === 'achievement') ?? [])

  const currentDisplayBall = profile?.display_ball ?? 'poke-ball'
  const currentTierIdx = STANDARD_ORDER.indexOf(ballData?.current_streak_tier ?? 'poke-ball')

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-pokemon-red transition-colors mb-6"
      >
        ← Back to Game
      </button>

      <h2 className="text-2xl font-bold text-gray-800 mb-1">Ball Collection</h2>
      <p className="text-sm text-gray-500 mb-6">Earn balls by playing and achieving milestones.</p>

      {isGuest && (
        <div className="mb-6 bg-blue-50 border border-blue-200 rounded-xl p-4 text-center text-sm text-blue-700 font-medium">
          Sign in to track your progress and unlock balls
        </div>
      )}

      {loading ? (
        <div className="animate-pulse space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <div className="flex items-center gap-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <div className="w-14 h-14 rounded-full bg-gray-200" />
                  <div className="w-10 h-3 bg-gray-200 rounded" />
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-32 bg-gray-100 rounded-xl" />
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* Standard tier track */}
          <section className="mb-8">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Streak Tier</h3>
            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 flex-wrap">
                {standardBalls.map((ball, i) => {
                  const isPast = ball.status === 'past_tier'
                  const isCurrent = ball.status === 'current_tier'
                  const isFuture = ball.status === 'future_tier' || ball.status === 'locked'
                  const isSelected = selectedBall === ball.id
                  const isDisplay = currentDisplayBall === ball.id
                  const canSelect = !isGuest && isSelectable(ball)

                  return (
                    <React.Fragment key={ball.id}>
                      <div className="flex flex-col items-center gap-1">
                        <button
                          disabled={!canSelect}
                          onClick={() => canSelect && setSelectedBall(isSelected ? null : ball.id)}
                          className={`w-14 h-14 rounded-full border-4 flex items-center justify-center transition-all ${
                            isCurrent
                              ? 'border-pokemon-red bg-red-50 shadow-lg shadow-red-200 scale-110'
                              : isPast
                              ? 'border-green-400 bg-green-50'
                              : 'border-gray-200 bg-gray-100 opacity-50'
                          } ${isSelected ? 'ring-2 ring-offset-1 ring-pokemon-blue' : ''} ${canSelect ? 'cursor-pointer hover:scale-105' : 'cursor-default'}`}
                        >
                          {isFuture ? (
                            <span className="text-gray-400 text-lg">?</span>
                          ) : (
                            <img src={`${SPRITE_BASE}/${ball.id}.png`} alt={ball.display_name} className="w-8 h-8 object-contain" loading="lazy" decoding="async" width={32} height={32} />
                          )}
                        </button>
                        <span className={`text-xs text-center leading-tight max-w-[56px] ${isFuture ? 'text-gray-400' : 'text-gray-700'}`}>
                          {ball.display_name}
                        </span>
                        {isDisplay && !isFuture && (
                          <span className="text-xs text-pokemon-red font-semibold">Active</span>
                        )}
                        {isSelected && ball.id !== currentDisplayBall && (
                          <button
                            disabled={settingBall}
                            onClick={() => handleSetBall(ball.id)}
                            className="text-xs bg-pokemon-red text-white px-2 py-0.5 rounded-full font-semibold hover:bg-red-700 transition-colors disabled:opacity-60"
                          >
                            {settingBall ? '…' : 'Set'}
                          </button>
                        )}
                      </div>
                      {i < standardBalls.length - 1 && (
                        <div className={`h-0.5 w-5 flex-shrink-0 ${i < currentTierIdx ? 'bg-green-400' : 'bg-gray-200'}`} />
                      )}
                    </React.Fragment>
                  )
                })}
              </div>
              <p className="text-xs text-gray-400 mt-3">Maintain your win streak to climb the tiers.</p>
            </div>
          </section>

          {/* Achievement balls */}
          <section>
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Achievement Balls</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {achievementBalls.map(ball => {
                const isUnlocked = ball.status === 'unlocked'
                const isSelected = selectedBall === ball.id
                const isDisplay = currentDisplayBall === ball.id
                const canSelect = !isGuest && isUnlocked

                return (
                  <button
                    key={ball.id}
                    disabled={!canSelect}
                    onClick={() => canSelect && setSelectedBall(isSelected ? null : ball.id)}
                    className={`border-2 rounded-xl p-4 flex flex-col items-center gap-2 transition-all text-left ${
                      isUnlocked
                        ? 'border-gray-200 bg-white hover:border-pokemon-blue cursor-pointer'
                        : 'border-gray-200 bg-gray-50 opacity-75 cursor-default'
                    } ${isSelected ? 'border-pokemon-blue ring-1 ring-pokemon-blue' : ''}`}
                  >
                    {isUnlocked ? (
                      <img src={`${SPRITE_BASE}/${ball.id}.png`} alt={ball.display_name} className="w-12 h-12 object-contain" loading="lazy" decoding="async" width={48} height={48} />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-gray-300 border-2 border-gray-400 flex items-center justify-center">
                        <span className="text-gray-500 text-lg">?</span>
                      </div>
                    )}
                    <span className={`text-sm font-semibold text-center ${isUnlocked ? 'text-gray-800' : 'text-gray-400'}`}>
                      {ball.display_name}
                    </span>
                    {isDisplay && (
                      <span className="text-xs text-pokemon-red font-semibold">Active</span>
                    )}
                    {isSelected && ball.id !== currentDisplayBall && (
                      <button
                        disabled={settingBall}
                        onClick={e => { e.stopPropagation(); handleSetBall(ball.id) }}
                        className="text-xs bg-pokemon-red text-white px-3 py-0.5 rounded-full font-semibold hover:bg-red-700 transition-colors disabled:opacity-60 w-full text-center"
                      >
                        {settingBall ? '…' : 'Set as display badge'}
                      </button>
                    )}
                    {!isUnlocked && ball.hint && (
                      <p className="text-xs text-gray-400 text-center leading-snug">{ball.hint}</p>
                    )}
                  </button>
                )
              })}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

export default CollectionPage
