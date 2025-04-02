import React, { useState, useRef, useEffect, useMemo, KeyboardEvent } from 'react'
import useGame from '../hooks/useGame'

interface GuessInputProps {
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onSubmit: (e: React.FormEvent) => void
  attemptsLeft: number
}

const GuessInput: React.FC<GuessInputProps> = ({ 
  value, 
  onChange, 
  onSubmit, 
  attemptsLeft 
}) => {
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [justSelected, setJustSelected] = useState(false)
  const { getSuggestions } = useGame()
  const inputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  
  // Memoize suggestions to prevent recalculating on every render
  const suggestions = useMemo(() => 
    value.length > 0 ? getSuggestions(value) : []
  , [value, getSuggestions])
  
  const suggestionRef = useRef<HTMLDivElement>(null)
  
  // Handle clicking outside suggestions to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (suggestionRef.current && !suggestionRef.current.contains(event.target as Node)) {
        setShowSuggestions(false)
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])
  
  // Reset selected index when suggestions change
  useEffect(() => {
    setSelectedIndex(-1)
  }, [suggestions])
  
  // Handle value changes to control suggestions visibility
  useEffect(() => {
    // Only show suggestions when we have input and matching suggestions
    setShowSuggestions(value.length > 0 && suggestions.length > 0)
  }, [value, suggestions])
  
  const handleSelectSuggestion = (suggestion: string) => {
    const e = { target: { value: suggestion } } as React.ChangeEvent<HTMLInputElement>
    onChange(e)
    // Force dropdown to close immediately
    setShowSuggestions(false)
    setSelectedIndex(-1)
    setJustSelected(true)
    
    // Focus the input to prepare for the next Enter key press
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }
  
  // Handle keyboard navigation
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // If we just selected and Enter is pressed again, submit the form
    if (justSelected && e.key === 'Enter') {
      e.preventDefault()
      formRef.current?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
      setJustSelected(false)
      return
    }
    
    // Reset the justSelected flag for other keys
    if (e.key !== 'Enter') {
      setJustSelected(false)
    }
    
    if (!showSuggestions || suggestions.length === 0) return
    
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault() // Prevent cursor from moving
        setSelectedIndex(prev => (prev < suggestions.length - 1 ? prev + 1 : 0))
        break
      case 'ArrowUp':
        e.preventDefault() // Prevent cursor from moving
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : suggestions.length - 1))
        break
      case 'Enter':
        // If a suggestion is highlighted, select it
        if (selectedIndex >= 0) {
          e.preventDefault() // Prevent form submission
          handleSelectSuggestion(suggestions[selectedIndex])
        } else {
          // Otherwise, let the form submission happen
          setShowSuggestions(false)
        }
        break
      case 'Escape':
        e.preventDefault()
        setShowSuggestions(false)
        setSelectedIndex(-1)
        // Blur input on escape to ensure dropdown doesn't reappear
        inputRef.current?.blur()
        break
      case 'Tab':
        // Close dropdown on tab
        setShowSuggestions(false)
        break
    }
  }
  
  // Also close dropdown when input blurs
  const handleBlur = () => {
    // Small delay to allow click events on suggestions to complete first
    setTimeout(() => {
      if (!suggestionRef.current?.contains(document.activeElement)) {
        setShowSuggestions(false)
      }
    }, 100)
  }
  
  const handleFormSubmit = (e: React.FormEvent) => {
    onSubmit(e)
    setShowSuggestions(false) // Hide suggestions on submit
    setJustSelected(false)    // Reset the flag
  }
  
  return (
    <div className="mt-4 relative">
      <form ref={formRef} onSubmit={handleFormSubmit} className="flex flex-col items-center">
        <div className="w-full max-w-md relative">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={onChange}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            onFocus={() => value && suggestions.length > 0 && setShowSuggestions(true)}
            className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            placeholder="Enter a Pokémon name..."
            autoComplete="off"
            autoFocus
          />
          
          {showSuggestions && suggestions.length > 0 && (
            <div 
              ref={suggestionRef}
              className="absolute z-10 mt-1 w-full bg-white shadow-lg max-h-60 rounded-md py-1 text-base overflow-auto focus:outline-none sm:text-sm"
            >
              {suggestions.map((suggestion, index) => (
                <div
                  key={index}
                  className={`cursor-pointer px-4 py-2 ${
                    index === selectedIndex ? 'bg-primary-100 text-primary-900' : 'hover:bg-gray-100'
                  }`}
                  onClick={() => handleSelectSuggestion(suggestion)}
                >
                  {suggestion}
                </div>
              ))}
            </div>
          )}
        </div>
        
        <div className="mt-2 flex items-center justify-between w-full max-w-md">
          <span className="text-sm text-gray-500">
            {attemptsLeft} attempts remaining
          </span>
          
          <button
            type="submit"
            className="btn btn-primary"
            disabled={value.trim() === ''}
          >
            Guess
          </button>
        </div>
      </form>
    </div>
  )
}

export default GuessInput
