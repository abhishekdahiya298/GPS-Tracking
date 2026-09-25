# Scheduled report emails

`/reports/schedules` (permission `reports.manage`: Org Admin, Fleet Manager).

- **Daily**: the previous local calendar day, sent at the chosen hour.
- **Weekly**: the previous Monday–Sunday, sent on the chosen weekday and hour.
- Times use the schedule's IANA time zone (DST-safe; `packages/core/src/schedule.ts`).
- Content: per-vehicle trips, distance, driving time, top speed + totals; optional CSV of
  every trip (formula-injection safe). Uses the same trip detection as `/reports`.
- Recipients are organization members, re-checked at send time: removing someone from the
  team stops their emails. Devices/recipients from other organizations are rejected (400).

## Delivery guarantees

- Scheduler: every 5 minutes inside the web process (enabled with `ALERTS_SCHEDULER_ENABLED`),
  first pass 30 s after start. Logs `reports.scheduler_started`, `reports.schedule_sent`,
  `reports.schedule_failed`.
- Exactly once per period: `last_period_key` is claimed with a conditional UPDATE before
  sending, so overlapping passes or several instances never double-send.
- A new (or re-timed / resumed) schedule starts with the **next** period, so saving one
  mid-day doesn't immediately mail yesterday. Use **Send me a test** (caller only, once a
  minute) to see the latest completed period now.
- Downtime: when the server comes back, the current due period is sent; periods fully missed
  during a longer outage are skipped (not back-filled).
- Without `RESEND_API_KEY`, nothing is sent and the page shows a warning.

API: `GET/POST /api/report-schedules`, `PATCH/DELETE /api/report-schedules/{id}`,
`POST /api/report-schedules/{id}/test`. Migration `0004_report_schedules` (additive: new
table + enum). Audit: `report_schedule.created/updated/deleted/test_sent`.
