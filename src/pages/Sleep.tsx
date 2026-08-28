import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWhoopData } from '../hooks/useWhoopData'
import { useSync } from '../hooks/useSync'
import MetricCard from '../components/MetricCard'
import PageHeader from '../components/PageHeader'
import NoDataBanner from '../components/NoDataBanner'
import LoadingScreen from '../components/LoadingScreen'
import SleepStagesBar from '../components/SleepStagesBar'
import ArcGauge from '../components/ArcGauge'
import { millisToTime, millisToHours, formatTime, formatShortDate } from '../utils/whoop'
import { BarChart, Bar, XAxis, ResponsiveContainer } from 'recharts'

export default function Sleep() {
  const { recentSleeps, recentNaps, whoopConnected, loading, refresh } = useWhoopData()
  const { sync, syncing } = useSync(refresh)
  const [dayIndex, setDayIndex] = useState(0)
  const navigate = useNavigate()

  if (loading) return <LoadingScreen />

  const selectedDay = new Date()
  selectedDay.setHours(12, 0, 0, 0)
  selectedDay.setDate(selectedDay.getDate() - dayIndex)
  const selectedDateKey = localDateKey(selectedDay.toISOString())
  const latestSleep = recentSleeps.find(sleep => localDateKey(sleep.end_time) === selectedDateKey) ?? null

  const perfScore = latestSleep?.sleep_performance_percentage ?? null
  const totalSleep = (latestSleep?.total_in_bed_time_milli ?? 0) - (latestSleep?.total_awake_time_milli ?? 0)

  const sleepNeeded = latestSleep
    ? (latestSleep.sleep_needed_baseline_milli ?? 0)
      + (latestSleep.sleep_needed_from_recent_strain_milli ?? 0)
      + (latestSleep.sleep_needed_from_sleep_debt_milli ?? 0)
      + (latestSleep.sleep_needed_from_recent_nap_milli ?? 0)
    : 0

  const sleepByWakeDate = new Map(recentSleeps.map(sleep => [localDateKey(sleep.end_time), sleep]))
  const chartData = Array.from({ length: 14 }, (_, index) => {
    const day = new Date()
    day.setHours(12, 0, 0, 0)
    day.setDate(day.getDate() - (13 - index))
    const sleep = sleepByWakeDate.get(localDateKey(day.toISOString()))

    return {
      date: formatShortDate(day.toISOString()),
      horas: sleep
        ? Math.round(millisToHours(
          (sleep.total_in_bed_time_milli ?? 0) - (sleep.total_awake_time_milli ?? 0)
        ) * 10) / 10
        : null,
    }
  })

  const last7Naps = recentNaps.slice(0, 7)

  return (
    <div className="page-premium pb-6">
      <PageHeader
        title="Sono"
        date={selectedDay.toISOString()}
        onPrev={() => setDayIndex(i => i + 1)}
        onNext={() => setDayIndex(i => i - 1)}
        hasPrev={dayIndex < 59}
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

      {!latestSleep ? (
        <NoDataBanner connected={whoopConnected} onSync={sync} syncing={syncing} />
      ) : (
        <>
          {/* Score + horários — WHOOP style */}
          <div className="mx-4 mt-3 bg-surface rounded-3xl overflow-hidden">
            <div className="flex flex-col items-center pt-5 pb-3">
              <div className="relative flex items-center justify-center" style={{ width: 160, height: 160 }}>
                <ArcGauge value={perfScore} max={100} color="#9C59D1" size={160} />
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-4xl font-bold tabular-nums" style={{ color: '#9C59D1' }}>
                    {perfScore != null ? Math.round(perfScore) : '--'}
                  </span>
                  <span className="text-xs text-gray-500 mt-1">% desempenho</span>
                </div>
              </div>
            </div>
            <div className="flex border-t border-white/8">
              <div className="flex-1 flex flex-col items-center py-3 px-2 gap-0.5 border-r border-white/8">
                <span className="text-lg font-bold tabular-nums text-white">{formatTime(latestSleep.start_time)}</span>
                <span className="text-[10px] text-gray-500">dormiu</span>
              </div>
              <div className="flex-1 flex flex-col items-center py-3 px-2 gap-0.5 border-r border-white/8">
                <span className="text-lg font-bold tabular-nums text-white">{formatTime(latestSleep.end_time)}</span>
                <span className="text-[10px] text-gray-500">acordou</span>
              </div>
              <div className="flex-1 flex flex-col items-center py-3 px-2 gap-0.5">
                <span className="text-lg font-bold tabular-nums" style={{ color: '#9C59D1' }}>{millisToTime(totalSleep)}</span>
                <span className="text-[10px] text-gray-500">total</span>
              </div>
            </div>
          </div>

          {/* Métricas principais */}
          <div className="px-4 grid grid-cols-2 gap-3 mt-3">
            <MetricCard
              label="Eficiência"
              value={latestSleep.sleep_efficiency_percentage?.toFixed(0)}
              unit="%"
              color="#9C59D1"
            />
            <MetricCard
              label="Consistência"
              value={latestSleep.sleep_consistency_percentage?.toFixed(0)}
              unit="%"
              color="#4FC3F7"
            />
            <MetricCard
              label="Frequência respiratória"
              value={latestSleep.respiratory_rate?.toFixed(1) ?? '--'}
              unit="rpm"
              color="#00D4A0"
            />
            <MetricCard
              label="Ciclos de sono"
              value={latestSleep.sleep_cycle_count ?? '--'}
              sub="ciclos REM"
              color="#F5C518"
            />
            <MetricCard
              label="Na cama"
              value={millisToTime(latestSleep.total_in_bed_time_milli)}
              color="#fff"
            />
            <MetricCard
              label="Distúrbios"
              value={latestSleep.disturbance_count ?? '--'}
              sub="vezes acordado"
              color={(latestSleep.disturbance_count ?? 0) > 5 ? '#FF4444' : '#00D4A0'}
            />
          </div>

          {/* Necessidade de sono detalhada */}
          {sleepNeeded > 0 && (
            <div className="mx-4 mt-3 bg-surface rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-medium">Necessidade de sono</p>
                <span className="text-xs font-semibold" style={{ color: totalSleep >= sleepNeeded ? '#00D4A0' : '#F5C518' }}>
                  {Math.round((totalSleep / sleepNeeded) * 100)}%
                </span>
              </div>

              <div className="flex items-center gap-2 mb-3">
                <div className="flex-1 h-2 bg-surface-3 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${Math.min((totalSleep / sleepNeeded) * 100, 100)}%`,
                      backgroundColor: '#9C59D1',
                    }}
                  />
                </div>
                <span className="text-sm font-semibold text-purple-400">
                  {millisToTime(sleepNeeded)}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs pt-3 border-t border-white/5">
                <BreakdownRow label="Base biológica" value={millisToTime(latestSleep.sleep_needed_baseline_milli)} color="#9C59D1" />
                {!!latestSleep.sleep_needed_from_recent_strain_milli && (
                  <BreakdownRow label="+ esforço recente" value={millisToTime(latestSleep.sleep_needed_from_recent_strain_milli)} color="#FF8C00" />
                )}
                {!!latestSleep.sleep_needed_from_sleep_debt_milli && (
                  <BreakdownRow label="+ dívida acumulada" value={millisToTime(latestSleep.sleep_needed_from_sleep_debt_milli)} color="#FF4444" />
                )}
                {!!latestSleep.sleep_needed_from_recent_nap_milli && (
                  <BreakdownRow label="− soneca recente" value={millisToTime(Math.abs(latestSleep.sleep_needed_from_recent_nap_milli))} color="#00D4A0" />
                )}
                <BreakdownRow label="Dormido" value={millisToTime(totalSleep)} color="#fff" />
              </div>
            </div>
          )}

          {/* Estágios do sono */}
          <div className="mx-4 mt-3 bg-surface rounded-2xl p-4">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-3 font-medium">Estágios</p>
            <SleepStagesBar sleep={latestSleep} />
          </div>

          {/* Sonecas */}
          {last7Naps.length > 0 && (
            <div className="mx-4 mt-3 bg-surface rounded-2xl p-4">
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-3 font-medium">Sonecas (últimas)</p>
              <div className="flex flex-col gap-2">
                {last7Naps.map(nap => {
                  const napTotal = (nap.total_in_bed_time_milli ?? 0) - (nap.total_awake_time_milli ?? 0)
                  return (
                    <div key={nap.id} className="flex items-center justify-between text-sm bg-surface-2 rounded-xl px-3 py-2">
                      <div>
                        <p className="text-white font-medium">{formatShortDate(nap.start_time)}</p>
                        <p className="text-xs text-gray-500">{formatTime(nap.start_time)} – {formatTime(nap.end_time)}</p>
                      </div>
                      <span className="font-bold text-purple-400">{millisToTime(napTotal)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Histórico */}
          {chartData.length > 1 && (
            <div className="mx-4 mt-3 bg-surface rounded-2xl p-4">
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-3 font-medium">
                Últimos 14 dias (horas)
              </p>
              <ResponsiveContainer width="100%" height={80}>
                <BarChart data={chartData} barCategoryGap={4}>
                  <XAxis dataKey="date" tick={{ fill: '#666', fontSize: 9 }} axisLine={false} tickLine={false} />
                  <Bar dataKey="horas" fill="#9C59D1" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <button
            onClick={() => navigate('/ia?q=' + encodeURIComponent('Como foi meu sono? Analise meu desempenho, eficiência e fases do sono.'))}
            className="mx-4 mt-3 mb-2 w-[calc(100%-2rem)] flex items-center justify-center gap-2 bg-surface border border-bhr-green/20 rounded-2xl py-3 text-sm text-bhr-green font-medium active:scale-95 transition-transform"
          >
            🤖 Perguntar ao Coach
          </button>
        </>
      )}
    </div>
  )
}

function localDateKey(value: string | null | undefined): string {
  if (!value) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Fortaleza',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value))
}

function BreakdownRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-400">{label}</span>
      <span className="font-semibold tabular-nums" style={{ color }}>{value}</span>
    </div>
  )
}
