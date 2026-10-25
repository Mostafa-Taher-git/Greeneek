import { BrandWordmark, FishLogo } from '@greeneek/gnk-client-ui-primitives'
import type { SidebarBrandMarkOwnerProps, SidebarBrandNameOwnerProps } from '@greeneek/gnk-client-ui-sidebar/client'

/**
 * Render the official mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the official whale mark.
 */
export function OfficialBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return <FishLogo size={size} />
}

/**
 * Render the official name artwork from the sidebar's localized brand text.
 * @param props - the localized wordmark supplied by the sidebar seat.
 * @returns the official name wordmark.
 */
export function OfficialBrandName({ wordmark }: SidebarBrandNameOwnerProps) {
  return <BrandWordmark wordmark={wordmark} includeMark={false} />
}
