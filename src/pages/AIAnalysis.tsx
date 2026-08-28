import { useState, useRef, useEffect } from 'react'
import { useFitbitData } from '../hooks/useFitbitData'
import { supabase } from '../lib/supabase'
import { recoveryColor } from '../utils/whoop'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

type Message = { role: 'user' | 'assistant'; content: string }
const CHAT_STORAGE_KEY = 'bhr-coach-messages-v1'

function loadSavedMessages(): Message[] {
  try {
    const value = JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) ?? '[]')
    return Array.isArray(value) ? value.slice(-20) : []
  } catch {
    return []
  }
}

// ─── SparklineMini ───────────────────────────────────────────────────────────

function SparklineMini({
  values,
  color = '#00D4A0',
  height = 36,
}: {
  values: number[]
  color?: string
  height?: number
}) {
  if (values.length < 2) return <div style={{ height }} />
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const W = 110
  const H = height
  const pts = values.map((v, i) => ({
    x: (i / (values.length - 1)) * W,
    y: H - ((v - min) / range) * (H - 8) - 4,
  }))
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      style={{ overflow: 'visible' }}
    >
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.6}
      />
      {pts.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={i === pts.length - 1 ? 4 : 3}
          fill={i === pts.length - 1 ? color : 'transparent'}
          stroke={color}
          strokeWidth={1.5}
        />
      ))}
    </svg>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DAY_ABBR = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'] // Dom Seg Ter Qua Qui Sex Sab

function weekdayLabel(value: string): string {
  return DAY_ABBR[new Date(value).getDay()]
}

function recoveryStatusLabel(score: number | null | undefined): { label: string; color: string } {
  if (score == null) return { label: '—', color: '#555' }
  if (score >= 67) return { label: 'Ótimo', color: '#00D4A0' }
  if (score >= 34) return { label: 'Regular', color: '#F5C518' }
  return { label: 'Baixo', color: '#FF4444' }
}

