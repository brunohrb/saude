import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

const GOOGLE_OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const CALLBACK_URL = 'https://hisbbtddpoxufvghxqtm.supabase.co/functions/v1/fitbit-auth-callback'
const SCOPES = [
  'https://www.googleapis.com/auth/fitness.activity.read',
  'https://www.googleapis.com/auth/fitness.heart_rate.read',
  'https://www.googleapis.com/auth/fitness.sleep.read',
  'https://www.googleapis.com/auth/fitness.body.read',
  'https://www.googleapis.com/auth/fitness.oxygen_saturation.read',
  // Necessário para com.google.distance.delta — sem ele a API devolve 403.
  'https://www.googleapis.com/auth/fitness.location.read',
  'profile',
  'email',
].join(' ')

export default function ConnectFitbit() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleConnect = () => {
    if (!user) return
    setLoading(true)
    setError(null)

    const params = new URLSearchParams({
      client_id: '390544242490-6qc6kiiq9s31r8uauiko9jdrqih7ring.apps.googleusercontent.com',
      redirect_uri: CALLBACK_URL,
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      state: user.id,
    })

    window.location.href = `${GOOGLE_OAUTH_URL}?${params}`
  }

  return (
    <div className="min-h-full flex flex-col px-6 pt-16 pb-8 bg-black">
      <button
        onClick={() => navigate('/configuracoes')}
        className="flex items-center gap-2 text-gray-400 text-sm mb-8"
      >
        ← Voltar
      </button>

      <div className="flex flex-col items-center text-center gap-6 flex-1">
        <div className="w-20 h-20 rounded-2xl bg-surface flex items-center justify-center">
          <svg className="w-12 h-12 text-bhr-green" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
          </svg>
        </div>

        <div>
          <h1 className="text-2xl font-bold mb-2">Conectar Google Health</h1>
          <p className="text-gray-400 text-sm leading-relaxed">
            Você será redirecionado para o Google para autorizar o acesso aos seus dados de saúde (Fitbit Air sincronizado via Google Health).
          </p>
        </div>

        <div className="w-full bg-surface rounded-2xl p-4 text-left">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-3 font-medium">
            Dados que serão acessados
          </p>
          {[
            'Frequência cardíaca e FC de repouso',
            'VFC e SpO₂',
            'Sono (duração, estágios, eficiência)',
            'Atividades e treinos',
            'Perfil básico',
          ].map(item => (
            <div key={item} className="flex items-center gap-2 py-1.5">
              <span className="text-bhr-green text-xs">✓</span>
              <span className="text-sm text-gray-300">{item}</span>
            </div>
          ))}
        </div>

        {error && (
          <div className="w-full bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="w-full mt-auto flex flex-col gap-3">
          <button
            onClick={handleConnect}
            disabled={loading}
            className="bg-bhr-green text-black font-bold py-4 rounded-xl text-base disabled:opacity-50 w-full"
          >
            {loading ? 'Aguarde...' : 'Autorizar no Google'}
          </button>
          <button
            onClick={() => navigate('/configuracoes')}
            className="text-gray-400 text-sm py-2"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
