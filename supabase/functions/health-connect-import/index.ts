import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Content-Type": "application/json",
}

type SleepRecord = {
  id: string
  start_time: string
  end_time: string
  awake_millis?: number
  light_millis?: number
  deep_millis?: number
  rem_millis?: number
}

const validMillis = (value: unknown) => {
  const number = Number(value ?? 0)
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers })
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers })

  const authorization = req.headers.get("Authorization")
  if (!authorization) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers })

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
  })
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers })

  let body: { records?: SleepRecord[] }
  try { body = await req.json() } catch {
    return new Response(JSON.stringify({ error: "JSON inválido" }), { status: 400, headers })
  }
  if (!Array.isArray(body.records) || body.records.length > 250) {
    return new Response(JSON.stringify({ error: "records deve conter até 250 itens" }), { status: 400, headers })
  }

  const earliest = Date.now() - 100 * 24 * 60 * 60 * 1000
  const rows = body.records.map((record) => {
    const start = Date.parse(record.start_time)
    const end = Date.parse(record.end_time)
    if (!record.id || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || start < earliest || end > Date.now() + 3_600_000) {
      throw new Error("Registro de sono inválido")
    }
    const awake = validMillis(record.awake_millis)
    const light = validMillis(record.light_millis)
    const deep = validMillis(record.deep_millis)
    const rem = validMillis(record.rem_millis)
    const inBed = end - start
    const asleep = light + deep + rem
    const efficiency = asleep > 0 ? Math.min(100, Math.round((asleep / inBed) * 100)) : null
    return {
      user_id: user.id,
      fitbit_sleep_id: `health-connect-${record.id}`,
      start_time: new Date(start).toISOString(),
      end_time: new Date(end).toISOString(),
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

  const admin = createClient(SUPABASE_URL, SERVICE_KEY)
  const { error } = await admin.schema("fitbit").from("sleep").upsert(rows, {
    onConflict: "fitbit_sleep_id",
    ignoreDuplicates: false,
  })
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers })
  return new Response(JSON.stringify({ imported: rows.length }), { headers })
})
