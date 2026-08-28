import { useState } from 'react'
import { useWhoopData } from '../hooks/useWhoopData'
import LoadingScreen from '../components/LoadingScreen'
import { recoveryColor, strainColor, formatShortDate, millisToHours } from '../utils/whoop'
import { supabase } from '../lib/supabase'
import type { BloodWork, JournalEntry } from '../types'
import {
  LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip,
  ScatterChart, Scatter, CartesianGrid, ReferenceLine,
} from 'recharts'

// ─── Journal tags ─────────────────────────────────────────────────────────────
const JOURNAL_TAGS = [
  { id: 'alcool', label: 'Álcool', emoji: '🍺' },
  { id: 'cafeina', label: 'Cafeína', emoji: '☕' },
  { id: 'melatonina', label: 'Melatonina', emoji: '💊' },
  { id: 'suplementos', label: 'Suplementos', emoji: '💪' },
  { id: 'medicacao', label: 'Medicação', emoji: '🩺' },
  { id: 'meditacao', label: 'Meditação', emoji: '🧘' },
  { id: 'alongamento', label: 'Alongamento', emoji: '🤸' },
  { id: 'massagem', label: 'Massagem', emoji: '💆' },
  { id: 'viagem', label: 'Viagem', emoji: '✈️' },
  { id: 'estresse', label: 'Estresse alto', emoji: '😰' },
  { id: 'doenca', label: 'Doença/dor', emoji: '🤒' },
  { id: 'cama-cedo', label: 'Cama cedo', emoji: '🌙' },
  { id: 'cama-tarde', label: 'Cama tarde', emoji: '🌙' },
  { id: 'soneca', label: 'Soneca', emoji: '😴' },
  { id: 'menstruacao', label: 'Menstruação', emoji: '🔴' },
]

// ─── Blood work marker presets ────────────────────────────────────────────────
const MARKER_PRESETS = [
  { label: 'Glicose', unit: 'mg/dL', refMin: 70, refMax: 99 },
  { label: 'Hemoglobina', unit: 'g/dL', refMin: 12, refMax: 17.5 },
  { label: 'Ferritina', unit: 'ng/mL', refMin: 12, refMax: 300 },
  { label: 'Vitamina D', unit: 'ng/mL', refMin: 30, refMax: 100 },
  { label: 'Vitamina B12', unit: 'pg/mL', refMin: 200, refMax: 900 },
  { label: 'TSH', unit: 'mUI/L', refMin: 0.4, refMax: 4.0 },
  { label: 'Testosterona', unit: 'ng/dL', refMin: 300, refMax: 1000 },
  { label: 'Cortisol', unit: 'µg/dL', refMin: 6, refMax: 23 },
  { label: 'Colesterol Total', unit: 'mg/dL', refMin: 0, refMax: 200 },
  { label: 'HDL', unit: 'mg/dL', refMin: 40, refMax: 999 },
  { label: 'LDL', unit: 'mg/dL', refMin: 0, refMax: 130 },
  { label: 'Triglicerídeos', unit: 'mg/dL', refMin: 0, refMax: 150 },
  { label: 'Creatinina', unit: 'mg/dL', refMin: 0.7, refMax: 1.3 },
  { label: 'PCR', unit: 'mg/L', refMin: 0, refMax: 5 },
  { label: 'Insulina', unit: 'µUI/mL', refMin: 2, refMax: 25 },
]

function bwStatusColor(bw: BloodWork) {
  if (bw.ref_min == null && bw.ref_max == null) return '#888'
  const v = bw.value
  const lo = bw.ref_min ?? -Infinity
  const hi = bw.ref_max ?? Infinity
  if (v < lo || v > hi) return '#FF4444'
  const pct = (v - lo) / (hi - lo)
  if (pct < 0.1 || pct > 0.9) return '#F5C518'
  return '#00D4A0'
}

