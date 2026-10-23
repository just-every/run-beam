-- Source availability is checked at the write boundary, so preparation requests
-- cannot race source-erasure admission. Historical reads and decision identities stay intact.
-- Base owns applying (0003); only its atomic archive restore may insert retained
-- source tombstone metadata. No application write can set this restore gate.
CREATE VIEW beam_unavailable_source_refs(source_id,version_id) AS
SELECT s.id,v.id FROM beam_sources s LEFT JOIN beam_source_versions v ON v.source_id=s.id
WHERE s.erased_at IS NOT NULL OR EXISTS(
  SELECT 1 FROM beam_erasure_jobs e WHERE e.kind='source' AND e.subject_id=s.id AND e.state!='complete'
);

CREATE TRIGGER beam_source_versions_source_admission_insert
BEFORE INSERT ON beam_source_versions
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(json_array(NEW.source_id)) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_source_versions_source_admission_update
BEFORE UPDATE OF source_id ON beam_source_versions
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(json_array(NEW.source_id)) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_acknowledgments_source_admission_insert
BEFORE INSERT ON beam_acknowledgments
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(json_array(NEW.source_id,NEW.source_version_id)) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_acknowledgments_source_admission_update
BEFORE UPDATE OF source_id,source_version_id ON beam_acknowledgments
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(json_array(NEW.source_id,NEW.source_version_id)) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_source_notices_source_admission_insert
BEFORE INSERT ON beam_source_notices
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(json_array(NEW.source_id,NEW.previous_version_id,NEW.new_version_id)) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_source_notices_source_admission_update
BEFORE UPDATE OF source_id,previous_version_id,new_version_id ON beam_source_notices
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(json_array(NEW.source_id,NEW.previous_version_id,NEW.new_version_id)) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_locale_maintenance_source_admission_insert
BEFORE INSERT ON beam_locale_maintenance
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(json_array(NEW.source_id,NEW.new_version_id)) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_locale_maintenance_source_admission_update
BEFORE UPDATE OF source_id,new_version_id ON beam_locale_maintenance
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(json_array(NEW.source_id,NEW.new_version_id)) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_source_ocr_runs_source_admission_insert
BEFORE INSERT ON beam_source_ocr_runs
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(json_array(NEW.source_version_id)) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_source_ocr_runs_source_admission_update
BEFORE UPDATE OF source_version_id ON beam_source_ocr_runs
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(json_array(NEW.source_version_id)) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

