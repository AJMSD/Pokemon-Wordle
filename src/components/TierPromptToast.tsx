import React from 'react'

interface TierPromptToastProps {
  tierId: string
  tierName: string
  onSwitch: () => void
  onDismiss: () => void
}

const SPRITE_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items'

const TierPromptToast: React.FC<TierPromptToastProps> = ({ tierId, tierName, onSwitch, onDismiss }) => {
  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-4">
      <div
        className="bg-white rounded-xl shadow-lg border border-gray-200 p-4 flex items-center gap-3"
        style={{ animation: 'fadeInScale 0.3s ease-out' }}
      >
        <img
          src={`${SPRITE_BASE}/${tierId}.png`}
          alt={tierName}
          className="w-10 h-10 flex-shrink-0 object-contain"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">You've reached {tierName}!</p>
          <p className="text-xs text-gray-500">Switch your display ball?</p>
          <div className="flex gap-2 mt-2">
            <button
              onClick={onSwitch}
              className="text-xs bg-pokemon-red text-white font-semibold px-3 py-1 rounded-full hover:bg-red-700 transition-colors"
            >
              Switch
            </button>
            <button
              onClick={onDismiss}
              className="text-xs text-gray-500 font-medium px-3 py-1 rounded-full hover:bg-gray-100 transition-colors border border-gray-200"
            >
              Later
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default TierPromptToast
