export interface AvatarConfig {
  avatar_mode?: 'default' | 'pokemon'
  avatar_pokemon_id?: number
  avatar_form_id?: string | null
  avatar_is_shiny?: boolean
}

const SPRITE_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon'

export function getAvatarUrl(config: AvatarConfig): string | null {
  if (!config.avatar_mode || config.avatar_mode === 'default') return null
  if (!config.avatar_pokemon_id) return null
  if (config.avatar_is_shiny) return `${SPRITE_BASE}/shiny/${config.avatar_pokemon_id}.png`
  return `${SPRITE_BASE}/${config.avatar_pokemon_id}.png`
}
