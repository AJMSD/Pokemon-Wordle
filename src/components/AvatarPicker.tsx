import React, { useState } from 'react'
import { useAuthStore } from '../store/authStore'

interface AvatarPickerProps {
  onClose: () => void
}

const SPRITE_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon'

const AvatarPicker: React.FC<AvatarPickerProps> = ({ onClose }) => {
  const [selected, setSelected] = useState<number | null>(null)
  const [isShiny, setIsShiny] = useState(false)
  const [saving, setSaving] = useState(false)
  const updateAvatar = useAuthStore(state => state.updateAvatar)

  const spriteUrl = (id: number) =>
    isShiny ? `${SPRITE_BASE}/shiny/${id}.png` : `${SPRITE_BASE}/${id}.png`

  async function handleConfirm() {
    if (!selected) return
    setSaving(true)
    await updateAvatar({ avatar_mode: 'pokemon', avatar_pokemon_id: selected, avatar_is_shiny: isShiny })
    setSaving(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
        <h2 className="text-xl font-bold text-center text-gray-900 mb-4">Choose your trainer</h2>

        <div className="flex items-center justify-center gap-2 mb-4">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isShiny}
              onChange={e => setIsShiny(e.target.checked)}
              className="rounded border-gray-300 text-pokemon-red focus:ring-pokemon-red"
            />
            Shiny
          </label>
        </div>

        <div className="grid grid-cols-5 gap-2 mb-6">
          {Array.from({ length: 20 }, (_, i) => i + 1).map(id => (
            <button
              key={id}
              onClick={() => setSelected(id)}
              className={`rounded-lg border-2 p-1 transition-colors ${
                selected === id
                  ? 'border-pokemon-red bg-red-50'
                  : 'border-gray-200 hover:border-gray-400'
              }`}
              title={`Pokémon #${id}`}
            >
              <img
                src={spriteUrl(id)}
                alt={`Pokémon #${id}`}
                className="w-full h-auto"
                loading="lazy"
              />
            </button>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selected || saving}
            className="flex-1 py-2 rounded-lg bg-pokemon-red text-white font-semibold hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default AvatarPicker
