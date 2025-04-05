import React from 'react'

const Header: React.FC = () => {
  return (
    <header className="mb-8 text-center">
      <h1 className="text-4xl md:text-5xl font-bold text-pokemon-red mb-2 tracking-wide">
        Wurmple
        <span className="inline-block ml-2 transform -rotate-12">
          <svg width="32" height="32" viewBox="0 0 24 24" className="fill-pokemon-red">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-5-9c.83 0 1.5-.67 1.5-1.5S7.83 8 7 8s-1.5.67-1.5 1.5S6.17 11 7 11zm10 0c.83 0 1.5-.67 1.5-1.5S17.83 8 17 8s-1.5.67-1.5 1.5.67 1.5 1.5 1.5zM12 17.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"/>
          </svg>
        </span>
      </h1>
      <p className="text-gray-600 md:text-lg mb-1">
        Guess the Daily Pokémon from the Pokédex!
      </p>
    </header>
  )
}

export default Header
