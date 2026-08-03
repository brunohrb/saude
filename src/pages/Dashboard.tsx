import { useWhoopData } from '../hooks/useWhoopData'
import { useSync } from '../hooks/useSync'
import { Link, useNavigate } from 'react-router-dom'
import LoadingScreen from '../components/LoadingScreen'
import CircleProgress from '../components/CircleProgress'
import { millisToTime, kcalFromKj } from '../utils/whoop'
import { useState, useEffect } from 'react'

const CARDIO_WEEKLY_GOAL = 360

export default function Dashboard() {
  const {
    latestRecovery, latestSleep, latestCycle,
    recentCycles, recentWorkouts,
    fitbitConnected, loading, refresh,
  } = useWhoopData()
  const { sync, syncing } = useSync(refresh)
  const navigate = useNavigate()
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(t)
  }, [])

  if (loading) return <LoadingScreen />

  const steps       = latestCycle?.steps ?? null
  const moveMinutes = latestCycle?.move_minutes ?? null
  const calories    = kcalFromKj(latestCycle?.kilojoule) || null
  const distance    = latestCycle?.distance_meter != null
    ? (latestCycle.distance_meter / 1000).toFixed(2) : null
  const restingHR   = latestRecovery?.resting_heart_rate
    ? Math.round(latestRecovery.resting_heart_rate) : null
  const spo2        = latestRecovery?.spo2_percentage ?? null

  // Disposição = recovery score proxy (derived from RHR)
  const disposicao = latestRecovery?.recovery_score != null
    ? Math.round(latestRecovery.recovery_score) : null

  // Weekly cardio (heart points sum last 7 days)
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const weeklyCardio = recentCycles
    .filter(c => new Date(c.start_time) > weekAgo)
    .reduce((s, c) => s + (c.heart_points ?? 0), 0)
  const cardioRounded = Math.round(weeklyCardio)
  const cardioPct = Math.min(100, Math.round(cardioRounded / CARDIO_WEEKLY_GOAL * 100))

  // Sleep
  const totalSleepMs = latestSleep
    ? (latestSleep.total_in_bed_time_milli ?? 0) - (latestSleep.total_awake_time_milli ?? 0)
    : null
  const sleepScore = latestSleep?.sleep_performance_percentage ?? null
  const sleepLabel = sleepScore != null
    ? sleepScore >= 85 ? 'Ótimo' : sleepScore >= 70 ? 'Bom' : sleepScore >= 50 ? 'Regular' : 'Ruim'
    : null

  // FC range
  const todayStr = new Date().toLocaleDateString('pt-BR')
  const todayWorkouts = recentWorkouts.filter(
    w => new Date(w.start_time).toLocaleDateString('pt-BR') === todayStr
  )
  const maxHR = todayWorkouts.reduce((m, w) => Math.max(m, w.max_heart_rate ?? 0), 0)
  const hrDisplay = restingHR
    ? maxHR > restingHR ? `${restingHR} a ${maxHR}` : `${restingHR}`
    : '--'

  // Atividade por hora (mock based on move_minutes)
  const atividadeHora = moveMinutes != null ? `${Math.min(Math.round(moveMinutes / 8), 9)} de 9` : '--'

  // Sinais vitais count
  const vitaisCount = [restingHR, spo2, latestRecovery?.skin_temp_celsius].filter(v => v != null).length
  const vitaisDisplay = vitaisCount > 0 ? `${vitaisCount} de 5` : '--'

  // Weekly workouts
  const weeklyWorkouts = recentWorkouts.filter(w => new Date(w.start_time) > weekAgo).length

  const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="min-h-full pb-24" style={{ backgroundColor: '#161616' }}>

      {/* ── Header ── */}
      <div className="safe-top px-4 pt-12 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="rounded-full px-3 py-1 flex items-center gap-1" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}>
            <span style={{ fontSize: 11, color: '#fff', fontWeight: 600 }}>
              {fitbitConnected ? '● Conectado' : '○ Desconectado'}
            </span>
          </div>
          <span style={{ color: '#666', fontSize: 12 }}>·</span>
          <button
            onClick={sync}
            disabled={syncing}
            style={{ fontSize: 12, color: '#aaa' }}
            className="disabled:opacity-50"
          >
            {syncing ? 'Sincronizando dados...' : 'Atualizar'}
          </button>
        </div>
        <Link
          to="/configuracoes"
          className="w-9 h-9 rounded-full flex items-center justify-center"
          style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-gray-300">
            <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
          </svg>
        </Link>
      </div>

      {!fitbitConnected ? (
        <div className="mx-4 mt-6 rounded-3xl p-8 text-center" style={{ backgroundColor: '#1e1e1e' }}>
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl"
            style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>🔗</div>
          <p className="text-white font-medium mb-1">Conecte seu Google Health</p>
          <p className="text-sm mb-5" style={{ color: '#888' }}>Para visualizar seus dados de saúde</p>
          <button
            onClick={() => navigate('/conectar-fitbit')}
            className="font-bold py-3 px-8 rounded-2xl text-sm text-white"
            style={{ backgroundColor: '#1a6b5a' }}
          >
            Conectar Google Health
          </button>
        </div>
      ) : (
        <div className="px-3">

          {/* ── Hero: Anel + 3 cards ── */}
          <div className="flex gap-2.5 mb-2.5" style={{ minHeight: 220 }}>

            {/* Anel cardio semanal */}
            <div className="rounded-3xl flex flex-col items-center justify-center py-4 px-2 flex-shrink-0"
              style={{ width: 155, backgroundColor: '#222222' }}>
              <p style={{ fontSize: 10, color: '#888', marginBottom: 4, textAlign: 'center' }}>
                Cardio semanal
              </p>
              <CircleProgress
                value={cardioRounded}
                max={CARDIO_WEEKLY_GOAL}
                size={120}
                strokeWidth={11}
                color="#3EC9BE"
              >
                <div className="flex flex-col items-center">
                  <span className="text-white font-bold tabular-nums" style={{ fontSize: 32, lineHeight: 1 }}>
                    {cardioPct}%
                  </span>
                  <span style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
                    {cardioRounded} de {CARDIO_WEEKLY_GOAL}
                  </span>
                  {cardioRounded > 0 && (
                    <div className="rounded-full px-2 mt-1.5" style={{ backgroundColor: '#3B5BDB', paddingTop: 2, paddingBottom: 2 }}>
                      <span style={{ fontSize: 10, color: '#fff', fontWeight: 700 }}>+{cardioRounded}</span>
                    </div>
                  )}
                </div>
              </CircleProgress>
            </div>

            {/* 3 cards empilhados */}
            <div className="flex-1 flex flex-col gap-2">

              {/* Passos */}
              <div className="flex-1 rounded-2xl flex items-center gap-3 px-3"
                style={{ backgroundColor: '#1a4840' }}>
                <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}>
                  <svg viewBox="0 0 24 24" fill="#3EC9BE" className="w-5 h-5">
                    <path d="M13.49 5.48c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-3.6 13.9l1-4.4 2.1 2v6h2v-7.5l-2.1-2 .6-3c1.3 1.5 3.3 2.5 5.5 2.5v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1l-5.2 2.2v4.7h2v-3.4l1.8-.7-1.6 8.1-4.9-1-.4 2 7 1.4z"/>
                  </svg>
                </div>
                <div>
                  <p style={{ fontSize: 11, color: '#3EC9BE', fontWeight: 600 }}>Passos</p>
                  <p className="text-white font-bold" style={{ fontSize: 22, lineHeight: 1.1 }}>
                    {steps != null ? steps.toLocaleString('pt-BR') : '--'}
                  </p>
                </div>
              </div>

              {/* Disposição */}
              <div className="flex-1 rounded-2xl flex items-center gap-3 px-3"
                style={{ backgroundColor: '#1a2850' }}>
                <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}>
                  <svg viewBox="0 0 24 24" fill="#7BA7F7" className="w-5 h-5">
                    <path d="M13.49 5.48c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-3.6 13.9l1-4.4 2.1 2v6h2v-7.5l-2.1-2 .6-3c1.3 1.5 3.3 2.5 5.5 2.5v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1l-5.2 2.2v4.7h2v-3.4l1.8-.7-1.6 8.1-4.9-1-.4 2 7 1.4z"/>
                  </svg>
                </div>
                <div>
                  <p style={{ fontSize: 11, color: '#7BA7F7', fontWeight: 600 }}>Disposição</p>
                  <p className="text-white font-bold" style={{ fontSize: 22, lineHeight: 1.1 }}>
                    {disposicao ?? '--'}
                  </p>
                </div>
              </div>

              {/* Sono */}
              <div className="flex-1 rounded-2xl flex items-center gap-3 px-3"
                style={{ backgroundColor: '#3a1555' }}>
                <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}>
                  <svg viewBox="0 0 24 24" fill="#C084FC" className="w-5 h-5">
                    <path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z"/>
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="text-white font-bold truncate" style={{ fontSize: 18, lineHeight: 1.1 }}>
                    {totalSleepMs ? millisToTime(totalSleepMs) : '--'}
                  </p>
                  <p style={{ fontSize: 11, color: '#C084FC', fontWeight: 600 }}>
                    {sleepScore != null ? `${Math.round(sleepScore)} • ${sleepLabel}` : 'Sem dados'}
                  </p>
                </div>
              </div>

            </div>
          </div>

          {/* ── Grade 2×3 ── */}
          <div className="grid grid-cols-2 gap-2 mb-3">

            <GridCard
              icon={<LocIcon />}
              label="Distância"
              value={distance ? `${distance} km` : '--'}
              bg="#1a4840"
              color="#3EC9BE"
            />
            <GridCard
              icon={<FlameIcon />}
              label="Cal queimada(s)"
              value={calories ? calories.toLocaleString('pt-BR') : '--'}
              bg="#1a3d2a"
              color="#3EC9BE"
            />
            <GridCard
              icon={<DumbellIcon />}
              label="Treinos"
              value={weeklyWorkouts > 0 ? `${weeklyWorkouts} esta sem.` : '--'}
              bg="#1e1e1e"
              color="#9CA3AF"
            />
            <GridCard
              icon={<ActivityIcon />}
              label="Atividade por hora"
              value={atividadeHora}
              bg="#1a4840"
              color="#3EC9BE"
            />
            <GridCard
              icon={<HeartIcon />}
              label="Frequência cardíaca"
              value={hrDisplay}
              bg="#1a1a2e"
              color="#60A5FA"
            />
            <GridCard
              icon={<VitalsIcon />}
              label="Sinais vitais"
              value={vitaisDisplay}
              bg="#1a3a1a"
              color="#4ADE80"
            />

          </div>

          {/* ── Pagination dots ── */}
          <div className="flex justify-center gap-1.5 mb-4">
            <div className="w-2 h-2 rounded-full bg-white" />
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.25)' }} />
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.25)' }} />
          </div>

          {/* ── Botões de ação ── */}
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => navigate('/treino')}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-full py-3 text-sm font-bold text-white"
              style={{ backgroundColor: '#2D5BE3' }}
            >
              <span style={{ fontSize: 16 }}>+</span> Registro
            </button>
            <button
              onClick={() => navigate('/esforco')}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-full py-3 text-sm font-bold text-white"
              style={{ backgroundColor: '#2448B0' }}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                <path d="M13.49 5.48c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-3.6 13.9l1-4.4 2.1 2v6h2v-7.5l-2.1-2 .6-3c1.3 1.5 3.3 2.5 5.5 2.5v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1l-5.2 2.2v4.7h2v-3.4l1.8-.7-1.6 8.1-4.9-1-.4 2 7 1.4z"/>
              </svg>
              Início
            </button>
            <button
              className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: '#222' }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="#aaa" strokeWidth="2" strokeLinecap="round" className="w-5 h-5">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
          </div>

          {/* ── Perguntar ao Coach ── */}
          <Link
            to="/ia"
            className="flex items-center justify-center gap-2 rounded-full py-3.5 mb-4"
            style={{ backgroundColor: '#C8DCFF' }}
          >
            <svg viewBox="0 0 24 24" fill="#1a3a7a" className="w-4 h-4">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/>
            </svg>
            <span style={{ color: '#1a3a7a', fontWeight: 700, fontSize: 14 }}>Perguntar ao Coach</span>
          </Link>

          {/* ── Horário ── */}
          <div className="flex items-center gap-1.5 px-1">
            <svg viewBox="0 0 24 24" fill="#ffffff55" className="w-3 h-3">
              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
            </svg>
            <span className="text-white font-bold" style={{ fontSize: 17 }}>{timeStr}</span>
          </div>

        </div>
      )}
    </div>
  )
}

