import React from 'react'
import { Archive, LogIn, LogOut } from 'lucide-react'
import { useAuthStore, BALL_NAMES } from '../store/authStore'
import { getAvatarUrl } from '../utils/avatarUtils'
import DefaultAvatar from './DefaultAvatar'
import streakIcon from '../../streak.png'

interface HeaderProps {
  onShowCollection?: () => void
  onShowProfile?: () => void
  onShowAuth?: () => void
  onGoHome?: () => void
  onSignOut?: () => void
}

const SPRITE_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items'

const Header: React.FC<HeaderProps> = ({ onShowCollection, onShowProfile, onShowAuth, onGoHome, onSignOut }) => {
  const profile = useAuthStore(state => state.profile)
  const stats = useAuthStore(state => state.stats)
  const isGuest = useAuthStore(state => state.isGuest)
  const signOut = useAuthStore(state => state.signOut)

  const displayBall = (!isGuest && profile?.display_ball) ? profile.display_ball : 'poke-ball'
  const ballName = BALL_NAMES[displayBall] ?? 'Poké Ball'
  const avatarUrl = (!isGuest && profile?.avatar_config) ? getAvatarUrl(profile.avatar_config) : null

  const handleSignOut = onSignOut ?? signOut

  return (
    <header className="relative sm:sticky sm:top-0 z-20 flex items-center justify-between px-4 sm:px-6 py-3 border-b border-gray-200 bg-white/80 backdrop-blur-sm rounded-t-lg mb-6">
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
        <h1 className="hidden sm:block font-pixel text-lg sm:text-xl md:text-2xl text-pokemon-red tracking-wide leading-none">Wurmple</h1>
      </button>

      {/* Right: ball badge + nav + auth */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Ball badge pill */}
        <div className="flex items-center gap-1.5 bg-gray-100 border border-gray-200 rounded-full px-2.5 py-1">
          <img
            src={`${SPRITE_BASE}/${displayBall}.png`}
            alt={ballName}
            className="w-6 h-6 object-contain"
            loading="lazy"
            decoding="async"
            width={24}
            height={24}
          />
          {!isGuest && stats !== null && (
            <span className="font-pixel text-sm text-gray-600 inline-flex items-center gap-1">
              <img
                src={streakIcon}
                alt="Streak"
                className="w-4 h-4 object-contain"
                loading="lazy"
                decoding="async"
                width={16}
                height={16}
              />
              {stats.current_streak}
            </span>
          )}
          {isGuest && (
            <span className="font-pixel text-sm font-medium text-gray-600">Guest</span>
          )}
        </div>

        {/* Nav icons (auth users only) */}
        {!isGuest && onShowCollection && (
          <div className="relative group">
            <button
              onClick={onShowCollection}
              className="p-1.5 text-gray-600 hover:text-pokemon-red transition-colors rounded-lg hover:bg-gray-100"
              aria-label="Collection"
            >
              <Archive size={18} />
            </button>
            <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1 px-2 py-0.5 bg-gray-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">
              Collection
            </span>
          </div>
        )}
        {!isGuest && onShowProfile && (
          <div className="relative group">
            <button
              onClick={onShowProfile}
              className="p-0.5 transition-colors rounded-full hover:bg-gray-100"
              aria-label="Profile"
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="Trainer avatar"
                  className="w-8 h-8 rounded-full object-cover border border-gray-200"
                  loading="lazy"
                  decoding="async"
                  width={32}
                  height={32}
                />
              ) : (
                <span className="w-8 h-8 rounded-full overflow-hidden border border-gray-200 inline-flex">
                  <DefaultAvatar size={32} />
                </span>
              )}
            </button>
            <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1 px-2 py-0.5 bg-gray-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">
              Profile
            </span>
          </div>
        )}

        {/* Auth action */}
        {isGuest ? (
          <div className="relative group">
            <button
              onClick={onShowAuth}
              className="bg-pokemon-red text-white px-3 py-1.5 rounded-full hover:bg-red-700 transition-colors flex items-center gap-1.5"
              aria-label="Sign In"
            >
              <LogIn size={16} />
              <span className="text-sm font-semibold hidden sm:inline">Sign In</span>
            </button>
          </div>
        ) : (
          <div className="relative group">
            <button
              onClick={handleSignOut}
              className="p-1.5 text-gray-500 hover:text-gray-700 transition-colors rounded-lg hover:bg-gray-100"
              aria-label="Sign Out"
            >
              <LogOut size={18} />
            </button>
            <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1 px-2 py-0.5 bg-gray-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">
              Sign Out
            </span>
          </div>
        )}
      </div>
    </header>
  )
}

export default Header
