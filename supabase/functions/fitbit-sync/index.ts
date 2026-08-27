import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const SUPABASE_SECRET_KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}") as Record<string, string>
const CRON_SECRET_KEY = SUPABASE_SECRET_KEYS.default
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!
const FITNESS_API = "https://www.googleapis.com/fitness/v1/users/me"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const msToNano = (ms: number) => (ms * 1_000_000).toString()
const nanoToMs = (ns: string | number) => Math.round(Number(ns) / 1_000_000)

interface SyncResult {
  user_id: string
  success: boolean
  synced_activities: number
  synced_recoveries: number
  synced_sleeps: number
  synced_workouts: number
  errors: Record<string, string>
  error?: string
}

// Resume os erros coletados em uma linha só, para gravar em sync_status.sync_error.
const summarizeErrors = (errors: Record<string, string>): string | null => {
  const keys = Object.keys(errors)
  if (keys.length === 0) return null
  return keys.map(k => `${k}: ${errors[k]}`).join(" | ").slice(0, 2000)
}

// Renova o access token do Google. Lança se não conseguir — seguir com um token
// vencido só produz 401 silencioso em cada chamada da Fitness API.
async function ensureAccessToken(
  supabase: SupabaseClient,
  userId: string,
  tokenData: Record<string, unknown>,
): Promise<string> {
  const expiresAt = tokenData.expires_at ? new Date(tokenData.expires_at as string) : null
  const needsRefresh = !expiresAt || expiresAt.getTime() - Date.now() < 5 * 60 * 1000
  if (!needsRefresh) return tokenData.access_token as string

  const refreshToken = tokenData.refresh_token as string | null
  if (!refreshToken) {
    throw new Error("Token do Google expirado e sem refresh_token. Reconecte sua conta Google.")
  }

  let refreshRes: Response
  try {
    refreshRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
      }),
    })
  } catch (e) {
    throw new Error(`Falha de rede ao renovar token do Google: ${String(e)}`)
  }

  if (!refreshRes.ok) {
    const body = await refreshRes.text()
    throw new Error(
      `Falha ao renovar token do Google (HTTP ${refreshRes.status}): ${body.slice(0, 300)}. ` +
      `Se o erro for invalid_grant, reconecte sua conta Google.`
    )
  }

  const newTokens = await refreshRes.json()
  await supabase.schema("fitbit").from("user_tokens").update({
    access_token: newTokens.access_token,
    expires_at: new Date(Date.now() + (newTokens.expires_in ?? 3600) * 1000).toISOString(),
  }).eq("user_id", userId)

  return newTokens.access_token as string
}

