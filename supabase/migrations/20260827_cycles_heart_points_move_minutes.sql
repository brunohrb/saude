-- Adiciona as colunas de Heart Points e Move Minutes do Google Fit em fitbit.cycles.
--
-- O sync (supabase/functions/fitbit-sync) passou a enviar heart_points e move_minutes
-- sem que as colunas existissem no banco. O PostgREST rejeitava o lote inteiro com
-- PGRST204 ("Could not find the 'heart_points' column of 'cycles' in the schema cache"),
-- então nenhuma atividade era gravada desde 14/08/2026.

ALTER TABLE fitbit.cycles
  ADD COLUMN IF NOT EXISTS heart_points integer,
  ADD COLUMN IF NOT EXISTS move_minutes integer;

-- Recarrega o schema cache do PostgREST para que as colunas fiquem visíveis na API.
NOTIFY pgrst, 'reload schema';
