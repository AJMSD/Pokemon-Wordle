import React from 'react'

interface BallUnlockModalProps {
  ballName: string
  ballId: string
  visible: boolean
  onClose: () => void
}

const BallUnlockModal: React.FC<BallUnlockModalProps> = ({ ballName, visible, onClose }) => {
  if (!visible) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full mx-4 text-center">
        <div className="text-5xl mb-4">🏆</div>
        <h2 className="text-2xl font-bold text-pokemon-red mb-2">New Ball Unlocked!</h2>
        <p className="text-gray-700 text-lg font-semibold mb-6">{ballName}</p>
        <button
          onClick={onClose}
          className="bg-pokemon-red text-white font-bold px-6 py-2 rounded-full hover:bg-red-700 transition-colors"
        >
          Nice!
        </button>
      </div>
    </div>
  )
}

export default BallUnlockModal
