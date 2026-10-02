import React, { useState, useEffect, useRef } from 'react'
import { useAuthStore, BALL_NAMES } from '../store/authStore'
import { isJsonEqual, readJsonCache, writeJsonCache } from '../lib/cache'
import { ballSpriteUrl } from '../lib/sprites'
import { BALLS_CACHE_PREFIX } from '../lib/profileCache'
import { TIER_THRESHOLDS, getStreakTier, nextTier } from '../logic/tierLogic'
import { ArrowLeft } from 'pixelarticons/react/ArrowLeft'

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

const STANDARD_ORDER = ['poke-ball', 'great-ball', 'ultra-ball', 'master-ball']

const GUEST_STANDARD: BallEntry[] = [
  { id: 'poke-ball',   display_name: BALL_NAMES['poke-ball'],   category: 'standard', status: 'current_tier', hint: null },
  { id: 'great-ball',  display_name: BALL_NAMES['great-ball'],  category: 'standard', status: 'future_tier',  hint: null },
  { id: 'ultra-ball',  display_name: BALL_NAMES['ultra-ball'],  category: 'standard', status: 'future_tier',  hint: null },
  { id: 'master-ball', display_name: BALL_NAMES['master-ball'], category: 'standard', status: 'future_tier',  hint: null },
]

const GUEST_ACHIEVEMENT: BallEntry[] = [
  { id: 'quick-ball',  display_name: 'Quick Ball',  category: 'achievement', status: 'locked', hint: 'Solve a puzzle in 1 or 2 guesses' },
  { id: 'timer-ball',  display_name: 'Timer Ball',  category: 'achievement', status: 'locked', hint: 'Win on your very last guess (10th)' },
  { id: 'luxury-ball', display_name: 'Luxury Ball', category: 'achievement', status: 'locked', hint: 'Build a 7-day participation streak' },
  { id: 'net-ball',    display_name: 'Net Ball',    category: 'achievement', status: 'locked', hint: 'Participate on 10 Water or Bug-type days' },
  { id: 'heal-ball',   display_name: 'Heal Ball',   category: 'achievement', status: 'locked', hint: 'Win 3 times in a row after a loss' },
]

const EquippedRibbon: React.FC = () => (
  <span className="equipped-ribbon" aria-hidden="true">★ Equipped</span>
)

// 11x7 pixel crown. g = gold, y = highlight, r = jewel, d = shaded band.
const CROWN_PIXELS = [
  'y....y....y',
  'g....g....g',
  'gg..ggg..gg',
  'ggggggggggg',
  'grgggrgggrg',
  'ggggggggggg',
  'ddddddddddd',
]

const CROWN_COLORS: Record<string, string> = {
  g: '#f8c000',
  y: '#fff3a0',
  r: '#e3242b',
  d: '#c88a00',
}

const CROWN_RECTS = CROWN_PIXELS.flatMap((row, y) =>
  [...row].flatMap((c, x) => (CROWN_COLORS[c] ? [{ x, y, fill: CROWN_COLORS[c] }] : [])),
)

const TierCrown: React.FC = () => (
  <svg
    className="tier-crown"
    width={22}
    height={14}
    viewBox="0 0 11 7"
    shapeRendering="crispEdges"
    aria-hidden="true"
    focusable="false"
  >
    {CROWN_RECTS.map(p => (
      <rect key={`${p.x}-${p.y}`} x={p.x} y={p.y} width={1} height={1} fill={p.fill} />
    ))}
  </svg>
)

function isSelectable(ball: BallEntry): boolean {
  return ball.status === 'current_tier' || ball.status === 'past_tier' || ball.status === 'unlocked'
}

function ballsCacheKey(userId: string) {
  return `${BALLS_CACHE_PREFIX}${userId}`
}

function readCachedBalls(userId: string): BallsResponse | null {
  return readJsonCache<BallsResponse>(ballsCacheKey(userId))
}

function writeCachedBalls(userId: string, data: BallsResponse) {
  writeJsonCache(ballsCacheKey(userId), data)
}

