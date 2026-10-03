import React, { useState, useEffect } from 'react'
import { useAuthStore } from '../store/authStore'
import { POKEMON_SPRITE_BASE } from '../lib/sprites'
import DefaultAvatar from './DefaultAvatar'
import { normalizePokemonName } from '../utils/pokemonUtils'

interface AvatarPickerProps {
  onClose: () => void
}

const CACHE_KEY = 'wurmple_avatar_pokemon_list'

interface PokemonEntry {
  id: number
  name: string
}

const AvatarPicker: React.FC<AvatarPickerProps> = ({ onClose }) => {
  // 'red' is the default trainer avatar; numbers are Pokémon ids.
  const [selected, setSelected] = useState<number | 'red' | null>(null)
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
      try {
        // Older caches hold raw PokéAPI names like 'lycanroc-midday'.
        const list: PokemonEntry[] = JSON.parse(cached)
        setPokemonMap(list.map(p => ({ ...p, name: normalizePokemonName(p.name) })))
        return
      } catch { /* fall through to fetch */ }
    }
    fetch('https://pokeapi.co/api/v2/pokemon?limit=1025')
      .then(r => r.json())
      .then(data => {
        const list: PokemonEntry[] = data.results.map((p: { name: string }, i: number) => ({ id: i + 1, name: normalizePokemonName(p.name) }))
        setPokemonMap(list)
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(list)) } catch { /* ignore quota */ }
      })
      .catch(() => { /* keep fallback */ })
  }, [])

  const query = search.toLowerCase().trim()
  const filtered = query
    ? pokemonMap.filter(p => p.name.includes(query))
    : pokemonMap
  const showRed = !query || 'red trainer'.includes(query)

  const spriteUrl = (id: number) =>
    isShiny ? `${POKEMON_SPRITE_BASE}/shiny/${id}.png` : `${POKEMON_SPRITE_BASE}/${id}.png`

  async function handleConfirm() {
    if (!selected) return
    setSaving(true)
    await updateAvatar(selected === 'red'
      ? { avatar_mode: 'default' }
      : { avatar_mode: 'pokemon', avatar_pokemon_id: selected, avatar_is_shiny: isShiny })
    setSaving(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white pixel-frame w-full max-w-sm sm:max-w-xl md:max-w-2xl p-4 sm:p-6 max-h-[calc(100dvh-2rem)] overflow-y-auto no-scrollbar" role="dialog" aria-modal="true" aria-labelledby="avatar-picker-title">
        <h2 id="avatar-picker-title" className="text-xl font-bold text-center text-gray-900 mb-4">Choose your trainer</h2>

        <div className="flex items-center gap-3 mb-3">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search Pokémon..."
            aria-label="Search Pokémon"
            className="pixel-input flex-1 min-w-0 text-sm bg-white px-3 py-1.5"
          />
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none whitespace-nowrap">
            <input
              type="checkbox"
              checked={isShiny}
              onChange={e => setIsShiny(e.target.checked)}
              className="w-4 h-4 accent-pokemon-red pixel-focus"
            />
            Shiny
          </label>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4 sm:mb-6 max-h-[min(16rem,40dvh)] sm:max-h-[min(26rem,55dvh)] overflow-y-auto no-scrollbar">
          {showRed && (
            <button
              onClick={() => setSelected('red')}
              aria-pressed={selected === 'red'}
              className={`border-2 p-1 flex flex-col items-center pixel-focus ${
                selected === 'red'
                  ? 'border-pokemon-red bg-red-50'
                  : 'border-gray-200 hover:border-gray-400'
              }`}
              title="Red (default)"
            >
              <span className="w-full aspect-square inline-flex [&>svg]:w-full [&>svg]:h-full">
                <DefaultAvatar size={64} />
              </span>
              <span className="text-[9px] text-gray-500 w-full text-center leading-tight mt-0.5 break-all">red</span>
            </button>
          )}
          {filtered.length === 0 && !showRed ? (
            <p className="col-span-full text-center text-sm text-gray-400 py-4">No Pokémon found</p>
          ) : filtered.map(p => (
            <button
              key={p.id}
              onClick={() => setSelected(p.id)}
              aria-pressed={selected === p.id}
              className={`border-2 p-1 flex flex-col items-center pixel-focus ${
                selected === p.id
                  ? 'border-pokemon-red bg-red-50'
                  : 'border-gray-200 hover:border-gray-400'
              }`}
              title={p.name}
            >
              <img
                src={spriteUrl(p.id)}
                alt={p.name}
                className="sprite w-full h-auto"
                loading="lazy"
              />
              <span className="text-[9px] text-gray-500 w-full text-center leading-tight mt-0.5 break-all">{p.name}</span>
            </button>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="pixel-btn flex-1 min-h-[44px] bg-white text-gray-700 font-bold hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selected || saving}
            className="pixel-btn flex-1 min-h-[44px] bg-pokemon-red text-white font-bold hover:bg-red-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default AvatarPicker
