import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useGameStore } from './store/gameStore'
import { useAuthStore, BALL_NAMES, canPrefetchGameSession } from './store/authStore'
import { readPersistedAccessToken } from './lib/api'
import { getJSTDateKey } from './utils/pokemonUtils'
import useDayRollover from './hooks/useDayRollover'
import Header from './components/Header'
import PokedexUI from './components/PokedexUI'
import BallUnlockModal from './components/BallUnlockModal'
import TierPromptToast from './components/TierPromptToast'
import ToastContainer from './components/ToastContainer'
import OfflineBanner from './components/OfflineBanner'
import useToast from './hooks/useToast'
import { ToastProps } from './components/Toast'
import { getTierUpgradePrompt } from './logic/tierLogic'
import { Close } from 'pixelarticons/react/Close'


const CollectionPage = lazy(() => import('./components/CollectionPage'))
const ProfilePage = lazy(() => import('./components/ProfilePage'))
const AuthModal = lazy(() => import('./components/AuthModal'))

function PageSkeleton() {
  return <div className="animate-pulse bg-pokemon-red/10 flex-1 min-h-0 w-full" />
}

const STREAK_MILESTONES: Record<number, string> = {
  3: "3-day streak! You're on a roll, Trainer!",
  7: '⚡ 7-day streak! A full week of victories!',
  14: '💪 14-day streak! Two weeks strong!',
  30: '🌟 30-day streak! Legendary Trainer territory!',
  50: '🏆 50-day streak! Elite Four level dedication!',
  100: "👑 100-day streak! You are a Pokémon Master!",
}

const STREAK_TOAST_SEEN_STORAGE_KEY = 'streak_milestone_toasts_seen_v1'

type SeenStreakMilestones = Record<string, true>

function getSeenStreakMilestones(): SeenStreakMilestones {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STREAK_TOAST_SEEN_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      return parsed as SeenStreakMilestones
    }
  } catch {
    // Ignore malformed storage and fall back to an empty seen map.
  }
  return {}
}

function getStreakToastSeenKey(userId: string | undefined, streak: number): string {
  return `${userId ?? 'anonymous'}:${streak}`
}

function hasSeenStreakToast(userId: string | undefined, streak: number): boolean {
  const seen = getSeenStreakMilestones()
  return Boolean(seen[getStreakToastSeenKey(userId, streak)])
}

function markStreakToastSeen(userId: string | undefined, streak: number): void {
  if (typeof window === 'undefined') return
  try {
    const seen = getSeenStreakMilestones()
    seen[getStreakToastSeenKey(userId, streak)] = true
    localStorage.setItem(STREAK_TOAST_SEEN_STORAGE_KEY, JSON.stringify(seen))
  } catch {
    // Ignore write failures so gameplay is never blocked by storage.
  }
}