async function syncUser(supabase: SupabaseClient, userId: string): Promise<SyncResult> {
  const base: SyncResult = {
    user_id: userId,
    success: false,
    synced_activities: 0,
    synced_recoveries: 0,
    synced_sleeps: 0,
    synced_workouts: 0,
    errors: {},
  }

  const { data: tokenData, error: tokenError } = await supabase
    .schema("fitbit")
    .from("user_tokens")
    .select("*")
    .eq("user_id", userId)
    .single()

  if (tokenError || !tokenData) {
    return { ...base, error: "Google Health não conectado" }
  }

  await supabase.schema("fitbit").from("sync_status").upsert(
    { user_id: userId, syncing: true, sync_error: null },
    { onConflict: "user_id" }
  )

  let accessToken: string
  try {
    accessToken = await ensureAccessToken(supabase, userId, tokenData)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[${userId}] ${msg}`)
    await supabase.schema("fitbit").from("sync_status").upsert(
      { user_id: userId, syncing: false, sync_error: msg },
      { onConflict: "user_id" }
    )
    return { ...base, error: msg, errors: { token: msg } }
  }

  const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }

  const now = Date.now()
  const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000

  let syncedActivities = 0
  let syncedSleeps = 0
  let syncedWorkouts = 0
  let syncedRecoveries = 0
  const errors: Record<string, string> = {}

  // A API do Google Fit rejeita agregações diárias em intervalos longos
  // ("aggregate duration too large"). Divide os 90 dias em blocos de 30
  // e reúne os buckets para manter o histórico completo.
  const MAX_AGGREGATE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
  const aggregate = async (dataTypeName: string) => {
    const buckets: Record<string, unknown>[] = []

    for (let chunkStart = ninetyDaysAgo; chunkStart < now; chunkStart += MAX_AGGREGATE_WINDOW_MS) {
      const chunkEnd = Math.min(chunkStart + MAX_AGGREGATE_WINDOW_MS, now)
      const res = await fetch(`${FITNESS_API}/dataset:aggregate`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          aggregateBy: [{ dataTypeName }],
          bucketByTime: { durationMillis: "86400000" },
          startTimeMillis: chunkStart.toString(),
          endTimeMillis: chunkEnd.toString(),
        }),
      })
      if (!res.ok) throw new Error(`aggregate ${dataTypeName}: HTTP ${res.status} - ${await res.text()}`)
      const payload = await res.json()
      buckets.push(...((payload.bucket ?? []) as Record<string, unknown>[]))
    }

    return { bucket: buckets }
  }

  // Extrai soma de fpVal dos pontos de um bucket
  const sumFp = (bucket: Record<string, unknown>, idx = 0): number => {
    const pts = (bucket.dataset as Record<string, unknown>[])?.[0]?.point as Record<string, unknown>[] ?? []
    return pts.reduce((acc: number, p: Record<string, unknown>) =>
      acc + (((p.value as Record<string, unknown>[])?.[idx] as Record<string, unknown>)?.fpVal as number ?? 0), 0)
  }

  // Extrai soma de intVal
  const sumInt = (bucket: Record<string, unknown>, idx = 0): number => {
    const pts = (bucket.dataset as Record<string, unknown>[])?.[0]?.point as Record<string, unknown>[] ?? []
    return pts.reduce((acc: number, p: Record<string, unknown>) =>
      acc + (((p.value as Record<string, unknown>[])?.[idx] as Record<string, unknown>)?.intVal as number ?? 0), 0)
  }

  try {
    // ── Buscar todos os dados diários em paralelo ────────────────────────────
    const [stepsData, distanceData, caloriesData, hrData, spo2Data, activeMinData, heartPtsData, moveMinData, weightData] = await Promise.allSettled([
      aggregate("com.google.step_count.delta"),       // passos
      aggregate("com.google.distance.delta"),          // distância (metros)
      aggregate("com.google.calories.expended"),       // calorias TOTAIS (inclui BMR)
      aggregate("com.google.heart_rate.bpm"),          // FC
      aggregate("com.google.oxygen_saturation"),       // SpO₂
      aggregate("com.google.active_minutes"),          // minutos ativos
      aggregate("com.google.heart_minutes"),           // Heart Points (cardio)
      aggregate("com.google.move_minutes"),            // minutos de movimento
      aggregate("com.google.weight"),                  // peso corporal
    ])

    // Construir maps por data
    const mapByDate = (settled: PromiseSettledResult<Record<string, unknown>>, extractor: (b: Record<string, unknown>) => number): Record<string, number> => {
      const out: Record<string, number> = {}
      if (settled.status !== "fulfilled") return out
      for (const bucket of (settled.value.bucket ?? []) as Record<string, unknown>[]) {
        const date = new Date(Number(bucket.startTimeMillis)).toISOString().split("T")[0]
        const val = extractor(bucket)
        if (val > 0) out[date] = val
      }
      return out
    }

    // FC: calcular média ponderada das leituras do dia (mais preciso que mínimo)
    const hrMap: Record<string, number> = {}
    if (hrData.status === "fulfilled") {
      for (const bucket of (hrData.value.bucket ?? []) as Record<string, unknown>[]) {
        const date = new Date(Number(bucket.startTimeMillis)).toISOString().split("T")[0]
        const pts = (bucket.dataset as Record<string, unknown>[])?.[0]?.point as Record<string, unknown>[] ?? []
        if (pts.length > 0) {
          // Google Fit aggregate heart_rate.bpm: [0]=min, [1]=max, [2]=avg
          // Usar índice 0 (mínimo) como proxy para FC em repouso
          const mins = pts
            .map((p: Record<string, unknown>) => ((p.value as Record<string, unknown>[])?.[0] as Record<string, unknown>)?.fpVal as number ?? 0)
            .filter((v: number) => v > 30 && v < 200) // filtro de sanidade
          if (mins.length > 0) {
            hrMap[date] = Math.round(mins.reduce((a, b) => a + b, 0) / mins.length)
          }
        }
      }
    }

    const stepsMap = mapByDate(stepsData, b => sumInt(b))
    const distanceMap = mapByDate(distanceData, b => sumFp(b))
    const caloriesMap = mapByDate(caloriesData, b => sumFp(b))
    const spo2Map = mapByDate(spo2Data, b => {
      const pts = (b.dataset as Record<string, unknown>[])?.[0]?.point as Record<string, unknown>[] ?? []
      if (pts.length === 0) return 0
      const vals = pts.map((p: Record<string, unknown>) => ((p.value as Record<string, unknown>[])?.[0] as Record<string, unknown>)?.fpVal as number ?? 0).filter((v: number) => v > 0)
      return vals.length > 0 ? parseFloat((vals.reduce((a: number, b: number) => a + b, 0) / vals.length).toFixed(1)) : 0
    })
    const activeMinMap = mapByDate(activeMinData, b => sumInt(b))
    const heartPtsMap = mapByDate(heartPtsData, b => sumInt(b))
    const moveMinMap = mapByDate(moveMinData, b => sumInt(b))

    // Peso: salvar o mais recente no perfil
    if (weightData.status === "fulfilled") {
      let latestWeight: number | null = null
      for (const bucket of (weightData.value.bucket ?? []) as Record<string, unknown>[]) {
        const pts = (bucket.dataset as Record<string, unknown>[])?.[0]?.point as Record<string, unknown>[] ?? []
        for (const p of pts) {
          const w = ((p.value as Record<string, unknown>[])?.[0] as Record<string, unknown>)?.fpVal as number ?? 0
          if (w > 0) latestWeight = parseFloat(w.toFixed(1))
        }
      }
      if (latestWeight) {
        await supabase.schema("fitbit").from("profiles").upsert(
          { user_id: userId, weight_kilogram: latestWeight },
          { onConflict: "user_id", ignoreDuplicates: false }
        )
      }
    }

    if (activeMinData.status === "rejected") errors.active_minutes = String(activeMinData.reason)
    if (stepsData.status === "rejected") errors.steps = String(stepsData.reason)
    if (distanceData.status === "rejected") errors.distance = "Permissão de distância pendente. Reconecte o Google Health."
    if (caloriesData.status === "rejected") errors.calories = String(caloriesData.reason)
    if (hrData.status === "rejected") errors.heart_rate = String(hrData.reason)
    if (spo2Data.status === "rejected") errors.spo2 = String(spo2Data.reason)
    if (heartPtsData.status === "rejected") errors.heart_points = String(heartPtsData.reason)
    if (moveMinData.status === "rejected" && !String(moveMinData.reason).includes("no default datasource")) {
      errors.move_minutes = "Minutos de movimento indisponíveis no Google Health."
    }
    if (weightData.status === "rejected") errors.weight = String(weightData.reason)

    // ── Atividades diárias ──────────────────────────────────────────────────
    try {
      // Gerar um bucket por dia nos últimos 90 dias
      const allDates: string[] = []
      const startDay = new Date(ninetyDaysAgo)
      startDay.setUTCHours(0, 0, 0, 0)
      for (let d = new Date(startDay); d.getTime() <= now; d.setUTCDate(d.getUTCDate() + 1)) {
        allDates.push(d.toISOString().split("T")[0])
      }

      const actRows = allDates
        .filter(date => stepsMap[date] || caloriesMap[date] || activeMinMap[date])
        .map(date => {
          const azm = activeMinMap[date] ?? 0
          const kcal = caloriesMap[date] ?? 0
          const rhr = hrMap[date] ?? null
          const steps = stepsMap[date] ?? null
          const distance = distanceMap[date] ?? null

          return {
            user_id: userId,
            fitbit_activity_id: date.replace(/-/g, ""),
            start_time: `${date}T00:00:00Z`,
            end_time: `${date}T23:59:59Z`,
            timezone: null,
            score_state: "SCORED",
            // Strain estimado a partir de minutos de zona cardíaca ativa
            strain: azm > 0 ? Math.min(parseFloat((azm / 6).toFixed(1)), 21) : null,
            // Calorias totais (inclui BMR) → kJ
            kilojoule: kcal > 0 ? Math.round(kcal * 4.184) : null,
            average_heart_rate: rhr,
            max_heart_rate: null,
            steps,
            distance_meter: distance ? Math.round(distance) : null,
            heart_points: heartPtsMap[date] ?? null,
            move_minutes: moveMinMap[date] ?? null,
          }
        })

      if (actRows.length > 0) {
        const { error: actErr } = await supabase.schema("fitbit").from("cycles").upsert(
          actRows, { onConflict: "fitbit_activity_id", ignoreDuplicates: false }
        )
        if (actErr) {
          console.error("Erro upsert cycles:", JSON.stringify(actErr))
          errors.cycles = actErr.message ?? JSON.stringify(actErr)
        } else {
          syncedActivities += actRows.length
        }

        // ── Recuperação estimada ──────────────────────────────────────────────
        const recovRows = actRows
          .filter(r => r.average_heart_rate != null)
          .map(r => {
            const date = String(r.fitbit_activity_id).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")
            const rhr = r.average_heart_rate as number
            const spo2 = spo2Map[date] ?? null
            // Score: RHR normalizado. 45bpm=100%, 80bpm=0%
            const score = Math.max(0, Math.min(100, Math.round(((80 - rhr) / 35) * 100)))
            return {
              user_id: userId,
              cycle_id: r.fitbit_activity_id,
              sleep_id: null,
              score_state: "SCORED",
              recovery_score: score,
              resting_heart_rate: rhr,
              hrv_rmssd_milli: null,
              spo2_percentage: spo2,
              skin_temp_celsius: null,
            }
          })

        if (recovRows.length > 0) {
          const { error: recovErr } = await supabase.schema("fitbit").from("recovery").upsert(
            recovRows, { onConflict: "cycle_id", ignoreDuplicates: false }
          )
          if (recovErr) errors.recovery = recovErr.message ?? JSON.stringify(recovErr)
          else syncedRecoveries += recovRows.length
        }
      }
    } catch (e) { errors.activity = String(e) }

    // ── Sono pela nova Google Health API ─────────────────────────────────────
    // O Fitbit Air grava o sono na Google Health API v4. Esses registros não
    // aparecem necessariamente na API antiga do Google Fit usada abaixo.
    try {
      const sleepUrl = new URL("https://health.googleapis.com/v4/users/me/dataTypes/sleep/dataPoints:reconcile")
      sleepUrl.searchParams.set("pageSize", "25")
      sleepUrl.searchParams.set("dataSourceFamily", "users/me/dataSourceFamilies/google-wearables")
      sleepUrl.searchParams.set(
        "filter",
        `sleep.interval.end_time >= "${new Date(windowStart).toISOString()}" AND sleep.interval.end_time < "${new Date(now).toISOString()}"`
      )

      const healthSleepRes = await fetch(sleepUrl, { headers })
      if (healthSleepRes.ok) {
        const healthSleepData = await healthSleepRes.json()
        const healthSleepRows = ((healthSleepData.dataPoints ?? []) as Record<string, unknown>[])
          .map((point: Record<string, unknown>) => {
            const sleep = point.sleep as Record<string, unknown> | undefined
            const interval = sleep?.interval as Record<string, unknown> | undefined
            const startTime = interval?.startTime as string | undefined
            const endTime = interval?.endTime as string | undefined
            if (!sleep || !startTime || !endTime) return null

            const startMs = Date.parse(startTime)
            const endMs = Date.parse(endTime)
            if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null

            let awake = 0, light = 0, deep = 0, rem = 0, genericSleep = 0
            for (const stage of (sleep.stages ?? []) as Record<string, unknown>[]) {
              const stageStart = Date.parse(String(stage.startTime ?? ""))
              const stageEnd = Date.parse(String(stage.endTime ?? ""))
              if (!Number.isFinite(stageStart) || !Number.isFinite(stageEnd) || stageEnd <= stageStart) continue
              const duration = stageEnd - stageStart
              const type = String(stage.type ?? "")
              if (type === "AWAKE" || type === "RESTLESS") awake += duration
              else if (type === "LIGHT") light += duration
              else if (type === "DEEP") deep += duration
              else if (type === "REM") rem += duration
              else if (type === "ASLEEP") genericSleep += duration
            }

            const summary = sleep.summary as Record<string, unknown> | undefined
            const summaryAsleep = Number(summary?.minutesAsleep ?? 0) * 60_000
            if (genericSleep > 0 && light + deep + rem === 0) light = genericSleep
            const totalSleep = summaryAsleep > 0 ? summaryAsleep : light + deep + rem
            const inBed = endMs - startMs
            const efficiency = inBed > 0 && totalSleep > 0
              ? Math.min(100, Math.round((totalSleep / inBed) * 100))
              : null

            return {
              user_id: userId,
              fitbit_sleep_id: String(point.dataPointName ?? point.name ?? `google-health-${startMs}`),
              start_time: new Date(startMs).toISOString(),
              end_time: new Date(endMs).toISOString(),
              timezone: null,
              nap: inBed < 3 * 3_600_000,
              score_state: "SCORED",
              total_in_bed_time_milli: inBed,
              total_awake_time_milli: awake || null,
              total_light_sleep_time_milli: light || null,
              total_slow_wave_sleep_time_milli: deep || null,
              total_rem_sleep_time_milli: rem || null,
              total_no_data_time_milli: null,
              sleep_cycle_count: null,
              disturbance_count: null,
              sleep_needed_baseline_milli: null,
              sleep_needed_from_sleep_debt_milli: null,
              sleep_needed_from_recent_strain_milli: null,
              sleep_needed_from_recent_nap_milli: null,
              respiratory_rate: null,
              sleep_performance_percentage: efficiency,
              sleep_consistency_percentage: null,
              sleep_efficiency_percentage: efficiency,
            }
          })
          .filter(Boolean)

        if (healthSleepRows.length > 0) {
          const { error: healthSleepErr } = await supabase.schema("fitbit").from("sleep").upsert(
            healthSleepRows,
            { onConflict: "user_id,start_time,end_time", ignoreDuplicates: false }
          )
          if (healthSleepErr) errors.google_health_sleep = healthSleepErr.message ?? JSON.stringify(healthSleepErr)
          else syncedSleeps += healthSleepRows.length
        }
      } else if (healthSleepRes.status !== 403) {
        errors.google_health_sleep = `HTTP ${healthSleepRes.status} - ${(await healthSleepRes.text()).slice(0, 300)}`
      }
    } catch (e) {
      errors.google_health_sleep = String(e)
    }

    // ── Sono ────────────────────────────────────────────────────────────────
    try {
      const sleepRes = await fetch(
        `${FITNESS_API}/sessions?startTime=${new Date(ninetyDaysAgo).toISOString()}&endTime=${new Date(now).toISOString()}&activityType=72`,
        { headers }
      )
      if (sleepRes.ok) {
        const sleepData = await sleepRes.json()
        const sessions: Record<string, unknown>[] = sleepData.session ?? []

        if (sessions.length > 0) {
          const sleepRows = sessions.map(s => {
            const startMs = Number(s.startTimeMillis)
            const endMs = Number(s.endTimeMillis)
            const durationMs = endMs - startMs
            return {
              user_id: userId,
              fitbit_sleep_id: String(s.id),
              start_time: new Date(startMs).toISOString(),
              end_time: new Date(endMs).toISOString(),
              timezone: null,
              nap: durationMs < 3 * 3_600_000,
              score_state: "SCORED",
              total_in_bed_time_milli: durationMs,
              total_awake_time_milli: null as number | null,
              total_light_sleep_time_milli: null as number | null,
              total_slow_wave_sleep_time_milli: null as number | null,
              total_rem_sleep_time_milli: null as number | null,
              total_no_data_time_milli: null,
              sleep_cycle_count: null,
              disturbance_count: null,
              sleep_needed_baseline_milli: null,
              sleep_needed_from_sleep_debt_milli: null,
              sleep_needed_from_recent_strain_milli: null,
              sleep_needed_from_recent_nap_milli: null,
              respiratory_rate: null,
              sleep_performance_percentage: null as number | null,
              sleep_consistency_percentage: null,
              sleep_efficiency_percentage: null as number | null,
            }
          })

          // Buscar estágios de sono para cada sessão
          for (const row of sleepRows) {
            try {
              const startNs = msToNano(new Date(row.start_time).getTime())
              const endNs = msToNano(new Date(row.end_time as string).getTime())
              const stagesRes = await fetch(
                `${FITNESS_API}/dataSources/derived:com.google.sleep.segment:com.google.android.gms:merged/datasets/${startNs}-${endNs}`,
                { headers }
              )
              if (stagesRes.ok) {
                const stagesData = await stagesRes.json()
                let light = 0, deep = 0, rem = 0, awake = 0
                for (const point of (stagesData.point ?? []) as Record<string, unknown>[]) {
                  const stageType = ((point.value as Record<string, unknown>[])?.[0] as Record<string, unknown>)?.intVal as number ?? 0
                  const dur = nanoToMs(Number(point.endTimeNanos) - Number(point.startTimeNanos))
                  // 1=awake, 2=sleep(genérico), 3=out-of-bed, 4=light, 5=deep, 6=REM
                  if (stageType === 1 || stageType === 3) awake += dur
                  else if (stageType === 4 || stageType === 2) light += dur
                  else if (stageType === 5) deep += dur
                  else if (stageType === 6) rem += dur
                }
                const totalSleep = light + deep + rem
                if (totalSleep > 0) {
                  row.total_awake_time_milli = awake
                  row.total_light_sleep_time_milli = light
                  row.total_slow_wave_sleep_time_milli = deep
                  row.total_rem_sleep_time_milli = rem
                  const inBed = row.total_in_bed_time_milli as number
                  row.sleep_efficiency_percentage = inBed > 0 ? Math.round((totalSleep / inBed) * 100) : null
                  row.sleep_performance_percentage = row.sleep_efficiency_percentage
                }
              }
            } catch { /* estágios opcionais */ }
          }

          const { error: sleepErr } = await supabase.schema("fitbit").from("sleep").upsert(
            sleepRows,
            { onConflict: "fitbit_sleep_id", ignoreDuplicates: false }
          )
          if (sleepErr) {
            console.error("Erro upsert sleep:", JSON.stringify(sleepErr))
            errors.sleep = sleepErr.message ?? JSON.stringify(sleepErr)
          } else {
            syncedSleeps += sleepRows.length
          }
        }
      } else {
        errors.sleep = `HTTP ${sleepRes.status} - ${(await sleepRes.text()).slice(0, 300)}`
      }
    } catch (e) { errors.sleep = String(e) }

    // ── Treinos ─────────────────────────────────────────────────────────────
    try {
      const workoutRes = await fetch(
        `${FITNESS_API}/sessions?startTime=${new Date(ninetyDaysAgo).toISOString()}&endTime=${new Date(now).toISOString()}`,
        { headers }
      )
      if (workoutRes.ok) {
        const workoutData = await workoutRes.json()
        const sessions: Record<string, unknown>[] = (workoutData.session ?? [])
          .filter((s: Record<string, unknown>) => Number(s.activityType) !== 72)

        if (sessions.length > 0) {
          const rows = sessions.map(s => ({
            user_id: userId,
            fitbit_workout_id: String(s.id),
            start_time: new Date(Number(s.startTimeMillis)).toISOString(),
            end_time: new Date(Number(s.endTimeMillis)).toISOString(),
            timezone: null,
            sport_id: Number(s.activityType ?? -1),
            score_state: "SCORED",
            strain: null,
            average_heart_rate: null,
            max_heart_rate: null,
            kilojoule: null,
            percent_recorded: null,
            zone_zero_milli: null,
            zone_one_milli: null,
            zone_two_milli: null,
            zone_three_milli: null,
            zone_four_milli: null,
            zone_five_milli: null,
          }))

          const { error: workoutErr } = await supabase.schema("fitbit").from("workouts").upsert(
            rows, { onConflict: "fitbit_workout_id", ignoreDuplicates: false }
          )
          if (workoutErr) errors.workout = workoutErr.message ?? JSON.stringify(workoutErr)
          else syncedWorkouts += rows.length
        }
      } else {
        errors.workout = `HTTP ${workoutRes.status} - ${(await workoutRes.text()).slice(0, 300)}`
      }
    } catch (e) { errors.workout = String(e) }

    // Qualquer erro coletado acima fica registrado — antes ele sumia e o app
    // mostrava "✓ 0 atividades" como se tivesse dado certo.
    await supabase.schema("fitbit").from("sync_status").upsert(
      {
        user_id: userId,
        last_sync_at: new Date().toISOString(),
        syncing: false,
        sync_error: summarizeErrors(errors),
      },
      { onConflict: "user_id" }
    )

    return {
      user_id: userId,
      success: Object.keys(errors).length === 0,
      synced_activities: syncedActivities,
      synced_recoveries: syncedRecoveries,
      synced_sleeps: syncedSleeps,
      synced_workouts: syncedWorkouts,
      errors,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido"
    console.error(`[${userId}] sync falhou:`, msg)
    await supabase.schema("fitbit").from("sync_status").upsert(
      { user_id: userId, syncing: false, sync_error: msg },
      { onConflict: "user_id" }
    )
    return { ...base, error: msg, errors: { ...errors, fatal: msg } }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  const authHeader = req.headers.get("Authorization")
  const apiKey = req.headers.get("apikey")?.trim()
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // O pg_cron usa a nova chave secreta no header apikey. Ela nunca fica gravada
  // no SQL: o banco lê o valor criptografado do Vault a cada execução.
  if (apiKey && CRON_SECRET_KEY && apiKey === CRON_SECRET_KEY) {
    const { data: rows, error } = await supabase
      .schema("fitbit")
      .from("user_tokens")
      .select("user_id")

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      })
    }

    const results: SyncResult[] = []
    for (const row of rows ?? []) {
      results.push(await syncUser(supabase, row.user_id as string))
    }

    return new Response(JSON.stringify({ mode: "cron", synced_users: results.length, results }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    })
  }

  // Chamada do app: sincroniza apenas o usuário do JWT.
  if (!authHeader) return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS })

  const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: { user }, error: userError } = await supabaseUser.auth.getUser()
  if (userError || !user) return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS })

  const result = await syncUser(supabase, user.id)

  // Sempre 200: o app lê success/error/errors do corpo. Um 500 faria o
  // supabase-js descartar o payload e o motivo real da falha se perderia.
  return new Response(JSON.stringify(result), {
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  })
})
