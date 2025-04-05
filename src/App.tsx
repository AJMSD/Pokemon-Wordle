import { useEffect } from 'react'
import { useGameStore } from './store/gameStore'
import Header from './components/Header'
import PokedexUI from './components/PokedexUI'
import ToastContainer from './components/ToastContainer'
import useToast from './hooks/useToast'
import { ToastProps } from './components/Toast'

function App() {
  const initializeGame = useGameStore(state => state.initializeGame)
  const { toasts, removeToast } = useToast()
  
  // Initialize game on app load
  useEffect(() => {
    initializeGame()
  }, [initializeGame])

  // Prepare toasts for the toast container
  const typedToasts = toasts.map(toast => ({
    ...toast,
    onClose: toast.onClose || (() => removeToast(toast.id))
  })) as (ToastProps & { id: string })[]

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 bg-white/50 backdrop-blur-sm rounded-lg shadow-lg my-4">
      <Header />
      <main>
        <PokedexUI />
      </main>
      <ToastContainer toasts={typedToasts} removeToast={removeToast} />
    </div>
  )
}

export default App
