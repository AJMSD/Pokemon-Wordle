import React from 'react'

interface DefaultAvatarProps {
  size?: number
}

const DefaultAvatar: React.FC<DefaultAvatarProps> = ({ size = 64 }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Default trainer avatar"
    >
      <rect width="64" height="64" rx="8" fill="#1a1a2e" />
      {/* Cap brim */}
      <rect x="14" y="22" width="36" height="5" rx="2" fill="#cc0000" />
      {/* Cap top */}
      <rect x="20" y="10" width="24" height="14" rx="3" fill="#cc0000" />
      {/* Head */}
      <ellipse cx="32" cy="30" rx="11" ry="10" fill="#e8c49a" />
      {/* Eyes */}
      <circle cx="28" cy="29" r="1.5" fill="#1a1a2e" />
      <circle cx="36" cy="29" r="1.5" fill="#1a1a2e" />
      {/* Body */}
      <path d="M18 56 Q18 42 32 40 Q46 42 46 56 Z" fill="#cc0000" />
      {/* Jacket trim */}
      <line x1="32" y1="40" x2="32" y2="56" stroke="#ffffff" strokeWidth="1.5" />
    </svg>
  )
}

export default DefaultAvatar
