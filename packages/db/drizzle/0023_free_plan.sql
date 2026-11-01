-- A $0 plan with everything, for RIO's own account and test customers.
INSERT INTO "plans" ("name", "modules", "included_loads", "extra_load_cents", "monthly_fee_cents", "per_tracker_cents", "sort_order")
  SELECT 'Free (internal & testing)', '{gps,loads}', 0, 0, 0, 0, 0
  WHERE NOT EXISTS (SELECT 1 FROM "plans" WHERE lower("name") = lower('Free (internal & testing)'));
