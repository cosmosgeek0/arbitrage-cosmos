/**
 * Static external-infrastructure posture for the assembled I00 candidate.
 *
 * This module deliberately exposes no request helper, status probe, command,
 * editor, console link, credential state, or mutation control. AWS activation
 * belongs to a separately authorized owner session and is not mounted here.
 */
export const AWS_CONTROL_POSTURE = Object.freeze({
  authority: 'OWNER_GATED',
  configuration: 'NOT_CONFIGURED',
  runtime: 'NOT_MOUNTED',
  detail: 'External infrastructure activation requires separate owner authorization.',
  boundary: 'No AWS status probe, command, runner edit, restart, deployment, or console action is mounted.',
});
