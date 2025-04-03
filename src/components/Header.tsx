import React from 'react'

const Header: React.FC = () => {
  // Get today's date in a user-friendly format
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return (
    <header className="mb-8 text-center">
      <h1 className="text-4xl font-bold text-pokemon-red mb-2">Wurmple</h1>
      <p className="text-gray-600 mb-1">
        Guess the daily Pokémon! You have 10 chances.
      </p>
      <p className="text-sm text-gray-500">
        Daily challenge for {today}
      </p>
    </header>
  )
}

export default Header
