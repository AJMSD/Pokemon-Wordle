import React, { useState, useEffect } from 'react'
import { useAuthStore } from '../store/authStore'

type AuthView = 'login' | 'signup' | 'forgot-password' | 'verify-email' | 'reset-password' | 'username-setup'

interface AuthModalProps {
  isOpen: boolean
  onClose: () => void
  initialView?: 'login' | 'signup'
  forceView?: 'reset-password' | 'username-setup'
}

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z" />
    <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z" />
    <path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z" />
    <path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3z" />
  </svg>
)

const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, initialView = 'login', forceView }) => {
  const [currentView, setCurrentView] = useState<AuthView>(forceView ?? initialView)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [username, setUsername] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const signIn = useAuthStore(state => state.signIn)
  const signUp = useAuthStore(state => state.signUp)
  const signInWithGoogle = useAuthStore(state => state.signInWithGoogle)
  const sendPasswordReset = useAuthStore(state => state.sendPasswordReset)
  const confirmPasswordReset = useAuthStore(state => state.confirmPasswordReset)
  const resendVerification = useAuthStore(state => state.resendVerification)
  const setupUsername = useAuthStore(state => state.setupUsername)
  const clearPasswordRecovery = useAuthStore(state => state.clearPasswordRecovery)

  useEffect(() => {
    if (!isOpen) return
    if (forceView) {
      setCurrentView(forceView)
    } else {
      setCurrentView(initialView)
    }
    setError(null)
    setSuccess(null)
    setEmail('')
    setPassword('')
    setConfirmPassword('')
    setUsername('')
  }, [forceView, isOpen, initialView])

  useEffect(() => {
    if (!isOpen || forceView) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, forceView, onClose])

  if (!isOpen) return null

  const canClose = !forceView

  const switchView = (view: AuthView) => {
    setError(null)
    setSuccess(null)
    setEmail('')
    setPassword('')
    setConfirmPassword('')
    setUsername('')
    setCurrentView(view)
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsLoading(true)
    const { error } = await signIn(email, password)
    setIsLoading(false)
    if (error) { setError(error) } else { onClose() }
  }

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setIsLoading(true)
    const { error } = await signUp(email, password, username)
    setIsLoading(false)
    if (error) { setError(error) } else { switchView('verify-email') }
  }

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setIsLoading(true)
    const { error } = await sendPasswordReset(email)
    setIsLoading(false)
    if (error) { setError(error) } else { setSuccess('Reset email sent! Check your inbox.') }
  }

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    if (password !== confirmPassword) { setError("Passwords don't match!"); return }
    setIsLoading(true)
    const { error } = await confirmPasswordReset(password)
    setIsLoading(false)
    if (error) { setError(error) } else { clearPasswordRecovery(); onClose() }
  }

  const handleUsernameSetup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsLoading(true)
    const { error } = await setupUsername(username)
    setIsLoading(false)
    if (error) { setError(error) } else { onClose() }
  }

  const handleResend = async () => {
    setError(null)
    setIsLoading(true)
    const { error } = await resendVerification()
    setIsLoading(false)
    if (error) { setError(error) } else { setSuccess('Verification email resent!') }
  }

  const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-400/40 focus:border-red-500 transition-colors'
  const primaryCls = 'w-full py-2.5 bg-pokemon-red text-white rounded-lg font-semibold text-sm hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
  const googleCls = 'w-full py-2.5 border border-gray-300 rounded-lg font-medium text-sm text-gray-700 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2'
  const linkCls = 'text-pokemon-red hover:underline text-sm font-medium cursor-pointer'
  const dividerEl = (
    <div className="relative my-1">
      <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200" /></div>
      <div className="relative flex justify-center"><span className="bg-white px-2 text-xs text-gray-400">or</span></div>
    </div>
  )

  const views: Record<AuthView, { title: string; content: React.ReactNode }> = {
    login: {
      title: 'Trainer Login',
      content: (
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
            <input type="email" className={inputCls} value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Password</label>
            <input type="password" className={inputCls} value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          {error && <p className="text-red-600 text-xs">{error}</p>}
          <button type="submit" className={primaryCls} disabled={isLoading}>{isLoading ? 'Verifying ID…' : 'Sign In'}</button>
          {dividerEl}
          <button type="button" onClick={signInWithGoogle} className={googleCls}><GoogleIcon />Continue with Google</button>
          <div className="flex items-center justify-between text-xs pt-1">
            <button type="button" onClick={() => switchView('forgot-password')} className={linkCls}>Forgot password?</button>
            <span className="text-gray-500">No account? <button type="button" onClick={() => switchView('signup')} className={linkCls}>Sign up</button></span>
          </div>
        </form>
      ),
    },
    signup: {
      title: 'Register Trainer',
      content: (
        <form onSubmit={handleSignup} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Username</label>
            <input type="text" className={inputCls} value={username} onChange={e => setUsername(e.target.value)} required minLength={3} maxLength={20} autoFocus placeholder="3–20 characters" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
            <input type="email" className={inputCls} value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Password</label>
            <input type="password" className={inputCls} value={password} onChange={e => setPassword(e.target.value)} required />
            {password.length > 0 && (
              <p className={`text-xs mt-1 ${password.length >= 8 ? 'text-green-600' : 'text-gray-400'}`}>
                {password.length >= 8 ? '✓ 8+ characters' : `${password.length}/8 — keep going!`}
              </p>
            )}
          </div>
          {error && <p className="text-red-600 text-xs">{error}</p>}
          <button type="submit" className={primaryCls} disabled={isLoading}>{isLoading ? 'Registering Trainer…' : 'Create Account'}</button>
          {dividerEl}
          <button type="button" onClick={signInWithGoogle} className={googleCls}><GoogleIcon />Continue with Google</button>
          <p className="text-center text-xs text-gray-500 pt-1">Already have an account? <button type="button" onClick={() => switchView('login')} className={linkCls}>Sign in</button></p>
        </form>
      ),
    },
    'forgot-password': {
      title: 'Reset Password',
      content: (
        <form onSubmit={handleForgotPassword} className="space-y-4">
          <p className="text-sm text-gray-600">Enter your email and we'll send a recovery link.</p>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
            <input type="email" className={inputCls} value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
          </div>
          {error && <p className="text-red-600 text-xs">{error}</p>}
          {success && <p className="text-green-600 text-xs">{success}</p>}
          <button type="submit" className={primaryCls} disabled={isLoading || !!success}>{isLoading ? 'Dispatching link…' : 'Send Recovery Link'}</button>
          <p className="text-center"><button type="button" onClick={() => switchView('login')} className={linkCls}>← Back to sign in</button></p>
        </form>
      ),
    },
    'verify-email': {
      title: 'Verify Email',
      content: (
        <div className="text-center space-y-4">
          <div className="text-5xl">📬</div>
          <div>
            <p className="text-sm font-medium text-gray-800">Check your inbox, Trainer!</p>
            <p className="text-xs text-gray-500 mt-1">We sent a verification link{email ? <> to <strong>{email}</strong></> : ''}. Click it to activate your account.</p>
          </div>
          {error && <p className="text-red-600 text-xs">{error}</p>}
          {success && <p className="text-green-600 text-xs">{success}</p>}
          <button onClick={handleResend} disabled={isLoading} className="text-pokemon-red hover:underline text-sm font-medium disabled:opacity-50">
            {isLoading ? 'Resending…' : 'Resend Verification'}
          </button>
          <div><button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600">Continue as Guest</button></div>
        </div>
      ),
    },
    'reset-password': {
      title: 'Set New Password',
      content: (
        <form onSubmit={handleResetPassword} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">New Password</label>
            <input type="password" className={inputCls} value={password} onChange={e => setPassword(e.target.value)} required autoFocus />
            {password.length > 0 && (
              <p className={`text-xs mt-1 ${password.length >= 8 ? 'text-green-600' : 'text-gray-400'}`}>
                {password.length >= 8 ? '✓ 8+ characters' : `${password.length}/8 — keep going!`}
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Confirm Password</label>
            <input type="password" className={inputCls} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required />
            {confirmPassword.length > 0 && password !== confirmPassword && (
              <p className="text-xs text-red-500 mt-1">Passwords don't match!</p>
            )}
          </div>
          {error && <p className="text-red-600 text-xs">{error}</p>}
          <button type="submit" className={primaryCls} disabled={isLoading}>{isLoading ? 'Updating…' : 'Confirm New Password'}</button>
        </form>
      ),
    },
    'username-setup': {
      title: 'Choose Your Trainer Name',
      content: (
        <form onSubmit={handleUsernameSetup} className="space-y-4">
          <p className="text-sm text-gray-600">One last step — pick your Trainer name to complete registration.</p>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Username</label>
            <input type="text" className={inputCls} value={username} onChange={e => setUsername(e.target.value)} required minLength={3} maxLength={20} autoFocus placeholder="3–20 characters" />
          </div>
          {error && <p className="text-red-600 text-xs">{error}</p>}
          <button type="submit" className={primaryCls} disabled={isLoading}>{isLoading ? 'Registering name…' : 'Save Trainer Name'}</button>
        </form>
      ),
    },
  }

  const { title, content } = views[currentView]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={canClose ? onClose : undefined}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6"
        onClick={e => e.stopPropagation()}
      >
        {canClose && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        )}
        <h2 className="text-xl font-bold text-gray-900 mb-5">{title}</h2>
        {content}
      </div>
    </div>
  )
}

export default AuthModal
