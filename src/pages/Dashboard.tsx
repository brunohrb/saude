import { useWhoopData } from '../hooks/useWhoopData'
import { useSync } from '../hooks/useSync'
import { Link, useNavigate } from 'react-router-dom'
import LoadingScreen from '../components/LoadingScreen'
import CircleProgress from '../components/CircleProgress'
import { millisToTime, kcalFromKj, formatDate } from '../utils/whoop'

const STEPS_GOAL = 10_000
const HEART_PTS_GOAL = 150 // semanal / 7 ≈ 21/dia

export default function Dashboard() {
  const {
    latestRecovery, latestSleep, latestCycle,
    recentWorkouts,
    fitbitConnected, loading, refresh,
  } = useWhoopData()
  const { sync, syncing } = useSync(refresh)
  const navigate = useNavigate()

  if (loading) return <LoadingScreen />

  const steps       = latestCycle?.steps ?? null
  const heartPoints = latestCycle?.heart_points ?? null
  const moveMinutes = latestCycle?.move_minutes ?? null
  const calories    = kcalFromKj(latestCycle?.kilojoule) || null
  const distance    = latestCycle?.distance_meter != null
    ? (latestCycle.distance_meter / 1000).toFixed(2) : null

  const restingHR = latestRecovery?.resting_heart_rate
    ? Math.round(latestRecovery.resting_heart_rate) : null
  const spo2       = latestRecovery?.spo2_percentage?.toFixed(1) ?? null

  const totalSleepMs = latestSleep
    ? (latestSleep.total_in_bed_time_milli ?? 0) - (latestSleep.total_awake_time_milli ?? 0)
    : null
  const sleepScore = latestSleep?.sleep_performance_percentage ?? null
  const sleepLabel = sleepScore != null
    ? sleepScore >= 85 ? 'Ótimo' : sleepScore >= 70 ? 'Bom' : sleepScore >= 50 ? 'Regular' : 'Ruim'
    : null

  const stepsPct     = steps ? Math.min(100, Math.round(steps / STEPS_GOAL * 100)) : 0
  const hpPct        = heartPoints ? Math.min(100, Math.round(heartPoints / HEART_PTS_GOAL * 100)) : 0

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const workoutsThisWeek = recentWorkouts.filter(w => new Date(w.start_time) > weekAgo).length

  const today = latestCycle?.start_time
    ? formatDate(latestCycle.start_time)
    : new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })

  // Green shades matching Google Health
  const stepsColor  = stepsPct >= 100 ? '#00D4A0' : stepsPct >= 50 ? '#00D4A0' : '#00A87C'
  const hpColor     = '#FF5252'
  const moveColor   = '#FF9800'

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
            {syncing ? <span className="animate-spin inline-block">↻</span> : '↻'}
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
          <p className="text-gray-300 font-medium mb-1">Conecte seu Google Health</p>
          <p className="text-gray-500 text-sm mb-5">Para visualizar seus dados de saúde</p>
          <button
            onClick={() => navigate('/conectar-fitbit')}
            className="bg-bhr-green text-black font-bold py-3 px-8 rounded-2xl text-sm"
          >
            Conectar Google Health
          </button>
        </div>
      ) : (
        <>
          {/* ── Hero: Passos ── */}
          <div className="mx-4 mt-2 bg-surface rounded-3xl p-5">
            <div className="flex items-center gap-5">
              {/* Anel de passos */}
              <div className="flex-shrink-0 flex flex-col items-center">
                <CircleProgress
                  value={steps ?? 0}
                  max={STEPS_GOAL}
                  size={120}
                  strokeWidth={10}
                  color={stepsColor}
                >
                  <div className="flex flex-col items-center">
                    <span className="text-[11px] text-gray-500 mb-0.5">passos</span>
                    <span
                      className="text-2xl font-bold tabular-nums leading-none"
                      style={{ color: stepsColor }}
                    >
                      {steps != null ? steps.toLocaleString('pt-BR') : '--'}
                    </span>
                    <span className="text-[10px] text-gray-600 mt-0.5">
                      meta {STEPS_GOAL.toLocaleString('pt-BR')}
                    </span>
                  </div>
                </CircleProgress>
                <p className="text-[10px] text-gray-500 mt-1.5 font-medium uppercase tracking-wide">
                  {stepsPct}% da meta
                </p>
              </div>

              {/* Métricas laterais */}
              <div className="flex-1 flex flex-col gap-2.5">
                <SideMetric
                  emoji="❤️"
                  label="Heart Points"
                  value={heartPoints != null ? String(heartPoints) : '--'}
                  unit="pts"
                  pct={hpPct}
                  color={hpColor}
                />
                <SideMetric
                  emoji="🔥"
                  label="Calorias ativas"
                  value={calories ? calories.toLocaleString('pt-BR') : '--'}
                  unit="kcal"
                  color="#FF6B35"
                />
                <SideMetric
                  emoji="⏱️"
                  label="Min. ativos"
                  value={moveMinutes != null ? String(moveMinutes) : '--'}
                  unit="min"
                  color={moveColor}
                />
              </div>
            </div>
          </div>

          {/* ── Sono ── */}
          <div className="mx-4 mt-2">
            <Link to="/sono" className="block bg-surface rounded-2xl p-4 active:opacity-70">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-base">🌙</span>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Sono</p>
                </div>
                <span className="text-gray-600 text-sm">›</span>
              </div>
              {totalSleepMs ? (
                <div className="flex items-end gap-3">
                  <span className="text-2xl font-bold text-purple-400">{millisToTime(totalSleepMs)}</span>
                  {sleepLabel && (
                    <span className="text-xs text-gray-500 mb-0.5">• {sleepLabel}</span>
                  )}
                </div>
              ) : (
                <p className="text-gray-600 text-sm">Sem dados de sono</p>
              )}
              {latestSleep && (
                <SleepBar sleep={latestSleep} />
              )}
            </Link>
          </div>

          {/* ── Grade de vitais ── */}
          <div className="px-4 mt-2 grid grid-cols-2 gap-2">
            <VitalCard icon="❤️" label="FC Repouso" value={restingHR != null ? `${restingHR}` : '--'} unit="bpm" color="#FF5252" />
            <VitalCard icon="🩸" label="SpO₂" value={spo2 ?? '--'} unit="%" color="#4FC3F7" />
            <VitalCard icon="📍" label="Distância" value={distance ?? '--'} unit="km" color="#00D4A0" />
            <VitalCard icon="🏋️" label="Treinos (7d)" value={`${workoutsThisWeek}`} unit="realizados" color="#A78BFA" />
          </div>

          {/* ── Quick links ── */}
          <div className="px-4 mt-2 grid grid-cols-2 gap-2">
            <Link to="/sono" className="bg-surface rounded-2xl p-4 flex items-center gap-3 active:opacity-70">
              <span className="text-xl">🌙</span>
              <div>
                <p className="text-xs font-semibold text-white">Sono</p>
                <p className="text-[10px] text-gray-500">Detalhes</p>
              </div>
            </Link>
            <Link to="/esforco" className="bg-surface rounded-2xl p-4 flex items-center gap-3 active:opacity-70">
              <span className="text-xl">⚡</span>
              <div>
                <p className="text-xs font-semibold text-white">Fitness</p>
                <p className="text-[10px] text-gray-500">Treinos</p>
              </div>
            </Link>
          </div>

          {/* ── AI Analysis ── */}
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

// ─── Sub-components ───────────────────────────────────────────────────────────

function SideMetric({
  emoji, label, value, unit, pct, color,
}: {
  emoji: string
  label: string
  value: string
  unit: string
  pct?: number
  color: string
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-base flex-shrink-0">{emoji}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-gray-500 leading-tight">{label}</p>
        <p className="font-bold text-sm leading-tight" style={{ color }}>
          {value}
          <span className="text-[10px] font-normal text-gray-500 ml-1">{unit}</span>
        </p>
        {pct != null && (
          <div className="mt-0.5 h-1 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${pct}%`, backgroundColor: color }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function VitalCard({ icon, label, value, unit, color }: {
  icon: string; label: string; value: string; unit: string; color: string
}) {
  return (
    <div className="bg-surface rounded-2xl px-4 py-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-sm">{icon}</span>
        <p className="text-[10px] text-gray-500 font-medium">{label}</p>
      </div>
      <p className="font-bold text-lg leading-none" style={{ color }}>
        {value}
        <span className="text-xs font-normal text-gray-500 ml-1">{unit}</span>
      </p>
    </div>
  )
}

function SleepBar({ sleep }: { sleep: ReturnType<typeof useWhoopData>['latestSleep'] }) {
  if (!sleep) return null
  const light = sleep.total_light_sleep_time_milli ?? 0
  const deep  = sleep.total_slow_wave_sleep_time_milli ?? 0
  const rem   = sleep.total_rem_sleep_time_milli ?? 0
  const awake = sleep.total_awake_time_milli ?? 0
  const total = light + deep + rem + awake
  if (total === 0) return null

  return (
    <div className="mt-3">
      <div className="flex h-2 rounded-full overflow-hidden gap-0.5">
        <div className="rounded-full" style={{ width: `${(light/total)*100}%`, backgroundColor: '#6366F1' }} />
        <div className="rounded-full" style={{ width: `${(deep/total)*100}%`, backgroundColor: '#3B82F6' }} />
        <div className="rounded-full" style={{ width: `${(rem/total)*100}%`, backgroundColor: '#8B5CF6' }} />
        <div className="rounded-full" style={{ width: `${(awake/total)*100}%`, backgroundColor: '#374151' }} />
      </div>
      <div className="flex gap-3 mt-1.5">
        <SleepLegend color="#6366F1" label="Leve" />
        <SleepLegend color="#3B82F6" label="Profundo" />
        <SleepLegend color="#8B5CF6" label="REM" />
        <SleepLegend color="#374151" label="Acordado" />
      </div>
    </div>
  )
}

function SleepLegend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
      <span className="text-[9px] text-gray-600">{label}</span>
    </div>
  )
}
