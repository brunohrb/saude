import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!
const HEALTH_AI_MODEL = Deno.env.get("HEALTH_AI_MODEL") ?? "claude-sonnet-4-5"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function millisToTime(ms: number | null | undefined): string {
  if (!ms) return "—"
  const totalMin = Math.floor(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const min = totalMin % 60
  if (h === 0) return `${min}min`
  return `${h}h ${min}min`
}

function avg(nums: (number | null | undefined)[]): string {
  const valid = nums.filter((n): n is number => n != null && !isNaN(n))
  if (valid.length === 0) return "—"
  return String(Math.round(valid.reduce((a, b) => a + b, 0) / valid.length))
}

function fmt(n: number | null | undefined, unit = ""): string {
  if (n == null) return "—"
  return `${Math.round(n * 10) / 10}${unit}`
}

function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "?"
  const d = new Date(dateStr)
  return d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })
}

// deno-lint-ignore no-explicit-any
function buildSystemPrompt(cycles: any[], recovery: any[], sleep: any[], workouts: any[], bloodWork: any[], journal: any[], profile: any, trainingPlan: any): string {
  const now = new Date()

  const last7Cycles = cycles.slice(0, 7)
  const last7Recovery = recovery.slice(0, 7)
  const last7Sleep = sleep.filter(s => !s.nap).slice(0, 7)
  const recentWorkouts = workouts.slice(0, 10)

  let recoverySection = "## Recuperação (últimos 7 dias)\n"
  for (const r of last7Recovery) {
    recoverySection += `- ${fmtDate(r.cycle_id?.toString().replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3T00:00:00"))}: Score ${fmt(r.recovery_score, "%")} | FC repouso ${fmt(r.resting_heart_rate, " bpm")} | SpO2 ${fmt(r.spo2_percentage, "%")}\n`
  }
  if (recovery.length > 7) {
    recoverySection += `\nMédia histórica: Score ${avg(recovery.slice(7).map(r => r.recovery_score))}% | FC repouso ${avg(recovery.slice(7).map(r => r.resting_heart_rate))} bpm\n`
  }

  let sleepSection = "## Sono (últimos 7 dias)\n"
  for (const s of last7Sleep) {
    const totalSleep = (s.total_in_bed_time_milli ?? 0) - (s.total_awake_time_milli ?? 0)
    sleepSection += `- ${fmtDate(s.end_time)} (dia em que acordou): Total ${millisToTime(totalSleep)} | Leve ${millisToTime(s.total_light_sleep_time_milli)} | Profundo ${millisToTime(s.total_slow_wave_sleep_time_milli)} | REM ${millisToTime(s.total_rem_sleep_time_milli)} | Eficiência ${fmt(s.sleep_efficiency_percentage, "%")} | Performance ${fmt(s.sleep_performance_percentage, "%")}\n`
  }

  let activitySection = "## Atividade diária (últimos 7 dias)\n"
  for (const c of last7Cycles) {
    const kcal = c.kilojoule ? Math.round(c.kilojoule / 4.184) : null
    const dist = c.distance_meter ? `${(c.distance_meter / 1000).toFixed(1)}km` : "—"
    activitySection += `- ${fmtDate(c.start_time)}: Passos ${fmt(c.steps)} | Dist ${dist} | Calorias ${fmt(kcal, " kcal")} | FC média ${fmt(c.average_heart_rate, " bpm")} | Heart Points ${fmt(c.heart_points)} | Move min ${fmt(c.move_minutes, " min")}\n`
  }

  let workoutsSection = "## Treinos recentes\n"
  if (recentWorkouts.length === 0) {
    workoutsSection += "Nenhum treino registrado.\n"
  } else {
    for (const w of recentWorkouts) {
      const dur = millisToTime(new Date(w.end_time).getTime() - new Date(w.start_time).getTime())
      workoutsSection += `- ${fmtDate(w.start_time)}: Sport ID ${w.sport_id ?? "?"} | Duração ${dur}\n`
    }
  }

  let bloodSection = "## Exames de sangue\n"
  if (bloodWork.length === 0) {
    bloodSection += "Nenhum exame registrado.\n"
  } else {
    for (const bw of bloodWork.slice(0, 10)) {
      bloodSection += `- ${fmtDate(bw.test_date)}: ${bw.marker} = ${bw.value} ${bw.unit}${bw.ref_min != null ? ` (ref: ${bw.ref_min}–${bw.ref_max})` : ""}\n`
    }
  }

  let journalSection = "## Diário de saúde\n"
  if (journal.length === 0) {
    journalSection += "Nenhuma entrada.\n"
  } else {
    for (const j of journal.slice(0, 7)) {
      journalSection += `- ${fmtDate(j.entry_date)}: Sono ${j.sleep_quality ?? "—"}/5 | Energia ${j.energy ?? "—"}/5 | Humor ${j.mood ?? "—"}/5 | Stress ${j.stress ?? "—"}/5${j.notes ? ` | Nota: ${j.notes}` : ""}\n`
    }
  }

  let profileSection = ""
  if (profile) {
    const name = [profile.first_name, profile.last_name].filter(Boolean).join(" ")
    profileSection = `## Perfil\nNome: ${name || "—"} | Peso: ${fmt(profile.weight_kilogram, " kg")} | Altura: ${profile.height_meter ? (profile.height_meter * 100).toFixed(0) + " cm" : "—"} | FC máx: ${fmt(profile.max_heart_rate, " bpm")}\n`
  }

  const trainingSection = trainingPlan
    ? `## Planejamento de treino salvo no app\n${JSON.stringify(trainingPlan).slice(0, 6000)}\n`
    : "## Planejamento de treino salvo no app\nNenhum plano configurado.\n"

  const newestCycle = cycles[0]?.start_time
  const newestSleep = last7Sleep[0]?.end_time

  return `Você é o Coach BHR, um coach pessoal de saúde, sono e performance com acesso aos dados reais do usuário sincronizados via Google Health/Fitbit. Seu papel é transformar sinais e tendências em decisões simples, realistas e personalizadas.

REGRAS DE QUALIDADE E SEGURANÇA:
- Responda sempre em português do Brasil, de forma direta, humana e sem jargão desnecessário.
- Diferencie claramente fato medido, estimativa e hipótese. Nunca invente valores ausentes.
- Confira a data de cada dado. Se sono, recuperação ou atividade estiverem desatualizados, diga isso antes de orientar.
- Não trate score estimado como diagnóstico médico. Não diagnostique, não prescreva medicamentos e não recomende interromper tratamento.
- Diante de sintomas graves, valores muito anormais ou risco imediato, recomende avaliação profissional/urgência de modo claro e proporcional.
- Dê no máximo 3 prioridades por resposta, com ações específicas para hoje e uma justificativa ligada aos dados.
- Compare tendências com o histórico do próprio usuário, não com padrões genéricos quando houver dados pessoais suficientes.
- Para treino, considere recuperação, sono, carga recente, relato subjetivo e objetivo. Ofereça alternativa mais leve quando os dados forem incompletos.
- Para sono, considere duração, eficiência, regularidade, estágios e horário de despertar. A noite pertence ao dia em que o usuário acordou.

FRESCOR DOS DADOS:
- Atividade mais recente: ${fmtDate(newestCycle)}
- Sono mais recente: ${fmtDate(newestSleep)}

${profileSection}
---
${recoverySection}
---
${sleepSection}
---
${activitySection}
---
${workoutsSection}
---
${trainingSection}
---
${bloodSection}
---
${journalSection}
---
Data atual: ${now.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}`
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS })
  }

  const authHeader = req.headers.get("Authorization")
  if (!authHeader) return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS })

  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error: userError } = await supabaseUser.auth.getUser()
  if (userError || !user) return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS })

  let body: { messages: { role: string; content: string }[]; mode?: "brief" | "chat" }
  try { body = await req.json() } catch {
    return new Response("Invalid JSON", { status: 400, headers: CORS_HEADERS })
  }
  const { messages = [], mode = "chat" } = body

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [cyclesRes, recoveryRes, sleepRes, workoutsRes, bloodRes, journalRes, profileRes, trainingRes] = await Promise.all([
    db.schema("fitbit").from("cycles").select("*").eq("user_id", user.id).gte("start_time", since).order("start_time", { ascending: false }).limit(30),
    db.schema("fitbit").from("recovery").select("*").eq("user_id", user.id).order("cycle_id", { ascending: false }).limit(30),
    db.schema("fitbit").from("sleep").select("*").eq("user_id", user.id).gte("end_time", since).order("end_time", { ascending: false }).limit(30),
    db.schema("fitbit").from("workouts").select("*").eq("user_id", user.id).gte("start_time", since).order("start_time", { ascending: false }).limit(20),
    db.schema("fitbit").from("blood_work").select("*").eq("user_id", user.id).order("test_date", { ascending: false }).limit(20),
    db.schema("fitbit").from("journal").select("*").eq("user_id", user.id).order("entry_date", { ascending: false }).limit(10),
    db.schema("fitbit").from("profiles").select("*").eq("user_id", user.id).maybeSingle(),
    db.schema("treino").from("bhr_treinos").select("record_content").eq("user_id", user.id).maybeSingle(),
  ])

  const systemPrompt = buildSystemPrompt(
    cyclesRes.data ?? [],
    recoveryRes.data ?? [],
    sleepRes.data ?? [],
    workoutsRes.data ?? [],
    bloodRes.data ?? [],
    journalRes.data ?? [],
    profileRes.data ?? null,
    trainingRes.data?.record_content ?? null,
  )

  const anthropicMessages = mode === "brief"
    ? [{ role: "user", content: "Gere um insight diário conciso (3-4 frases) sobre minha saúde com base nos dados. Mencione recuperação, sono e atividade. Termine com uma pergunta pessoal ou recomendação específica para hoje." }]
    : messages
      .filter(m => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-12)
      .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }))

  const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: HEALTH_AI_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: anthropicMessages,
      stream: true,
    }),
  })

  if (!claudeRes.ok) {
    const err = await claudeRes.text()
    console.error("Claude error:", claudeRes.status, err)
    return new Response(`Erro ao chamar IA: ${claudeRes.status}`, { status: 502, headers: CORS_HEADERS })
  }

  return new Response(claudeRes.body, {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  })
})
