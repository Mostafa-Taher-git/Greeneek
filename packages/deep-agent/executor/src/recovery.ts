/** Text injected into a Worker resumed after a host restart. */
export const RECOVERY_NOTE = [
  'The host restarted during this ticket.',
  'Inspect the current working directory, git history and external state before continuing.',
  'Then either finish the work and report, or report blocked with what is missing.',
].join(' ')
