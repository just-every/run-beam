-- Independent local methods preserve the existing global kill switch.
ALTER TABLE beam_frontline_policy ADD COLUMN password_enabled INTEGER NOT NULL DEFAULT 1 CHECK(password_enabled IN (0,1));
ALTER TABLE beam_frontline_policy ADD COLUMN pin_enabled INTEGER NOT NULL DEFAULT 1 CHECK(pin_enabled IN (0,1));
ALTER TABLE beam_frontline_policy ADD COLUMN initial_days INTEGER NOT NULL DEFAULT 7 CHECK(initial_days BETWEEN 1 AND 30);
