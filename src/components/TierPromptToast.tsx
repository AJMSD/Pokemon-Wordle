import React from 'react'
import { ballSpriteUrl } from '../lib/sprites'

interface TierPromptToastProps {
  tierId: string
  tierName: string
  onSwitch: () => void
  onDismiss: () => void
}

const TierPromptToast: React.FC<TierPromptToastProps> = ({ tierId, tierName, onSwitch, onDismiss }) => {
  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-4">
      <div className="bg-white pixel-frame pop-in p-4 flex items-center gap-3" role="status">
        <img
          src={ballSpriteUrl(tierId)}
          alt={tierName}
          className="sprite w-10 h-10 flex-shrink-0"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900">You've reached {tierName}!</p>
          <p className="text-xs text-gray-500">Switch your display ball?</p>
          <div className="flex gap-2 mt-2">
            <button
              onClick={onSwitch}
              className="pixel-btn text-xs bg-pokemon-red text-white font-bold px-3 min-h-[44px] hover:bg-red-700"
            >
              Switch
            </button>
            <button
              onClick={onDismiss}
              className="pixel-btn text-xs bg-white text-gray-600 px-3 min-h-[44px] hover:bg-gray-100"
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
