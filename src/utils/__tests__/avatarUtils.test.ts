import { describe, it, expect } from 'vitest'
import { getAvatarUrl } from '../avatarUtils'

const SPRITE_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon'

describe('getAvatarUrl', () => {
  it('returns null when avatar_mode is not set', () => {
    expect(getAvatarUrl({})).toBeNull()
  })

  it('returns null when avatar_mode is default', () => {
    expect(getAvatarUrl({ avatar_mode: 'default' })).toBeNull()
  })

  it('returns null when avatar_mode is pokemon but no pokemon id', () => {
    expect(getAvatarUrl({ avatar_mode: 'pokemon' })).toBeNull()
  })

  it('returns regular sprite URL for pokemon mode with id', () => {
    expect(getAvatarUrl({ avatar_mode: 'pokemon', avatar_pokemon_id: 25 }))
      .toBe(`${SPRITE_BASE}/25.png`)
  })

  it('returns shiny sprite URL when avatar_is_shiny is true', () => {
    expect(getAvatarUrl({ avatar_mode: 'pokemon', avatar_pokemon_id: 25, avatar_is_shiny: true }))
      .toBe(`${SPRITE_BASE}/shiny/25.png`)
  })

  it('returns regular sprite URL when avatar_is_shiny is false', () => {
    expect(getAvatarUrl({ avatar_mode: 'pokemon', avatar_pokemon_id: 6, avatar_is_shiny: false }))
      .toBe(`${SPRITE_BASE}/6.png`)
  })
})
