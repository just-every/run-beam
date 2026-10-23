-- Prepared, packaged and evidenced learning cannot introduce references to erased sources.
CREATE TRIGGER beam_packages_source_admission_insert
BEFORE INSERT ON beam_packages
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(json_array(json(CASE WHEN json_valid(NEW.source_version_ids) THEN NEW.source_version_ids ELSE 'null' END),json(CASE WHEN json_valid(NEW.manifest_json) THEN NEW.manifest_json ELSE 'null' END))) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_packages_source_admission_update
BEFORE UPDATE OF source_version_ids,manifest_json ON beam_packages
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(json_array(json(CASE WHEN json_valid(NEW.source_version_ids) THEN NEW.source_version_ids ELSE 'null' END),json(CASE WHEN json_valid(NEW.manifest_json) THEN NEW.manifest_json ELSE 'null' END))) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_xapi_activities_source_admission_insert
BEFORE INSERT ON beam_xapi_activities
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(CASE WHEN json_valid(NEW.source_version_ids) THEN NEW.source_version_ids ELSE 'null' END) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_xapi_activities_source_admission_update
BEFORE UPDATE OF source_version_ids ON beam_xapi_activities
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(CASE WHEN json_valid(NEW.source_version_ids) THEN NEW.source_version_ids ELSE 'null' END) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_agent_proposals_source_admission_insert
BEFORE INSERT ON beam_agent_proposals
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(json_array(json(CASE WHEN json_valid(NEW.inputs_json) THEN NEW.inputs_json ELSE 'null' END),json(CASE WHEN json_valid(NEW.reasons_json) THEN NEW.reasons_json ELSE 'null' END),json(CASE WHEN json_valid(NEW.excluded_json) THEN NEW.excluded_json ELSE 'null' END),json(CASE WHEN json_valid(NEW.payload_json) THEN NEW.payload_json ELSE 'null' END),json(CASE WHEN json_valid(NEW.result_json) THEN NEW.result_json ELSE 'null' END))) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_agent_proposals_source_admission_update
BEFORE UPDATE OF inputs_json,reasons_json,excluded_json,payload_json,result_json ON beam_agent_proposals
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(json_array(json(CASE WHEN json_valid(NEW.inputs_json) THEN NEW.inputs_json ELSE 'null' END),json(CASE WHEN json_valid(NEW.reasons_json) THEN NEW.reasons_json ELSE 'null' END),json(CASE WHEN json_valid(NEW.excluded_json) THEN NEW.excluded_json ELSE 'null' END),json(CASE WHEN json_valid(NEW.payload_json) THEN NEW.payload_json ELSE 'null' END),json(CASE WHEN json_valid(NEW.result_json) THEN NEW.result_json ELSE 'null' END))) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_scenarios_source_admission_insert
BEFORE INSERT ON beam_scenarios
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(CASE WHEN json_valid(NEW.steps_json) THEN NEW.steps_json ELSE 'null' END) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_scenarios_source_admission_update
BEFORE UPDATE OF steps_json ON beam_scenarios
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(CASE WHEN json_valid(NEW.steps_json) THEN NEW.steps_json ELSE 'null' END) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_revision_sequences_source_admission_insert
BEFORE INSERT ON beam_revision_sequences
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(CASE WHEN json_valid(NEW.sequence_json) THEN NEW.sequence_json ELSE 'null' END) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_revision_sequences_source_admission_update
BEFORE UPDATE OF sequence_json ON beam_revision_sequences
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(CASE WHEN json_valid(NEW.sequence_json) THEN NEW.sequence_json ELSE 'null' END) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_assessment_revisions_source_admission_insert
BEFORE INSERT ON beam_assessment_revisions
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(CASE WHEN json_valid(NEW.questions_json) THEN NEW.questions_json ELSE 'null' END) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_assessment_revisions_source_admission_update
BEFORE UPDATE OF questions_json ON beam_assessment_revisions
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(CASE WHEN json_valid(NEW.questions_json) THEN NEW.questions_json ELSE 'null' END) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_skill_paths_source_admission_insert
BEFORE INSERT ON beam_skill_paths
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(CASE WHEN json_valid(NEW.inputs_json) THEN NEW.inputs_json ELSE 'null' END) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_skill_paths_source_admission_update
BEFORE UPDATE OF inputs_json ON beam_skill_paths
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(CASE WHEN json_valid(NEW.inputs_json) THEN NEW.inputs_json ELSE 'null' END) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_imported_history_source_admission_insert
BEFORE INSERT ON beam_imported_history
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(CASE WHEN json_valid(NEW.payload) THEN NEW.payload ELSE 'null' END) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_imported_history_source_admission_update
BEFORE UPDATE OF payload ON beam_imported_history
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(CASE WHEN json_valid(NEW.payload) THEN NEW.payload ELSE 'null' END) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_completions_source_admission_insert
BEFORE INSERT ON beam_completions
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(CASE WHEN json_valid(NEW.evidence_json) THEN NEW.evidence_json ELSE 'null' END) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_completions_source_admission_update
BEFORE UPDATE OF evidence_json ON beam_completions
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(CASE WHEN json_valid(NEW.evidence_json) THEN NEW.evidence_json ELSE 'null' END) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

-- Source metadata erasure changes filename/provenance, not source_id; OCR
-- erasure clears result_json/state, not source_version_id. Neither is blocked.