function sleepStatusLabel(perf: number | null | undefined): { label: string; color: string } {
  if (perf == null) return { label: '—', color: '#555' }
  if (perf >= 85) return { label: 'Ótimo', color: '#00D4A0' }
  if (perf >= 70) return { label: 'Bom', color: '#4FC3F7' }
  if (perf >= 50) return { label: 'Regular', color: '#F5C518' }
  return { label: 'Ruim', color: '#FF4444' }
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AIAnalysis() {
  const { recentRecoveries, recentSleeps, loading: dataLoading } = useFitbitData()

  const [briefing, setBriefing] = useState<string>('')
  const [briefLoading, setBriefLoading] = useState(false)
  const [messages, setMessages] = useState<Message[]>(loadSavedMessages)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const briefFetched = useRef(false)

  // Last 7 recovery scores (oldest → newest) — data comes desc from DB, so reverse
  const last7Recovery = [...recentRecoveries]
    .sort((a, b) => String(a.cycle_id).localeCompare(String(b.cycle_id)))
    .slice(-7)

  // Last 7 sleep performances (oldest → newest)
  const last7Sleep = [...recentSleeps]
    .sort((a, b) => new Date(a.end_time ?? 0).getTime() - new Date(b.end_time ?? 0).getTime())
    .slice(-7)

  const recoveryDayLabels = last7Recovery.map(r => weekdayLabel(String(r.cycle_id).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3T12:00:00')))
  const sleepDayLabels = last7Sleep.map(s => weekdayLabel(s.end_time ?? s.start_time))

  const latestRecoveryScore = last7Recovery[last7Recovery.length - 1]?.recovery_score ?? null
  const latestSleepPerf = last7Sleep[last7Sleep.length - 1]?.sleep_performance_percentage ?? null

  const recoveryValues = last7Recovery.map((r) => r.recovery_score ?? 0)
  const sleepValues = last7Sleep.map((s) => s.sleep_performance_percentage ?? 0)

  const recovStat = recoveryStatusLabel(latestRecoveryScore)
  const sleepStat = sleepStatusLabel(latestSleepPerf)

  // ── Send function ──────────────────────────────────────────────────────────

  async function send(text: string, isBrief = false) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    setError(null)
    const history: Message[] = isBrief
      ? [{ role: 'user', content: text }]
      : [...messages, { role: 'user', content: text }]

    if (!isBrief) {
      setMessages(history)
      setInput('')
    }

    if (isBrief) {
      setBriefLoading(true)
    } else {
      setStreaming(true)
      setMessages((prev) => [...prev, { role: 'assistant', content: '' }])
    }

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/health-ai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          messages: history,
          mode: isBrief ? 'brief' : 'chat',
        }),
      })

      if (!res.ok || !res.body) {
        await res.text()
        setError('O coach não conseguiu responder agora. Tente novamente em alguns instantes.')
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''
      let buffer = ''

      let reading = true
      while (reading) {
        const { done, value } = await reader.read()
        if (done) {
          reading = false
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data)
            if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
              accumulated += parsed.delta.text
              if (isBrief) {
                setBriefing(accumulated)
              } else {
                setMessages((prev) => {
                  const updated = [...prev]
                  updated[updated.length - 1] = { role: 'assistant', content: accumulated }
                  return updated
                })
              }
            }
          } catch {
            // skip malformed SSE lines
          }
        }
      }
    } catch (err) {
      console.error('Stream error:', err)
      setError(navigator.onLine ? 'A conexão com o coach foi interrompida.' : 'Você está sem internet. O coach precisa de conexão para responder.')
    } finally {
      if (isBrief) setBriefLoading(false)
      else setStreaming(false)
    }
  }

  // Auto-fetch briefing on mount (after data loads)
  useEffect(() => {
    if (!dataLoading && !briefFetched.current) {
      briefFetched.current = true
      send('brief', true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLoading])

  // Scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages.slice(-20)))
  }, [messages])

  function handleSend() {
    const text = input.trim()
    if (!text || streaming) return
    send(text, false)
  }

  function handleQuickPrompt(prompt: string) {
    setInput(prompt)
    send(prompt, false)
  }

  function focusInput() {
    inputRef.current?.focus()
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: '#0a0014', color: '#fff', fontFamily: 'system-ui, sans-serif' }}
    >
      {/* Header */}
      <div className="px-5 pt-10 pb-4">
        <div className="flex items-center gap-2 mb-1">
          <span style={{ color: '#00D4A0', fontSize: 20 }}>✦</span>
          <h1 className="text-2xl font-bold tracking-tight">Coach BHR</h1>
        </div>
        <p style={{ color: '#9CA3AF', fontSize: 13 }}>Claude Sonnet · seus dados reais · orientação diária</p>
      </div>

      {/* Briefing Card */}
      <div className="mx-4 mb-4 rounded-2xl p-5" style={{ background: '#16002a' }}>
        {briefLoading || (dataLoading && !briefing) ? (
          <div className="flex gap-2 items-center py-4">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-2 h-2 rounded-full"
                style={{
                  background: '#00D4A0',
                  display: 'inline-block',
                  animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                }}
              />
            ))}
            <style>{`@keyframes bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-8px)} }`}</style>
          </div>
        ) : briefing ? (
          <p className="text-lg leading-relaxed" style={{ color: '#F3F4F6' }}>
            {briefing}
          </p>
        ) : null}

        {/* Metric Cards */}
        <div className="grid grid-cols-2 gap-3 mt-5">
          {/* Recovery Card */}
          <div className="rounded-xl p-3" style={{ background: '#0a001a' }}>
            <p className="text-xs mb-2" style={{ color: '#9CA3AF' }}>Recuperação</p>
            <p className="text-2xl font-bold mb-1" style={{ color: recoveryColor(latestRecoveryScore) }}>
              {latestRecoveryScore != null ? `${latestRecoveryScore}%` : '—'}
            </p>
            <SparklineMini values={recoveryValues} color={recoveryColor(latestRecoveryScore)} height={36} />
            <div className="flex justify-between mt-1">
              {recoveryDayLabels.map((d, i) => (
                <span key={i} style={{ color: '#6B7280', fontSize: 9 }}>{d}</span>
              ))}
            </div>
            <div
              className="mt-2 inline-block px-2 py-0.5 rounded-full text-xs font-medium"
              style={{ background: recovStat.color + '22', color: recovStat.color }}
            >
              {recovStat.label}
            </div>
          </div>

          {/* Sleep Card */}
          <div className="rounded-xl p-3" style={{ background: '#0a001a' }}>
            <p className="text-xs mb-2" style={{ color: '#9CA3AF' }}>Sono</p>
            <p className="text-2xl font-bold mb-1" style={{ color: '#9C59D1' }}>
              {latestSleepPerf != null ? `${latestSleepPerf}%` : '—'}
            </p>
            <SparklineMini values={sleepValues} color="#9C59D1" height={36} />
            <div className="flex justify-between mt-1">
              {sleepDayLabels.map((d, i) => (
                <span key={i} style={{ color: '#6B7280', fontSize: 9 }}>{d}</span>
              ))}
            </div>
            <div
              className="mt-2 inline-block px-2 py-0.5 rounded-full text-xs font-medium"
              style={{ background: sleepStat.color + '22', color: sleepStat.color }}
            >
              {sleepStat.label}
            </div>
          </div>
        </div>

        {/* Action row */}
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={focusInput}
            className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium"
            style={{ background: '#1a0030', color: '#00D4A0', border: '1px solid #00D4A022' }}
          >
            <span>✦</span> Responder
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => setFeedback('up')}
              className="w-9 h-9 rounded-full flex items-center justify-center text-base"
              style={{
                background: feedback === 'up' ? '#00D4A022' : '#1a0030',
                border: '1px solid #ffffff11',
              }}
              title="Útil"
            >
              👍
            </button>
            <button
              onClick={() => setFeedback('down')}
              className="w-9 h-9 rounded-full flex items-center justify-center text-base"
              style={{
                background: feedback === 'down' ? '#FF444422' : '#1a0030',
                border: '1px solid #ffffff11',
              }}
              title="Não útil"
            >
              👎
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-4 mb-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto px-4 pb-2">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`mb-4 flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className="max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed"
              style={
                msg.role === 'user'
                  ? { background: '#00D4A0', color: '#000', fontWeight: 500 }
                  : { background: '#16002a', color: '#F3F4F6' }
              }
            >
              {msg.content || (
                <span className="inline-flex gap-1">
                  {[0, 1, 2].map((j) => (
                    <span
                      key={j}
                      className="w-1.5 h-1.5 rounded-full"
                      style={{
                        background: '#9CA3AF',
                        display: 'inline-block',
                        animation: `bounce 1.2s ease-in-out ${j * 0.2}s infinite`,
                      }}
                    />
                  ))}
                </span>
              )}
            </div>
          </div>
        ))}
        <div ref={chatEndRef} />

        {/* Quick prompts — shown only when no chat yet */}
        {messages.length === 0 && (
          <div className="mt-2 mb-4">
            <p className="text-xs mb-3" style={{ color: '#6B7280' }}>Sugestões</p>
            <div className="flex flex-col gap-2">
              {[
                'O que devo treinar hoje?',
                'Monte meu plano de treino desta semana',
                'Como melhorar meu sono?',
                'Analise minha tendência de recuperação',
                'Resuma meus principais sinais de saúde',
              ].map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => handleQuickPrompt(prompt)}
                  className="text-left px-4 py-3 rounded-xl text-sm"
                  style={{ background: '#16002a', color: '#D1D5DB', border: '1px solid #ffffff0d' }}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Input bar */}
      <div
        className="sticky bottom-0 px-4 pb-8 pt-3"
        style={{ background: 'linear-gradient(to top, #0a0014 80%, transparent)' }}
      >
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-2xl"
          style={{ background: '#16002a', border: '1px solid #ffffff0d' }}
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Pergunte ao seu coach…"
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: '#F3F4F6', caretColor: '#00D4A0' }}
            disabled={streaming}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || streaming}
            className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 text-sm font-bold transition-opacity"
            style={{
              background: input.trim() && !streaming ? '#00D4A0' : '#1a0030',
              color: input.trim() && !streaming ? '#000' : '#6B7280',
              opacity: input.trim() && !streaming ? 1 : 0.5,
            }}
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  )
}
