import { useEffect } from 'react'
import { useAuthStore } from '../store/authStore'
import { fetchAsDataUrl } from '../lib/profileCache'

/**
 * Returns the cached data URL for an avatar sprite when it matches `avatarUrl`,
 * otherwise the network URL. Signed-in users get the data URL cached in the
 * background so the next load paints the avatar without a network round trip.
 */
export default function useAvatarSrc(avatarUrl: string | null): string | null {
  const cachedAvatar = useAuthStore(state => state.cachedAvatar)
  const hasSession = useAuthStore(state => Boolean(state.session))
  const cacheAvatar = useAuthStore(state => state.cacheAvatar)
  const isCached = Boolean(avatarUrl && cachedAvatar?.src === avatarUrl)

  useEffect(() => {
    if (!avatarUrl || !hasSession || isCached) return
    let cancelled = false
    void fetchAsDataUrl(avatarUrl).then(dataUrl => {
      if (!cancelled && dataUrl) cacheAvatar(avatarUrl, dataUrl)
    })
    return () => { cancelled = true }
  }, [avatarUrl, hasSession, isCached, cacheAvatar])

  if (!avatarUrl) return null
  return isCached ? cachedAvatar!.dataUrl : avatarUrl
}
