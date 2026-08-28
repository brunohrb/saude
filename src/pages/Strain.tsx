import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWhoopData } from '../hooks/useWhoopData'
import { useSync } from '../hooks/useSync'
import PageHeader from '../components/PageHeader'
import NoDataBanner from '../components/NoDataBanner'
import LoadingScreen from '../components/LoadingScreen'
import HRZonesBar from '../components/HRZonesBar'
import ArcGauge from '../components/ArcGauge'
import { strainColor, sportName, workoutDuration, kcalFromKj, formatTime, formatShortDate } from '../utils/whoop'
import { BarChart, Bar, XAxis, ResponsiveContainer, Cell } from 'recharts'

const STRAIN_ZONES = [
  { label: 'Leve', range: '0–9', color: '#4FC3F7' },
  { label: 'Moderado', range: '10–13', color: '#F5C518' },
  { label: 'Intenso', range: '14–17', color: '#FF8C00' },
  { label: 'Extremo', range: '18–21', color: '#FF4444' },
]

export default function Strain() {
  const { recentCycles, recentWorkouts, whoopConnected, loading, refresh } = useWhoopData()
  const { sync, syncing } = useSync(refresh)
  const [dayIndex, setDayIndex] = useState(0)
  const navigate = useNavigate()

  if (loading) return <LoadingScreen />

  const latestCycle = recentCycles[dayIndex] ?? null
  const strain = latestCycle?.strain ?? null
  const color = strainColor(strain)

  const cycleWorkouts = recentWorkouts.filter(w => {
    if (!latestCycle) return false
    // Compare by local date string to avoid UTC offset issues
    const wDate = new Date(w.start_time).toLocaleDateString('pt-BR')
    const cDate = new Date(latestCycle.start_time).toLocaleDateString('pt-BR')
    return wDate === cDate
  })

  const chartData = recentCycles
    .slice(0, 14)
    .reverse()
    .map(c => ({
      date: formatShortDate(c.start_time),
      esforco: c.strain ? Math.round(c.strain * 10) / 10 : 0,
      color: strainColor(c.strain),
    }))

  return (
    <div className="page-premium pb-8">
      <PageHeader
        title="Esforço"
        date={latestCycle?.start_time}
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

      {!latestCycle ? (
        <NoDataBanner connected={whoopConnected} onSync={sync} syncing={syncing} />
      ) : (
        <>
          {/* Hero — anel WHOOP style */}
          <div className="mx-4 mt-2 bg-surface rounded-3xl overflow-hidden">
            <div className="flex flex-col items-center py-5">
              <div className="relative flex items-center justify-center" style={{ width: 180, height: 180 }}>
                <ArcGauge value={strain} max={21} color={color} size={180} />
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-5xl font-bold tabular-nums" style={{ color }}>
                    {strain != null ? strain.toFixed(1) : '--'}
                  </span>
                  <span className="text-xs text-gray-500 mt-1">/ 21 esforço</span>
                </div>
              </div>
            </div>

            <div className="flex justify-around pb-5 border-t border-white/5 pt-4">
              <StatItem label="Calorias" value={`${kcalFromKj(latestCycle.kilojoule) || '--'}`} unit="kcal" color="#FF8C00" />
              <div className="w-px bg-white/5" />
              <StatItem label="FC Média" value={`${latestCycle.average_heart_rate ?? '--'}`} unit="bpm" color="#4FC3F7" />
              <div className="w-px bg-white/5" />
              <StatItem label="FC Máx" value={`${latestCycle.max_heart_rate ?? '--'}`} unit="bpm" color="#FF4444" />
            </div>

            {/* Legenda de zonas */}
            <div className="flex justify-between px-5 pb-4 pt-2 border-t border-white/5">
              {STRAIN_ZONES.map(z => (
                <div key={z.label} className="flex flex-col items-center gap-1">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: z.color }} />
                  <span className="text-[10px] text-gray-400 font-medium">{z.label}</span>
                  <span className="text-[9px] text-gray-600">{z.range}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Histórico 14 dias */}
          {chartData.length > 1 && (
            <div className="mx-4 mt-3 bg-surface rounded-2xl p-4">
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-3 font-medium">
                Últimos 14 dias
              </p>
              <ResponsiveContainer width="100%" height={80}>
                <BarChart data={chartData} barCategoryGap={4}>
                  <XAxis dataKey="date" tick={{ fill: '#666', fontSize: 9 }} axisLine={false} tickLine={false} />
                  <Bar dataKey="esforco" radius={[3, 3, 0, 0]}>
                    {chartData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Treinos do dia */}
          {cycleWorkouts.length > 0 && (
            <div className="px-4 mt-3">
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-3 font-medium px-1">
                Treinos do dia
              </p>
              <div className="flex flex-col gap-3">
                {cycleWorkouts.map(w => <WorkoutCard key={w.id} workout={w} />)}
              </div>
            </div>
          )}

          {cycleWorkouts.length === 0 && (
            <div className="mx-4 mt-3 bg-surface rounded-2xl p-4 text-center">
              <p className="text-gray-500 text-sm">Nenhum treino registrado</p>
              <p className="text-gray-600 text-xs mt-1">Registre atividades no app WHOOP</p>
            </div>
          )}

          {/* Treinos recentes — últimos 7 dias excluindo o dia selecionado */}
          {dayIndex === 0 && (() => {
            const todayStart = latestCycle ? new Date(latestCycle.start_time).getTime() : 0
            const recentOther = recentWorkouts.filter(w => new Date(w.start_time).getTime() < todayStart).slice(0, 8)
            if (recentOther.length === 0) return null
            return (
              <div className="px-4 mt-4">
                <p className="text-xs text-gray-400 uppercase tracking-wider mb-3 font-medium px-1">Treinos recentes</p>
                <div className="flex flex-col gap-2">
                  {recentOther.map(w => (
                    <div key={w.id} className="bg-surface rounded-xl px-3 py-2.5 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold">{sportName(w.sport_id)}</p>
                        <p className="text-xs text-gray-500">
                          {new Date(w.start_time).toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' })}
                          {' · '}{workoutDuration(w.start_time, w.end_time)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-base font-bold" style={{ color: strainColor(w.strain) }}>
                          {w.strain?.toFixed(1) ?? '--'}
                        </p>
                        <p className="text-[10px] text-gray-500">{kcalFromKj(w.kilojoule) || '--'} kcal</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}
          <button
            onClick={() => navigate('/ia?q=' + encodeURIComponent('Como foi meu esforço hoje? Analise meu strain, treinos e zonas de FC.'))}
            className="mx-4 mt-3 mb-2 w-[calc(100%-2rem)] flex items-center justify-center gap-2 bg-surface border border-bhr-green/20 rounded-2xl py-3 text-sm text-bhr-green font-medium active:scale-95 transition-transform"
          >
            🤖 Perguntar ao Coach
          </button>
        </>
      )}
    </div>
  )
}

function StatItem({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-base font-bold" style={{ color }}>{value}</span>
      <span className="text-[10px] text-gray-400">{unit}</span>
    </div>
  )
}

function WorkoutCard({ workout }: { workout: ReturnType<typeof useWhoopData>['recentWorkouts'][0] }) {
  const color = strainColor(workout.strain)
  const pctRec = workout.percent_recorded
  return (
    <div className="bg-surface rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="font-semibold">{sportName(workout.sport_id)}</p>
          <p className="text-xs text-gray-400">
            {formatTime(workout.start_time)} · {workoutDuration(workout.start_time, workout.end_time)}
            {pctRec != null && pctRec < 100 && (
              <span className="ml-1 text-yellow-400/80">· {pctRec.toFixed(0)}% gravado</span>
            )}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold" style={{ color }}>
            {workout.strain?.toFixed(1) ?? '--'}
          </p>
          <p className="text-xs text-gray-400">esforço</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-sm">
        <div>
          <p className="text-gray-400 text-xs">FC Média</p>
          <p className="font-semibold">{workout.average_heart_rate ?? '--'} <span className="text-xs text-gray-400">bpm</span></p>
        </div>
        <div>
          <p className="text-gray-400 text-xs">FC Máx</p>
          <p className="font-semibold">{workout.max_heart_rate ?? '--'} <span className="text-xs text-gray-400">bpm</span></p>
        </div>
        <div>
          <p className="text-gray-400 text-xs">Calorias</p>
          <p className="font-semibold">{kcalFromKj(workout.kilojoule) || '--'} <span className="text-xs text-gray-400">kcal</span></p>
        </div>
      </div>
      {(workout.zone_one_milli || workout.zone_two_milli || workout.zone_three_milli) && (
        <div className="mt-3 pt-3 border-t border-white/5">
          <p className="text-xs text-gray-400 mb-2">Zonas de FC</p>
          <HRZonesBar workout={workout} />
        </div>
      )}
    </div>
  )
}
