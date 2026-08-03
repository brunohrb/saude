import { useState } from 'react'
import { supabase } from '../lib/supabase'

export interface SyncResult {
  synced_activities: number
  synced_sleeps: number
  synced_workouts: number
  synced_recoveries: number
  errors: Record<string, string>
  allErrors: string[]
  hasData: boolean
}

export function useSync(onComplete?: () => void) {
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<string | null>(null)
  const [syncDetail, setSyncDetail] = useState<SyncResult | null>(null)

  const sync = async () => {
    setSyncing(true)
    setError(null)
    setLastResult(null)
    setSyncDetail(null)
    try {
      const { data, error: fnError } = await supabase.functions.invoke('fitbit-sync')
      if (fnError) throw fnError

      const activities  = data?.synced_activities  ?? 0
      const sleeps      = data?.synced_sleeps      ?? 0
      const workouts    = data?.synced_workouts    ?? 0
      const recoveries  = data?.synced_recoveries  ?? 0
      const errors      = data?.errors             ?? {}

      // Checar TODAS as chaves de erro retornadas pelo servidor
      const allErrors = Object.entries(errors)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}: ${v}`)

      const hasData = activities + sleeps + workouts + recoveries > 0

      setSyncDetail({ synced_activities: activities, synced_sleeps: sleeps, synced_workouts: workouts, synced_recoveries: recoveries, errors, allErrors, hasData })

      if (allErrors.length > 0 && !hasData) {
        setError(`Google Health retornou erros: ${allErrors[0]}`)
      } else if (!hasData) {
        setError('Sync OK mas nenhum dado encontrado. Verifique se o Fitbit está sincronizando com o Google Health.')
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

  return { sync, syncing, error, lastResult, syncDetail }
}
