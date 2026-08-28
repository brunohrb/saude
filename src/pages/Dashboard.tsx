import { useWhoopData } from '../hooks/useWhoopData'
import { useSync } from '../hooks/useSync'
import { Link, useNavigate } from 'react-router-dom'
import LoadingScreen from '../components/LoadingScreen'
import CircleProgress from '../components/CircleProgress'
import { recoveryColor, millisToTime, kcalFromKj, formatDate } from '../utils/whoop'

export default function Dashboard() {
  const {
    latestRecovery, latestCycle,
    recentWorkouts, recentSleeps,
    fitbitConnected, loading, refresh,
  } = useWhoopData()
  const { sync, syncing } = useSync(refresh)
  const navigate = useNavigate()

  if (loading) return <LoadingScreen />

  const dashboardDateKey = localDateKey(latestCycle?.start_time ?? new Date().toISOString())
  const dashboardSleep = recentSleeps.find(sleep => localDateKey(sleep.end_time) === dashboardDateKey) ?? null

  const recoveryScore = latestRecovery?.recovery_score ?? null
  const sleepScore = dashboardSleep?.sleep_performance_percentage ?? null
  const strain = latestCycle?.strain ?? null
  const calories = kcalFromKj(latestCycle?.kilojoule) || null
  const restingHR = latestRecovery?.resting_heart_rate ? Math.round(latestRecovery.resting_heart_rate) : null
  const spo2 = latestRecovery?.spo2_percentage?.toFixed(1) ?? null
  const skinTemp = latestRecovery?.skin_temp_celsius?.toFixed(1) ?? null

  const totalSleepMs = dashboardSleep
    ? (dashboardSleep.total_in_bed_time_milli ?? 0) - (dashboardSleep.total_awake_time_milli ?? 0)
    : null

  const ringColor = recoveryColor(recoveryScore)

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const workoutsThisWeek = recentWorkouts.filter(w => new Date(w.start_time) > weekAgo).length

  const sleepLabel = sleepScore != null
    ? sleepScore >= 85 ? 'Ótimo' : sleepScore >= 70 ? 'Bom' : sleepScore >= 50 ? 'Regular' : 'Ruim'
    : null

  const today = latestCycle?.start_time
    ? formatDate(latestCycle.start_time)
    : new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="min-h-full pb-6 bg-black">
      {/* Header */}
      <div className="px-5 pt-14 pb-3 safe-top flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Hoje</h1>
          <p className="text-xs text-gray-500 capitalize mt-0.5">{today}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={sync}
            disabled={syncing}
            className="text-gray-400 w-9 h-9 flex items-center justify-center rounded-full bg-white/5 disabled:opacity-40 text-base"
          >
            {syncing ? (
              <span className="animate-spin inline-block">↻</span>
            ) : '↻'}
          </button>
          <Link
            to="/configuracoes"
            className="text-gray-400 w-9 h-9 flex items-center justify-center rounded-full bg-white/5"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
              <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
            </svg>
          </Link>
        </div>
      </div>

      {!fitbitConnected ? (
        <div className="mx-4 mt-6 bg-surface rounded-3xl p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4 text-3xl">🔗</div>
          <p className="text-gray-300 font-medium mb-1">Conecte seu Google</p>
          <p className="text-gray-500 text-sm mb-5">Para visualizar seus dados de saúde</p>
          <button
            onClick={() => navigate('/conectar-fitbit')}
            className="bg-teal-500 text-black font-bold py-3 px-8 rounded-2xl text-sm"
          >
            Conectar Google
          </button>
        </div>
      ) : (
        <>
          {/* Hero: Ring + Stacked cards */}
          <div className="px-4 flex gap-3" style={{ minHeight: 200 }}>
            {/* Big ring */}
            <div className="bg-surface rounded-3xl flex flex-col items-center justify-center p-3 flex-shrink-0" style={{ width: 168 }}>
              <p className="text-[10px] text-gray-500 mb-1 uppercase tracking-wide">Recuperação</p>
              <CircleProgress
                value={recoveryScore}
                max={100}
                size={130}
                strokeWidth={11}
                color={ringColor}
              >
                <div className="flex flex-col items-center">
                  <span className="text-4xl font-bold tabular-nums leading-none" style={{ color: ringColor }}>
                    {recoveryScore != null ? Math.round(recoveryScore) : '--'}
                  </span>
                  <span className="text-xs text-gray-500 mt-1">%</span>
                </div>
              </CircleProgress>
              {recoveryScore != null && (
                <p className="text-[11px] font-semibold mt-1" style={{ color: ringColor }}>
                  {recoveryScore >= 67 ? '● Ótimo' : recoveryScore >= 34 ? '● Moderado' : '● Baixo'}
                </p>
              )}
            </div>

            {/* Stacked right cards */}
            <div className="flex-1 flex flex-col gap-2">
              {/* Calorias - teal */}
              <div className="flex-1 bg-card-teal rounded-2xl px-3 py-2.5 flex items-center gap-2.5">
                <span className="text-xl flex-shrink-0">🔥</span>
                <div className="min-w-0">
                  <p className="text-[10px] text-teal-300/60 font-medium">Calorias</p>
                  <p className="text-teal-300 font-bold text-base leading-tight truncate">
                    {calories ? calories.toLocaleString('pt-BR') : '--'}
                    <span className="text-xs font-normal text-teal-400/50 ml-1">kcal</span>
                  </p>
                </div>
              </div>

              {/* Esforço - amber */}
              <div className="flex-1 bg-card-amber rounded-2xl px-3 py-2.5 flex items-center gap-2.5">
                <span className="text-xl flex-shrink-0">⚡</span>
                <div className="min-w-0">
                  <p className="text-[10px] text-amber-300/60 font-medium">Esforço</p>
                  <p className="text-amber-300 font-bold text-base leading-tight">
                    {strain != null ? strain.toFixed(1) : '--'}
                    <span className="text-xs font-normal text-amber-400/50 ml-1">/21</span>
                  </p>
                </div>
              </div>

              {/* Sono - purple */}
              <div className="flex-1 bg-card-purple rounded-2xl px-3 py-2.5 flex items-center gap-2.5">
                <span className="text-xl flex-shrink-0">🌙</span>
                <div className="min-w-0">
                  <p className="text-[10px] text-purple-300/60 font-medium">Sono</p>
                  <p className="text-purple-300 font-bold text-sm leading-tight truncate">
                    {totalSleepMs ? millisToTime(totalSleepMs) : '--'}
                  </p>
                  {sleepScore != null && sleepLabel && (
                    <p className="text-[10px] text-purple-400/50">
                      {Math.round(sleepScore)} • {sleepLabel}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 2x2 Activity grid */}
          <div className="px-4 mt-3 grid grid-cols-2 gap-2">
            <ActivityCard
              icon="👟"
              label="Passos"
              value={latestCycle?.steps != null ? latestCycle.steps.toLocaleString('pt-BR') : '--'}
              unit="passos"
            />
            <ActivityCard
              icon="📍"
              label="Distância"
              value={latestCycle?.distance_meter != null ? (latestCycle.distance_meter / 1000).toFixed(2) : '--'}
              unit="km"
            />
            <ActivityCard icon="❤️" label="FC Repouso" value={restingHR != null ? `${restingHR}` : '--'} unit="bpm" />
            <ActivityCard icon="🏋️" label="Treinos (7 dias)" value={`${workoutsThisWeek}`} unit="realizados" />
          </div>

          {/* Vitals dark cards */}
          <div className="px-4 mt-2 grid grid-cols-2 gap-2">
            <VitalCard icon="🩸" label="SpO₂" value={spo2 ?? '--'} unit="%" />
            <VitalCard icon="🌡️" label="Temp. Pele" value={skinTemp ?? '--'} unit="°C" />
          </div>

          {/* Quick links */}
          <div className="px-4 mt-3 grid grid-cols-2 gap-2">
            <Link to="/sono" className="bg-surface rounded-2xl p-4 flex items-center gap-3 active:opacity-70">
              <span className="text-xl">🌙</span>
              <div>
                <p className="text-xs font-semibold text-white">Sono</p>
                <p className="text-[10px] text-gray-500">Ver detalhes</p>
              </div>
            </Link>
            <Link to="/esforco" className="bg-surface rounded-2xl p-4 flex items-center gap-3 active:opacity-70">
              <span className="text-xl">⚡</span>
              <div>
                <p className="text-xs font-semibold text-white">Fitness</p>
                <p className="text-[10px] text-gray-500">Ver treinos</p>
              </div>
            </Link>
          </div>

          {/* AI Analysis */}
          <Link
            to="/ia"
            className="mx-4 mt-2 bg-gradient-to-r from-teal-900/40 to-purple-900/40 border border-white/5 rounded-2xl p-4 flex items-center gap-3 active:opacity-70"
          >
            <span className="text-2xl">🤖</span>
            <div className="flex-1">
              <p className="font-semibold text-sm text-white">Análise por IA</p>
              <p className="text-xs text-gray-500 mt-0.5">Claude analisa sua saúde e dá recomendações</p>
            </div>
            <span className="text-gray-600 text-lg">›</span>
          </Link>
        </>
      )}
    </div>
  )
}

function localDateKey(value: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Fortaleza',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value))
}

function ActivityCard({ icon, label, value, unit }: { icon: string; label: string; value: string; unit: string }) {
  return (
    <div className="bg-card-teal rounded-2xl px-4 py-3">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-base">{icon}</span>
        <p className="text-[10px] text-teal-300/60 font-medium leading-tight">{label}</p>
      </div>
      <p className="text-teal-300 font-bold text-xl leading-none">
        {value}
        <span className="text-xs font-normal text-teal-400/50 ml-1">{unit}</span>
      </p>
    </div>
  )
}

function VitalCard({ icon, label, value, unit }: { icon: string; label: string; value: string; unit: string }) {
  return (
    <div className="bg-card-dark rounded-2xl px-4 py-3">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-base">{icon}</span>
        <p className="text-[10px] text-blue-300/50 font-medium">{label}</p>
      </div>
      <p className="text-white font-bold text-xl leading-none">
        {value}
        <span className="text-xs font-normal text-gray-500 ml-1">{unit}</span>
      </p>
    </div>
  )
}
