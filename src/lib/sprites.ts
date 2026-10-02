// Ball sprites are self-hosted (public/sprites/items) so they share the site's
// long-lived cache instead of waiting on raw.githubusercontent.com.
const BALL_SPRITE_BASE = `${import.meta.env.BASE_URL}sprites/items`

export const POKEMON_SPRITE_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon'

export function ballSpriteUrl(ballId: string): string {
  return `${BALL_SPRITE_BASE}/${ballId}.png`
}
