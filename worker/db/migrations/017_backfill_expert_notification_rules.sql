-- Sincroniza reglas de solicitud creada con servicios que ya tienen expertos asignados.

-- Algunas bases Dev antiguas conservaron la tabla sin la restricción declarada
-- en 004. El índice único hace que el backfill sea seguro y re-aplicable aun
-- cuando exista ese drift de esquema.
DO $$
DECLARE
  duplicate_group RECORD;
  survivor UUID;
BEGIN
  FOR duplicate_group IN
    SELECT event_code, service_type
    FROM operations.notification_rules
    GROUP BY event_code, service_type
    HAVING COUNT(*) > 1
  LOOP
    SELECT id INTO survivor
    FROM operations.notification_rules
    WHERE event_code = duplicate_group.event_code
      AND service_type = duplicate_group.service_type
    ORDER BY updated_at DESC, created_at DESC, id DESC
    LIMIT 1;

    UPDATE operations.notification_rules survivor_rule
    SET audiences = ARRAY(
      SELECT DISTINCT audience
      FROM operations.notification_rules source_rule,
           unnest(source_rule.audiences) AS audience
      WHERE source_rule.event_code = duplicate_group.event_code
        AND source_rule.service_type = duplicate_group.service_type
      ORDER BY audience
    ), updated_at = NOW()
    WHERE survivor_rule.id = survivor;

    INSERT INTO operations.notification_rule_recipients (rule_id, recipient_id)
    SELECT survivor, recipient_id
    FROM operations.notification_rule_recipients mapping
    JOIN operations.notification_rules source_rule ON source_rule.id = mapping.rule_id
    WHERE source_rule.event_code = duplicate_group.event_code
      AND source_rule.service_type = duplicate_group.service_type
    ON CONFLICT DO NOTHING;

    DELETE FROM operations.notification_rules
    WHERE event_code = duplicate_group.event_code
      AND service_type = duplicate_group.service_type
      AND id <> survivor;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS notification_rules_event_service_key
  ON operations.notification_rules(event_code, service_type);

INSERT INTO operations.notification_rules (name, event_code, service_type, audiences)
SELECT 'Solicitud creada - ' || s.name, 'request_created', s.code, ARRAY['expert']::TEXT[]
FROM operations.service_consultation_types sct
JOIN operations.services s ON s.id = sct.service_id AND s.active = TRUE
JOIN operations.consultation_type_experts cte ON cte.consultation_type_id = sct.consultation_type_id AND cte.active = TRUE
GROUP BY s.code, s.name
ON CONFLICT (event_code, service_type) DO UPDATE
SET audiences = CASE
  WHEN 'expert' = ANY(operations.notification_rules.audiences) THEN operations.notification_rules.audiences
  ELSE array_append(operations.notification_rules.audiences, 'expert')
END,
updated_at = NOW();
