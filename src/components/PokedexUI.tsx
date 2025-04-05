import React, { useState, useEffect, useRef } from 'react'
import { useGameStore } from '../store/gameStore'
import HintPanel from './HintPanel'
import GuessList from './GuessList'
import useToast from '../hooks/useToast'
import useGame from '../hooks/useGame'

const PokedexUI: React.FC = () => {
  const [currentGuess, setCurrentGuess] = useState('')
  const { makeGuess, error, resetError, dailyPokemon, gameStatus, checkForNewDay } = useGameStore()
  const { getSuggestions } = useGame()
  const { showError, addToast } = useToast()
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [justSelected, setJustSelected] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  
  const suggestions = currentGuess.length > 0 ? getSuggestions(currentGuess) : []

  // Check for mobile viewport
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    
    // Initial check
    checkMobile();
    
    // Add resize listener
    window.addEventListener('resize', checkMobile);
    
    // Cleanup
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Check for a new day on component mount
  useEffect(() => {
    checkForNewDay();
  }, [checkForNewDay]);

  // Show error toast when error occurs
  useEffect(() => {
    if (error) {
      showError(error)
      resetError()
    }
    
    if (gameStatus === 'won') {
      addToast('Congratulations! You guessed correctly!', 'success')
    } else if (gameStatus === 'lost') {
      addToast(`Game over! The Pokémon was ${dailyPokemon?.name}.`, 'error')
    }
  }, [error, resetError, showError, gameStatus, addToast, dailyPokemon?.name])

  // Reset selected index when suggestions change
  useEffect(() => {
    setSelectedIndex(-1)
  }, [suggestions])

  const handleSubmitGuess = (e: React.FormEvent) => {
    e.preventDefault()
    if (currentGuess.trim() === '') return
    
    makeGuess(currentGuess)
    setCurrentGuess('')
    setShowSuggestions(false)
    setJustSelected(false)
  }

  const handleSelectSuggestion = (suggestion: string) => {
    setCurrentGuess(suggestion)
    setShowSuggestions(false)
    setSelectedIndex(-1)
    setJustSelected(true)
    
    // Focus the input after selection
    setTimeout(() => {
      inputRef.current?.focus()
    }, 10)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // If suggestions aren't showing or there are none, don't handle keyboard navigation
    if (!showSuggestions || suggestions.length === 0) {
      setJustSelected(false)
      return
    }

    // If we just selected and Enter is pressed again, submit the form
    if (justSelected && e.key === 'Enter') {
      e.preventDefault()
      formRef.current?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
      setJustSelected(false)
      return
    }

    // Reset justSelected flag for keys other than Enter
    if (e.key !== 'Enter') {
      setJustSelected(false)
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault() // Prevent cursor movement
        setSelectedIndex(prev => (prev < suggestions.length - 1 ? prev + 1 : 0))
        break
      case 'ArrowUp':
        e.preventDefault() // Prevent cursor movement
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : suggestions.length - 1))
        break
      case 'Enter':
        // If a suggestion is highlighted, select it instead of submitting
        if (selectedIndex >= 0) {
          e.preventDefault() // Prevent form submission
          handleSelectSuggestion(suggestions[selectedIndex])
        }
        break
      case 'Escape':
        e.preventDefault()
        setShowSuggestions(false)
        setSelectedIndex(-1)
        break
    }
  }

  // Determine what to show in the main screen
  const pokemonImage = dailyPokemon?.sprites?.other?.['official-artwork']?.front_default || dailyPokemon?.sprites?.front_default;

  // Conditionally render main screen content based on game status and device
  const renderMainScreenContent = () => {
    if (isMobile) {
      // On mobile: show hint panel when not won, show pokemon when won
      if (gameStatus === 'won') {
        return (
          <div className="pokemon-image-container">
            <img src={pokemonImage} alt={dailyPokemon?.name} className="pokemon-image" />
          </div>
        );
      } else {
        return (
          <div className="mobile-hint-panel">
            <HintPanel />
          </div>
        );
      }
    } else {
      // On desktop: show the regular unknown or won state
      if (gameStatus === 'won') {
        return (
          <div className="pokemon-image-container">
            <img src={pokemonImage} alt={dailyPokemon?.name} className="pokemon-image" />
          </div>
        );
      } else {
        return <div className="unknown-pokemon">?</div>;
      }
    }
  };

  return (
    <div className="pokedex">
      <div className="pokedex-left-panel">
        <div className="left-panel-top">
          <div className="blue-light"></div>
          <div className="small-lights-container">
            <div className="small-light red"></div>
            <div className="small-light yellow"></div>
            <div className="small-light green"></div>
          </div>
        </div>
        <div className="main-screen-container">
          <div className="main-screen">
            {renderMainScreenContent()}
          </div>
          <div className="main-screen-decorations">
            <div className="bottom-lights-container">
              <div className="bottom-light red"></div>
              <div className="bottom-light green"></div>
            </div>
            <div className="sound-holes">
              <div className={`sound-hole ${gameStatus === 'won' ? 'win-glow' : ''}`}></div>
              <div className={`sound-hole ${gameStatus === 'won' ? 'win-glow' : ''}`}></div>
              <div className={`sound-hole ${gameStatus === 'won' ? 'win-glow' : ''}`}></div>
              <div className={`sound-hole ${gameStatus === 'won' ? 'win-glow' : ''}`}></div>
            </div>
          </div>
        </div>
        <div className="guess-input-container">
          <form ref={formRef} onSubmit={handleSubmitGuess} className="guess-form">
            <input
              ref={inputRef}
              type="text"
              value={currentGuess}
              onChange={(e) => {
                setCurrentGuess(e.target.value)
                setShowSuggestions(e.target.value.length > 0)
              }}
              onKeyDown={handleKeyDown}
              className="guess-input"
              placeholder="Enter Pokémon name..."
              autoComplete="off"
              autoFocus
              disabled={gameStatus !== 'playing'}
            />
            <div className="masterball-button-container">
              <button 
                type="submit" 
                className="masterball-button"
                disabled={currentGuess.trim() === '' || gameStatus !== 'playing'}
                aria-label="Submit guess"
              >
                <div className="masterball">
                  <div className="masterball-top">
                    <div className="masterball-m">M</div>
                    <div className="masterball-dots">
                      <div className="masterball-dot"></div>
                      <div className="masterball-dot"></div>
                    </div>
                  </div>
                  <div className="masterball-stripe"></div>
                  <div className="masterball-bottom"></div>
                  <div className="masterball-button-center"></div>
                </div>
              </button>
            </div>
            {showSuggestions && suggestions.length > 0 && (
              <div className="suggestions-dropdown">
                {suggestions.map((suggestion, index) => (
                  <div
                    key={index}
                    className={`suggestion-item ${index === selectedIndex ? 'bg-gray-200' : ''}`}
                    onClick={() => handleSelectSuggestion(suggestion)}
                  >
                    {suggestion}
                  </div>
                ))}
              </div>
            )}
          </form>
        </div>
      </div>
      <div className="pokedex-right-panel">
        <div className="right-panel-screen">
          {!isMobile && <HintPanel />}
        </div>
        <div className="guesses-container">
          <GuessList />
        </div>
      </div>
    </div>
  )
}

export default PokedexUI
