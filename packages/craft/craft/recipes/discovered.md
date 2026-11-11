# Auto-detected Craft recipe

Use this recipe only while an auto-detected Craft headless session is open.

1. Call `command_list` first when the available commands are unclear. It returns the app's current command catalog; do not trust remembered command names.
2. Run one command with `command_run`, or several independent commands with `command_batch`, when the live catalog advertises them.
3. Write every output under the job `out/` directory. Paths outside the write root are rejected.
4. Destructive commands (overwrite, save-over, print) require an approval card before they run.

Recipes are enabled only after a reviewed registry match. Until then, tools run without this recipe.
