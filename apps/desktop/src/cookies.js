/**
 * Stale auth-cookie cleanup.
 * The service names its session cookie `gnk-auth-` plus a hash of the request
 * authority, which includes the random port — and cookies are not port-scoped.
 * Every restart therefore mints another month-long cookie for 127.0.0.1 until
 * the Cookie header outgrows Node's limit and every request dies with HTTP
 * 431. Deleting the stale names before first navigation keeps exactly one.
 */

/** Cookie-name prefix the service mints per authority. */
export const GNK_AUTH_COOKIE_PREFIX = 'gnk-auth-'

/**
 * Delete stale service-auth cookies for the loopback origin about to load.
 * Refuses non-loopback URLs outright: this cleanup must never touch cookies
 * belonging to any other origin.
 * @param cookieStore - the window's session.cookies (get/remove).
 * @param rendererUrl - the token URL about to load.
 * @returns how many cookies were removed.
 */
export async function clearStaleGnkAuthCookies(cookieStore, rendererUrl) {
  let origin
  try {
    const parsed = new URL(rendererUrl)
    if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) return 0
    origin = `${parsed.origin}/`
  } catch {
    return 0
  }
  const stale = (await cookieStore.get({ url: origin }))
    .filter(({ name }) => name.startsWith(GNK_AUTH_COOKIE_PREFIX))
  await Promise.all(stale.map(({ name }) => cookieStore.remove(origin, name)))
  return stale.length
}
