-- Idempotently registers one GPS device in RIO's own database (never Traccar's).
-- Creates the organization and its Traccar provider row if missing, then the device.
-- The device's externalDeviceId is Traccar's uniqueId, which for Teltonika is the IMEI.
--
-- Usage (on the VPS, from /opt/rio-gps):
--   docker compose --env-file .env -f infra/docker-compose.yml exec -T postgres \
--     psql -U postgres -d rio -v ON_ERROR_STOP=1 \
--       -v org_name='RIO California Inc' -v org_slug='rio-california' \
--       -v imei='864361078566115' -v model='FTM880' \
--       -f - < infra/postgres/register-device.sql

BEGIN;

INSERT INTO organizations (name, slug)
VALUES (:'org_name', :'org_slug')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO gps_providers (organization_id, kind, name, api_base_url)
SELECT o.id, 'traccar', 'Traccar', 'http://traccar:8082'
FROM organizations o
WHERE o.slug = :'org_slug'
  AND NOT EXISTS (
    SELECT 1 FROM gps_providers p WHERE p.organization_id = o.id AND p.kind = 'traccar'
  );

INSERT INTO gps_devices (organization_id, provider_id, external_device_id, imei, model)
SELECT o.id, p.id, :'imei', :'imei', :'model'
FROM organizations o
JOIN gps_providers p ON p.organization_id = o.id AND p.kind = 'traccar'
WHERE o.slug = :'org_slug'
ON CONFLICT (imei) DO NOTHING;

SELECT o.slug, d.imei, d.external_device_id, d.model, d.status
FROM gps_devices d
JOIN organizations o ON o.id = d.organization_id
WHERE d.imei = :'imei';

COMMIT;
