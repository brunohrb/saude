-- Deduplica fitbit.sleep e passa a identificar um sono pela noite, não pelo id externo.
--
-- O Google Fit devolve a mesma noite várias vezes (uma sessão healthkit-* por
-- origem) e troca esses ids entre execuções. Com onConflict no id, cada id novo
-- virava uma linha nova — a noite de 21/07 chegou a ter 7 cópias.

-- 1. Mantém uma linha por (user_id, start_time, end_time), preferindo a que tem
--    estágios de sono preenchidos. Nenhuma tabela tem FK para fitbit.sleep.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, start_time, end_time
           ORDER BY (sleep_efficiency_percentage IS NULL), created_at, id
         ) AS rn
  FROM fitbit.sleep
)
DELETE FROM fitbit.sleep s
USING ranked r
WHERE s.id = r.id AND r.rn > 1;

-- 2. A noite passa a ser a identidade.
CREATE UNIQUE INDEX IF NOT EXISTS sleep_user_periodo_unico
  ON fitbit.sleep (user_id, start_time, end_time);

-- 3. O id externo deixa de ser único: se ele continuasse único, o upsert pela
--    chave natural quebraria quando o Google mantivesse o id e mudasse o período.
ALTER TABLE fitbit.sleep DROP CONSTRAINT IF EXISTS sleep_whoop_sleep_id_key;
DROP INDEX IF EXISTS fitbit.sleep_whoop_sleep_id_key;

CREATE INDEX IF NOT EXISTS idx_sleep_fitbit_sleep_id
  ON fitbit.sleep (fitbit_sleep_id);
