import React, { useState, useEffect } from 'react'
import { useAuthStore } from '../store/authStore'

interface AvatarPickerProps {
  onClose: () => void
}

const SPRITE_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon'
const CACHE_KEY = 'wurmple_avatar_pokemon_list'

interface PokemonEntry {
  id: number
  name: string
}

const AvatarPicker: React.FC<AvatarPickerProps> = ({ onClose }) => {
  const [selected, setSelected] = useState<number | null>(null)
  const [isShiny, setIsShiny] = useState(false)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [pokemonMap, setPokemonMap] = useState<PokemonEntry[]>(() => {
    // Seed with first 50 as fallback while fetching
    return Array.from({ length: 50 }, (_, i) => ({ id: i + 1, name: `#${i + 1}` }))
  })
  const updateAvatar = useAuthStore(state => state.updateAvatar)

  useEffect(() => {
    const cached = localStorage.getItem(CACHE_KEY)
    if (cached) {
      try { setPokemonMap(JSON.parse(cached)); return } catch { /* fall through to fetch */ }
    }
    fetch('https://pokeapi.co/api/v2/pokemon?limit=1025')
      .then(r => r.json())
      .then(data => {
        const list: PokemonEntry[] = data.results.map((p: { name: string }, i: number) => ({ id: i + 1, name: p.name }))
        setPokemonMap(list)
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(list)) } catch { /* ignore quota */ }
      })
      .catch(() => { /* keep fallback */ })
  }, [])

  const filtered = search.trim()
    ? pokemonMap.filter(p => p.name.includes(search.toLowerCase().trim()))
    : pokemonMap

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

        <div className="flex items-center gap-3 mb-3">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search Pokémon..."
            className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-pokemon-red/40"
          />
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer select-none whitespace-nowrap">
            <input
              type="checkbox"
              checked={isShiny}
              onChange={e => setIsShiny(e.target.checked)}
              className="rounded border-gray-300 text-pokemon-red focus:ring-pokemon-red"
            />
            Shiny
          </label>
        </div>

        <div className="grid grid-cols-5 gap-2 mb-6 max-h-64 overflow-y-auto pr-1">
          {filtered.length === 0 ? (
            <p className="col-span-5 text-center text-sm text-gray-400 py-4">No Pokémon found</p>
          ) : filtered.map(p => (
            <button
              key={p.id}
              onClick={() => setSelected(p.id)}
              className={`rounded-lg border-2 p-1 transition-colors flex flex-col items-center ${
                selected === p.id
                  ? 'border-pokemon-red bg-red-50'
                  : 'border-gray-200 hover:border-gray-400'
              }`}
              title={p.name}
            >
              <img
                src={spriteUrl(p.id)}
                alt={p.name}
                className="w-full h-auto"
                loading="lazy"
              />
              <span className="text-[9px] text-gray-500 truncate w-full text-center leading-tight mt-0.5">{p.name}</span>
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
