import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useWhoopData } from '../hooks/useWhoopData'
import { SPLITS, getActivePhase, parseDescanso } from '../data/workouts'
import { MEALS } from '../data/meals'
import type { WhoopRecovery, WhoopSleep } from '../types'

type TreinoTab = 'treino' | 'dieta' | 'readiness' | 'timer' | 'stats'

interface ReadinessDay {
  sleep: number
  energy: number
  soreness: number
  mood: number
  score: number
}

interface TreinoState {
  date: string
  split: '6d' | '5d'
  cursor: number
  completedCount: number
  exercises: Record<string, boolean>
  meals: Record<string, boolean>
  mealChoice: Record<string, number>
  fastToday: boolean
  fastDays: Record<string, boolean>
  readiness: Record<string, ReadinessDay>
  restDayToday: string
  skipNextRest: boolean
}

const STORAGE_KEY = 'iron-data-v2'
const CYCLE_LENGTH = 35
const DELOAD_WINDOW = 7

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

function defaultState(): TreinoState {
  return {
    date: todayKey(),
    split: '6d',
    cursor: 0,
    completedCount: 0,
    exercises: {},
    meals: {},
    mealChoice: {},
    fastToday: false,
    fastDays: {},
    readiness: {},
    restDayToday: '',
    skipNextRest: false,
  }
}

function mergeState(raw: unknown): TreinoState {
  const base = defaultState()
  const parsed = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (parsed.cursor === undefined || parsed.completedCount === undefined) {
    parsed.cursor = 0
    parsed.completedCount = 0
    parsed.exercises = {}
  }
  for (const k of Object.keys(base) as (keyof TreinoState)[]) {
    if (parsed[k] === undefined) parsed[k] = base[k] as unknown
  }
  const state = parsed as unknown as TreinoState
  if (state.date !== todayKey()) {
    if (state.fastToday) state.fastDays[state.date] = true
    state.date = todayKey()
    state.exercises = {}
    state.meals = {}
    state.fastToday = false
  }
  return state
}

function loadLocalState(): TreinoState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultState()
    return mergeState(JSON.parse(raw))
  } catch {
    return defaultState()
  }
}

function sessionInCycle(completedCount: number): number {
  return (completedCount % CYCLE_LENGTH) + 1
}

function isDeload(completedCount: number): boolean {
  return sessionInCycle(completedCount) >= CYCLE_LENGTH - DELOAD_WINDOW + 1
}

function sessionsUntilDeload(completedCount: number): number {
  const pos = sessionInCycle(completedCount)
  const start = CYCLE_LENGTH - DELOAD_WINDOW + 1
  return pos < start ? start - pos : 0
}

function applyDeload(sets: string, deload: boolean): string {
  if (!deload) return sets
  const m = sets.match(/^(\d+)x(.+)$/)
  if (!m) return sets
  return `${Math.max(2, Math.ceil(parseInt(m[1]) / 2))}x${m[2]}`
}

type AdaptLevel = 'none' | 'moderate' | 'heavy'

function applyAdaptation(sets: string, level: AdaptLevel): string {
  if (level === 'none') return sets
  const m = sets.match(/^(\d+)x(\d+)(.*)$/)
  if (!m) return sets
  const s = parseInt(m[1])
  const r = parseInt(m[2])
  const rest = m[3]
  if (level === 'moderate') {
    // ~25% reduction: 4x12 → 3x10
    return `${Math.max(2, Math.round(s * 0.75))}x${Math.max(6, Math.round(r * 0.83))}${rest}`
  }
  // 'heavy' ~50%: 4x12 → 2x8
  return `${Math.max(2, Math.ceil(s / 2))}x${Math.max(5, Math.round(r * 0.67))}${rest}`
}

function createBeeps(audioCtx: AudioContext, secondsFromNow: number) {
  const tones = [
    { freq: 880, dur: 0.18, gain: 0.55, delay: 0.0 },
    { freq: 1100, dur: 0.18, gain: 0.65, delay: 0.22 },
    { freq: 1320, dur: 0.32, gain: 0.72, delay: 0.44 },
    { freq: 1760, dur: 0.45, gain: 0.78, delay: 0.80 },
  ]
  const startAt = audioCtx.currentTime + Math.max(0, secondsFromNow)
  tones.forEach(t => {
    try {
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.connect(gain)
      gain.connect(audioCtx.destination)
      osc.type = 'sine'
      osc.frequency.value = t.freq
      const t0 = startAt + t.delay
      gain.gain.setValueAtTime(0.001, t0)
      gain.gain.exponentialRampToValueAtTime(t.gain, t0 + 0.02)
      gain.gain.setValueAtTime(t.gain, t0 + t.dur - 0.05)
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + t.dur)
      osc.start(t0)
      osc.stop(t0 + t.dur + 0.05)
    } catch { /* áudio não é suportado neste dispositivo */ }
  })
}

// ── Supabase sync (debounced) ────────────────────────────────────────
let syncTimer: ReturnType<typeof setTimeout> | null = null

async function syncToSupabase(state: TreinoState) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  await supabase.schema('treino').from('bhr_treinos').upsert(
    { user_id: user.id, record_content: state, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' }
  )
}

function scheduleSyncToSupabase(state: TreinoState) {
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(() => syncToSupabase(state), 1500)
}

