import { useEffect, useState } from 'react'
import { useGameStore } from './store/gameStore'
import { useAuthStore } from './store/authStore'
import Header from './components/Header'
import PokedexUI from './components/PokedexUI'
import CollectionPage from './components/CollectionPage'
import ProfilePage from './components/ProfilePage'
import BallUnlockModal from './components/BallUnlockModal'
import TierPromptToast from './components/TierPromptToast'
import ToastContainer from './components/ToastContainer'
import useToast from './hooks/useToast'
import { ToastProps } from './components/Toast'

function App() {
  const initializeGame = useGameStore(state => state.initializeGame)
  const updateDisplayBall = useAuthStore(state => state.updateDisplayBall)
  const { toasts, removeToast } = useToast()
  const [showCollection, setShowCollection] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [unlockedBall, setUnlockedBall] = useState<{ name: string; id: string } | null>(null)
  const [tierUpgrade, setTierUpgrade] = useState<{ tierId: string; tierName: string } | null>(null)

  useEffect(() => {
    initializeGame()
  }, [initializeGame])

  const typedToasts = toasts.map(toast => ({
    ...toast,
    onClose: toast.onClose || (() => removeToast(toast.id))
  })) as (ToastProps & { id: string })[]

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 bg-white/50 backdrop-blur-sm rounded-lg shadow-lg my-4">
      <Header
        onShowCollection={() => setShowCollection(true)}
        onShowProfile={() => setShowProfile(true)}
      />
      <main>
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
