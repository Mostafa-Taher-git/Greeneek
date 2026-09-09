export type Platform = "windows" | "macos" | "linux" | "unknown";

export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent.toLowerCase();
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

/** All downloads route to the latest release. */
export const download = {
  latest: `${RELEASES_URL}/latest`,
  windowsInstaller: RELEASES_URL,
  windowsPortable: RELEASES_URL,
  linuxDeb: RELEASES_URL,
  linuxAppImage: RELEASES_URL,
};
