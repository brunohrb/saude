import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWhoopData } from '../hooks/useWhoopData'
import { useSync } from '../hooks/useSync'
import MetricCard from '../components/MetricCard'
import PageHeader from '../components/PageHeader'
import NoDataBanner from '../components/NoDataBanner'
import LoadingScreen from '../components/LoadingScreen'
import ArcGauge from '../components/ArcGauge'
import { recoveryColor, recoveryLevel, formatShortDate } from '../utils/whoop'
import { BarChart, Bar, XAxis, ResponsiveContainer, Cell, LineChart, Line, YAxis, Tooltip } from 'recharts'

export default function Recovery() {
  const { recentRecoveries, recentCycles, whoopConnected, loading, refresh } = useWhoopData()
  const { sync, syncing } = useSync(refresh)
  const [dayIndex, setDayIndex] = useState(0)
  const navigate = useNavigate()

  if (loading) return <LoadingScreen />

  const selectedCycle = recentCycles[dayIndex] ?? null
  const selectedRecovery = selectedCycle
    ? recentRecoveries.find(r => r.cycle_id === selectedCycle.fitbit_activity_id) ?? null
    : null

  const score = selectedRecovery?.recovery_score ?? null
  const color = recoveryColor(score)
  const level = recoveryLevel(score)
  const levelLabel = { green: 'Boa', yellow: 'Moderada', red: 'Baixa', unknown: 'Sem dados' }[level]

  const chartData = recentCycles
    .slice(0, 14)
    .reverse()
    .map(cycle => {
      const rec = recentRecoveries.find(r => r.cycle_id === cycle.fitbit_activity_id)
      return {
        date: formatShortDate(cycle.start_time),
        score: rec?.recovery_score ?? 0,
        color: recoveryColor(rec?.recovery_score),
      }
    })

  const hrvData = recentCycles
    .slice(0, 30)
    .reverse()
    .map(cycle => {
      const rec = recentRecoveries.find(r => r.cycle_id === cycle.fitbit_activity_id)
      return {
        date: formatShortDate(cycle.start_time),
        hrv: rec?.hrv_rmssd_milli ? Math.round(rec.hrv_rmssd_milli) : null,
        rhr: rec?.resting_heart_rate ? Math.round(rec.resting_heart_rate) : null,
        spo2: rec?.spo2_percentage ? parseFloat(rec.spo2_percentage.toFixed(1)) : null,
        temp: rec?.skin_temp_celsius ? parseFloat(rec.skin_temp_celsius.toFixed(1)) : null,
      }
    })

  const hrv = selectedRecovery?.hrv_rmssd_milli
    ? Math.round(selectedRecovery.hrv_rmssd_milli)
    : null

  const rhr = selectedRecovery?.resting_heart_rate
    ? Math.round(selectedRecovery.resting_heart_rate)
    : null

  const spo2 = selectedRecovery?.spo2_percentage
    ? selectedRecovery.spo2_percentage.toFixed(1)
    : null

  const temp = selectedRecovery?.skin_temp_celsius
    ? selectedRecovery.skin_temp_celsius.toFixed(1)
    : null

  return (
    <div className="page-premium pb-6">
      <PageHeader
        title="Recuperação"
        date={selectedCycle?.start_time}
        onPrev={() => setDayIndex(i => i + 1)}
        onNext={() => setDayIndex(i => i - 1)}
        hasPrev={dayIndex < recentCycles.length - 1}
        hasNext={dayIndex > 0}
        right={
          <button
            onClick={sync}
            disabled={syncing}
            className="text-xs text-gray-400 border border-white/10 rounded-lg px-3 py-1.5 disabled:opacity-50"
          >
            {syncing ? '...' : '↻'}
          </button>
        }
      />

      {!selectedRecovery ? (
        <NoDataBanner connected={whoopConnected} onSync={sync} syncing={syncing} />
      ) : (
        <>
          {/* Score principal — anel WHOOP style */}
          <div className="mx-4 mt-3 bg-surface rounded-3xl overflow-hidden">
            <div className="flex flex-col items-center py-6">
              <div className="relative flex items-center justify-center" style={{ width: 180, height: 180 }}>
                <ArcGauge value={score} max={100} color={color} size={180} />
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-5xl font-bold tabular-nums" style={{ color }}>
                    {score != null ? Math.round(score) : '--'}
                  </span>
                  <span className="text-xs text-gray-500 mt-1">% recuperação</span>
                  <span className="text-sm font-semibold mt-1" style={{ color }}>{levelLabel}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Métricas */}
          <div className="px-4 grid grid-cols-2 gap-3">
            <MetricCard
              label="VFC"
              value={hrv}
              unit="ms"
              sub="Variabilidade cardíaca"
              color="#00D4A0"
              icon={<WaveIcon />}
            />
            <MetricCard
              label="FCC"
              value={rhr}
              unit="bpm"
              sub="Frequência em repouso"
              color="#4FC3F7"
              icon={<HeartIcon />}
            />
            <MetricCard
              label="SpO₂"
              value={spo2}
              unit="%"
              sub="Oxigênio no sangue"
              color="#9C59D1"
              icon={<DropIcon />}
            />
            <MetricCard
              label="Temp. Pele"
              value={temp}
              unit="°C"
              sub="Temperatura cutânea"
              color="#FF8C00"
              icon={<TempIcon />}
            />
          </div>

          {/* Histórico recuperação 14 dias */}
          {chartData.length > 1 && (
            <div className="mx-4 mt-3 bg-surface rounded-2xl p-4">
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-3 font-medium">
                Recuperação · 14 dias
              </p>
              <ResponsiveContainer width="100%" height={80}>
                <BarChart data={chartData} barCategoryGap={4}>
                  <XAxis dataKey="date" tick={{ fill: '#666', fontSize: 9 }} axisLine={false} tickLine={false} />
                  <Bar dataKey="score" radius={[3, 3, 0, 0]}>
                    {chartData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* VFC trend */}
          {hrvData.some(d => d.hrv != null) && (
            <div className="mx-4 mt-3 bg-surface rounded-2xl p-4">
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-3 font-medium">VFC · 30 dias (ms)</p>
              <ResponsiveContainer width="100%" height={80}>
                <LineChart data={hrvData} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
                  <XAxis dataKey="date" tick={{ fill: '#666', fontSize: 8 }} axisLine={false} tickLine={false} interval={4} />
                  <YAxis tick={{ fill: '#666', fontSize: 9 }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v: number) => [`${v} ms`, 'VFC']} contentStyle={{ background: '#1a1a1a', border: '1px solid #ffffff15', borderRadius: 8, fontSize: 11 }} />
                  <Line type="monotone" dataKey="hrv" stroke="#00D4A0" dot={false} strokeWidth={2} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* RHR trend */}
          {hrvData.some(d => d.rhr != null) && (
            <div className="mx-4 mt-3 bg-surface rounded-2xl p-4">
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-3 font-medium">FC de Repouso · 30 dias (bpm)</p>
              <ResponsiveContainer width="100%" height={80}>
                <LineChart data={hrvData} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
                  <XAxis dataKey="date" tick={{ fill: '#666', fontSize: 8 }} axisLine={false} tickLine={false} interval={4} />
                  <YAxis tick={{ fill: '#666', fontSize: 9 }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v: number) => [`${v} bpm`, 'FC Repouso']} contentStyle={{ background: '#1a1a1a', border: '1px solid #ffffff15', borderRadius: 8, fontSize: 11 }} />
                  <Line type="monotone" dataKey="rhr" stroke="#4FC3F7" dot={false} strokeWidth={2} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* SpO2 trend */}
          {hrvData.some(d => d.spo2 != null) && (
            <div className="mx-4 mt-3 bg-surface rounded-2xl p-4">
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-3 font-medium">SpO₂ · 30 dias (%)</p>
              <ResponsiveContainer width="100%" height={80}>
                <LineChart data={hrvData} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
                  <XAxis dataKey="date" tick={{ fill: '#666', fontSize: 8 }} axisLine={false} tickLine={false} interval={4} />
                  <YAxis tick={{ fill: '#666', fontSize: 9 }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
                  <Tooltip formatter={(v: number) => [`${v}%`, 'SpO₂']} contentStyle={{ background: '#1a1a1a', border: '1px solid #ffffff15', borderRadius: 8, fontSize: 11 }} />
                  <Line type="monotone" dataKey="spo2" stroke="#9C59D1" dot={false} strokeWidth={2} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Skin temp trend */}
          {hrvData.some(d => d.temp != null) && (
            <div className="mx-4 mt-3 bg-surface rounded-2xl p-4">
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-3 font-medium">Temperatura da Pele · 30 dias (°C)</p>
              <ResponsiveContainer width="100%" height={80}>
                <LineChart data={hrvData} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
                  <XAxis dataKey="date" tick={{ fill: '#666', fontSize: 8 }} axisLine={false} tickLine={false} interval={4} />
                  <YAxis tick={{ fill: '#666', fontSize: 9 }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
                  <Tooltip formatter={(v: number) => [`${v}°C`, 'Temp. Pele']} contentStyle={{ background: '#1a1a1a', border: '1px solid #ffffff15', borderRadius: 8, fontSize: 11 }} />
                  <Line type="monotone" dataKey="temp" stroke="#FF8C00" dot={false} strokeWidth={2} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          <button
            onClick={() => navigate('/ia?q=' + encodeURIComponent('Como está minha recuperação hoje? Analise minha VFC, FC de repouso e score geral.'))}
            className="mx-4 mt-3 mb-2 w-[calc(100%-2rem)] flex items-center justify-center gap-2 bg-surface border border-bhr-green/20 rounded-2xl py-3 text-sm text-bhr-green font-medium active:scale-95 transition-transform"
          >
            🤖 Perguntar ao Coach
          </button>
        </>
      )}
    </div>
  )
}

const WaveIcon = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z"/>
  </svg>
)
const HeartIcon = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.27 2 8.5 2 5.41 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.08C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.41 22 8.5c0 3.77-3.4 6.86-8.55 11.53L12 21.35z"/>
  </svg>
)
const DropIcon = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2c-5.33 4.55-8 8.48-8 11.8C4 17.78 7.58 22 12 22s8-4.22 8-8.2C20 10.48 17.33 6.55 12 2z"/>
  </svg>
)
const TempIcon = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M15 13V5c0-1.66-1.34-3-3-3S9 3.34 9 5v8c-1.21.91-2 2.37-2 4 0 2.76 2.24 5 5 5s5-2.24 5-5c0-1.63-.79-3.09-2-4zm-3 7c-1.65 0-3-1.35-3-3 0-1.3.84-2.4 2-2.82V5c0-.55.45-1 1-1s1 .45 1 1v9.18c1.16.42 2 1.52 2 2.82 0 1.65-1.35 3-3 3z"/>
  </svg>
)
