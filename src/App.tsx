import { useEffect } from 'react'
import { useGameStore } from './store/gameStore'
import Header from './components/Header'
import PokedexUI from './components/PokedexUI'
import ToastContainer from './components/ToastContainer'
import useToast from './hooks/useToast'

function App() {
  const initializeGame = useGameStore(state => state.initializeGame)
  const { toasts, removeToast } = useToast()
  
  useEffect(() => {
    initializeGame()
  }, [initializeGame])

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 bg-white/50 backdrop-blur-sm rounded-lg shadow-lg my-4">
      <Header />
      <main>
        <PokedexUI />
      </main>
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  )
}

export default App
