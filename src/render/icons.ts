/**
 * Vendored icon paths: GENERATED, do not edit by hand.
 * Regenerate with `npm run build:icons`.
 *
 * Source: Material Design Icons by Pictogrammers
 *   https://github.com/Templarian/MaterialDesign
 * Licence: Apache 2.0: https://github.com/Templarian/MaterialDesign/blob/master/LICENSE
 * Taken from @iconify-json/mdi@1.2.3; only the icons this game draws
 * are included.
 *
 * Coordinates are in the icon's own 24×24 space. The renderer
 * scales them; see drawIcon in mapRenderer.ts.
 */

export interface VectorIcon {
  /** Upstream icon name, kept for attribution and for finding it again. */
  name: string
  width: number
  height: number
  paths: readonly string[]
}

export const ICONS = {
  gasCt: {
    name: "turbine",
    width: 24,
    height: 24,
    paths: [
      "M2 12c0 5.5 4.5 10 10 10s10-4.5 10-10S17.5 2 12 2S2 6.5 2 12m18 0c0 4.4-3.6 8-8 8s-8-3.6-8-8s3.6-8 8-8s8 3.6 8 8m-7.5-5l-.3 1.3l-.9-3.3c-1 .3-1.6 1.3-1.4 2.4l.3 1.3l-2.3-2.4c-.7.7-.7 2 0 2.7l1 1l-3.3-.9c-.3 1 .3 2.1 1.4 2.4l1.3.3l-3.3.9c.3 1 1.3 1.6 2.4 1.4l1.3-.3l-2.4 2.4c.8.7 2 .7 2.7 0l.9-.9l-.9 3.3c1 .3 2.1-.3 2.4-1.4l.3-1.3l.9 3.3c1-.3 1.6-1.3 1.4-2.4l-.3-1.3l2.4 2.4c.7-.8.7-2 0-2.7l-1-1.2l3.3.9c.3-1-.3-2.1-1.4-2.4l-1.3-.3l3.3-.9c-.3-1-1.3-1.6-2.4-1.4l-1.3.3l2.4-2.4c-.8-.7-2-.7-2.7 0l-.9 1l.9-3.3c-1.1-.2-2.2.4-2.5 1.5m1 5c0 .8-.7 1.5-1.5 1.5s-1.5-.7-1.5-1.5s.7-1.5 1.5-1.5s1.5.7 1.5 1.5",
    ],
  },
  gasCcgt: {
    name: "factory",
    width: 24,
    height: 24,
    paths: [
      "M4 18v2h4v-2zm0-4v2h10v-2zm6 4v2h4v-2zm6-4v2h4v-2zm0 4v2h4v-2zM2 22V8l5 4V8l5 4V8l5 4l1-10h3l1 10v10z",
    ],
  },
  solar: {
    name: "solar-power-variant",
    width: 24,
    height: 24,
    paths: [
      "M3.33 16H11v-3H4zM13 16h7.67L20 13h-7zm8.11 2H13v4h9zM2 22h9v-4H2.89zm9-14h2v3h-2zm4.76-.79l1.42-1.42l2.12 2.12l-1.41 1.42zm-11.05.7l2.12-2.12l1.41 1.42l-2.12 2.12zM3 2h3v2H3zm15 0h3v2h-3zm-6 5c2.76 0 5-2.24 5-5H7c0 2.76 2.24 5 5 5",
    ],
  },
  battery: {
    name: "home-battery",
    width: 24,
    height: 24,
    paths: [
      "M12 20H5v-8H2l10-9l2.78 2.5H14v1.67c-1.16.41-2 1.53-2 2.83zm3-11h1V7.5h4V9h1c.55 0 1 .45 1 1v11c0 .55-.45 1-1 1h-6c-.55 0-1-.45-1-1V10c0-.55.45-1 1-1m1 2v3h4v-3z",
    ],
  },
  nuclear: {
    name: "atom",
    width: 24,
    height: 24,
    paths: [
      "M12 11a1 1 0 0 1 1 1a1 1 0 0 1-1 1a1 1 0 0 1-1-1a1 1 0 0 1 1-1M4.22 4.22C5.65 2.79 8.75 3.43 12 5.56c3.25-2.13 6.35-2.77 7.78-1.34s.79 4.53-1.34 7.78c2.13 3.25 2.77 6.35 1.34 7.78s-4.53.79-7.78-1.34c-3.25 2.13-6.35 2.77-7.78 1.34S3.43 15.25 5.56 12C3.43 8.75 2.79 5.65 4.22 4.22m11.32 4.24c.61.62 1.17 1.25 1.69 1.88c1.38-2.13 1.88-3.96 1.13-4.7c-.74-.75-2.57-.25-4.7 1.13c.63.52 1.26 1.08 1.88 1.69m-7.08 7.08c-.61-.62-1.17-1.25-1.69-1.88c-1.38 2.13-1.88 3.96-1.13 4.7c.74.75 2.57.25 4.7-1.13c-.63-.52-1.26-1.08-1.88-1.69m-2.82-9.9c-.75.74-.25 2.57 1.13 4.7c.52-.63 1.08-1.26 1.69-1.88c.62-.61 1.25-1.17 1.88-1.69c-2.13-1.38-3.96-1.88-4.7-1.13m4.24 8.48c.7.7 1.42 1.34 2.12 1.91c.7-.57 1.42-1.21 2.12-1.91s1.34-1.42 1.91-2.12c-.57-.7-1.21-1.42-1.91-2.12S12.7 8.54 12 7.97c-.7.57-1.42 1.21-2.12 1.91S8.54 11.3 7.97 12c.57.7 1.21 1.42 1.91 2.12m8.48 4.24c.75-.74.25-2.57-1.13-4.7c-.52.63-1.08 1.26-1.69 1.88c-.62.61-1.25 1.17-1.88 1.69c2.13 1.38 3.96 1.88 4.7 1.13",
    ],
  },
  dataCenter: {
    name: "server-network",
    width: 24,
    height: 24,
    paths: [
      "M13 19h1a1 1 0 0 1 1 1h7v2h-7a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1H2v-2h7a1 1 0 0 1 1-1h1v-2H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-7zM4 3h16a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1m5 4h1V5H9zm0 8h1v-2H9zM5 5v2h2V5zm0 8v2h2v-2z",
    ],
  },
  contract: {
    name: "file-sign",
    width: 24,
    height: 24,
    paths: [
      "M19.7 12.9L14 18.6h-2.3v-2.3l5.7-5.7zm3.4-.8c0 .3-.3.6-.6.9L20 15.5l-.9-.9l2.6-2.6l-.6-.6l-.7.7l-2.3-2.3l2.2-2.1c.2-.2.6-.2.9 0l1.4 1.4c.2.2.2.6 0 .9c-.2.2-.4.4-.4.6s.2.4.4.6c.3.3.6.6.5.9M3 20V4h7v5h5v1.5l2-2V8l-6-6H3c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2zm8-2.9c-.2 0-.4.1-.5.1L10 15H8.5l-2.1 1.7L7 14H5.5l-1 5H6l2.9-2.6l.6 2.3h1l.5-.1z",
    ],
  },
  tower: {
    name: "transmission-tower",
    width: 24,
    height: 24,
    paths: [
      "m8.28 5.45l-1.78-.9L7.76 2h8.47l1.27 2.55l-1.78.89L15 4H9zM18.62 8h-4.53l-.79-3h-2.6l-.79 3H5.38L4.1 10.55l1.79.89l.73-1.44h10.76l.72 1.45l1.79-.89zm-.85 14H15.7l-.24-.9L12 15.9l-3.47 5.2l-.23.9H6.23l2.89-11h2.07l-.36 1.35L12 14.1l1.16-1.75l-.35-1.35h2.07zm-6.37-7l-.9-1.35l-1.18 4.48zm3.28 3.12l-1.18-4.48l-.9 1.36z",
    ],
  },
  fault: {
    name: "flash-alert",
    width: 24,
    height: 24,
    paths: [
      "M5 2v11h3v9l7-12h-4l4-8m2 13h2v2h-2zm0-8h2v6h-2z",
    ],
  },
} as const satisfies Record<string, VectorIcon>

export type IconKey = keyof typeof ICONS

/** Attribution string, surfaced in the UI credits. */
export const ICON_ATTRIBUTION =
  'Material Design Icons by Pictogrammers (Apache 2.0)'
