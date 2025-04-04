import React from 'react'

const Header: React.FC = () => {
  return (
    <header className="mb-8 text-center">
      <h1 className="text-4xl font-bold text-pokemon-red mb-2">Wurmple</h1>
      <p className="text-gray-600 mb-1">
        Guess the Daily Pokémon from the Pokédex!
      </p>
    </header>
  )
}

export default Header
