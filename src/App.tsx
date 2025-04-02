import { useEffect } from 'react'
import { useGameStore } from './store/gameStore'
import GameBoard from './components/GameBoard'
import Header from './components/Header'

function App() {
  const initializeGame = useGameStore(state => state.initializeGame)
  
  useEffect(() => {
    initializeGame()
  }, [initializeGame])

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Header />
      <main>
        <GameBoard />
      </main>
    </div>
  )
}

export default App
