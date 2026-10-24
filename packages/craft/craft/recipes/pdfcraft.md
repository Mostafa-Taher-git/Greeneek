# PdfCraft headless recipe

Use this recipe only while a PdfCraft headless session is open.

1. Call `command_list` to discover the current command catalog. The app was renamed from PrintCraft before v0.2.1; accept `printcraft` as an alias when older notes mention it.
2. Run commands with `command_run` or `command_batch`.
3. Write rendered output under the job `out/` directory. Paths outside the write root are rejected.
4. `render_preview` returns page images inside `out/`; the client renders them as artifact cards.
5. Print and overwrite classes require an approval card before they run.

Cancellation kills the app process tree. A cancelled job may leave partial files in `out/`.
