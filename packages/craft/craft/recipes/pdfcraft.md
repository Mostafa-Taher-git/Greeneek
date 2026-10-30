# PdfCraft MCP recipe

Use this recipe only while a PdfCraft session is open.

1. Call `command_list` first when the command catalog is unclear; the mounted `mcp__pdfcraft__*` tools come from the app's own MCP server.
2. Create a PDF from a PDF, image, or text file with `doc_create_multiple` and an absolute `out` path under the job `out/` directory.
3. Inspect with `doc_open`, `doc_info`, `text_extract`, `text_find`, and `page_render`; edit with `doc_save`, `doc_export_images`, page tools, and `command_run`.
4. Write every output under the job `out/` directory. Paths outside it are rejected.
5. Destructive commands (overwrite, save-over, print) require an approval card before they run.

Cancellation kills the app process tree. A cancelled job may leave partial files in `out/`.