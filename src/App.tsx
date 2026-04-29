import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useGameStore } from './store/gameStore'
import { useAuthStore, BALL_NAMES } from './store/authStore'
import Header from './components/Header'
import PokedexUI from './components/PokedexUI'
import BallUnlockModal from './components/BallUnlockModal'
import TierPromptToast from './components/TierPromptToast'
import ToastContainer from './components/ToastContainer'
import OfflineBanner from './components/OfflineBanner'
import useToast from './hooks/useToast'
import { ToastProps } from './components/Toast'

const TIER_ORDER = ['poke-ball', 'great-ball', 'ultra-ball', 'master-ball']
function getStreakTier(streak: number): string {
  if (streak >= 14) return 'master-ball'
  if (streak >= 7) return 'ultra-ball'
  if (streak >= 3) return 'great-ball'
  return 'poke-ball'
}

const CollectionPage = lazy(() => import('./components/CollectionPage'))
const ProfilePage = lazy(() => import('./components/ProfilePage'))
const AuthModal = lazy(() => import('./components/AuthModal'))

function PageSkeleton() {
  return <div className="animate-pulse bg-pokemon-red/10 rounded-xl h-96 w-full" />
}

const STREAK_MILESTONES: Record<number, string> = {
  3: "3-day streak! You're on a roll, Trainer!",
  7: '⚡ 7-day streak! A full week of victories!',
  14: '💪 14-day streak! Two weeks strong!',
  30: '🌟 30-day streak! Legendary Trainer territory!',
  50: '🏆 50-day streak! Elite Four level dedication!',
  100: "👑 100-day streak! You are a Pokémon Master!",
}

function App() {
  const initializeGame = useGameStore(state => state.initializeGame)
  const initializeServerSession = useGameStore(state => state.initializeServerSession)
  const newlyUnlockedBalls = useGameStore(state => state.newlyUnlockedBalls)
  const clearNewlyUnlockedBalls = useGameStore(state => state.clearNewlyUnlockedBalls)
  const gameStatus = useGameStore(state => state.gameStatus)
  const initialize = useAuthStore(state => state.initialize)
  const updateDisplayBall = useAuthStore(state => state.updateDisplayBall)
  const resendVerification = useAuthStore(state => state.resendVerification)
  const signOut = useAuthStore(state => state.signOut)
  const isGuest = useAuthStore(state => state.isGuest)
  const session = useAuthStore(state => state.session)
  const profile = useAuthStore(state => state.profile)
  const user = useAuthStore(state => state.user)
  const pendingPasswordRecovery = useAuthStore(state => state.pendingPasswordRecovery)
  const stats = useAuthStore(state => state.stats)

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

  useEffect(() => {
    initialize().then(() => initializeGame())
  }, [initialize, initializeGame])

  useEffect(() => {
    if (!pendingPasswordRecovery && !isGuest && session?.access_token && user?.email_confirmed_at && user.id !== lastSyncedUserId.current) {
      lastSyncedUserId.current = user.id
      initializeServerSession(session.access_token)
    }
  }, [pendingPasswordRecovery, isGuest, session?.access_token, user?.email_confirmed_at, user?.id, initializeServerSession])

  useEffect(() => {
    if (isGuest) {
      lastSyncedUserId.current = null
    }
  }, [isGuest])

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
    milestoneShownRef.current = true
    const t = setTimeout(() => {
      addToast(STREAK_MILESTONES[streak], 'success')
    }, 1500)
    return () => clearTimeout(t)
  }, [gameStatus, isGuest, stats?.current_streak, addToast])

  const needsUsernameSetup = !isGuest && !!session && !profile
  const showUnverifiedBanner = !isGuest && !!session && !user?.email_confirmed_at && !bannerDismissed

  const typedToasts = toasts.map(toast => ({
    ...toast,
    onClose: toast.onClose || (() => removeToast(toast.id))
  })) as (ToastProps & { id: string })[]

  useEffect(() => {
    if (isGuest || !stats || !profile) return
    const currentTier = getStreakTier(stats.current_streak)
    if (TIER_ORDER.indexOf(currentTier) > TIER_ORDER.indexOf(profile.display_ball ?? 'poke-ball')) {
      const dismissed = localStorage.getItem('tier_prompt_dismissed')
      if (dismissed !== currentTier) setTierUpgrade({ tierId: currentTier, tierName: BALL_NAMES[currentTier] })
    }
  }, [stats, profile, isGuest])

  const handleSignOut = async () => {
    setShowCollection(false)
    setShowProfile(false)
    setShowAuth(false)
    lastSyncedUserId.current = null
    await signOut()
  }

  const handleResendVerification = async () => {
    await resendVerification()
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 bg-white/50 backdrop-blur-sm rounded-lg shadow-lg my-4">
      <OfflineBanner />
      <Header
        onShowCollection={!isGuest ? () => { setShowCollection(true); setShowProfile(false) } : undefined}
        onShowProfile={!isGuest ? () => { setShowProfile(true); setShowCollection(false) } : undefined}
        onShowAuth={() => { setAuthInitialView('login'); setShowAuth(true) }}
        onGoHome={() => { setShowCollection(false); setShowProfile(false) }}
        onSignOut={handleSignOut}
      />
      {showUnverifiedBanner && (
        <div className="flex items-center justify-between bg-yellow-50 border border-yellow-300 text-yellow-800 text-sm rounded-lg px-4 py-3 mb-4 gap-4">
          <span>
            Verify your email to start tracking your Trainer stats.{' '}
            <button onClick={handleResendVerification} className="underline font-medium hover:text-yellow-900">
              Resend verification
            </button>
          </span>
          <button onClick={() => setBannerDismissed(true)} className="text-yellow-600 hover:text-yellow-900 text-lg leading-none flex-shrink-0" aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
      <Suspense fallback={<PageSkeleton />}>
        <main className="pt-14 sm:pt-0">
          {showProfile
            ? (
              <ProfilePage
                onBack={() => setShowProfile(false)}
                onTierUpgradeAvailable={(tierId, tierName) => setTierUpgrade({ tierId, tierName })}
              />
            )
            : showCollection
              ? <CollectionPage onBack={() => setShowCollection(false)} />
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
            localStorage.setItem('tier_prompt_dismissed', tierUpgrade.tierId)
            setTierUpgrade(null)
          }}
        />
      )}
    </div>
  )
}

export default App
