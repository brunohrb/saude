import { useState } from 'react'
import { supabase } from '../lib/supabase'

// Rótulos amigáveis para as chaves de erro devolvidas pela edge function.
const ERROR_LABELS: Record<string, string> = {
  token: 'Autenticação Google',
  cycles: 'Atividades',
  activity: 'Atividades',
  recovery: 'Recuperação',
  sleep: 'Sono',
  workout: 'Treinos',
  steps: 'Passos',
  distance: 'Distância',
  calories: 'Calorias',
  heart_rate: 'Frequência cardíaca',
  active_minutes: 'Minutos ativos',
  spo2: 'Oxigenação do sangue',
  heart_points: 'Pontos cardíacos',
  move_minutes: 'Minutos de movimento',
  weight: 'Peso',
  fatal: 'Erro',
}

export function useSync(onComplete?: () => void) {
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<string | null>(null)

  const sync = async () => {
    setSyncing(true)
    setError(null)
    setLastResult(null)
    try {
      const { data, error: fnError } = await supabase.functions.invoke('fitbit-sync')
      if (fnError) throw fnError

      const activities = data?.synced_activities ?? 0
      const sleeps = data?.synced_sleeps ?? 0
      const workouts = data?.synced_workouts ?? 0
      const recoveries = data?.synced_recoveries ?? 0
      const errors: Record<string, string> = data?.errors ?? {}

      // Antes só quatro chaves eram checadas, então falhas em `cycles`
      // (ex.: coluna faltando) apareciam como "✓ 0 atividades".
      const messages = Object.keys(errors).map(
        key => `${ERROR_LABELS[key] ?? key}: ${errors[key]}`
      )
      if (data?.error && messages.length === 0) messages.push(data.error)

      if (messages.length > 0) {
        setError(messages.join(' · '))
      } else {
        setLastResult(`✓ ${activities} atividades · ${sleeps} sonos · ${recoveries} recuperações · ${workouts} treinos`)
      }
      onComplete?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao sincronizar')
    } finally {
      setSyncing(false)
    }
  }

  return { sync, syncing, error, lastResult }
}