function bwStatusLabel(bw: BloodWork) {
  if (bw.ref_min == null && bw.ref_max == null) return ''
  if (bw.ref_max != null && bw.value > bw.ref_max) return 'Alto'
  if (bw.ref_min != null && bw.value < bw.ref_min) return 'Baixo'
  return 'Normal'
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function Health() {
  const { recentCycles, recentRecoveries, recentSleeps, bloodWork, journal, loading, refresh } = useWhoopData()
  const [tab, setTab] = useState<'tendencias' | 'diario' | 'exames'>('tendencias')

  if (loading) return <LoadingScreen />

  return (
    <div className="pb-8">
      <div className="px-5 pt-14 pb-3 safe-top">
        <h1 className="text-2xl font-bold">Saúde</h1>
      </div>

      {/* 3-tab bar */}
      <div className="flex mx-4 bg-surface rounded-xl p-1 mb-4 gap-1">
        {([['tendencias', 'Tendências'], ['diario', 'Diário'], ['exames', 'Exames']] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${
              tab === id ? 'bg-white/10 text-white' : 'text-gray-500'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'tendencias' && (
        <TrendsTab cycles={recentCycles} recoveries={recentRecoveries} sleeps={recentSleeps} />
      )}
      {tab === 'diario' && (
        <JournalTab entries={journal} onSaved={refresh} />
      )}
      {tab === 'exames' && (
        <BloodTab entries={bloodWork} onAdded={refresh} />
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

// ─── Trends tab ───────────────────────────────────────────────────────────────
function TrendsTab({ cycles, recoveries, sleeps }: {
  cycles: ReturnType<typeof useWhoopData>['recentCycles']
  recoveries: ReturnType<typeof useWhoopData>['recentRecoveries']
  sleeps: ReturnType<typeof useWhoopData>['recentSleeps']
}) {
  const daily = cycles.slice(0, 30).reverse().map(c => {
    const rec = recoveries.find(r => r.cycle_id === c.fitbit_activity_id)
    return {
      date: formatShortDate(c.start_time),
      recovery: rec?.recovery_score ?? null,
      strain: c.strain ?? null,
      hrv: rec?.hrv_rmssd_milli ? Math.round(rec.hrv_rmssd_milli) : null,
      rhr: rec?.resting_heart_rate ? Math.round(rec.resting_heart_rate) : null,
    }
  })

  const scatterData = daily
    .filter(d => d.strain != null && d.recovery != null)
    .map(d => ({ x: d.strain!, y: d.recovery!, date: d.date, color: recoveryColor(d.recovery) }))

  const sleepByWakeDate = new Map(sleeps.map(s => [localDateKey(s.end_time), s]))
  const sleepData = Array.from({ length: 14 }, (_, index) => {
    const day = new Date()
    day.setHours(12, 0, 0, 0)
    day.setDate(day.getDate() - (13 - index))
    const sleep = sleepByWakeDate.get(localDateKey(day.toISOString()))

    return {
      date: formatShortDate(day.toISOString()),
      horas: sleep
        ? Math.round(millisToHours((sleep.total_in_bed_time_milli ?? 0) - (sleep.total_awake_time_milli ?? 0)) * 10) / 10
        : null,
      perf: sleep?.sleep_performance_percentage ?? null,
    }
  })

  const tooltipStyle = { background: '#1a1a1a', border: '1px solid #ffffff15', borderRadius: 8, fontSize: 11 }

  return (
    <div className="flex flex-col gap-3 px-4">
      {/* Scatter */}
      <ChartCard title="Esforço × Recuperação" subtitle="Cada ponto = 1 dia · últimos 30 dias">
        <ResponsiveContainer width="100%" height={180}>
          <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
            <XAxis type="number" dataKey="x" domain={[0, 21]} ticks={[0, 7, 14, 21]}
              tick={{ fill: '#555', fontSize: 9 }} axisLine={false} tickLine={false}
              label={{ value: 'Esforço', position: 'insideBottom', offset: -4, fill: '#555', fontSize: 9 }} />
            <YAxis type="number" dataKey="y" domain={[0, 100]} ticks={[0, 33, 67, 100]}
              tick={{ fill: '#555', fontSize: 9 }} axisLine={false} tickLine={false} />
            <ReferenceLine y={67} stroke="#00D4A015" strokeDasharray="4 4" />
            <ReferenceLine y={33} stroke="#F5C51815" strokeDasharray="4 4" />
            <Tooltip cursor={false} content={({ payload }) => {
              if (!payload?.length) return null
              const d = payload[0].payload
              return (
                <div className="bg-surface-2 border border-white/10 rounded-lg px-2 py-1 text-xs">
                  <p className="text-gray-400">{d.date}</p>
                  <p>Esforço <b style={{ color: strainColor(d.x) }}>{d.x?.toFixed(1)}</b></p>
                  <p>Recuperação <b style={{ color: recoveryColor(d.y) }}>{Math.round(d.y)}%</b></p>
                </div>
              )
            }} />
            <Scatter data={scatterData} shape={(props: unknown) => {
              const { cx, cy, payload } = props as { cx: number; cy: number; payload: { color: string } }
              return <circle cx={cx} cy={cy} r={5} fill={payload.color} fillOpacity={0.85} />
            }} />
          </ScatterChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Dual line */}
      <ChartCard title="Recuperação vs Esforço" subtitle="Últimos 30 dias">
        <ResponsiveContainer width="100%" height={110}>
          <LineChart data={daily} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
            <XAxis dataKey="date" tick={{ fill: '#555', fontSize: 8 }} axisLine={false} tickLine={false} interval={4} />
            <YAxis yAxisId="rec" domain={[0, 100]} hide />
            <YAxis yAxisId="str" domain={[0, 21]} orientation="right" hide />
            <Tooltip contentStyle={tooltipStyle} content={({ payload, label }) => {
              if (!payload?.length) return null
              return (
                <div className="bg-surface-2 border border-white/10 rounded-lg px-2 py-1 text-xs">
                  <p className="text-gray-400 mb-1">{label}</p>
                  {payload.map(p => <p key={p.name} style={{ color: p.color as string }}>{p.name}: <b>{p.value ?? '--'}</b></p>)}
                </div>
              )
            }} />
            <Line yAxisId="rec" type="monotone" dataKey="recovery" name="Recuperação %" stroke="#00D4A0" dot={false} strokeWidth={2} connectNulls />
            <Line yAxisId="str" type="monotone" dataKey="strain" name="Esforço /21" stroke="#FF8C00" dot={false} strokeWidth={2} connectNulls />
          </LineChart>
        </ResponsiveContainer>
        <div className="flex gap-4 mt-1 px-1">
          <Legend color="#00D4A0" label="Recuperação %" />
          <Legend color="#FF8C00" label="Esforço /21" />
        </div>
      </ChartCard>

      {daily.some(d => d.hrv != null) && (
        <ChartCard title="VFC (HRV)" subtitle="Variabilidade da frequência cardíaca · ms · 30 dias">
          <ResponsiveContainer width="100%" height={90}>
            <LineChart data={daily} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
              <XAxis dataKey="date" tick={{ fill: '#555', fontSize: 8 }} axisLine={false} tickLine={false} interval={4} />
              <YAxis tick={{ fill: '#555', fontSize: 9 }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v: number) => [`${v} ms`, 'VFC']} contentStyle={tooltipStyle} />
              <Line type="monotone" dataKey="hrv" stroke="#00D4A0" dot={false} strokeWidth={2} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {daily.some(d => d.rhr != null) && (
        <ChartCard title="FC de Repouso" subtitle="Batimentos por minuto · 30 dias">
          <ResponsiveContainer width="100%" height={90}>
            <LineChart data={daily} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
              <XAxis dataKey="date" tick={{ fill: '#555', fontSize: 8 }} axisLine={false} tickLine={false} interval={4} />
              <YAxis tick={{ fill: '#555', fontSize: 9 }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v: number) => [`${v} bpm`, 'FC Repouso']} contentStyle={tooltipStyle} />
              <Line type="monotone" dataKey="rhr" stroke="#4FC3F7" dot={false} strokeWidth={2} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {sleepData.some(d => d.perf != null) && (
        <ChartCard title="Desempenho do Sono" subtitle="% · últimas 2 semanas">
          <ResponsiveContainer width="100%" height={90}>
            <LineChart data={sleepData} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
              <XAxis dataKey="date" tick={{ fill: '#555', fontSize: 8 }} axisLine={false} tickLine={false} interval={2} />
              <YAxis domain={[0, 100]} tick={{ fill: '#555', fontSize: 9 }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v: number) => [`${v}%`, 'Desempenho']} contentStyle={tooltipStyle} />
              <Line type="monotone" dataKey="perf" stroke="#9C59D1" dot={false} strokeWidth={2} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {sleepData.length > 1 && (
        <ChartCard title="Horas de Sono" subtitle="Últimas 2 semanas">
          <ResponsiveContainer width="100%" height={90}>
            <LineChart data={sleepData} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
              <XAxis dataKey="date" tick={{ fill: '#555', fontSize: 8 }} axisLine={false} tickLine={false} interval={2} />
              <YAxis domain={[0, 12]} tick={{ fill: '#555', fontSize: 9 }} axisLine={false} tickLine={false} />
              <ReferenceLine y={8} stroke="#ffffff15" strokeDasharray="4 4" />
              <Tooltip formatter={(v: number) => [`${v}h`, 'Sono']} contentStyle={tooltipStyle} />
              <Line type="monotone" dataKey="horas" stroke="#9C59D1" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      )}
    </div>
  )
}

// ─── Journal tab ──────────────────────────────────────────────────────────────
function JournalTab({ entries, onSaved }: { entries: JournalEntry[]; onSaved: () => void }) {
  const [showForm, setShowForm] = useState(false)
  const todayStr = new Date().toISOString().slice(0, 10)
  const todayEntry = entries.find(e => e.entry_date === todayStr) ?? null

  return (
    <div className="px-4 flex flex-col gap-3">
      {/* Today's entry or add button */}
      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          className={`w-full py-3 rounded-xl font-bold text-sm ${
            todayEntry ? 'bg-white/10 text-gray-300' : 'bg-bhr-green text-black'
          }`}
        >
          {todayEntry ? '✏️ Editar registro de hoje' : '+ Registrar bem-estar de hoje'}
        </button>
      )}

      {showForm && (
        <JournalForm
          existing={todayEntry}
          onSaved={() => { setShowForm(false); onSaved() }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Past entries */}
      {entries.length === 0 && !showForm && (
        <div className="bg-surface rounded-2xl p-6 text-center">
          <p className="text-gray-400 text-sm">Nenhum registro ainda</p>
          <p className="text-gray-500 text-xs mt-1">Registre como você se sente diariamente para entender melhor sua recuperação</p>
        </div>
      )}

      {entries.map(e => <JournalCard key={e.id} entry={e} />)}
    </div>
  )
}

function JournalCard({ entry }: { entry: JournalEntry }) {
  const metrics = [
    { label: 'Sono', value: entry.sleep_quality, color: '#9C59D1' },
    { label: 'Energia', value: entry.energy, color: '#F5C518' },
    { label: 'Humor', value: entry.mood, color: '#00D4A0' },
    { label: 'Estresse', value: entry.stress, color: '#FF4444', invert: true },
  ]
  return (
    <div className="bg-surface rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="font-semibold text-sm">{entry.entry_date}</p>
        <div className="flex gap-1">
          {metrics.filter(m => m.value != null).map(m => (
            <div key={m.label} className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: m.color }} />
              <span className="text-xs text-gray-400">{dotsLabel(m.value!, m.invert)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2 mb-3">
        {metrics.map(m => m.value != null && (
          <div key={m.label} className="text-center">
            <p className="text-[9px] text-gray-500 mb-1">{m.label}</p>
            <StarRow value={m.value} color={m.color} invert={m.invert} />
          </div>
        ))}
      </div>
      {entry.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {entry.tags.map(tag => {
            const t = JOURNAL_TAGS.find(jt => jt.id === tag)
            return t ? (
              <span key={tag} className="text-[10px] bg-white/8 rounded-full px-2 py-0.5 text-gray-400">
                {t.emoji} {t.label}
              </span>
            ) : null
          })}
        </div>
      )}
      {entry.notes && <p className="text-xs text-gray-400 italic">"{entry.notes}"</p>}
    </div>
  )
}

function dotsLabel(value: number, invert?: boolean) {
  const effective = invert ? 6 - value : value
  if (effective >= 5) return 'Ótimo'
  if (effective >= 4) return 'Bom'
  if (effective >= 3) return 'Ok'
  if (effective >= 2) return 'Baixo'
  return 'Ruim'
}

function StarRow({ value, color, invert }: { value: number; color: string; invert?: boolean }) {
  return (
    <div className="flex justify-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => {
        const filled = invert ? i <= (6 - value) : i <= value
        return (
          <div key={i} className="w-2 h-2 rounded-full"
            style={{ backgroundColor: filled ? color : '#2a2a2a' }} />
        )
      })}
    </div>
  )
}

function JournalForm({ existing, onSaved, onCancel }: {
  existing: JournalEntry | null
  onSaved: () => void
  onCancel: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    sleep_quality: existing?.sleep_quality ?? 3,
    energy: existing?.energy ?? 3,
    mood: existing?.mood ?? 3,
    stress: existing?.stress ?? 3,
    tags: existing?.tags ?? [],
    notes: existing?.notes ?? '',
  })

  const toggleTag = (id: string) => {
    setForm(f => ({
      ...f,
      tags: f.tags.includes(id) ? f.tags.filter(t => t !== id) : [...f.tags, id],
    }))
  }

  async function save() {
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const payload = {
      user_id: user!.id,
      entry_date: new Date().toISOString().slice(0, 10),
      sleep_quality: form.sleep_quality,
      energy: form.energy,
      mood: form.mood,
      stress: form.stress,
      tags: form.tags,
      notes: form.notes || null,
    }
    if (existing) {
      await supabase.schema('fitbit').from('journal').update(payload).eq('id', existing.id)
    } else {
      await supabase.schema('fitbit').from('journal').insert(payload)
    }
    setSaving(false)
    onSaved()
  }

  return (
    <div className="bg-surface rounded-2xl p-4 flex flex-col gap-4">
      <p className="font-semibold text-sm">Como você está hoje?</p>

      {([
        { key: 'sleep_quality' as const, label: 'Qualidade do sono', color: '#9C59D1', invert: false },
        { key: 'energy' as const, label: 'Nível de energia', color: '#F5C518', invert: false },
        { key: 'mood' as const, label: 'Humor', color: '#00D4A0', invert: false },
        { key: 'stress' as const, label: 'Estresse', color: '#FF4444', invert: true },
      ]).map(({ key, label, color, invert }) => (
        <div key={key}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-400">{label}</span>
            <span className="text-xs font-semibold" style={{ color }}>
              {dotsLabel(form[key], invert)}
            </span>
          </div>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map(v => (
              <button
                key={v}
                onClick={() => setForm(f => ({ ...f, [key]: v }))}
                className="flex-1 h-8 rounded-lg transition-all"
                style={{
                  backgroundColor: form[key] === v ? color : '#2a2a2a',
                  opacity: form[key] >= v ? 1 : 0.4,
                }}
              />
            ))}
          </div>
        </div>
      ))}

      <div>
        <p className="text-xs text-gray-400 mb-2">O que aconteceu hoje?</p>
        <div className="flex flex-wrap gap-1.5">
          {JOURNAL_TAGS.map(tag => (
            <button
              key={tag.id}
              onClick={() => toggleTag(tag.id)}
              className={`text-xs rounded-full px-2.5 py-1 transition-colors ${
                form.tags.includes(tag.id)
                  ? 'bg-bhr-green/20 text-bhr-green border border-bhr-green/30'
                  : 'bg-white/8 text-gray-400 border border-transparent'
              }`}
            >
              {tag.emoji} {tag.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs text-gray-400 mb-1">Notas livres</p>
        <textarea
          className="w-full bg-surface-2 rounded-xl px-3 py-2.5 text-sm text-white border border-white/10 resize-none"
          rows={2}
          placeholder="Como foi o dia? Algo que queira lembrar..."
          value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
        />
      </div>

      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border border-white/10 text-sm text-gray-400">
          Cancelar
        </button>
        <button onClick={save} disabled={saving}
          className="flex-1 py-2.5 rounded-xl bg-bhr-green text-black font-bold text-sm disabled:opacity-50">
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </div>
  )
}

// ─── Blood work tab ───────────────────────────────────────────────────────────
function BloodTab({ entries, onAdded }: { entries: BloodWork[]; onAdded: () => void }) {
  const [showForm, setShowForm] = useState(false)
  const [selectedMarker, setSelectedMarker] = useState<string | null>(null)

  const byMarker: Record<string, BloodWork[]> = {}
  for (const e of entries) {
    if (!byMarker[e.marker]) byMarker[e.marker] = []
    byMarker[e.marker].push(e)
  }
  const markers = Object.keys(byMarker).sort()
  const tooltipStyle = { background: '#1a1a1a', border: '1px solid #ffffff15', borderRadius: 8, fontSize: 11 }

  return (
    <div className="px-4 flex flex-col gap-3">
      <button onClick={() => setShowForm(true)}
        className="w-full py-3 bg-bhr-green text-black font-bold rounded-xl text-sm">
        + Adicionar Exame
      </button>

      {showForm && (
        <AddBloodWorkForm onSaved={() => { setShowForm(false); onAdded() }} onCancel={() => setShowForm(false)} />
      )}

      {markers.length === 0 && !showForm && (
        <div className="bg-surface rounded-2xl p-6 text-center">
          <p className="text-gray-400 text-sm">Nenhum exame registrado</p>
          <p className="text-gray-500 text-xs mt-1">Adicione seus resultados para acompanhar tendências</p>
        </div>
      )}

      {markers.map(marker => {
        const list = byMarker[marker]
        const latest = list[0]
        const color = bwStatusColor(latest)
        const label = bwStatusLabel(latest)
        return (
          <div key={marker} className="bg-surface rounded-2xl overflow-hidden">
            <button className="w-full flex items-center justify-between p-4"
              onClick={() => setSelectedMarker(selectedMarker === marker ? null : marker)}>
              <div className="text-left">
                <p className="font-semibold">{marker}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Último: <span className="font-bold" style={{ color }}>{latest.value} {latest.unit}</span>
                  {label && <span className="ml-2 text-[10px]" style={{ color }}>● {label}</span>}
                </p>
              </div>
              <span className="text-gray-600 text-sm">{selectedMarker === marker ? '▲' : '▼'}</span>
            </button>

            {selectedMarker === marker && (
              <div className="border-t border-white/5 px-4 pb-4">
                {list.length > 1 && (
                  <div className="mt-3 mb-2">
                    <ResponsiveContainer width="100%" height={80}>
                      <LineChart data={[...list].reverse()} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
                        <XAxis dataKey="test_date" tick={{ fill: '#555', fontSize: 8 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: '#555', fontSize: 9 }} axisLine={false} tickLine={false} />
                        {latest.ref_min != null && <ReferenceLine y={latest.ref_min} stroke="#ffffff15" strokeDasharray="3 3" />}
                        {latest.ref_max != null && <ReferenceLine y={latest.ref_max} stroke="#ffffff15" strokeDasharray="3 3" />}
                        <Tooltip formatter={(v: number) => [`${v} ${latest.unit}`, marker]} contentStyle={tooltipStyle} />
                        <Line type="monotone" dataKey="value" stroke={color} dot={{ fill: color, r: 3 }} strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
                {latest.ref_min != null && latest.ref_max != null && (
                  <RangeBar value={latest.value} min={latest.ref_min} max={latest.ref_max} color={color} />
                )}
                <div className="flex flex-col gap-1 mt-3">
                  {list.map(e => (
                    <div key={e.id} className="flex items-center justify-between text-sm">
                      <span className="text-gray-500 text-xs">{e.test_date}</span>
                      <span className="font-semibold" style={{ color: bwStatusColor(e) }}>
                        {e.value} <span className="text-gray-500 font-normal text-xs">{e.unit}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function RangeBar({ value, min, max, color }: { value: number; min: number; max: number; color: string }) {
  const span = max - min
  const ext = span * 0.4
  const lo = min - ext
  const hi = max + ext
  const total = hi - lo
  const rangePctStart = ((min - lo) / total) * 100
  const rangePctWidth = ((max - min) / total) * 100
  const valuePct = Math.min(Math.max(((value - lo) / total) * 100, 0), 100)
  return (
    <div className="mt-2">
      <div className="relative h-3 bg-surface-3 rounded-full">
        <div className="absolute h-full rounded-full bg-white/10"
          style={{ left: `${rangePctStart}%`, width: `${rangePctWidth}%` }} />
        <div className="absolute top-1/2 w-3 h-3 rounded-full border-2 border-black"
          style={{ left: `${valuePct}%`, backgroundColor: color, transform: 'translate(-50%, -50%)' }} />
      </div>
      <div className="flex justify-between text-[9px] text-gray-600 mt-1">
        <span>{min}</span>
        <span className="text-gray-400 font-semibold">{value}</span>
        <span>{max}</span>
      </div>
    </div>
  )
}

function AddBloodWorkForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const [saving, setSaving] = useState(false)
  const [custom, setCustom] = useState(false)
  const [form, setForm] = useState({
    marker: MARKER_PRESETS[0].label, customName: '',
    value: '', unit: MARKER_PRESETS[0].unit,
    refMin: String(MARKER_PRESETS[0].refMin), refMax: String(MARKER_PRESETS[0].refMax),
    test_date: new Date().toISOString().slice(0, 10), notes: '',
  })

  function selectPreset(label: string) {
    if (label === '__custom__') { setCustom(true); setForm(f => ({ ...f, unit: '', refMin: '', refMax: '' })); return }
    const p = MARKER_PRESETS.find(x => x.label === label)
    if (p) { setCustom(false); setForm(f => ({ ...f, marker: p.label, unit: p.unit, refMin: String(p.refMin), refMax: String(p.refMax) })) }
  }

  async function save() {
    const markerName = custom ? form.customName.trim() : form.marker
    if (!markerName || !form.value) return
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.schema('fitbit').from('blood_work').insert({
      user_id: user!.id, test_date: form.test_date, marker: markerName,
      value: parseFloat(form.value), unit: form.unit,
      ref_min: form.refMin ? parseFloat(form.refMin) : null,
      ref_max: form.refMax ? parseFloat(form.refMax) : null,
      notes: form.notes || null,
    })
    setSaving(false); onSaved()
  }

  return (
    <div className="bg-surface rounded-2xl p-4 flex flex-col gap-3">
      <p className="font-semibold text-sm">Novo Exame</p>
      <div>
        <label className="text-xs text-gray-400 mb-1 block">Marcador</label>
        <select className="w-full bg-surface-2 rounded-xl px-3 py-2.5 text-sm text-white border border-white/10"
          onChange={e => selectPreset(e.target.value)} value={custom ? '__custom__' : form.marker}>
          {MARKER_PRESETS.map(p => <option key={p.label} value={p.label}>{p.label}</option>)}
          <option value="__custom__">Outro (personalizado)</option>
        </select>
      </div>
      {custom && (
        <Field label="Nome">
          <input className="w-full bg-surface-2 rounded-xl px-3 py-2.5 text-sm text-white border border-white/10"
            value={form.customName} onChange={e => setForm(f => ({ ...f, customName: e.target.value }))} placeholder="ex: Ferritina livre" />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor">
          <input type="number" className="w-full bg-surface-2 rounded-xl px-3 py-2.5 text-sm text-white border border-white/10"
            value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} placeholder="0.0" />
        </Field>
        <Field label="Unidade">
          <input className="w-full bg-surface-2 rounded-xl px-3 py-2.5 text-sm text-white border border-white/10"
            value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} placeholder="mg/dL" />
        </Field>
        <Field label="Ref. mínima">
          <input type="number" className="w-full bg-surface-2 rounded-xl px-3 py-2.5 text-sm text-white border border-white/10"
            value={form.refMin} onChange={e => setForm(f => ({ ...f, refMin: e.target.value }))} placeholder="opcional" />
        </Field>
        <Field label="Ref. máxima">
          <input type="number" className="w-full bg-surface-2 rounded-xl px-3 py-2.5 text-sm text-white border border-white/10"
            value={form.refMax} onChange={e => setForm(f => ({ ...f, refMax: e.target.value }))} placeholder="opcional" />
        </Field>
      </div>
      <Field label="Data do exame">
        <input type="date" className="w-full bg-surface-2 rounded-xl px-3 py-2.5 text-sm text-white border border-white/10"
          value={form.test_date} onChange={e => setForm(f => ({ ...f, test_date: e.target.value }))} />
      </Field>
      <Field label="Observações (opcional)">
        <input className="w-full bg-surface-2 rounded-xl px-3 py-2.5 text-sm text-white border border-white/10"
          value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="em jejum, clínica, etc." />
      </Field>
      <div className="flex gap-2 mt-1">
        <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border border-white/10 text-sm text-gray-400">Cancelar</button>
        <button onClick={save} disabled={saving}
          className="flex-1 py-2.5 rounded-xl bg-bhr-green text-black font-bold text-sm disabled:opacity-50">
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </div>
  )
}

// ─── Shared ───────────────────────────────────────────────────────────────────
function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface rounded-2xl p-4">
      <div className="mb-3">
        <p className="text-xs text-gray-400 uppercase tracking-wider font-medium">{title}</p>
        {subtitle && <p className="text-[10px] text-gray-600 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-3 h-0.5 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-[10px] text-gray-500">{label}</span>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-gray-400 mb-1 block">{label}</label>
      {children}
    </div>
  )
}
