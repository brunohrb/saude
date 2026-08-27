import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
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

// Fuso do usuário. O Brasil não tem horário de verão desde 2019, então um
// offset fixo é suficiente e evita depender do fuso do runtime da edge function.
const TZ_OFFSET = "-03:00"
const TZ_OFFSET_MS = -3 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

// Data local (YYYY-MM-DD) de um instante em ms.
const localDate = (ms: number) => new Date(ms + TZ_OFFSET_MS).toISOString().split("T")[0]

// Meia-noite local de uma data YYYY-MM-DD, em ms.
const localMidnight = (date: string) => Date.parse(`${date}T00:00:00.000${TZ_OFFSET}`)

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
  // Os buckets do Google Fit começam exatamente em startTimeMillis. Ancorar a
  // janela na meia-noite local mantém cada bucket = um dia do calendário do
  // usuário. Sem isso, cada execução recortaria os dias num horário diferente
  // e o cron de hora em hora reescreveria os mesmos dias com valores tortos.
  const windowStart = localMidnight(localDate(now - 90 * DAY_MS))

  let syncedActivities = 0
  let syncedSleeps = 0
  let syncedWorkouts = 0
  let syncedRecoveries = 0
  const errors: Record<string, string> = {}

  // Agrega dados por dia do Google Fit
  const aggregate = async (dataTypeName: string) => {
    const res = await fetch(`${FITNESS_API}/dataset:aggregate`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        aggregateBy: [{ dataTypeName }],
        bucketByTime: { durationMillis: "86400000" },
        startTimeMillis: windowStart.toString(),
        endTimeMillis: now.toString(),
      }),
    })
    if (!res.ok) throw new Error(`aggregate ${dataTypeName}: HTTP ${res.status} - ${await res.text()}`)
    return res.json()
  }

  // Extrai soma de fpVal dos pontos de um bucket
  const sumFp = (bucket: Record<string, unknown>, idx = 0): number => {
    const pts = (bucket.dataset as Record<string, unknown>[])?.[0]?.point as Record<string, unknown>[] ?? []
    return pts.reduce((acc: number, p: Record<string, unknown>) =>
      acc + (((p.value as Record<string, unknown>[])?.[idx] as Record<string, unknown>)?.fpVal as number ?? 0), 0)
  }

  // Soma aceitando intVal ou fpVal: heart_minutes vem como fpVal e
  // move_minutes como intVal, então somar só um dos dois zera a métrica.
  const sumAny = (bucket: Record<string, unknown>, idx = 0): number => {
    const pts = (bucket.dataset as Record<string, unknown>[])?.[0]?.point as Record<string, unknown>[] ?? []
    return pts.reduce((acc: number, p: Record<string, unknown>) => {
      const v = (p.value as Record<string, unknown>[])?.[idx] as Record<string, unknown> | undefined
      return acc + ((v?.intVal as number ?? 0) || (v?.fpVal as number ?? 0))
    }, 0)
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
        const date = localDate(Number(bucket.startTimeMillis))
        const val = extractor(bucket)
        if (val > 0) out[date] = val
      }
      return out
    }

    // FC: calcular média ponderada das leituras do dia (mais preciso que mínimo)
    const hrMap: Record<string, number> = {}
    if (hrData.status === "fulfilled") {
      for (const bucket of (hrData.value.bucket ?? []) as Record<string, unknown>[]) {
        const date = localDate(Number(bucket.startTimeMillis))
        const pts = (bucket.dataset as Record<string, unknown>[])?.[0]?.point as Record<string, unknown>[] ?? []
        if (pts.length > 0) {
          // O agregado com.google.heart_rate.summary devolve [average, max, min]
          // — o mínimo é o índice 2, não o 0. Usar o 0 pegava a FC média do dia
          // (80-100 bpm), o que zerava o recovery_score na fórmula abaixo.
          const mins = pts
            .map((p: Record<string, unknown>) => ((p.value as Record<string, unknown>[])?.[2] as Record<string, unknown>)?.fpVal as number ?? 0)
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
    const heartPtsMap = mapByDate(heartPtsData, b => Math.round(sumAny(b)))
    const moveMinMap = mapByDate(moveMinData, b => Math.round(sumAny(b)))

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
    if (distanceData.status === "rejected") errors.distance = String(distanceData.reason)
    if (caloriesData.status === "rejected") errors.calories = String(caloriesData.reason)
    if (hrData.status === "rejected") errors.heart_rate = String(hrData.reason)
    if (spo2Data.status === "rejected") errors.spo2 = String(spo2Data.reason)
    if (heartPtsData.status === "rejected") errors.heart_points = String(heartPtsData.reason)
    if (moveMinData.status === "rejected") errors.move_minutes = String(moveMinData.reason)
    if (weightData.status === "rejected") errors.weight = String(weightData.reason)

    // ── Atividades diárias ──────────────────────────────────────────────────
    try {
      // Gerar um bucket por dia nos últimos 90 dias
      const allDates: string[] = []
      for (let t = windowStart; t <= now; t += DAY_MS) allDates.push(localDate(t))

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
            start_time: `${date}T00:00:00${TZ_OFFSET}`,
            end_time: `${date}T23:59:59${TZ_OFFSET}`,
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

    // ── Sono ────────────────────────────────────────────────────────────────
    try {
      const sleepRes = await fetch(
        `${FITNESS_API}/sessions?startTime=${new Date(windowStart).toISOString()}&endTime=${new Date(now).toISOString()}&activityType=72`,
        { headers }
      )
      if (sleepRes.ok) {
        const sleepData = await sleepRes.json()
        const seen = new Set<string>()
        const sessions: Record<string, unknown>[] = (sleepData.session ?? [])
          .filter((s: Record<string, unknown>) => {
            const key = `${s.startTimeMillis}-${s.endTimeMillis}`
            if (seen.has(key)) return false
            seen.add(key)
            return true
          })

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

          // Conflito pela chave natural (a noite), não pelo id: o Google Fit
          // troca o id healthkit-* da mesma noite entre execuções, e era assim
          // que a mesma noite virava várias linhas.
          const { error: sleepErr } = await supabase.schema("fitbit").from("sleep").upsert(
            sleepRows,
            { onConflict: "user_id,start_time,end_time", ignoreDuplicates: false }
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
        `${FITNESS_API}/sessions?startTime=${new Date(windowStart).toISOString()}&endTime=${new Date(now).toISOString()}`,
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
  if (!authHeader) return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS })

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim()
  const isCronCall = req.headers.get("x-cron") === "1"

  // Chamada com a service role key (pg_cron): sincroniza todos os usuários conectados.
  //
  // A função roda com verify_jwt: false porque o gateway do Supabase recusa o JWT
  // legado com UNAUTHORIZED_LEGACY_JWT antes de chegar aqui — é o mesmo arranjo das
  // outras funções de cron do projeto. A autenticação é feita abaixo: ou a chave
  // bate exatamente, ou o token precisa ser um JWT de usuário válido; qualquer
  // outra coisa cai no 401 do final.
  if (bearer === SUPABASE_SERVICE_ROLE_KEY) {
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

  if (isCronCall) {
    // Prefixos só, para diagnosticar divergência de formato de chave sem vazar segredo.
    console.error(
      `chamada de cron com chave que não confere: recebido ${bearer.slice(0, 8)}…, ` +
      `esperado ${SUPABASE_SERVICE_ROLE_KEY.slice(0, 8)}…`
    )
    return new Response(JSON.stringify({ error: "cron key inválida" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    })
  }

  // Chamada do app: sincroniza apenas o usuário do JWT.
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
