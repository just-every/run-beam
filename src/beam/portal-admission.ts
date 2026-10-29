// Shared by portal reads and atomic evidence writes. Account binding is never inferred from email.
export const portalAdmission = `SELECT e.* FROM beam_portal_enrollments e
 JOIN beam_portal_identities i ON i.id=e.identity_id AND i.portal_id=e.portal_id
 JOIN beam_enterprise_portals p ON p.id=e.portal_id
 JOIN beam_portal_shares s ON s.portal_id=e.portal_id AND s.revision_id=e.revision_id
 JOIN beam_course_revisions r ON r.id=e.revision_id
 JOIN beam_courses c ON c.id=r.course_id
 WHERE e.portal_id=?1 AND e.id=?2 AND i.id=?3 AND i.operator_id=?4
 AND i.revoked_at IS NULL AND i.consent_at IS NOT NULL AND i.consent_version=p.notice_version
 AND s.revoked_at IS NULL AND r.state IN ('published','superseded') AND c.retired_at IS NULL AND c.archived_at IS NULL`
