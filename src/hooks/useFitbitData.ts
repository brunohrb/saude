import { useEffect, useState, useCallback } from 'react'
import { supabaseFitbit as supabase } from '../lib/supabase'
import type { FitbitActivity, FitbitRecovery, FitbitSleep, FitbitWorkout, FitbitProfile, SyncStatus, BloodWork, JournalEntry } from '../types'

interface FitbitData {
  latestCycle: FitbitActivity | null
  latestRecovery: FitbitRecovery | null
  latestSleep: FitbitSleep | null
  recentWorkouts: FitbitWorkout[]
  recentCycles: FitbitActivity[]
  recentRecoveries: FitbitRecovery[]
  recentSleeps: FitbitSleep[]
  recentNaps: FitbitSleep[]
  bloodWork: BloodWork[]
  journal: JournalEntry[]
  profile: FitbitProfile | null
  syncStatus: SyncStatus | null
  fitbitConnected: boolean
  whoopConnected: boolean  // legacy alias
  loading: boolean
  error: string | null
  refresh: () => void
}

export function useFitbitData(): FitbitData {
  const [data, setData] = useState<Omit<FitbitData, 'refresh'>>({
    latestCycle: null,
    latestRecovery: null,
    latestSleep: null,
    recentWorkouts: [],
    recentCycles: [],
    recentRecoveries: [],
    recentSleeps: [],
    recentNaps: [],
    bloodWork: [],
    journal: [],
    profile: null,
    syncStatus: null,
    fitbitConnected: false,
    whoopConnected: false,
    loading: true,
    error: null,
  })

  const fetch = useCallback(async () => {
    setData(d => ({ ...d, loading: true, error: null }))
    try {
      const [
        { data: tokenData },
        { data: profileData },
        { data: cyclesData },
        { data: workoutsData },
        { data: sleepsData },
        { data: syncData },
        { data: bloodWorkData },
        { data: journalData },
      ] = await Promise.all([
        supabase.from('user_tokens').select('fitbit_user_id').single(),
        supabase.from('profiles').select('*').single(),
        supabase.from('cycles').select('*').order('start_time', { ascending: false }).limit(30),
        supabase.from('workouts').select('*').order('start_time', { ascending: false }).limit(20),
        supabase.from('sleep').select('*').order('end_time', { ascending: false }).limit(60),
        supabase.from('sync_status').select('*').single(),
        supabase.from('blood_work').select('*').order('test_date', { ascending: false }).limit(200),
        supabase.from('journal').select('*').order('entry_date', { ascending: false }).limit(90),
      ])

      const cycles = cyclesData ?? []
      const allSleeps = sleepsData ?? []
      const sleeps = allSleeps.filter(s => !s.nap)
      const naps = allSleeps.filter(s => s.nap)

      const latestCycle = cycles[0] ?? null
      const latestSleep = sleeps[0] ?? null

      let latestRecovery: FitbitRecovery | null = null
      let recentRecoveries: FitbitRecovery[] = []

      if (cycles.length > 0) {
        const cycleIds = cycles.map(c => c.fitbit_activity_id)
        const { data: recoveryData } = await supabase
          .from('recovery')
          .select('*')
          .in('cycle_id', cycleIds)
          .order('cycle_id', { ascending: false })
          .limit(30)

        recentRecoveries = recoveryData ?? []
        latestRecovery = recentRecoveries[0] ?? null
      }

      setData({
        latestCycle,
        latestRecovery,
        latestSleep,
        recentWorkouts: workoutsData ?? [],
        recentCycles: cycles,
        recentRecoveries,
        recentSleeps: sleeps,
        recentNaps: naps,
        bloodWork: bloodWorkData ?? [],
        journal: journalData ?? [],
        profile: profileData,
        syncStatus: syncData,
        fitbitConnected: !!tokenData?.fitbit_user_id,
        whoopConnected: !!tokenData?.fitbit_user_id,
        loading: false,
        error: null,
      })
    } catch (err) {
      setData(d => ({
        ...d,
        loading: false,
        error: err instanceof Error ? err.message : 'Erro ao carregar dados',
      }))
    }
  }, [])

  useEffect(() => { fetch() }, [fetch])

  return { ...data, refresh: fetch }
}
