/** Contracts shared by the right-panel surface components. */
import type { PropsLocale } from '@greeneek/gnk-client-ui-slots'
import type { SidebarKey } from '../locales.ts'

/** One installed application reported by the Host. */
export interface DeviceAppEntry {
  /** Stable application id. */
  id: string
  /** Localized display name. */
  label: string
}

/** Host facts the Device surface displays. */
export interface DeviceFacts {
  /** Machine name, absent before the ready frame. */
  hostname: string | undefined
  /** Host home directory, absent before the ready frame. */
  home: string | undefined
  /** True when the Gateway is reached over loopback. */
  isLoopback: boolean
  /** Host platform token (`win32`, `darwin`, `linux`, ...). */
  platform: string
  /** Installed applications the Client can name. */
  apps: readonly DeviceAppEntry[]
}

/** Props of the Device surface. */
export type DeviceSurfaceProps = PropsLocale<'sidebar'> & {
  /** Load the Host facts through the plugin's injected Remote callbacks. */
  loadDevice: () => Promise<DeviceFacts>
}

/** Locale-key subset used by the surface components. */
export type SurfaceLocaleKey = SidebarKey
