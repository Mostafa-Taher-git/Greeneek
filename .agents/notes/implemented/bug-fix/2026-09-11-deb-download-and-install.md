# Agent Note: Download & Install for every desktop install type

Status: implemented

## Problem

The updater offered `Download` but deb installs fell back to opening
the releases page: Linux self-update only worked for AppImage, and the
offer buttons promised less than the Windows/AppImage flows delivered.

## Decision

Capability is now a kind, not a boolean: `nsis` and `appimage` keep the
existing electron-updater quit-and-install flow; `deb` downloads
through the same verified pipeline, then installs the hash-verified
package via `pkexec apt-get install --yes` and relaunches. Detection
probes instead of assuming: `dpkg-query -S` on the running executable
(a tarball under /opt does not qualify) and a `pkexec --version` probe
for the privilege helper; both are injectable. All spawns are
argv-based — no shell anywhere near privilege escalation — and the
updater never executes downloaded code as root, only hands the verified
file to the package manager. Denied prompts, missing helpers, and
broken packages fall back to the releases page with the failure logged.
Offer buttons read `Download & Install` on capable installs; the deb
install dialog names the administrator step explicitly. Consent still
gates both phases: download on offer accept, install on Install now.

## Alternatives considered

**`dpkg -i` instead of `apt-get install`.** Rejected: dpkg does not
resolve dependencies; apt-get installs the local file plus whatever it
needs.

**Assuming deb from the install path.** Rejected: probing dpkg is one
syscall and distinguishes real package installs from unpacked copies.

**Keeping the boolean capability.** Rejected: three install mechanisms
already exist and the dialog, install step, and fallback each branch on
which one, so the kind is load-bearing, not decorative.

## Consequences

The updater performing an update is always the installed one, so deb
users on 0.2.8 or earlier install manually once; every later update
self-installs. Portable Windows copies and helper-less Linux installs
keep the Download-page fallback with reasons. Desktop suite covers
kinds, the verified-file-only pkexec argv, relaunch ordering, and the
failure fallback.
