/**
 * Named z-index constants. Use these in `style={{ zIndex: Z.modal }}`
 * for deliberate stacking — keeps ad-hoc `z-[9999]` values out of the codebase.
 */
export const Z = {
  base: 0,
  dropdown: 50,
  sticky: 100,
  fixed: 200,
  modalBackdrop: 300,
  modal: 400,
  popover: 500,
  tooltip: 600,
  toast: 700,
  cookieBanner: 800,
  /**
   * Help drawer sits above the cookie banner: the banner is fixed to the bottom
   * of the viewport and would otherwise cover the drawer's footer CTA. The
   * banner still wins over ordinary page content — only the drawer outranks it.
   */
  supportDrawerBackdrop: 900,
  supportDrawer: 901,
} as const;
