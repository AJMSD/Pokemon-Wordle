import React, { useState } from 'react'
import { useAuthStore } from '../store/authStore'
import { getAvatarUrl } from '../utils/avatarUtils'
import DefaultAvatar from './DefaultAvatar'
import AvatarPicker from './AvatarPicker'

interface ProfilePageProps {
  onBack: () => void
}

const ProfilePage: React.FC<ProfilePageProps> = ({ onBack }) => {
  const profile = useAuthStore(state => state.profile)
  const [showPicker, setShowPicker] = useState(false)

  const avatarUrl = profile?.avatar_config ? getAvatarUrl(profile.avatar_config) : null

  return (
    <div className="max-w-sm mx-auto py-6">
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6 transition-colors"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Back to Game
      </button>

      <div className="bg-white rounded-xl shadow p-6 text-center">
        <div className="flex flex-col items-center gap-3 mb-6">
          {avatarUrl ? (
            <img src={avatarUrl} alt="avatar" className="w-16 h-16 rounded-lg" />
          ) : (
            <DefaultAvatar size={64} />
          )}
          <div>
            <p className="text-lg font-bold text-gray-900">{profile?.username ?? '—'}</p>
            <p className="text-xs text-gray-400 capitalize">{profile?.display_ball ?? '—'}</p>
          </div>
          <button
            onClick={() => setShowPicker(true)}
            className="text-xs text-pokemon-red font-semibold hover:underline"
          >
            Change Avatar
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 text-center">
          {[
            { label: 'Current Streak', value: '—' },
            { label: 'Best Streak', value: '—' },
            { label: 'Win Rate', value: '—' },
            { label: 'Avg Guesses', value: '—' },
          ].map(({ label, value }) => (
            <div key={label} className="bg-gray-50 rounded-lg p-3">
              <p className="text-xl font-bold text-gray-900">{value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {showPicker && <AvatarPicker onClose={() => setShowPicker(false)} />}
    </div>
  )
}

export default ProfilePage
