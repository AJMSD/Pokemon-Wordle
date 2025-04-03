import React from 'react'
import { useGameStore } from '../store/gameStore'

const HintPanel: React.FC = () => {
  const { hints, dailyPokemon, guesses } = useGameStore()
  
  if (guesses.length === 0) {
    return null
  }
  
  return (
    <div className="mt-6 p-4 bg-pokemon-blue/10 rounded-md border border-pokemon-blue/30 shadow-sm">
      <h2 className="text-xl font-semibold mb-3 text-pokemon-blue">Hints</h2>
      
      <div className="space-y-3">
        <HintItem 
          label="Ability" 
          value={dailyPokemon?.abilities?.[0]?.ability?.name || "Static"}
          revealed={hints[0].revealed}
          unlocksAt={3}
          currentGuesses={guesses.length}
        />
        
        <HintItem 
          label="Generation" 
          value={hints[1].value || "Generation I"}
          revealed={hints[1].revealed}
          unlocksAt={6}
          currentGuesses={guesses.length}
        />
        
        <HintItem 
          label="Type(s)" 
          value={Array.isArray(hints[2].value) ? hints[2].value.join(", ") : "Electric"}
          revealed={hints[2].revealed}
          unlocksAt={9}
          currentGuesses={guesses.length}
        />
      </div>
    </div>
  )
}

interface HintItemProps {
  label: string;
  value: string;
  revealed: boolean;
  unlocksAt: number;
  currentGuesses: number;
}

const HintItem: React.FC<HintItemProps> = ({ 
  label, 
  value, 
  revealed, 
  unlocksAt, 
  currentGuesses 
}) => {
  const remaining = unlocksAt - currentGuesses;
  const willUnlockSoon = remaining > 0 && remaining <= 2;
  
  return (
    <div className={`flex items-center p-2 rounded ${
      revealed ? 'bg-pokemon-white' : willUnlockSoon ? 'bg-pokemon-yellow/20' : ''
    }`}>
      <div className="w-28 font-medium text-gray-700">{label}:</div>
      <div>
        {revealed ? (
          <span className="font-medium text-pokemon-red">{value}</span>
        ) : (
          <span className="text-gray-500">
            {willUnlockSoon 
              ? `Unlocks in ${remaining} more ${remaining === 1 ? 'guess' : 'guesses'}!` 
              : `Revealed after ${unlocksAt} guesses`}
          </span>
        )}
      </div>
    </div>
  )
}

export default HintPanel
