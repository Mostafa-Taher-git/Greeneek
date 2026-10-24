# PhotoCraft headless recipe

Use this recipe only while a PhotoCraft headless session is open.

1. Call `command_list` first when the available commands are unclear. It returns the app's current command catalog; do not trust remembered command names.
2. Run one command with `command_run`, or several independent commands with `command_batch`.
3. Write every output under the job `out/` directory. Paths outside the write root are rejected.
4. Artifact tools (`render_preview`, `screenshot`) return paths inside `out/`; the client renders them as artifact cards.
5. Destructive commands (overwrite, save-over, print) require an approval card before they run.

Cancellation kills the app process tree. A cancelled job may leave partial files in `out/`; inspect before retrying.