// ── Grid Card ────────────────────────────────────────────────────────────────
function GridCard({ icon, label, value, bg, color }: {
  icon: React.ReactNode; label: string; value: string; bg: string; color: string
}) {
  return (
    <div className="rounded-2xl px-3.5 py-3" style={{ backgroundColor: bg }}>
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
          {icon}
        </div>
        <p style={{ fontSize: 10, color, fontWeight: 600, lineHeight: 1.2 }}>{label}</p>
      </div>
      <p className="text-white font-bold" style={{ fontSize: 20, lineHeight: 1 }}>{value}</p>
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────
function LocIcon() {
  return <svg viewBox="0 0 24 24" fill="#3EC9BE" className="w-4 h-4">
    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
  </svg>
}
function FlameIcon() {
  return <svg viewBox="0 0 24 24" fill="#3EC9BE" className="w-4 h-4">
    <path d="M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z"/>
  </svg>
}
function DumbellIcon() {
  return <svg viewBox="0 0 24 24" fill="#9CA3AF" className="w-4 h-4">
    <path d="M20.57 14.86L22 13.43 20.57 12 17 15.57 8.43 7 12 3.43 10.57 2 9.14 3.43 7.71 2 5.57 4.14 4.14 2.71 2.71 4.14l1.43 1.43L2 7.71l1.43 1.43L2 10.57 3.43 12 7 8.43 15.57 17 12 20.57 13.43 22l1.43-1.43L16.29 22l2.14-2.14 1.43 1.43 1.43-1.43-1.43-1.43L22 16.29l-1.43-1.43z"/>
  </svg>
}
function ActivityIcon() {
  return <svg viewBox="0 0 24 24" fill="#3EC9BE" className="w-4 h-4">
    <path d="M13.49 5.48c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-3.6 13.9l1-4.4 2.1 2v6h2v-7.5l-2.1-2 .6-3c1.3 1.5 3.3 2.5 5.5 2.5v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1l-5.2 2.2v4.7h2v-3.4l1.8-.7-1.6 8.1-4.9-1-.4 2 7 1.4z"/>
  </svg>
}
function HeartIcon() {
  return <svg viewBox="0 0 24 24" fill="#60A5FA" className="w-4 h-4">
    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.27 2 8.5 2 5.41 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.08C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.41 22 8.5c0 3.77-3.4 6.86-8.55 11.53L12 21.35z"/>
  </svg>
}
function VitalsIcon() {
  return <svg viewBox="0 0 24 24" fill="#4ADE80" className="w-4 h-4">
    <path d="M3 12h4l3-9 4 18 3-9h4" stroke="#4ADE80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
  </svg>
}