function App() {
  const initializeGame = useGameStore(state => state.initializeGame)
  const initializeServerSession = useGameStore(state => state.initializeServerSession)
  const newlyUnlockedBalls = useGameStore(state => state.newlyUnlockedBalls)
  const clearNewlyUnlockedBalls = useGameStore(state => state.clearNewlyUnlockedBalls)
  const gameStatus = useGameStore(state => state.gameStatus)
  const initialize = useAuthStore(state => state.initialize)
  const updateDisplayBall = useAuthStore(state => state.updateDisplayBall)
  const dismissTierPromptForever = useAuthStore(state => state.dismissTierPromptForever)
  const resendVerification = useAuthStore(state => state.resendVerification)
  const signOut = useAuthStore(state => state.signOut)
  const isGuest = useAuthStore(state => state.isGuest)
  const session = useAuthStore(state => state.session)
  const profile = useAuthStore(state => state.profile)
  const user = useAuthStore(state => state.user)
  const pendingPasswordRecovery = useAuthStore(state => state.pendingPasswordRecovery)
  const hasResolvedProfile = useAuthStore(state => state.hasResolvedProfile)
  const isProfileHydrating = useAuthStore(state => state.isProfileHydrating)
  const stats = useAuthStore(state => state.stats)
  const authNotice = useAuthStore(state => state.authNotice)
  const clearAuthNotice = useAuthStore(state => state.clearAuthNotice)

  const { toasts, removeToast, addToast } = useToast()
  const [showCollection, setShowCollection] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  const [authInitialView, setAuthInitialView] = useState<'login' | 'signup'>('login')
  const [unlockedBall, setUnlockedBall] = useState<{ name: string; id: string } | null>(null)
  const [tierUpgrade, setTierUpgrade] = useState<{ tierId: string; tierName: string } | null>(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const milestoneShownRef = useRef(false)
  const lastSyncedUserId = useRef<string | null>(null)
  const lastSyncedToken = useRef<string | null>(null)

  useDayRollover()

  useEffect(() => {
    // A returning player's token is already in storage: start loading the
    // server game now instead of after auth hydration (profile fetch etc.).
    // Skipped when a guest game may need importing first (see authStore).
    const persisted = readPersistedAccessToken()
    const game = useGameStore.getState()
    if (persisted && canPrefetchGameSession(persisted.userId) && !game.hasGuestProgress()) {
      lastSyncedUserId.current = persisted.userId
      lastSyncedToken.current = persisted.accessToken
      game.setStorageScope(persisted.userId)
      void initializeGame()
      void initializeServerSession(persisted.accessToken)
    }
    // Guests on per-user days play on the server too; their session loads
    // once auth has settled as guest (a signed-in scope makes this a no-op).
    initialize()
      .then(() => initializeGame())
      .then(() => useGameStore.getState().loadGuestServerSession())
  }, [initialize, initializeGame, initializeServerSession])

  useEffect(() => {
    const token = session?.access_token
    if (!pendingPasswordRecovery && !isGuest && token && user?.email_confirmed_at) {
      const userChanged = user.id !== lastSyncedUserId.current
      // A refreshed token after a failed early load gets one more try.
      const retryWithNewToken = token !== lastSyncedToken.current
        && useGameStore.getState().puzzleDateKey !== getJSTDateKey()
      if (userChanged || retryWithNewToken) {
        lastSyncedUserId.current = user.id
        lastSyncedToken.current = token
        // The server sync doesn't depend on PokéAPI details, so don't wait for them.
        if (userChanged) void initializeGame()
        void initializeServerSession(token)
      }
    }
  }, [pendingPasswordRecovery, isGuest, session?.access_token, user?.email_confirmed_at, user?.id, initializeGame, initializeServerSession])

  useEffect(() => {
    if (isGuest) {
      lastSyncedUserId.current = null
      lastSyncedToken.current = null
    }
  }, [isGuest])

  useEffect(() => {
    if (!authNotice) return
    addToast(authNotice, 'error', 6000)
    clearAuthNotice()
  }, [authNotice, addToast, clearAuthNotice])

  useEffect(() => {
    if (newlyUnlockedBalls.length > 0) {
      const ballId = newlyUnlockedBalls[0]
      setUnlockedBall({ name: BALL_NAMES[ballId] ?? ballId, id: ballId })
      clearNewlyUnlockedBalls()
    }
  }, [newlyUnlockedBalls, clearNewlyUnlockedBalls])

  useEffect(() => {
    if (gameStatus === 'playing') { milestoneShownRef.current = false; return; }
    if (gameStatus !== 'won' || isGuest || milestoneShownRef.current) return
    const streak = stats?.current_streak
    if (!streak || !STREAK_MILESTONES[streak]) return
    if (hasSeenStreakToast(user?.id, streak)) {
      milestoneShownRef.current = true
      return
    }
    milestoneShownRef.current = true
    markStreakToastSeen(user?.id, streak)
    const t = setTimeout(() => {
      addToast(STREAK_MILESTONES[streak], 'success')
    }, 1500)
    return () => clearTimeout(t)
  }, [gameStatus, isGuest, stats?.current_streak, user?.id, addToast])

  const needsUsernameSetup = !isGuest
    && !!session
    && hasResolvedProfile
    && !isProfileHydrating
    && !profile
  const showUnverifiedBanner = !isGuest && !!session && !user?.email_confirmed_at && !bannerDismissed

  const typedToasts = toasts.map(toast => ({
    ...toast,
    onClose: toast.onClose || (() => removeToast(toast.id))
  })) as (ToastProps & { id: string })[]

  useEffect(() => {
    if (isGuest || !stats || !profile) return
    const upgradeTier = getTierUpgradePrompt(
      stats.current_streak,
      profile.display_ball,
      Boolean(profile.tier_prompt_dismissed_forever),
    )
    if (upgradeTier) {
      setTierUpgrade({ tierId: upgradeTier, tierName: BALL_NAMES[upgradeTier] })
    }
  }, [stats, profile, isGuest])

  const handleSignOut = async () => {
    setShowCollection(false)
    setShowProfile(false)
    setShowAuth(false)
    lastSyncedUserId.current = null
    lastSyncedToken.current = null
    await signOut()
  }

  const handleResendVerification = async () => {
    await resendVerification()
  }

  return (
    <div className="mx-auto my-2 md:my-4 flex h-[calc(100dvh-1rem)] md:h-[calc(100dvh-2rem)] w-full max-w-6xl flex-col px-2 py-2 md:px-4 md:py-4 bg-white/70 pixel-frame">
      <OfflineBanner />
      <Header
        onShowCollection={!isGuest ? () => { setShowCollection(true); setShowProfile(false) } : undefined}
        onShowProfile={!isGuest ? () => { setShowProfile(true); setShowCollection(false) } : undefined}
        onShowAuth={() => { setAuthInitialView('login'); setShowAuth(true) }}
        onGoHome={() => { setShowCollection(false); setShowProfile(false) }}
        onSignOut={handleSignOut}
      />
      {showUnverifiedBanner && (
        <div className="flex items-center justify-between bg-yellow-50 border-2 border-yellow-600 text-yellow-800 text-sm px-4 py-2 mb-2 gap-4">
          <span>
            Verify your email to start tracking your Trainer stats.{' '}
            <button onClick={handleResendVerification} className="underline hover:text-yellow-900 pixel-focus">
              Resend verification
            </button>
          </span>
          <button onClick={() => setBannerDismissed(true)} className="text-yellow-700 hover:text-yellow-900 flex-shrink-0 pixel-focus" aria-label="Dismiss">
            <Close width={24} height={24} aria-hidden="true" />
          </button>
        </div>
      )}
      <Suspense fallback={<PageSkeleton />}>
        {/* Pages fit by layout; the hidden-bar scroll is only a fallback for very short viewports. */}
        <main className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
          {showProfile
            ? (
              <ProfilePage
                onTierUpgradeAvailable={(tierId, tierName) => setTierUpgrade({ tierId, tierName })}
              />
            )
            : showCollection
              ? <CollectionPage />
              : <PokedexUI />
          }
        </main>
        <AuthModal
          isOpen={showAuth || pendingPasswordRecovery || needsUsernameSetup}
          onClose={() => setShowAuth(false)}
          initialView={authInitialView}
          forceView={
            pendingPasswordRecovery ? 'reset-password' :
            needsUsernameSetup ? 'username-setup' :
            undefined
          }
        />
      </Suspense>
      <ToastContainer toasts={typedToasts} removeToast={removeToast} />
      <BallUnlockModal
        visible={!!unlockedBall}
        ballName={unlockedBall?.name ?? ''}
        ballId={unlockedBall?.id ?? ''}
        onClose={() => setUnlockedBall(null)}
      />
      {tierUpgrade && (
        <TierPromptToast
          tierId={tierUpgrade.tierId}
          tierName={tierUpgrade.tierName}
          onSwitch={async () => {
            await updateDisplayBall(tierUpgrade.tierId)
            setTierUpgrade(null)
          }}
          onDismiss={() => {
            if (isGuest) {
              localStorage.setItem('tier_prompt_dismissed', tierUpgrade.tierId)
            } else {
              void dismissTierPromptForever()
            }
            setTierUpgrade(null)
          }}
        />
      )}
    </div>
  )
}

export default App
