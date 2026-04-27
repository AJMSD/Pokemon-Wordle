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
    <header className="mb-8 text-center relative">
      <h1 className="font-pixel text-2xl md:text-3xl text-pokemon-red mb-2 tracking-wide">
        Wurmple
        <span className="inline-block ml-2 transform -rotate-12">
          <svg width="32" height="32" viewBox="0 0 24 24" className="fill-pokemon-red">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-5-9c.83 0 1.5-.67 1.5-1.5S7.83 8 7 8s-1.5.67-1.5 1.5S6.17 11 7 11zm10 0c.83 0 1.5-.67 1.5-1.5S17.83 8 17 8s-1.5.67-1.5 1.5.67 1.5 1.5 1.5zM12 17.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"/>
          </svg>
        </span>
      </h1>
      <p className="text-gray-600 md:text-lg mb-1">
        Guess the Daily Pokémon from the Pokédex!
      </p>
      <div className="absolute top-0 right-0 flex items-center gap-2">
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
          <span className="font-pixel text-xs font-medium text-gray-600">{isGuest ? 'Guest' : ballName}</span>
          {!isGuest && stats !== null && (
            <span className="font-pixel text-xs text-gray-400 ml-0.5">🔥 {stats.current_streak}</span>
          )}
        </div>
        {!isGuest && onShowCollection && (
          <button
            onClick={onShowCollection}
            className="text-sm font-semibold text-pokemon-red hover:underline"
          >
            Collection
          </button>
        )}
        {!isGuest && onShowProfile && (
          <button
            onClick={onShowProfile}
            className="text-sm font-semibold text-pokemon-red hover:underline"
          >
            Profile
          </button>
        )}
        {isGuest ? (
          <button
            onClick={onShowAuth}
            className="text-sm font-semibold text-pokemon-red hover:underline"
          >
            Sign In
          </button>
        ) : (
          <button
            onClick={signOut}
            className="text-sm font-semibold text-gray-500 hover:text-gray-700 hover:underline"
          >
            Sign Out
          </button>
        )}
      </div>
    </header>
  )
}

export default Header
