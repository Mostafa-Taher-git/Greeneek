# PhotoCraft headless recipe

Use this recipe only while a PhotoCraft headless session is open.

1. Call `command_list` first when the available commands are unclear. It returns the app's current command catalog; do not trust remembered command names.
2. Run one command with `command_run`, or several independent commands with `command_batch`.
3. Write every output under the job `out/` directory. Paths outside the write root are rejected.
4. Artifact tools (`render_preview`, `screenshot`) return paths inside `out/`; the client renders them as artifact cards.
5. Destructive commands (overwrite, save-over, print) require an approval card before they run.

## Photo batch: cull -> grade -> contact sheet

1. Read the candidate files under the workspace root and select against the user's cull criteria from the interview; never invent files that are not on disk.
2. Run the grade commands with `command_batch` over the selected candidates only.
3. Render the contact sheet with `render_preview` into `out/` and present its path as the deliverable. An empty candidate set is reported as empty; do not fabricate a sheet.

## Image editing and drafting

Retouch, crop, and format conversions run as single `command_run` calls in this session. A failed command names what was and was not produced; a cancelled job may leave partial files in `out/` — inspect before retrying.
