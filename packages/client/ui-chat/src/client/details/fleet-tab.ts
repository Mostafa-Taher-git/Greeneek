/**
 * Fleet-tab availability: whether a surface occupies the details panel's Fleet
 * body slot right now.
 *
 * The panel has no channel to the Army plugin, and adding one would make Chat
 * depend on a feature package, so it reads the registry's own occupancy
 * projection and re-reads it on that key's batched change notifications. The
 * resulting boolean is what the panel's tab strip renders from.
 * @module @greeneek/gnk-client-ui-chat/client/details/fleet-tab
 */
import { notifySubscribers } from '@greeneek/gnk-client-store'
import type { HostObservable } from '@greeneek/gnk-client-ui-slots'

/** Slot whose occupancy the details panel arbitrates against. */
const FLEET_SLOT = 'conversation.details.fleet'

/** Registry face the source reads: cell winners for one key, plus its change feed. */
export interface FleetSlotRegistry {
  entriesOfSlot(key: typeof FLEET_SLOT): readonly unknown[]
  subscribe(key: typeof FLEET_SLOT, fn: () => void): () => void
}

/**
 * Live occupancy of the Fleet body slot, published as the tab strip's
 * availability fact.
 */
export class FleetTabAvailability implements HostObservable<boolean> {
  private readonly listeners = new Set<() => void>()
  private readonly unsubscribe: () => void
  private occupied: boolean

  /**
   * @param registry - the Client slot registry this source projects.
   */
  constructor(private readonly registry: FleetSlotRegistry) {
    this.occupied = registry.entriesOfSlot(FLEET_SLOT).length > 0
    this.unsubscribe = registry.subscribe(FLEET_SLOT, () => { this.read() })
  }

  /** Return the cached occupancy, unchanged until a registration moves it. */
  getSnapshot = (): boolean => this.occupied

  /** Subscribe to occupancy replacement. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Drop the registry feed and every subscriber when the owning fiber unloads. */
  dispose(): void {
    this.unsubscribe()
    this.listeners.clear()
  }

  /** Re-read occupancy and notify only when the fact actually moved. */
  private read(): void {
    const occupied = this.registry.entriesOfSlot(FLEET_SLOT).length > 0
    if (occupied === this.occupied) return
    this.occupied = occupied
    notifySubscribers(this.listeners, '[ui-chat] fleet tab')
  }
}
