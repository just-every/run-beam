-- AUTO-004 / MOVE-009: a credited historical expiry starts one real renewal,
-- across rule replacements, without creating or changing completion evidence.
CREATE TABLE beam_credit_renewal_cycles (
 credit_id TEXT NOT NULL,
 member_id TEXT NOT NULL,
 rule_id TEXT NOT NULL REFERENCES beam_renewal_rules(id),
 assignment_id TEXT NOT NULL UNIQUE REFERENCES beam_assignments(id),
 history_id TEXT NOT NULL,
 source TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 due_date TEXT NOT NULL,
 timezone TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(credit_id,member_id),
 FOREIGN KEY(credit_id,member_id) REFERENCES beam_history_credit_people(credit_id,member_id)
);
