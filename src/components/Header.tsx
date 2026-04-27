import React from 'react'
import { useAuthStore, BALL_NAMES } from '../store/authStore'

interface HeaderProps {
  onShowCollection?: () => void
  onShowProfile?: () => void
  onShowAuth?: () => void
}

const SPRITE_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items'

const Header: React.FC<HeaderProps> = ({ onShowCollection, onShowProfile, onShowAuth }) => {
  const profile = useAuthStore(state => state.profile)
  const stats = useAuthStore(state => state.stats)
  const isGuest = useAuthStore(state => state.isGuest)
  const signOut = useAuthStore(state => state.signOut)

  const displayBall = (!isGuest && profile?.display_ball) ? profile.display_ball : 'poke-ball'
  const ballName = BALL_NAMES[displayBall] ?? 'Poké Ball'

  return (
    <header className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-gray-200 bg-white/80 backdrop-blur-sm sticky top-0 z-20 rounded-t-lg mb-6">
      {/* Left: Logo + title */}
      <div className="flex items-center gap-2">
        <svg width="26" height="26" viewBox="0 0 24 24" className="fill-pokemon-red flex-shrink-0">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-5-9c.83 0 1.5-.67 1.5-1.5S7.83 8 7 8s-1.5.67-1.5 1.5S6.17 11 7 11zm10 0c.83 0 1.5-.67 1.5-1.5S17.83 8 17 8s-1.5.67-1.5 1.5.67 1.5 1.5 1.5zM12 17.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"/>
        </svg>
        <h1 className="font-pixel text-lg sm:text-xl md:text-2xl text-pokemon-red tracking-wide leading-none">Wurmple</h1>
      </div>

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
            {isGuest ? 'Guest' : ballName}
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
