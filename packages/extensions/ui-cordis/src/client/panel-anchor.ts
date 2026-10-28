/** Geometry the fixed inventory panel anchors against. */
export interface PanelAnchorInput {
  /** The trigger's viewport rect. */
  readonly rect: { readonly left: number; readonly right: number; readonly top: number }
  /** The viewport the panel is fixed in. */
  readonly viewport: { readonly width: number; readonly height: number }
  /** Whether the document renders right-to-left. */
  readonly rtl: boolean
}

/**
 * Fixed-position offsets that place the panel against its trigger without
 * leaving the viewport: the inline edge hugs the trigger's reading-start edge,
 * so a right-side sidebar opens the panel inboard under RTL.
 * @param input - trigger rect, viewport size, and reading direction.
 * @returns The inline-start inset and bottom offset in pixels.
 */
export function panelAnchor(input: PanelAnchorInput): { insetInlineStart: number; bottom: number } {
  const { rect, viewport, rtl } = input
  return {
    insetInlineStart: rtl ? viewport.width - rect.right : rect.left,
    bottom: viewport.height - rect.top + 8,
  }
}
