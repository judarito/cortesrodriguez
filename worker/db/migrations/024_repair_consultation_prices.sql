-- Prices are stored in minor currency units (cents). Repair the two seeded
-- USD consultation prices that were saved as whole dollars instead of cents.
-- The exact-value predicates keep this migration safe for already-correct data.
UPDATE operations.service_consultation_types AS service_consultation
SET amount_cents = CASE consultation.code
  WHEN 'consulta_basica' THEN 1000
  WHEN 'datos_legales' THEN 1500
END,
updated_at = NOW()
FROM operations.consultation_types AS consultation
WHERE service_consultation.consultation_type_id = consultation.id
  AND service_consultation.currency = 'USD'
  AND (
    (consultation.code = 'consulta_basica' AND service_consultation.amount_cents = 10)
    OR (consultation.code = 'datos_legales' AND service_consultation.amount_cents = 15)
  );
