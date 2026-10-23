-- Editable and frozen authoring stores use the same atomic source-availability boundary.
CREATE TRIGGER beam_courses_source_admission_insert
BEFORE INSERT ON beam_courses
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(CASE WHEN json_valid(NEW.draft_json) THEN NEW.draft_json ELSE 'null' END) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_courses_source_admission_update
BEFORE UPDATE OF draft_json ON beam_courses
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(CASE WHEN json_valid(NEW.draft_json) THEN NEW.draft_json ELSE 'null' END) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_lesson_revisions_source_admission_insert
BEFORE INSERT ON beam_lesson_revisions
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(json_array(json(CASE WHEN json_valid(NEW.source_version_ids) THEN NEW.source_version_ids ELSE 'null' END),json(CASE WHEN json_valid(NEW.blocks_json) THEN NEW.blocks_json ELSE 'null' END))) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_lesson_revisions_source_admission_update
BEFORE UPDATE OF source_version_ids,blocks_json ON beam_lesson_revisions
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(json_array(json(CASE WHEN json_valid(NEW.source_version_ids) THEN NEW.source_version_ids ELSE 'null' END),json(CASE WHEN json_valid(NEW.blocks_json) THEN NEW.blocks_json ELSE 'null' END))) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_proposals_source_admission_insert
BEFORE INSERT ON beam_proposals
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(json_array(json(CASE WHEN json_valid(NEW.input_version_ids) THEN NEW.input_version_ids ELSE 'null' END),json(CASE WHEN json_valid(NEW.draft_json) THEN NEW.draft_json ELSE 'null' END),json(CASE WHEN json_valid(NEW.passages_json) THEN NEW.passages_json ELSE 'null' END),json(CASE WHEN json_valid(NEW.missing_json) THEN NEW.missing_json ELSE 'null' END))) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_proposals_source_admission_update
BEFORE UPDATE OF input_version_ids,draft_json,passages_json,missing_json ON beam_proposals
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(json_array(json(CASE WHEN json_valid(NEW.input_version_ids) THEN NEW.input_version_ids ELSE 'null' END),json(CASE WHEN json_valid(NEW.draft_json) THEN NEW.draft_json ELSE 'null' END),json(CASE WHEN json_valid(NEW.passages_json) THEN NEW.passages_json ELSE 'null' END),json(CASE WHEN json_valid(NEW.missing_json) THEN NEW.missing_json ELSE 'null' END))) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_draft_conflicts_source_admission_insert
BEFORE INSERT ON beam_draft_conflicts
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(json_array(json(CASE WHEN json_valid(NEW.mine_json) THEN NEW.mine_json ELSE 'null' END),json(CASE WHEN json_valid(NEW.theirs_json) THEN NEW.theirs_json ELSE 'null' END))) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_draft_conflicts_source_admission_update
BEFORE UPDATE OF mine_json,theirs_json ON beam_draft_conflicts
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(json_array(json(CASE WHEN json_valid(NEW.mine_json) THEN NEW.mine_json ELSE 'null' END),json(CASE WHEN json_valid(NEW.theirs_json) THEN NEW.theirs_json ELSE 'null' END))) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_course_locales_source_admission_insert
BEFORE INSERT ON beam_course_locales
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(CASE WHEN json_valid(NEW.draft_json) THEN NEW.draft_json ELSE 'null' END) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_course_locales_source_admission_update
BEFORE UPDATE OF draft_json ON beam_course_locales
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(CASE WHEN json_valid(NEW.draft_json) THEN NEW.draft_json ELSE 'null' END) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_locale_glossaries_source_admission_insert
BEFORE INSERT ON beam_locale_glossaries
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(CASE WHEN json_valid(NEW.terms_json) THEN NEW.terms_json ELSE 'null' END) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

CREATE TRIGGER beam_locale_glossaries_source_admission_update
BEFORE UPDATE OF terms_json ON beam_locale_glossaries
WHEN COALESCE((SELECT applying FROM rer_portability_state WHERE id=1),0)=0 AND EXISTS(
  SELECT 1 FROM json_tree(CASE WHEN json_valid(NEW.terms_json) THEN NEW.terms_json ELSE 'null' END) j
  JOIN beam_unavailable_source_refs u ON j.atom=u.source_id OR j.atom=u.version_id
)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;

