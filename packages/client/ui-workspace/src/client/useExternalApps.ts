/**
 * The Host external application catalogue, read once per surface.
 *
 * Both the Session header and the Workspace row offer the same destinations,
 * so both read the catalogue the same way: on mount, per call, and never
 * blocking the surface on it.
 */
import { useEffect, useState } from 'react'
import type { ExternalAppsShare } from './contract/slots.ts'

/**
 * Read the Host's external application catalogue.
 * @param externalApps - the injected catalogue read.
 * @returns the catalogue, or undefined while it loads or after a failed read.
 */
export function useExternalApps(
  externalApps: () => Promise<ExternalAppsShare>,
): ExternalAppsShare | undefined {
  const [share, setShare] = useState<ExternalAppsShare | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    externalApps()
      .then((value) => {
        if (!cancelled) setShare(value)
      })
      .catch((reason: unknown) => {
        // The catalogue is advisory: the default file-manager entry works alone.
        console.warn('external application catalogue unavailable:', reason)
      })
    return () => { cancelled = true }
  }, [externalApps])
  return share
}
