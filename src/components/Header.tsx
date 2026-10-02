import React from 'react'
import { Archive } from 'pixelarticons/react/Archive'
import { Login } from 'pixelarticons/react/Login'
import { Logout } from 'pixelarticons/react/Logout'
import { useAuthStore, BALL_NAMES } from '../store/authStore'
import { getAvatarUrl } from '../utils/avatarUtils'
import DefaultAvatar from './DefaultAvatar'
import useAvatarSrc from '../hooks/useAvatarSrc'
import streakIcon from '../../streak.png'
import { ballSpriteUrl } from '../lib/sprites'

interface HeaderProps {
  onShowCollection?: () => void
  onShowProfile?: () => void
  onShowAuth?: () => void
  onGoHome?: () => void
  onSignOut?: () => void
}

const Header: React.FC<HeaderProps> = ({ onShowCollection, onShowProfile, onShowAuth, onGoHome, onSignOut }) => {
  const profile = useAuthStore(state => state.profile)
  const stats = useAuthStore(state => state.stats)
  const isGuest = useAuthStore(state => state.isGuest)
  const isLoading = useAuthStore(state => state.isLoading)
  const bootProfile = useAuthStore(state => state.bootProfile)
  const signOut = useAuthStore(state => state.signOut)

  // While auth resolves, paint the cached trainer instead of flashing the guest chip.
  const boot = isGuest && isLoading ? bootProfile : null
  const showAsUser = !isGuest || boot !== null
  const viewProfile = boot ? boot.profile : (!isGuest ? profile : null)
  const viewStats = boot ? boot.stats : stats

  const displayBall = (showAsUser && viewProfile?.display_ball) ? viewProfile.display_ball : 'poke-ball'
  const ballName = BALL_NAMES[displayBall] ?? 'Poké Ball'
  const avatarUrl = viewProfile?.avatar_config ? getAvatarUrl(viewProfile.avatar_config) : null
  const avatarSrc = useAvatarSrc(avatarUrl)

  // Nav actions only work once the session has resolved.
  const handleShowCollection = boot ? undefined : onShowCollection
  const handleShowProfile = boot ? undefined : onShowProfile
  const handleSignOut = boot ? undefined : (onSignOut ?? signOut)

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between px-2 sm:px-6 py-1.5 md:py-2 border-b-2 border-gray-900 bg-white mb-2 md:mb-3">
      {/* Left: Logo + title */}
      <button
        onClick={onGoHome}
        className="flex items-center gap-2 min-h-[44px] md:min-h-0 hover:opacity-80 pixel-focus"
        aria-label="Go to game"
      >
        <img
          src={`${import.meta.env.BASE_URL}logo.png`}
          alt="Wurmple logo"
          className="sprite h-7 w-auto flex-shrink-0"
        />
        <h1 className="hidden sm:block font-pixel text-lg sm:text-xl md:text-2xl text-pokemon-red tracking-wide leading-none">Wurmple</h1>
      </button>

      {/* Right: ball badge + nav + auth */}
      <div className="flex items-center gap-1 sm:gap-3">
        {/* Ball badge pill */}
        <div
          className="inline-flex items-center gap-1.5 bg-gray-100 px-2.5 py-1"
          title={showAsUser ? `Equipped: ${ballName}` : undefined}
        >
          <img
            src={ballSpriteUrl(displayBall)}
            alt={showAsUser ? `Equipped: ${ballName}` : ballName}
            className="sprite w-6 h-6"
            decoding="async"
            width={24}
            height={24}
          />
          {showAsUser && viewStats !== null && (
            <span className="font-pixel text-sm text-gray-600 inline-flex items-center gap-1">
              <img
                src={streakIcon}
                alt="Streak"
                className="sprite w-4 h-4"
                decoding="async"
                width={16}
                height={16}
              />
              {viewStats.current_streak}
            </span>
          )}
          {!showAsUser && (
            <span className="font-pixel text-sm text-gray-600">Guest</span>
          )}
        </div>

        {/* Nav icons (auth users only) */}
        {showAsUser && (onShowCollection || boot) && (
          <div className="relative group">
            <button
              onClick={handleShowCollection}
              aria-disabled={!handleShowCollection || undefined}
              className="header-icon-btn inline-flex items-center justify-center min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 p-1 text-gray-600 hover:text-pokemon-red pixel-focus"
              aria-label="Collection"
            >
              <Archive width={24} height={24} aria-hidden="true" />
            </button>
            <span className="hidden md:block absolute top-full left-1/2 -translate-x-1/2 mt-1 px-2 py-0.5 bg-gray-800 text-white text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">
              Collection
            </span>
          </div>
        )}
        {showAsUser && (onShowProfile || boot) && (
          <div className="relative group">
            <button
              onClick={handleShowProfile}
              aria-disabled={!handleShowProfile || undefined}
              className="header-icon-btn inline-flex items-center justify-center min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 p-1 pixel-focus"
              aria-label="Profile"
            >
              {avatarSrc ? (
                <img
                  src={avatarSrc}
                  alt="Trainer avatar"
                  className="sprite w-8 h-8 object-cover bg-gray-50"
                  decoding="async"
                  width={32}
                  height={32}
                />
              ) : (
                <span className="w-8 h-8 overflow-hidden inline-flex">
                  <DefaultAvatar size={32} />
                </span>
              )}
            </button>
            <span className="hidden md:block absolute top-full left-1/2 -translate-x-1/2 mt-1 px-2 py-0.5 bg-gray-800 text-white text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">
              Profile
            </span>
          </div>
        )}

        {/* Auth action */}
        {!showAsUser ? (
          <div className="relative group">
            <button
              onClick={onShowAuth}
              className="pixel-btn bg-pokemon-red text-white px-3 py-1 min-h-[44px] md:min-h-0 hover:bg-red-700 flex items-center gap-1.5"
              aria-label="Sign In"
            >
              <Login width={24} height={24} aria-hidden="true" />
              <span className="text-sm font-bold hidden sm:inline">Sign In</span>
            </button>
          </div>
        ) : (
          <div className="relative group">
            <button
              onClick={handleSignOut}
              aria-disabled={!handleSignOut || undefined}
              className="header-icon-btn inline-flex items-center justify-center min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 p-1 text-gray-500 hover:text-gray-700 pixel-focus"
              aria-label="Sign Out"
            >
              <Logout width={24} height={24} aria-hidden="true" />
            </button>
            <span className="hidden md:block absolute top-full left-1/2 -translate-x-1/2 mt-1 px-2 py-0.5 bg-gray-800 text-white text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">
              Sign Out
            </span>
          </div>
        )}
      </div>
    </header>
  )
}

export default Header
