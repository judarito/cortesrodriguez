-- Sincroniza reglas de solicitud creada con servicios que ya tienen expertos asignados.

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
