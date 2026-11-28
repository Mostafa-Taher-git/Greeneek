import desktopRelease from "./desktop-release.json";

export type Platform = "windows" | "macos" | "linux" | "unknown";

export function detectPlatform(userAgent?: string): Platform {
  if (typeof navigator === "undefined" && userAgent === undefined) return "unknown";
  const ua = (userAgent ?? navigator.userAgent).toLowerCase();
  // Android reports Linux in its UA but has no desktop installer.
  if (ua.includes("android")) return "unknown";
  if (ua.includes("win")) return "windows";
  if (ua.includes("mac") || ua.includes("iphone") || ua.includes("ipad"))
    return "macos";
  if (ua.includes("linux") || ua.includes("x11")) return "linux";
  return "unknown";
}

export const RELEASES_URL =
  "https://github.com/Mostafa-Taher-git/Greeneek/releases";
export const REPO_URL = "https://github.com/Mostafa-Taher-git/Greeneek";
export const ISSUES_URL = `${REPO_URL}/issues`;
export const DOCS_URL = `${REPO_URL}/blob/main/docs/user/guide/index.md`;
export const DEV_DOCS_URL = `${REPO_URL}/blob/main/docs/development.md`;
export const PLUGINS_URL = "https://github.com/topics/gnk-plugin";
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;

/**
 * Downloads are pinned to a concrete desktop release resolved at build time.
 * The repo-wide `/releases/latest` can point at the npm `v*` source release,
 * which has no installers, so it is never used for a download URL.
 */
export const DESKTOP_RELEASE_TAG = desktopRelease.tag;
const assetUrl = (name: string): string =>
  `${RELEASES_URL}/download/${DESKTOP_RELEASE_TAG}/${name}`;

export const download = {
  latest: `${RELEASES_URL}/tag/${DESKTOP_RELEASE_TAG}`,
  windowsInstaller: assetUrl("Greeneek-Desktop-latest-windows-x64.exe"),
  windowsPortable: assetUrl("Greeneek-Desktop-latest-windows-x64.zip"),
  linuxDeb: assetUrl("Greeneek-Desktop-latest-linux-amd64.deb"),
  linuxAppImage: assetUrl("Greeneek-Desktop-latest-linux-x86_64.AppImage"),
};
