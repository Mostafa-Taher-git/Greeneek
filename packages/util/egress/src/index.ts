/**
 * The single network egress policy for the Greeneek Harness.
 *
 * The harness blocks no provider by default: the operator chooses every
 * endpoint (`$GREENEEK_BASE_URL`, user settings files, plugin config), and
 * every public host those endpoints name is dialable — including the
 * pre-rebrand provider's hosts, which are just another user-configured
 * endpoint now. The guard runs where connection facts resolve — before any
 * adapter holds a URL — so a refused endpoint fails at boot with a readable
 * config error rather than mid-stream.
 *
 * Strict mode (`$GNK_STRICT_EGRESS=1`) refuses every host that is not in the
 * built-in allow-list or user-configured, for air-gapped or compliance
 * deployments. It is opt-in and off by default.
 * @module @greeneek/gnk-egress
 */

/** Raised when a resolved endpoint violates the egress policy. */
export class EgressBlockedError extends Error {
  /** The hostname that caused the refusal. */
  readonly hostname: string

  /**
   * @param hostname - the refused host.
   * @param reason - which policy arm refused it.
   */
  constructor(hostname: string, reason: string) {
    super(`Egress blocked for ${hostname}: ${reason}`)
    this.name = 'EgressBlockedError'
    this.hostname = hostname
  }
}

/**
 * Hosts the harness will never talk to. Empty by policy: no provider is
 * blocked by default, so every operator-configured endpoint is reachable.
 * The export stays so connection seams keep one policy call site; entries
 * here (matched against the full hostname, subdomains included) refuse
 * before the strict-mode arm runs and can never be allow-listed.
 */
export const BLOCKED_HOSTS: readonly RegExp[] = []

/**
 * Allow-list consulted only under `$GNK_STRICT_EGRESS=1`. The harness ships
 * no first-party service, so this holds no built-in hosts: every endpoint a
 * strict deployment dials is user-configured, and package-registry and
 * release hosts are added by the update/installer seams themselves when
 * strict mode is tightened further.
 */
export const STRICT_ALLOWED_HOSTS: ReadonlySet<string> = new Set([])

/**
 * Refuse URLs whose host is banned (and, under strict mode, not allow-listed).
 * @param url - a resolved endpoint about to be used by a connection layer.
 * @param env - environment mapping consulted for `GNK_STRICT_EGRESS`.
 * @throws {EgressBlockedError} when the URL's host is blocked or, in strict
 * mode, absent from the allow-list; a `TypeError`-shaped failure for a URL
 * that cannot be parsed is wrapped so consumers see one error class.
 */
export function assertEgressAllowed(
  url: string,
  env: Record<string, string | undefined> = process.env,
): void {
  let hostname: string
  try {
    hostname = new URL(url).hostname
  } catch {
    throw new EgressBlockedError(url, 'not an absolute URL')
  }
  hostname = hostname.toLowerCase()
  if (BLOCKED_HOSTS.some(re => re.test(hostname))) {
    throw new EgressBlockedError(hostname,
      'this host is on the deployment blocklist')
  }
  if (env.GNK_STRICT_EGRESS === '1' && !STRICT_ALLOWED_HOSTS.has(hostname)) {
    throw new EgressBlockedError(hostname, 'GNK_STRICT_EGRESS=1 allows only allow-listed hosts')
  }
}
