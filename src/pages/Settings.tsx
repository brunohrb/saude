import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useFitbitData } from '../hooks/useFitbitData'
import { useSync } from '../hooks/useSync'
import { supabaseFitbit } from '../lib/supabase'

export default function Settings() {
  const { user, signOut } = useAuth()
  const { profile, syncStatus, fitbitConnected, recentSleeps, refresh } = useFitbitData()
  const { sync, syncing, error: syncError, lastResult, syncDetail } = useSync(refresh)
  const [showSyncLog, setShowSyncLog] = useState(false)
  const navigate = useNavigate()
  const [fitbitError, setFitbitError] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('fitbit_connected') === 'true') {
      refresh()
      window.history.replaceState({}, '', window.location.pathname)
    }
    const err = params.get('fitbit_error')
    if (err) {
      setFitbitError(`Erro ao conectar Fitbit: ${err}`)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [refresh])

  const handleDisconnect = async () => {
    if (!confirm('Deseja desconectar o Fitbit? Seus dados sincronizados serão mantidos.')) return
    await supabaseFitbit.from('user_tokens').delete().eq('user_id', user?.id)
    refresh()
  }

  const lastSync = syncStatus?.last_sync_at
    ? new Date(syncStatus.last_sync_at).toLocaleString('pt-BR')
    : 'Nunca sincronizado'

  const profileName = profile
    ? [profile.first_name, profile.last_name].filter(Boolean).join(' ') || 'Usuário'
    : null

  return (
    <div className="pb-6">
      <div className="px-5 pt-14 pb-4 safe-top">
        <h1 className="text-2xl font-bold">Configurações</h1>
      </div>

      <div className="px-4 flex flex-col gap-4">
        {/* Conta */}
        <Section title="Conta">
          <div className="flex items-center gap-4 py-1">
            <div className="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center text-xl font-bold text-bhr-green">
              {(user?.email?.[0] ?? 'U').toUpperCase()}
            </div>
            <div>
              <p className="font-semibold">{user?.email}</p>
              {profileName && <p className="text-sm text-gray-400">{profileName}</p>}
            </div>
          </div>
        </Section>

        {/* Fitbit */}
        <Section title="Fitbit">
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium">Status</p>
              <p className={`text-xs mt-0.5 ${fitbitConnected ? 'text-bhr-green' : 'text-gray-400'}`}>
                {fitbitConnected ? '● Conectado' : '○ Não conectado'}
              </p>
            </div>
            {fitbitConnected ? (
              <button
                onClick={handleDisconnect}
                className="text-xs text-red-400 border border-red-400/20 rounded-lg px-3 py-1.5"
              >
                Desconectar
              </button>
            ) : (
              <button
                onClick={() => navigate('/conectar-fitbit')}
                className="text-xs text-bhr-green border border-bhr-green/30 rounded-lg px-3 py-1.5 font-medium"
              >
                Conectar
              </button>
            )}
          </div>

          {fitbitError && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-sm text-red-400 mb-2">
              {fitbitError}
            </div>
          )}

          {fitbitConnected && recentSleeps.length === 0 && (
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 text-sm text-yellow-300 mb-3">
              <p className="font-medium mb-1">⚠️ Dados incompletos</p>
              <p className="text-xs text-yellow-400/80 leading-relaxed">
                Seu token não inclui sono. Desconecte e reconecte o Fitbit para obter todos os dados.
              </p>
            </div>
          )}

          {fitbitConnected && (
            <>
              <div className="border-t border-white/5 pt-3">
                <p className="text-xs text-gray-500 mb-2">Última sincronização: {lastSync}</p>
                {syncError && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 mb-2">
                    <p className="text-xs text-red-400">{syncError}</p>
                  </div>
                )}
                {lastResult && (
                  <p className="text-xs text-bhr-green mb-2">{lastResult}</p>
                )}
                {syncDetail && syncDetail.allErrors.length > 0 && (
                  <div className="mb-2">
                    <button
                      onClick={() => setShowSyncLog(v => !v)}
                      className="text-xs text-yellow-400 underline"
                    >
                      {showSyncLog ? 'Ocultar' : 'Ver'} log de erros ({syncDetail.allErrors.length})
                    </button>
                    {showSyncLog && (
                      <div className="mt-2 bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-3 max-h-40 overflow-y-auto">
                        {syncDetail.allErrors.map((e, i) => (
                          <p key={i} className="text-[10px] text-yellow-300/70 font-mono mb-1 break-all">{e}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <button
                  onClick={sync}
                  disabled={syncing}
                  className="w-full bg-bhr-green text-black font-bold py-3 rounded-xl text-sm disabled:opacity-50"
                >
                  {syncing ? 'Sincronizando...' : '↻ Sincronizar dados'}
                </button>
                <p className="text-xs text-gray-500 mt-2 text-center">
                  Busca dados dos últimos 90 dias
                </p>
              </div>
            </>
          )}
        </Section>

        {/* Perfil Fitbit */}
        {profile && (
          <Section title="Perfil Fitbit">
            {[
              { label: 'Nome', value: profileName },
              { label: 'Altura', value: profile.height_meter ? `${(profile.height_meter * 100).toFixed(0)} cm` : null },
              { label: 'Peso', value: profile.weight_kilogram ? `${profile.weight_kilogram} kg` : null },
              { label: 'FC Máxima', value: profile.max_heart_rate ? `${profile.max_heart_rate} bpm` : null },
            ].filter(r => r.value).map(row => (
              <div key={row.label} className="flex justify-between py-2 border-b border-white/5 last:border-0">
                <span className="text-gray-400 text-sm">{row.label}</span>
                <span className="text-sm font-medium">{row.value}</span>
              </div>
            ))}
          </Section>
        )}

        {/* App */}
        <Section title="App">
          <button
            onClick={async () => {
              const keys = await caches.keys()
              await Promise.all(keys.map(k => caches.delete(k)))
              const regs = await navigator.serviceWorker.getRegistrations()
              await Promise.all(regs.map(r => r.unregister()))
              window.location.reload()
            }}
            className="w-full border border-white/10 text-gray-300 py-3 rounded-xl text-sm font-medium"
          >
            Limpar cache e atualizar
          </button>
          <p className="text-xs text-gray-600 mt-2 text-center">Use se o app estiver desatualizado</p>
        </Section>

        {/* Sair */}
        <button
          onClick={signOut}
          className="w-full border border-red-400/20 text-red-400 py-3 rounded-xl text-sm font-medium"
        >
          Sair da conta
        </button>

        <p className="text-center text-xs text-gray-600 pb-2">
          Saúde BHR · v1.0
        </p>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface rounded-2xl p-4">
      <p className="text-xs text-gray-400 uppercase tracking-wider mb-3 font-medium">{title}</p>
      {children}
    </div>
  )
}