const CollectionPage: React.FC<CollectionPageProps> = ({ onBack }) => {
  const session = useAuthStore(state => state.session)
  const profile = useAuthStore(state => state.profile)
  const stats = useAuthStore(state => state.stats)
  const isGuest = useAuthStore(state => state.isGuest)
  const updateDisplayBall = useAuthStore(state => state.updateDisplayBall)

  const [ballData, setBallData] = useState<BallsResponse | null>(null)
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [selectedBall, setSelectedBall] = useState<string | null>(null)
  const [settingBall, setSettingBall] = useState(false)
  const [setBallError, setSetBallError] = useState<string | null>(null)
  const latestFetchIdRef = useRef(0)

  useEffect(() => {
    if (isGuest || !session) {
      setIsInitialLoading(false)
      setIsRefreshing(false)
      return
    }

    const cachedBalls = readCachedBalls(session.user.id)
    if (cachedBalls) {
      setBallData(prev => (isJsonEqual(prev, cachedBalls) ? prev : cachedBalls))
      setIsInitialLoading(false)
      setIsRefreshing(true)
    } else {
      setIsInitialLoading(true)
      setIsRefreshing(false)
    }

    const fetchId = latestFetchIdRef.current + 1
    latestFetchIdRef.current = fetchId
    const supabaseUrl = import.meta.env.VITE_API_URL as string
    fetch(`${supabaseUrl}/functions/v1/get-balls`, {
      headers: { 'Authorization': `Bearer ${session.access_token}` },
    })
      .then(async r => {
        if (!r.ok) {
          throw new Error(`get-balls failed with status ${r.status}`)
        }
        const data = await r.json() as BallsResponse
        if (latestFetchIdRef.current !== fetchId) {
          return
        }

        setBallData(prev => {
          if (isJsonEqual(prev, data)) {
            return prev
          }
          writeCachedBalls(session.user.id, data)
          return data
        })
        setIsInitialLoading(false)
        setIsRefreshing(false)
      })
      .catch(() => {
        if (latestFetchIdRef.current !== fetchId) {
          return
        }
        setIsInitialLoading(false)
        setIsRefreshing(false)
      })
  }, [isGuest, session?.user.id, session?.access_token])

  async function handleSetBall(ballId: string) {
    setSettingBall(true)
    setSetBallError(null)
    const { error } = await updateDisplayBall(ballId)
    if (error) {
      setSetBallError(error)
    }
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

  // Segmented progress from the current streak tier to the next one.
  const streak = stats?.current_streak ?? 0
  const upcomingTier = nextTier(streak)
  const segmentStart = TIER_THRESHOLDS[getStreakTier(streak)]
  const segmentCount = upcomingTier ? upcomingTier.threshold - segmentStart : 1
  const segmentsFilled = upcomingTier ? streak - segmentStart : 1
  const winsToNext = upcomingTier ? upcomingTier.threshold - streak : 0

  return (
    <div className="max-w-3xl mx-auto px-2 sm:px-4 py-2 sm:py-4">
      <div className="flex items-center gap-2 sm:gap-4 mb-1">
        <button
          onClick={onBack}
          aria-label="Back to Game"
          className="flex items-center gap-2 min-h-[44px] min-w-[44px] text-sm text-gray-600 hover:text-pokemon-red pixel-focus flex-shrink-0"
        >
          <ArrowLeft width={24} height={24} aria-hidden="true" />
          <span className="hidden sm:inline">Back to Game</span>
        </button>
        <h2 className="text-xl sm:text-2xl font-bold text-gray-800 leading-tight">Ball Collection</h2>
      </div>
      <p className="hidden sm:block text-sm text-gray-500 mb-3">Earn balls by playing and achieving milestones.</p>
      {setBallError && (
        <div className="mb-3 border-2 border-red-400 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {setBallError}
        </div>
      )}

      {isGuest && (
        <div className="mt-2 mb-4 bg-red-50 pixel-frame px-3 py-2 text-center">
          <p className="text-sm font-bold text-gray-800">Sign in to start earning balls</p>
          <p className="hidden sm:block text-xs text-gray-500 mt-0.5">Track your streak and unlock achievement balls</p>
        </div>
      )}

      {isInitialLoading ? (
        <div className="animate-pulse space-y-4 mt-2">
          <div className="bg-white pixel-frame p-4">
            <div className="flex items-center gap-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <div className="w-14 h-14 bg-gray-200" />
                  <div className="w-10 h-3 bg-gray-200" />
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-1.5 sm:gap-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-11 sm:h-32 bg-gray-100" />
            ))}
          </div>
        </div>
      ) : (
        <>
          {isRefreshing && (
            <p className="text-xs text-gray-400 mb-2">Refreshing collection...</p>
          )}

          {/* Standard tier track */}
          <section className="mb-3 sm:mb-4">
            <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-2">Streak Tier</h3>
            <div className="bg-white pixel-frame p-3 sm:p-4">
              <div className="flex w-full items-start pt-7 px-3 sm:px-6">
                {standardBalls.map((ball, i) => {
                  const isPast = ball.status === 'past_tier'
                  const isCurrent = ball.status === 'current_tier'
                  const isFuture = ball.status === 'future_tier' || ball.status === 'locked'
                  const isSelected = selectedBall === ball.id
                  const isDisplay = !isGuest && currentDisplayBall === ball.id
                  const canSelect = !isGuest && isSelectable(ball)
                  const tierState = isCurrent ? ', your current tier' : isPast ? ', tier reached' : ', locked tier'
                  const showTierEquip = isSelected && ball.id !== currentDisplayBall

                  return (
                    <React.Fragment key={ball.id}>
                      <div className="relative flex flex-col items-center gap-1.5 flex-shrink-0 w-14">
                        {isCurrent && (
                          <span className="tier-marker">
                            <TierCrown />
                            <span className="sr-only">You are here</span>
                          </span>
                        )}
                        {isPast && <span className="tier-marker tier-marker--past" aria-hidden="true">✓</span>}
                        <button
                          disabled={!canSelect}
                          onClick={() => canSelect && setSelectedBall(isSelected ? null : ball.id)}
                          aria-label={`${ball.display_name}${tierState}${isDisplay ? ', equipped' : ''}`}
                          aria-pressed={canSelect ? isSelected : undefined}
                          aria-current={isDisplay ? 'true' : undefined}
                          className={`tier-slot ${
                            isCurrent ? 'tier-slot--current' : isPast ? 'tier-slot--past' : 'tier-slot--future'
                          } ${isDisplay ? 'equipped-frame' : ''} ${isSelected ? 'tier-slot--selected' : ''} ${canSelect ? 'cursor-pointer' : 'cursor-default'}`}
                        >
                          {isFuture ? (
                            <span className="text-gray-400 text-lg" aria-hidden="true">?</span>
                          ) : (
                            <img
                              src={ballSpriteUrl(ball.id)}
                              alt=""
                              className="sprite w-8 h-8"
                              decoding="async"
                              width={32}
                              height={32}
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                            />
                          )}
                        </button>
                        <span className={`text-xs text-center leading-tight max-w-[56px] ${isFuture ? 'text-gray-400' : 'text-gray-700'} ${showTierEquip ? 'invisible' : ''}`}>
                          {ball.display_name}
                        </span>
                        {isDisplay && !isFuture && <EquippedRibbon />}
                        {/* Covers the name label instead of adding a row, so selecting never grows the page. */}
                        {showTierEquip && (
                          <button
                            disabled={settingBall}
                            onClick={() => handleSetBall(ball.id)}
                            className="equip-btn absolute top-[62px] left-1/2 -translate-x-1/2 z-10"
                          >
                            {settingBall ? '…' : 'Equip'}
                          </button>
                        )}
                      </div>
                      {i < standardBalls.length - 1 && (
                        <div className={`tier-connector ${i < currentTierIdx ? 'tier-connector--done' : ''}`} />
                      )}
                    </React.Fragment>
                  )
                })}
              </div>
              {!isGuest && stats ? (
                <div className="mt-3">
                  <div
                    className="pixel-progress"
                    role="progressbar"
                    aria-label={upcomingTier ? `Progress to ${BALL_NAMES[upcomingTier.tierId]}` : 'Max tier reached'}
                    aria-valuemin={0}
                    aria-valuemax={segmentCount}
                    aria-valuenow={segmentsFilled}
                  >
                    {Array.from({ length: segmentCount }, (_, i) => (
                      <span key={i} className={`pixel-progress__seg ${i < segmentsFilled ? 'pixel-progress__seg--filled' : ''}`} />
                    ))}
                  </div>
                  <p className="text-xs text-gray-600 mt-2">
                    {upcomingTier
                      ? `${winsToNext} more ${winsToNext === 1 ? 'win' : 'wins'} to ${BALL_NAMES[upcomingTier.tierId]}`
                      : 'Max tier'}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-gray-400 mt-3">Maintain your win streak to climb the tiers.</p>
              )}
            </div>
          </section>

          {/* Achievement balls */}
          <section>
            <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-2">Achievement Balls</h3>
            {/* Phones: one short row per ball. sm+: cards, one row of five on desktop. */}
            <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-1 sm:gap-3 sm:pt-2">
              {achievementBalls.map(ball => {
                const isUnlocked = ball.status === 'unlocked'
                const isSelected = selectedBall === ball.id
                const isDisplay = !isGuest && currentDisplayBall === ball.id
                const canSelect = !isGuest && isUnlocked
                // The Equip action takes the hint's place so selecting never grows the page.
                const showEquip = isSelected && ball.id !== currentDisplayBall

                return (
                  <div
                    key={ball.id}
                    aria-current={isDisplay ? 'true' : undefined}
                    className={`relative border-2 flex flex-row sm:flex-col items-center ${
                      isUnlocked
                        ? 'border-gray-300 bg-white hover:border-pokemon-blue'
                        : 'border-gray-200 bg-gray-50 opacity-75'
                    } ${isSelected ? 'border-pokemon-blue outline outline-2 outline-pokemon-blue' : ''} ${isDisplay ? 'equipped-frame' : ''}`}
                  >
                    {isDisplay && (
                      <span className="absolute -top-2 right-2 sm:-top-3 sm:right-auto sm:left-1/2 sm:-translate-x-1/2 whitespace-nowrap z-10"><EquippedRibbon /></span>
                    )}
                    <button
                      type="button"
                      disabled={!canSelect}
                      onClick={() => canSelect && setSelectedBall(isSelected ? null : ball.id)}
                      aria-label={`${ball.display_name}${isUnlocked ? '' : ', locked'}${isDisplay ? ', equipped' : ''}`}
                      aria-pressed={canSelect ? isSelected : undefined}
                      className={`flex-1 min-w-0 w-full min-h-[44px] px-2 py-1 sm:p-3 flex flex-row sm:flex-col items-center gap-3 sm:gap-2 text-left sm:text-center pixel-focus ${canSelect ? 'cursor-pointer' : 'cursor-default'}`}
                    >
                      {isUnlocked ? (
                        <img
                          src={ballSpriteUrl(ball.id)}
                          alt=""
                          className="sprite w-8 h-8 sm:w-12 sm:h-12 flex-shrink-0"
                          decoding="async"
                          width={48}
                          height={48}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                        />
                      ) : (
                        <div className="w-8 h-8 sm:w-12 sm:h-12 flex-shrink-0 pixel-circle bg-gray-300 flex items-center justify-center">
                          <span className="text-gray-500 text-lg" aria-hidden="true">?</span>
                        </div>
                      )}
                      <span className="min-w-0 flex flex-col sm:items-center gap-0.5 sm:gap-2">
                        <span className={`text-sm font-bold ${isUnlocked ? 'text-gray-800' : 'text-gray-400'}`}>
                          {ball.display_name}
                        </span>
                        {ball.hint && !showEquip && (
                          <span className={`text-[10px] sm:text-xs leading-snug ${isUnlocked ? 'text-gray-500' : 'text-gray-400'}`}>
                            {ball.hint}
                          </span>
                        )}
                      </span>
                    </button>
                    {showEquip && (
                      <div className="flex-shrink-0 pr-2 sm:pr-0 sm:w-full sm:px-3 sm:pb-3">
                        <button
                          disabled={settingBall}
                          onClick={() => handleSetBall(ball.id)}
                          className="equip-btn sm:w-full"
                        >
                          {settingBall ? '…' : 'Equip'}
                        </button>
                      </div>
                    )}
                  </div>
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
