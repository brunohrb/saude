-- Agenda o sync do Google Fit de hora em hora.
--
-- Até então o sync só rodava quando o usuário abria o app e tocava no ↻,
-- então os dados ficavam parados enquanto o app não fosse aberto.
--
-- A edge function fitbit-sync detecta a service role key no header Authorization
-- e entra em "modo cron": sincroniza todos os usuários de fitbit.user_tokens.
--
-- A chave é reaproveitada de uma job já existente para não reescrever o segredo.
DO $$
DECLARE
  auth_header text;
BEGIN
  SELECT 'Bearer ' || substring(command from 'Bearer ([A-Za-z0-9._-]+)')
    INTO auth_header
    FROM cron.job
   WHERE jobname = 'casabem_sync_manha_semana';

  IF auth_header IS NULL THEN
    RAISE EXCEPTION 'não foi possível obter a service role key das jobs existentes';
  END IF;

  PERFORM cron.schedule(
    'fitbit_sync_hourly',
    '7 * * * *',
    format(
      $cmd$SELECT net.http_post(
        url := 'https://hisbbtddpoxufvghxqtm.supabase.co/functions/v1/fitbit-sync',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', %L),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
      )$cmd$,
      auth_header
    )
  );
END $$;
