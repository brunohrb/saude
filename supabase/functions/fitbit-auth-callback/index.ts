import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { Pool } from "https://deno.land/x/postgres@v0.17.0/mod.ts"

const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const SUPABASE_DB_URL = Deno.env.get("SUPABASE_DB_URL")!
const APP_URL = Deno.env.get("APP_URL") || "https://brunohrb.github.io/saude"
const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/fitbit-auth-callback`

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)
  const code = url.searchParams.get("code")
  const userId = url.searchParams.get("state")
  const error = url.searchParams.get("error")

  if (error) {
    return Response.redirect(`${APP_URL}/configuracoes?fitbit_error=${encodeURIComponent(error)}`)
  }

  if (!code || !userId) {
    return Response.redirect(`${APP_URL}/configuracoes?fitbit_error=parametros_invalidos`)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId)
  if (userError || !userData?.user) {
    console.error("User ID inválido:", userId, userError)
    return Response.redirect(`${APP_URL}/configuracoes?fitbit_error=usuario_invalido`)
  }

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: CALLBACK_URL,
    }),
  })

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text()
    console.error("Troca de token falhou:", errBody)
    return Response.redirect(`${APP_URL}/configuracoes?fitbit_error=troca_token_falhou`)
  }

  const tokens = await tokenRes.json()
  const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString()

  let googleProfile: Record<string, unknown> | null = null
  try {
    const profileRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    if (profileRes.ok) googleProfile = await profileRes.json()
  } catch (e) { console.error("Erro ao buscar perfil:", e) }

  const pool = new Pool(SUPABASE_DB_URL, 1, true)
  const conn = await pool.connect()

  try {
    await conn.queryObject(
      `INSERT INTO fitbit.user_tokens (user_id, access_token, refresh_token, token_type, expires_at, scope, fitbit_user_id)
       VALUES ($1::uuid, $2, $3, $4, $5::timestamptz, $6, $7)
       ON CONFLICT (user_id) DO UPDATE SET
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         token_type = EXCLUDED.token_type,
         expires_at = EXCLUDED.expires_at,
         scope = EXCLUDED.scope,
         fitbit_user_id = EXCLUDED.fitbit_user_id`,
      [
        userId,
        tokens.access_token,
        tokens.refresh_token ?? null,
        tokens.token_type ?? "Bearer",
        expiresAt,
        tokens.scope ?? null,
        googleProfile?.sub ?? null,
      ]
    )

    if (googleProfile) {
      const nameParts = String(googleProfile.name ?? "").split(" ")
      await conn.queryObject(
        `INSERT INTO fitbit.profiles (user_id, fitbit_user_id, email, first_name, last_name, height_meter, weight_kilogram, max_heart_rate)
         VALUES ($1::uuid, $2, $3, $4, $5, null, null, null)
         ON CONFLICT (user_id) DO UPDATE SET
           fitbit_user_id = EXCLUDED.fitbit_user_id,
           email = EXCLUDED.email,
           first_name = EXCLUDED.first_name,
           last_name = EXCLUDED.last_name`,
        [
          userId,
          googleProfile.sub ?? null,
          googleProfile.email ?? null,
          nameParts[0] ?? null,
          nameParts.slice(1).join(" ") || null,
        ]
      )
    }
  } catch (dbErr) {
    console.error("Erro ao salvar no banco:", dbErr)
    return Response.redirect(
      `${APP_URL}/configuracoes?fitbit_error=${encodeURIComponent(`erro_db:${(dbErr as Error).message}`)}`
    )
  } finally {
    conn.release()
    await pool.end()
  }

  return Response.redirect(`${APP_URL}/configuracoes?fitbit_connected=true`)
})
