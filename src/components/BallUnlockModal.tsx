import React from 'react'
import { ballSpriteUrl } from '../lib/sprites'

interface BallUnlockModalProps {
  ballName: string
  ballId: string
  visible: boolean
  onClose: () => void
}

const BallUnlockModal: React.FC<BallUnlockModalProps> = ({ ballName, ballId, visible, onClose }) => {
  if (!visible) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        className="bg-white pixel-frame pop-in p-8 max-w-sm w-full mx-4 text-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ball-unlock-title"
      >
        <div className="ball-burst-animate inline-block">
          <div className="unlock-ring-animate inline-block">
            <img
              src={ballSpriteUrl(ballId)}
              alt={ballName}
              className="sprite w-16 h-16"
              decoding="async"
              width={64}
              height={64}
            />
          </div>
        </div>
        <h2 id="ball-unlock-title" className="text-2xl font-bold text-pokemon-red mb-2">New Ball Unlocked!</h2>
        <p className="text-gray-500 text-sm mb-2">A new ball has been added to your case!</p>
        <p className="text-gray-800 text-lg font-bold mb-6">{ballName}</p>
        <button
          onClick={onClose}
          className="pixel-btn bg-pokemon-red text-white font-bold px-6 min-h-[44px] hover:bg-red-700"
        >
          Nice!
        </button>
      </div>
    </div>
  )
}

export default BallUnlockModal
