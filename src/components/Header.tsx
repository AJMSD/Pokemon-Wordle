import React from 'react'
import { useAuthStore, BALL_NAMES } from '../store/authStore'

interface HeaderProps {
  onShowCollection?: () => void
  onShowProfile?: () => void
  onShowAuth?: () => void
  onGoHome?: () => void
}

const SPRITE_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items'

const Header: React.FC<HeaderProps> = ({ onShowCollection, onShowProfile, onShowAuth, onGoHome }) => {
  const profile = useAuthStore(state => state.profile)
  const stats = useAuthStore(state => state.stats)
  const isGuest = useAuthStore(state => state.isGuest)
  const signOut = useAuthStore(state => state.signOut)

  const displayBall = (!isGuest && profile?.display_ball) ? profile.display_ball : 'poke-ball'
  const ballName = BALL_NAMES[displayBall] ?? 'Poké Ball'

  return (
    <header className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-gray-200 bg-white/80 backdrop-blur-sm sticky top-0 z-20 rounded-t-lg mb-6">
      {/* Left: Logo + title */}
      <button
        onClick={onGoHome}
        className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        aria-label="Go to game"
      >
        <img
          src={`${import.meta.env.BASE_URL}logo.png`}
          alt="Wurmple logo"
          className="h-7 w-auto object-contain flex-shrink-0"
        />
        <h1 className="font-pixel text-lg sm:text-xl md:text-2xl text-pokemon-red tracking-wide leading-none">Wurmple</h1>
      </button>

      {/* Right: ball badge + nav + auth */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Ball badge pill */}
        <div className="flex items-center gap-1 bg-gray-100 border border-gray-200 rounded-full px-2 py-0.5">
          <img
            src={`${SPRITE_BASE}/${displayBall}.png`}
            alt={ballName}
            className="w-4 h-4 object-contain"
            loading="lazy"
            decoding="async"
            width={16}
            height={16}
          />
          <span className="font-pixel text-xs font-medium text-gray-600 hidden sm:inline">
            {isGuest ? 'Guest' : (profile?.username ?? 'Trainer')}
          </span>
          {!isGuest && stats !== null && (
            <span className="font-pixel text-xs text-gray-400 ml-0.5">🔥{stats.current_streak}</span>
          )}
        </div>

        {/* Nav links (auth users only) */}
        {!isGuest && onShowCollection && (
          <button
            onClick={onShowCollection}
            className="text-sm font-semibold text-gray-700 hover:text-pokemon-red transition-colors hidden sm:block"
          >
            Collection
          </button>
        )}
        {!isGuest && onShowProfile && (
          <button
            onClick={onShowProfile}
            className="text-sm font-semibold text-gray-700 hover:text-pokemon-red transition-colors hidden sm:block"
          >
            Profile
          </button>
        )}

        {/* Auth action */}
        {isGuest ? (
          <button
            onClick={onShowAuth}
            className="bg-pokemon-red text-white px-3 sm:px-4 py-1.5 rounded-full text-sm font-semibold hover:bg-red-700 transition-colors"
          >
            Sign In →
          </button>
        ) : (
          <button
            onClick={signOut}
            className="text-sm font-semibold text-gray-500 hover:text-gray-700 transition-colors"
          >
            Sign Out
          </button>
        )}
      </div>
    </header>
  )
}

export default Header