export default function Treino() {
  const [activeTab, setActiveTab] = useState<TreinoTab>('treino')
  const [state, setStateRaw] = useState<TreinoState>(() => loadLocalState())
  const [syncing, setSyncing] = useState(true)
  const { latestRecovery, latestSleep } = useWhoopData()

  // Load from Supabase on mount
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { setSyncing(false); return }
      const { data } = await supabase.schema('treino').from('bhr_treinos')
        .select('record_content').eq('user_id', user.id).maybeSingle()
      if (data?.record_content) {
        const loaded = mergeState(data.record_content)
        setStateRaw(loaded)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(loaded))
      }
      setSyncing(false)
    })
  }, [])

  const setState = useCallback((updater: (prev: TreinoState) => TreinoState) => {
    setStateRaw(prev => {
      const next = updater(prev)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      scheduleSyncToSupabase(next)
      return next
    })
  }, [])

  const deload = isDeload(state.completedCount)

  if (syncing) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="w-6 h-6 border-2 border-bhr-green border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="pb-8 flex flex-col h-full">
      <div className="flex border-b border-white/10 bg-black sticky top-0 z-10 overflow-x-auto">
        {([
          ['treino',    'Treino'],
          ['dieta',     'Dieta'],
          ['readiness', 'Prontidão'],
          ['timer',     'Timer'],
          ['stats',     'Stats'],
        ] as [TreinoTab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`flex-shrink-0 flex-1 py-3 text-xs font-semibold uppercase tracking-wide transition-colors ${
              activeTab === t ? 'text-bhr-green border-b-2 border-bhr-green' : 'text-gray-500'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'treino'    && <WorkoutTab state={state} setState={setState} deload={deload} latestRecovery={latestRecovery} latestSleep={latestSleep} />}
        {activeTab === 'dieta'     && <DietaTab state={state} setState={setState} />}
        {activeTab === 'readiness' && <ReadinessTab state={state} setState={setState} />}
        {activeTab === 'timer'     && <TimerTab />}
        {activeTab === 'stats'     && <StatsTab state={state} setState={setState} />}
      </div>
    </div>
  )
}

// ── Coach ─────────────────────────────────────────────────────────────────────

function coachRecommendation(
  recovery: number | null,
  sleepPerf: number | null,
  subjective: number | null,
) {
  // weighted average: recovery 50%, sleep 20%, subjective 30%
  let sum = 0, weight = 0
  if (recovery  !== null) { sum += recovery  * 0.50; weight += 0.50 }
  if (sleepPerf !== null) { sum += sleepPerf * 0.20; weight += 0.20 }
  if (subjective !== null) { sum += subjective * 0.30; weight += 0.30 }
  if (weight === 0) return null
  const score = sum / weight

  if (score >= 75) return {
    score: Math.round(score),
    color: 'text-bhr-green', border: 'border-bhr-green/30', bg: 'bg-bhr-green/10',
    label: 'Treinar forte', emoji: '🟢',
    advice: 'Recuperação excelente. Tente progressão de carga ou bata um PR hoje.',
  }
  if (score >= 55) return {
    score: Math.round(score),
    color: 'text-[#9BD200]', border: 'border-[#9BD200]/30', bg: 'bg-[#9BD200]/10',
    label: 'Treino normal', emoji: '🟡',
    advice: 'Boa recuperação. Siga o plano normalmente.',
  }
  if (score >= 35) return {
    score: Math.round(score),
    color: 'text-bhr-yellow', border: 'border-bhr-yellow/30', bg: 'bg-bhr-yellow/10',
    label: 'Reduzir carga', emoji: '🟠',
    advice: 'Recuperação parcial. Reduza o peso 10–20% e mantenha as séries.',
  }
  return {
    score: Math.round(score),
    color: 'text-bhr-red', border: 'border-bhr-red/30', bg: 'bg-bhr-red/10',
    label: 'Treino leve ou OFF', emoji: '🔴',
    advice: 'Recuperação baixa. Prefira mobilidade, caminhada ou descanso. Ouvir o corpo é maturidade.',
  }
}

function CoachCard({
  recovery,
  sleep,
  readiness,
  isRestDay,
  workoutTitle,
  adaptLevel,
  onAdapt,
  onSkipRest,
  onPullRestForward,
}: {
  recovery: WhoopRecovery | null
  sleep: WhoopSleep | null
  readiness: ReadinessDay | null
  isRestDay: boolean
  workoutTitle: string
  adaptLevel: AdaptLevel
  onAdapt: (l: AdaptLevel) => void
  onSkipRest: () => void
  onPullRestForward: () => void
}) {
  const [open, setOpen] = useState(false)

  const whoopScore = recovery?.recovery_score              ?? null
  const sleepPerf  = sleep?.sleep_performance_percentage   ?? null
  const subjective = readiness?.score                      ?? null
  const hrv        = recovery?.hrv_rmssd_milli             ?? null
  const rhr        = recovery?.resting_heart_rate          ?? null

  const rec = coachRecommendation(whoopScore, sleepPerf, subjective)

  // No data at all
  if (!rec) {
    return (
      <div className="bg-surface rounded-2xl px-4 py-3 mb-3 flex items-center justify-between">
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Coach do Dia</p>
          <p className="text-[10px] text-gray-600 mt-0.5">Conecte o WHOOP ou preencha a aba Prontidão</p>
        </div>
        <span className="text-xl">🤖</span>
      </div>
    )
  }

  // ── Context-aware label ──────────────────────────────────────────────────
  let contextLabel = rec.label
  let contextAdvice = rec.advice
  let contextEmoji = rec.emoji

  if (isRestDay) {
    if (rec.score >= 75) {
      contextEmoji  = '💪'
      contextLabel  = 'Dia de descanso — mas você está ótimo'
      contextAdvice = `Recuperação excelente (${rec.score}) num dia de OFF. Se quiser, pule o descanso e treine hoje.`
    } else {
      contextEmoji  = '😴'
      contextLabel  = 'Descanse — seu corpo está pedindo'
      contextAdvice = `Recuperação ${rec.score}/100 confirma que hoje é dia de descanso. Aproveite para recuperar.`
    }
  } else {
    // training day
    if (rec.score < 35) {
      contextEmoji  = '⚠️'
      contextLabel  = `${workoutTitle} — recuperação muito baixa`
      contextAdvice = `Recuperação ${rec.score}/100. Não é o momento ideal para ${workoutTitle}. Considere antecipar o próximo descanso ou adaptar o treino.`
    } else if (rec.score < 55) {
      contextLabel  = `${workoutTitle} — reduzir carga`
      contextAdvice = `Recuperação ${rec.score}/100. Faça ${workoutTitle} mas reduza o volume. As séries/reps serão ajustadas automaticamente.`
    } else if (rec.score < 75) {
      contextLabel  = `${workoutTitle} — treino normal`
      contextAdvice = `Recuperação ${rec.score}/100. Siga o plano de ${workoutTitle} normalmente.`
    } else {
      contextLabel  = `${workoutTitle} — pode ir com tudo`
      contextAdvice = `Recuperação ${rec.score}/100. Ótimo dia para ${workoutTitle}. Tente progressão de carga.`
    }
  }

  const signals = [
    { label: 'Recuperação', value: whoopScore !== null ? `${whoopScore}%`        : '—', sub: 'objetivo'      },
    { label: 'Sono WHOOP',     value: sleepPerf  !== null ? `${sleepPerf}%`         : '—', sub: 'performance'   },
    { label: 'Prontidão',      value: subjective !== null ? `${subjective}`          : '—', sub: 'subjetivo'     },
    { label: 'HRV',            value: hrv        !== null ? `${Math.round(hrv)}ms`  : '—', sub: 'variabilidade' },
    { label: 'FC Repouso',     value: rhr        !== null ? `${rhr}bpm`             : '—', sub: 'basal'         },
  ]

  return (
    <div className={`rounded-2xl mb-3 border ${rec.border} ${rec.bg} overflow-hidden`}>
      {/* Header */}
      <button onClick={() => setOpen(o => !o)} className="w-full px-4 py-3 flex items-center justify-between text-left">
        <div>
          <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Coach do Dia</p>
          <p className={`text-sm font-bold mt-0.5 ${rec.color}`}>{contextEmoji} {contextLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xl font-bold tabular-nums ${rec.color}`}>{rec.score}</span>
          <span className="text-gray-500 text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 flex flex-col gap-3">
          <p className="text-xs text-gray-300 leading-relaxed">{contextAdvice}</p>

          {/* Sinais */}
          <div className="grid grid-cols-2 gap-2">
            {signals.map(s => (
              <div key={s.label} className="bg-black/30 rounded-xl px-3 py-2">
                <p className="text-[9px] text-gray-500 uppercase tracking-wide">{s.label}</p>
                <p className="text-sm font-bold text-white mt-0.5">{s.value}</p>
                <p className="text-[9px] text-gray-600">{s.sub}</p>
              </div>
            ))}
          </div>

          {/* ── Ações contextuais ── */}
          {isRestDay && rec.score >= 75 && (
            <button
              onClick={() => { onSkipRest(); setOpen(false) }}
              className="w-full py-2.5 rounded-xl bg-bhr-green text-black text-xs font-bold"
            >
              💪 Pular descanso e treinar hoje
            </button>
          )}

          {!isRestDay && (
            <div className="flex flex-col gap-2">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold">
                Ajustar volume do treino
              </p>
              <div className="grid grid-cols-3 gap-2">
                {([
                  ['none',     'Normal',      'text-white',        adaptLevel === 'none'],
                  ['moderate', '−25%',        'text-bhr-yellow', adaptLevel === 'moderate'],
                  ['heavy',    '−50%',        'text-bhr-red',    adaptLevel === 'heavy'],
                ] as const).map(([level, label, color, active]) => (
                  <button
                    key={level}
                    onClick={() => onAdapt(level)}
                    className={`py-2.5 rounded-xl text-xs font-bold border transition-colors ${
                      active ? `border-current ${color} bg-white/10` : 'border-white/20 text-gray-500'
                    } ${color}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {adaptLevel !== 'none' ? (
                <p className="text-[10px] text-gray-400">
                  {adaptLevel === 'moderate'
                    ? '📉 Volume −25%. Ex: 4×12 → 3×10'
                    : '📉 Volume −50%. Ex: 4×12 → 2×8'}
                </p>
              ) : rec.score < 55 ? (
                <p className="text-[10px] text-yellow-500">
                  ⚠️ Recuperação baixa — considere reduzir o volume
                </p>
              ) : null}
            </div>
          )}

          {!isRestDay && rec.score < 35 && (
            <button
              onClick={() => { onPullRestForward(); setOpen(false) }}
              className="w-full py-2.5 rounded-xl border border-bhr-red/40 text-bhr-red text-xs font-bold"
            >
              😴 Antecipar descanso — treinar amanhã
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function WorkoutTab({
  state,
  setState,
  deload,
  latestRecovery,
  latestSleep,
}: {
  state: TreinoState
  setState: (u: (p: TreinoState) => TreinoState) => void
  deload: boolean
  latestRecovery: WhoopRecovery | null
  latestSleep: WhoopSleep | null
}) {
  const [activeRest, setActiveRest] = useState<string | null>(null)
  const [restRemaining, setRestRemaining] = useState(0)
  const [restTotal, setRestTotal] = useState(0)
  const restEndRef = useRef(0)
  const restIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const [chronoSec, setChronoSec] = useState(0)
  const [chronoRunning, setChronoRunning] = useState(false)
  const chronoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [adaptLevel, setAdaptLevel] = useState<AdaptLevel>('none')

  const split = SPLITS[state.split]
  const dayData = split[state.cursor]
  const activePhase = getActivePhase(state.completedCount)
  const workout = activePhase.workouts[dayData.key]

  function initAudio() {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      try {
        audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      } catch { /* áudio não é suportado neste dispositivo */ }
    }
  }

  function startRest(key: string, seconds: number) {
    if (restIntervalRef.current) clearInterval(restIntervalRef.current)
    setActiveRest(key)
    setRestTotal(seconds)
    restEndRef.current = Date.now() + seconds * 1000
    setRestRemaining(seconds)
    if (audioCtxRef.current) createBeeps(audioCtxRef.current, seconds)
    if ('vibrate' in navigator) navigator.vibrate(100)
    restIntervalRef.current = setInterval(() => {
      const rem = Math.max(0, Math.ceil((restEndRef.current - Date.now()) / 1000))
      setRestRemaining(rem)
      if (rem <= 0) {
        clearInterval(restIntervalRef.current!)
        restIntervalRef.current = null
        setActiveRest(null)
        if ('vibrate' in navigator) navigator.vibrate([300, 100, 300, 100, 500])
      }
    }, 250)
  }

  function cancelRest() {
    if (restIntervalRef.current) clearInterval(restIntervalRef.current)
    restIntervalRef.current = null
    setActiveRest(null)
  }

  function toggleChrono() {
    if (chronoRunning) {
      clearInterval(chronoIntervalRef.current!)
      chronoIntervalRef.current = null
      setChronoRunning(false)
    } else {
      setChronoRunning(true)
      chronoIntervalRef.current = setInterval(() => setChronoSec(s => s + 1), 1000)
    }
  }

  function resetChrono() {
    clearInterval(chronoIntervalRef.current!)
    chronoIntervalRef.current = null
    setChronoRunning(false)
    setChronoSec(0)
  }

  useEffect(() => () => {
    if (restIntervalRef.current) clearInterval(restIntervalRef.current)
    if (chronoIntervalRef.current) clearInterval(chronoIntervalRef.current)
  }, [])

  function toggleExercise(key: string) {
    initAudio()
    setState(prev => {
      const next = { ...prev, exercises: { ...prev.exercises, [key]: !prev.exercises[key] } }
      if (!prev.exercises[key]) {
        const allDone = workout.exercises.every((_, i) => {
          const k2 = `${dayData.key}-${i}`
          return k2 === key ? true : next.exercises[k2]
        })
        if (allDone) setTimeout(() => advanceSession(), 400)
      }
      return next
    })
  }

  function advanceSession() {
    setState(prev => {
      const sp = SPLITS[prev.split]
      const newExercises = { ...prev.exercises }
      Object.keys(newExercises).forEach(k => { if (k.startsWith(dayData.key + '-')) delete newExercises[k] })
      let newCursor = (prev.cursor + 1) % sp.length
      let newCount = prev.completedCount + 1
      if (prev.skipNextRest && sp[newCursor].key === 'rest') {
        newCursor = (newCursor + 1) % sp.length
        newCount++
      }
      return { ...prev, cursor: newCursor, completedCount: newCount, exercises: newExercises, skipNextRest: false, restDayToday: '' }
    })
    resetChrono()
  }

  function restToday() {
    if (!confirm('Descansar hoje?\n\nO próximo dia OFF da fila será consumido.')) return
    setState(prev => ({ ...prev, restDayToday: todayKey(), skipNextRest: true }))
  }

  function undoSession() {
    if (state.completedCount === 0) return
    if (!confirm('Desfazer a última sessão?')) return
    setState(prev => {
      const sp = SPLITS[prev.split]
      return { ...prev, cursor: (prev.cursor - 1 + sp.length) % sp.length, completedCount: prev.completedCount - 1 }
    })
  }

  const fmtChrono = (s: number) => {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const r = s % 60
    if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
  }

  const restPct = restTotal > 0 ? (restRemaining / restTotal) * 100 : 0

  const todayReadiness = state.readiness[todayKey()] ?? null

  function pullRestForward() {
    if (!confirm('Antecipar o descanso para hoje?\nO próximo OFF da fila será consumido.')) return
    setState(prev => ({ ...prev, restDayToday: todayKey(), skipNextRest: true }))
  }

  return (
    <div className="px-4 py-3">
      <CoachCard
        recovery={latestRecovery}
        sleep={latestSleep}
        readiness={todayReadiness}
        isRestDay={!!workout.rest}
        workoutTitle={workout.title ?? dayData.focus}
        adaptLevel={adaptLevel}
        onAdapt={setAdaptLevel}
        onSkipRest={advanceSession}
        onPullRestForward={pullRestForward}
      />

      {activeRest && (
        <div className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center gap-4" onClick={cancelRest}>
          <p className="text-xs text-gray-400 uppercase tracking-widest">Descansando</p>
          <div className="text-8xl font-bold tabular-nums text-bhr-green">{String(restRemaining).padStart(2, '0')}</div>
          <div className="w-48 h-2 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-bhr-green transition-all" style={{ width: `${restPct}%` }} />
          </div>
          <p className="text-xs text-gray-500 mt-2">Toque para cancelar</p>
        </div>
      )}

      {/* Phase banner */}
      <div className="bg-surface rounded-xl px-3 py-2 mb-3 flex items-center justify-between">
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">
            {activePhase.label} · {activePhase.focus}
          </p>
          <p className="text-[10px] text-gray-600 mt-0.5">{activePhase.description}</p>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[10px] text-gray-500">
            Ciclo {Math.floor(state.completedCount / 35) + 1}
          </span>
          {deload
            ? <span className="text-[10px] text-yellow-400 font-bold">⚡ DELOAD</span>
            : <span className="text-[10px] text-gray-600">deload em {sessionsUntilDeload(state.completedCount)} sess.</span>
          }
        </div>
      </div>

      <div className="flex gap-2 mb-3">
        {(['6d', '5d'] as const).map(s => (
          <button
            key={s}
            onClick={() => setState(prev => ({ ...prev, split: s, cursor: prev.cursor % SPLITS[s].length }))}
            className={`px-3 py-1 rounded-lg text-xs font-bold border transition-colors ${
              state.split === s ? 'bg-bhr-green text-black border-bhr-green' : 'text-gray-400 border-white/20'
            }`}
          >
            {s.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2 mb-3">
        {SPLITS[state.split].map((_, i) => {
          const idx = (state.cursor + i) % SPLITS[state.split].length
          const d = SPLITS[state.split][idx]
          return (
            <div
              key={i}
              className={`flex-shrink-0 flex flex-col items-center px-3 py-2 rounded-xl border text-center min-w-[64px] ${
                i === 0 ? 'border-bhr-green bg-bhr-green/10' : 'border-white/10 bg-surface'
              }`}
            >
              <span className="text-[9px] font-bold text-gray-400">{i === 0 ? 'AGORA' : `+${i}`}</span>
              <span className="text-[10px] font-semibold text-white mt-0.5">{d.focus}</span>
            </div>
          )
        })}
      </div>

      {deload && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-3 py-2 text-xs text-yellow-400 mb-3">
          DELOAD · sessão {sessionInCycle(state.completedCount)}/{CYCLE_LENGTH} · Reduza cargas 40% · Séries ajustadas
        </div>
      )}

      {state.restDayToday === todayKey() && !workout.rest ? (
        <div className="bg-surface rounded-2xl p-4 text-center mb-3">
          <p className="font-bold text-lg">OFF FLEX</p>
          <p className="text-gray-400 text-sm mt-1">Você descansou hoje. Treino de amanhã: <strong>{workout.title}</strong></p>
        </div>
      ) : workout.rest ? (
        <div className="bg-surface rounded-2xl p-4 mb-3">
          <p className="font-bold text-xl text-center">DESCANSO</p>
          <p className="text-gray-400 text-sm text-center mt-2">{workout.note}</p>
          <button onClick={advanceSession} className="w-full mt-4 py-3 rounded-xl bg-bhr-green text-black font-bold text-sm">
            CONCLUIR DESCANSO →
          </button>
        </div>
      ) : (
        <>
          <div className="bg-surface rounded-2xl p-4 mb-3">
            <p className="font-bold text-base">{workout.title}</p>
            <p className="text-xs text-gray-500 mt-0.5 mb-3">⏱ {workout.duration} · {workout.volume}</p>

            <div className="flex items-center gap-3 bg-white/5 rounded-xl px-3 py-2 mb-3">
              <div>
                <p className="text-[9px] text-gray-500 uppercase">Cronômetro</p>
                <p className={`font-bold tabular-nums text-lg ${chronoRunning ? 'text-bhr-green' : 'text-white'}`}>
                  {fmtChrono(chronoSec)}
                </p>
              </div>
              <div className="flex gap-2 ml-auto">
                <button onClick={toggleChrono} className="text-xs px-3 py-1.5 rounded-lg border border-white/20 font-medium">
                  {chronoRunning ? 'PAUSAR' : chronoSec > 0 ? 'CONT.' : 'INICIAR'}
                </button>
                <button onClick={resetChrono} className="text-xs px-2 py-1.5 rounded-lg border border-white/20">✕</button>
              </div>
            </div>

            {adaptLevel !== 'none' && (
              <div className="mb-2 px-1 text-[10px] text-bhr-yellow">
                ⚡ Treino adaptado pelo Coach ({adaptLevel === 'moderate' ? '−25% volume' : '−50% volume'})
              </div>
            )}

            <div className="flex flex-col gap-2">
              {workout.exercises.map((ex, i) => {
                const key = `${dayData.key}-${i}`
                const done = !!state.exercises[key]
                const adjustedSets = applyAdaptation(applyDeload(ex.sets, deload), adaptLevel)
                const restSec = parseDescanso(ex.detail)
                const isRestRunning = activeRest === key
                return (
                  <div
                    key={key}
                    onClick={() => toggleExercise(key)}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 cursor-pointer transition-all ${
                      done ? 'bg-bhr-green/10 opacity-60' : 'bg-white/5'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                      done ? 'border-bhr-green bg-bhr-green' : 'border-white/30'
                    }`}>
                      {done && <span className="text-black text-xs font-bold">✓</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold leading-tight">{ex.name}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5 leading-tight">{ex.detail}</p>
                      <a
                        href={`https://www.youtube.com/results?search_query=${encodeURIComponent(ex.name + ' execução')}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="text-[10px] text-red-400 mt-0.5 inline-block"
                      >
                        ▶ YouTube
                      </a>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className="text-xs font-bold text-white">{adjustedSets}</span>
                      <button
                        onClick={e => { e.stopPropagation(); initAudio(); isRestRunning ? cancelRest() : startRest(key, restSec) }}
                        className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                          isRestRunning ? 'border-bhr-green text-bhr-green' : 'border-white/20 text-gray-400'
                        }`}
                      >
                        ⏱
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {(() => {
            const doneCount = workout.exercises.filter((_, i) => state.exercises[`${dayData.key}-${i}`]).length
            const allDone = doneCount === workout.exercises.length
            return (
              <div className="flex flex-col gap-2">
                <button
                  onClick={advanceSession}
                  disabled={doneCount === 0}
                  className={`w-full py-3 rounded-xl font-bold text-sm transition-colors ${
                    allDone ? 'bg-bhr-green text-black' : doneCount > 0 ? 'bg-white/10 text-white' : 'bg-white/5 text-gray-600'
                  }`}
                >
                  {allDone ? '✓ FINALIZAR TREINO' : `FINALIZAR (${doneCount}/${workout.exercises.length})`}
                </button>
                {state.skipNextRest
                  ? <div className="text-center text-xs text-yellow-400">OFF FLEX ATIVO · próximo descanso removido</div>
                  : <button onClick={restToday} className="w-full py-2 rounded-xl border border-white/20 text-gray-400 text-xs">DESCANSAR HOJE</button>
                }
              </div>
            )
          })()}
        </>
      )}

      <button onClick={undoSession} className="w-full mt-3 py-2 text-xs text-gray-600 border border-white/5 rounded-xl">
        ↩ Desfazer última sessão
      </button>
    </div>
  )
}

function DietaTab({
  state,
  setState,
}: {
  state: TreinoState
  setState: (u: (p: TreinoState) => TreinoState) => void
}) {
  const activeMeals = MEALS.filter(m => !(state.fastToday && m.skipOnFast))

  const jejumCount = (() => {
    const today = new Date()
    const weekStart = new Date(today)
    weekStart.setDate(today.getDate() - today.getDay())
    weekStart.setHours(0, 0, 0, 0)
    let n = Object.entries(state.fastDays).filter(([d, v]) => v && new Date(d) >= weekStart).length
    if (state.fastToday) n++
    return n
  })()

  const totals = activeMeals.reduce(
    (acc, m) => {
      const opt = m.options[state.mealChoice[m.id] ?? 0] ?? m.options[0]
      return { kcal: acc.kcal + opt.macros.kcal, p: acc.p + opt.macros.p, c: acc.c + opt.macros.c, g: acc.g + opt.macros.g }
    },
    { kcal: 0, p: 0, c: 0, g: 0 }
  )

  return (
    <div className="px-4 py-3">
      <div className="bg-surface rounded-2xl p-3 mb-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-gray-400 uppercase font-semibold">Modo hoje</span>
          <span className="text-xs text-gray-500">Jejum {jejumCount}/2 esta semana</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setState(prev => ({ ...prev, fastToday: false }))}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors ${
              !state.fastToday ? 'bg-bhr-green text-black' : 'bg-white/5 text-gray-400'
            }`}
          >
            NORMAL
          </button>
          <button
            onClick={() => setState(prev => ({ ...prev, fastToday: true, meals: { ...prev.meals, cafe: false, lanche1: false } }))}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors ${
              state.fastToday ? 'bg-yellow-500 text-black' : 'bg-white/5 text-gray-400'
            }`}
          >
            JEJUM 16H
          </button>
        </div>
        {state.fastToday && (
          <p className="text-[10px] text-yellow-400 mt-2">🕐 Primeira refeição 13h · última 22h</p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {activeMeals.map(m => {
          const chosenIdx = state.mealChoice[m.id] ?? 0
          const opt = m.options[chosenIdx] ?? m.options[0]
          const done = !!state.meals[m.id]
          return (
            <div
              key={m.id}
              onClick={() => setState(prev => ({ ...prev, meals: { ...prev.meals, [m.id]: !prev.meals[m.id] } }))}
              className={`bg-surface rounded-2xl p-4 cursor-pointer transition-all ${done ? 'opacity-60 ring-1 ring-bhr-green/40' : ''}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="font-semibold text-sm">{m.name}</span>
                  {m.optional && <span className="ml-1 text-[9px] text-gray-500 border border-gray-700 rounded px-1">opcional</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">{m.time}</span>
                  {done && <span className="text-bhr-green text-sm">✓</span>}
                </div>
              </div>

              {m.options.length > 1 && (
                <div className="flex gap-1.5 mb-2 flex-wrap" onClick={e => e.stopPropagation()}>
                  {m.options.map((o, i) => (
                    <button
                      key={i}
                      onClick={() => setState(prev => ({ ...prev, mealChoice: { ...prev.mealChoice, [m.id]: i } }))}
                      className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                        i === chosenIdx ? 'border-bhr-green text-bhr-green' : 'border-white/20 text-gray-500'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              )}

              <ul className="text-xs text-gray-400 space-y-0.5 mb-2">
                {opt.items.map((item, i) => <li key={i}>· {item}</li>)}
              </ul>
              <div className="flex gap-3 text-[10px] text-gray-500 border-t border-white/5 pt-2">
                <span className="font-bold text-white">{opt.macros.kcal}kcal</span>
                <span>P {opt.macros.p}g</span>
                <span>C {opt.macros.c}g</span>
                <span>G {opt.macros.g}g</span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="bg-surface rounded-2xl p-4 mt-3">
        <p className="text-xs text-gray-400 uppercase font-semibold mb-2">Total do dia</p>
        <div className="grid grid-cols-4 text-center">
          <div><p className="text-lg font-bold text-bhr-green">{totals.kcal}</p><p className="text-[10px] text-gray-500">kcal</p></div>
          <div><p className="text-lg font-bold">{totals.p}</p><p className="text-[10px] text-gray-500">prot</p></div>
          <div><p className="text-lg font-bold">{totals.c}</p><p className="text-[10px] text-gray-500">carb</p></div>
          <div><p className="text-lg font-bold">{totals.g}</p><p className="text-[10px] text-gray-500">gord</p></div>
        </div>
      </div>
    </div>
  )
}

// ── Readiness ────────────────────────────────────────────────────────────────

function computeReadinessScore(r: { sleep: number; energy: number; soreness: number; mood: number }): number {
  const s = r.sleep * 1.5 + r.energy * 1.5 + (6 - r.soreness) * 1.0 + r.mood * 1.0
  return Math.round((s - 5) * 5)
}

function readinessInfo(score: number) {
  if (score >= 80) return { level: 'ALTA', colorClass: 'text-bhr-green', advice: 'Corpo pronto. Treine forte — pode tentar PR hoje.' }
  if (score >= 60) return { level: 'BOA', colorClass: 'text-[#9BD200]', advice: 'Treino normal conforme plano.' }
  if (score >= 40) return { level: 'MÉDIA', colorClass: 'text-bhr-yellow', advice: 'Reduza carga 10–15%. Mantenha séries.' }
  return { level: 'BAIXA', colorClass: 'text-bhr-red', advice: 'Treino leve ou off — ouvir o corpo não é fraqueza.' }
}

const RD_SLIDERS = [
  { key: 'sleep'    as const, label: 'Sono',          hint: 'Horas · profundidade', low: 'Péssimo', high: 'Ótimo'     },
  { key: 'energy'   as const, label: 'Energia',        hint: 'Disposição geral',     low: 'Esgotado', high: 'De pilha' },
  { key: 'soreness' as const, label: 'Dor muscular',   hint: 'DOMS do treino anterior', low: 'Sem dor', high: 'Muita dor' },
  { key: 'mood'     as const, label: 'Humor',          hint: 'Vontade de treinar',   low: 'Péssimo', high: 'Ótimo'     },
]

function ReadinessTab({
  state,
  setState,
}: {
  state: TreinoState
  setState: (u: (p: TreinoState) => TreinoState) => void
}) {
  const DEFAULT_RD = { sleep: 3, energy: 3, soreness: 3, mood: 3, score: 50 }
  const rd = state.readiness[todayKey()] ?? DEFAULT_RD
  const hasData = !!state.readiness[todayKey()]
  const info = hasData ? readinessInfo(rd.score) : null

  function updateSlider(key: keyof Omit<ReadinessDay, 'score'>, val: number) {
    setState(prev => {
      const current = prev.readiness[todayKey()] ?? { ...DEFAULT_RD }
      const updated = { ...current, [key]: val }
      updated.score = computeReadinessScore(updated)
      return { ...prev, readiness: { ...prev.readiness, [todayKey()]: updated } }
    })
  }

  return (
    <div className="px-4 py-3">
      {/* Score hero */}
      <div className="bg-surface rounded-2xl p-5 mb-3 text-center">
        <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Prontidão Hoje</p>
        <p className={`text-8xl font-bold tabular-nums leading-none ${info ? info.colorClass : 'text-gray-600'}`}>
          {hasData ? rd.score : '—'}
        </p>
        {info ? (
          <>
            <p className={`text-sm font-bold mt-2 ${info.colorClass}`}>{info.level}</p>
            <p className="text-xs text-gray-400 mt-1 leading-relaxed">{info.advice}</p>
          </>
        ) : (
          <p className="text-xs text-gray-500 mt-2">Preencha os sliders abaixo</p>
        )}
      </div>

      {/* Sliders */}
      <div className="flex flex-col gap-2 mb-3">
        {RD_SLIDERS.map(({ key, label, hint, low, high }) => (
          <div key={key} className="bg-surface rounded-2xl px-4 py-3">
            <div className="flex justify-between items-baseline mb-2">
              <div>
                <p className="text-sm font-semibold">{label}</p>
                <p className="text-[10px] text-gray-500">{hint}</p>
              </div>
              <span className="text-2xl font-bold text-bhr-green tabular-nums">{rd[key]}</span>
            </div>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={rd[key]}
              onChange={e => updateSlider(key, +e.target.value)}
              className="w-full"
            />
            <div className="flex justify-between text-[9px] text-gray-600 mt-1">
              <span>1 · {low}</span>
              <span>5 · {high}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Guide */}
      <div className="bg-surface rounded-2xl p-4">
        <p className="text-[10px] text-gray-400 uppercase font-semibold mb-3">Guia</p>
        <div className="flex flex-col gap-2">
          {[
            { range: '80+',   cls: 'text-bhr-green',  text: 'Corpo pronto — tente progressão de carga ou PR' },
            { range: '60–79', cls: 'text-[#9BD200]',    text: 'Treino normal conforme o plano' },
            { range: '40–59', cls: 'text-bhr-yellow', text: 'Reduza carga 10–15%, mantenha séries' },
            { range: '<40',   cls: 'text-bhr-red',    text: 'Treino leve ou off — ouvir o corpo é maturidade' },
          ].map(({ range, cls, text }) => (
            <div key={range} className="flex items-start gap-3 text-xs">
              <span className={`font-bold w-12 flex-shrink-0 ${cls}`}>{range}</span>
              <span className="text-gray-400">{text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Timer ─────────────────────────────────────────────────────────────────────

const TIMER_PRESETS = [
  { label: '45s',  secs: 45  },
  { label: '1min', secs: 60  },
  { label: '90s',  secs: 90  },
  { label: '2min', secs: 120 },
  { label: '3min', secs: 180 },
]

function TimerTab() {
  const [total,     setTotal]     = useState(60)
  const [remaining, setRemaining] = useState(60)
  const [running,   setRunning]   = useState(false)
  const [done,      setDone]      = useState(false)
  const endRef      = useRef(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)

  function initAudio() {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      try { audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)() } catch { /* áudio não suportado */ }
    }
    audioCtxRef.current?.resume().catch(() => {})
  }

  function beep(ctx: AudioContext) {
    ctx.resume().then(() => {
      const tones = [
        { freq: 880,  dur: 0.18, gain: 0.55, delay: 0.0  },
        { freq: 1100, dur: 0.18, gain: 0.65, delay: 0.22 },
        { freq: 1320, dur: 0.32, gain: 0.72, delay: 0.44 },
        { freq: 1760, dur: 0.45, gain: 0.78, delay: 0.80 },
      ]
      tones.forEach(t => {
        try {
          const osc = ctx.createOscillator()
          const g   = ctx.createGain()
          osc.connect(g); g.connect(ctx.destination)
          osc.type = 'sine'; osc.frequency.value = t.freq
          const t0 = ctx.currentTime + t.delay
          g.gain.setValueAtTime(0.001, t0)
          g.gain.exponentialRampToValueAtTime(t.gain, t0 + 0.02)
          g.gain.setValueAtTime(t.gain, t0 + t.dur - 0.05)
          g.gain.exponentialRampToValueAtTime(0.001, t0 + t.dur)
          osc.start(t0); osc.stop(t0 + t.dur + 0.05)
        } catch { /* ignora falha isolada ao criar um tom */ }
      })
    }).catch(() => {})
  }

  function sendNotification() {
    if (!('Notification' in window)) return
    if (Notification.permission === 'granted') {
      new Notification('Timer concluído!', { body: 'Hora de voltar para o treino 💪', icon: '/whoop/icons/icon.svg', silent: false })
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(p => {
        if (p === 'granted') new Notification('Timer concluído!', { body: 'Hora de voltar para o treino 💪', icon: '/whoop/icons/icon.svg' })
      })
    }
  }

  function start(secs = remaining) {
    initAudio()
    if (intervalRef.current) clearInterval(intervalRef.current)
    setDone(false)
    endRef.current = Date.now() + secs * 1000
    setRunning(true)
    intervalRef.current = setInterval(() => {
      const rem = Math.max(0, Math.ceil((endRef.current - Date.now()) / 1000))
      setRemaining(rem)
      if (rem <= 0) {
        clearInterval(intervalRef.current!)
        intervalRef.current = null
        setRunning(false)
        setDone(true)
        if (audioCtxRef.current) beep(audioCtxRef.current)
        if ('vibrate' in navigator) navigator.vibrate([400, 100, 400, 100, 600])
        sendNotification()
      }
    }, 250)
  }

  function pause() {
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = null
    setRunning(false)
  }

  function reset(secs?: number) {
    pause()
    setDone(false)
    const t = secs ?? total
    setTotal(t)
    setRemaining(t)
  }

  function loadPreset(secs: number) {
    reset(secs)
    setTimeout(() => start(secs), 50)
  }

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current) }, [])

  const pct      = total > 0 ? (remaining / total) * 100 : 0
  const mins     = Math.floor(remaining / 60)
  const secsDisp = remaining % 60
  const display  = `${String(mins).padStart(2, '0')}:${String(secsDisp).padStart(2, '0')}`

  return (
    <div className="px-4 py-3">
      {done && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center gap-4 animate-pulse-slow"
          onClick={() => setDone(false)}
        >
          <p className="text-7xl">💪</p>
          <p className="text-4xl font-bold text-bhr-green">TEMPO!</p>
          <p className="text-sm text-gray-400">Hora de treinar</p>
          <p className="text-xs text-gray-600 mt-4">Toque para fechar</p>
        </div>
      )}

      <div className="bg-surface rounded-2xl p-6 mb-3 flex flex-col items-center gap-3">
        <p className="text-[10px] text-gray-500 uppercase tracking-widest">Descanso</p>
        <p className={`text-8xl font-bold tabular-nums leading-none transition-colors ${running ? 'text-bhr-green' : remaining === 0 ? 'text-bhr-green' : 'text-white'}`}>
          {display}
        </p>
        <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div className="h-full bg-bhr-green transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex gap-3 mt-1">
          {running ? (
            <button onClick={pause} className="px-6 py-2.5 rounded-xl border border-white/20 text-sm font-bold">PAUSAR</button>
          ) : (
            <button
              onClick={() => { if (remaining > 0) { initAudio(); start() } }}
              disabled={remaining === 0}
              className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-colors ${remaining > 0 ? 'bg-bhr-green text-black' : 'bg-white/5 text-gray-600'}`}
            >
              {remaining === total ? 'INICIAR' : 'CONTINUAR'}
            </button>
          )}
          <button onClick={() => reset()} className="px-4 py-2.5 rounded-xl border border-white/20 text-sm font-bold text-gray-400">✕</button>
        </div>
      </div>

      <div className="bg-surface rounded-2xl p-4 mb-3">
        <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-3">Presets de descanso</p>
        <div className="grid grid-cols-5 gap-2">
          {TIMER_PRESETS.map(p => (
            <button
              key={p.secs}
              onClick={() => { initAudio(); loadPreset(p.secs) }}
              className={`py-2.5 rounded-xl text-xs font-bold border transition-colors ${
                total === p.secs ? 'bg-bhr-green text-black border-bhr-green' : 'border-white/20 text-gray-300'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-surface rounded-2xl p-4">
        <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-3">Tempo personalizado</p>
        <div className="grid grid-cols-3 gap-2">
          {[30, 45, 60, 90, 120, 180, 240, 300, 360].map(s => (
            <button key={s} onClick={() => { initAudio(); loadPreset(s) }} className="py-2 rounded-xl border border-white/10 text-xs text-gray-400">
              {s < 60 ? `${s}s` : `${s / 60}min`}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function StatsTab({
  state,
  setState,
}: {
  state: TreinoState
  setState: (u: (p: TreinoState) => TreinoState) => void
}) {
  const pos      = sessionInCycle(state.completedCount)
  const deload   = isDeload(state.completedCount)
  const untilDl  = sessionsUntilDeload(state.completedCount)
  const cycleNum = Math.floor(state.completedCount / CYCLE_LENGTH) + 1
  const pct      = ((pos - 1) / CYCLE_LENGTH) * 100
  const split    = SPLITS[state.split]
  const dayData  = split[state.cursor]

  const readinessHistory = Object.entries(state.readiness)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 7)

  function rdColor(score: number) {
    if (score >= 80) return 'text-bhr-green'
    if (score >= 60) return 'text-[#9BD200]'
    if (score >= 40) return 'text-bhr-yellow'
    return 'text-bhr-red'
  }

  return (
    <div className="px-4 py-3 flex flex-col gap-3">
      {/* Ciclo */}
      <div className="bg-surface rounded-2xl p-4">
        <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-3">Ciclo de {CYCLE_LENGTH} sessões</p>
        <div className="flex justify-between items-baseline mb-2">
          <span className="text-2xl font-bold">Ciclo {cycleNum}</span>
          <span className="text-sm text-gray-400">sessão <span className="text-white font-bold">{pos}</span>/{CYCLE_LENGTH}</span>
        </div>
        <div className="h-2 bg-white/10 rounded-full overflow-hidden mb-2">
          <div className={`h-full rounded-full transition-all ${deload ? 'bg-bhr-yellow' : 'bg-bhr-green'}`} style={{ width: `${pct}%` }} />
        </div>
        <div className="flex justify-between text-[10px] text-gray-500">
          <span>Total: <span className="text-white font-bold">{state.completedCount}</span> sessões</span>
          {deload
            ? <span className="text-bhr-yellow font-bold">⚡ SEMANA DELOAD</span>
            : <span>deload em <span className="text-white font-bold">{untilDl}</span> sessões</span>
          }
        </div>
      </div>

      {/* Próximos dias */}
      <div className="bg-surface rounded-2xl p-4">
        <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-3">Próximos dias</p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {Array.from({ length: 7 }, (_, i) => {
            const idx = (state.cursor + i) % split.length
            const d   = split[idx]
            return (
              <div key={i} className={`flex-shrink-0 flex flex-col items-center px-3 py-2 rounded-xl border text-center min-w-[60px] ${i === 0 ? 'border-bhr-green bg-bhr-green/10' : 'border-white/10'}`}>
                <span className="text-[9px] font-bold text-gray-500">{i === 0 ? 'HOJE' : `+${i}`}</span>
                <span className="text-[10px] font-semibold text-white mt-0.5">{d.focus}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Split */}
      <div className="bg-surface rounded-2xl p-4">
        <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-3">Divisão</p>
        <div className="flex gap-2 mb-2">
          {(['6d', '5d'] as const).map(s => (
            <button
              key={s}
              onClick={() => setState(prev => ({ ...prev, split: s, cursor: prev.cursor % SPLITS[s].length }))}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold border transition-colors ${state.split === s ? 'bg-bhr-green text-black border-bhr-green' : 'text-gray-400 border-white/20'}`}
            >
              {s.toUpperCase()}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-400">Hoje: <span className="text-white font-semibold">{dayData.focus}</span></p>
        <button
          onClick={() => { if (confirm('Desfazer a última sessão?')) setState(prev => ({ ...prev, cursor: (prev.cursor - 1 + SPLITS[prev.split].length) % SPLITS[prev.split].length, completedCount: Math.max(0, prev.completedCount - 1) })) }}
          className="mt-3 w-full py-2 text-xs text-gray-600 border border-white/5 rounded-xl"
        >
          ↩ Desfazer última sessão
        </button>
      </div>

      {/* Histórico readiness */}
      {readinessHistory.length > 0 && (
        <div className="bg-surface rounded-2xl p-4">
          <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-3">Prontidão — últimos 7 dias</p>
          <div className="flex flex-col gap-2">
            {readinessHistory.map(([date, rd]) => (
              <div key={date} className="flex items-center justify-between">
                <span className="text-xs text-gray-500">{date}</span>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-gray-600">sono {rd.sleep} · energia {rd.energy} · dor {rd.soreness} · humor {rd.mood}</span>
                  <span className={`text-sm font-bold tabular-nums ${rdColor(rd.score)}`}>{rd.score}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
