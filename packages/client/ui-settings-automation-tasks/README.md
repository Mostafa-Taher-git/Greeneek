# @greeneek/gnk-client-ui-settings-automation-tasks

Automation tasks settings section: status tabs (Enabled/Paused/Ended/All),
search, a New split button (Create in a session / Create manually), per-tab
empty states, a manual-create form, and task rows with pause/resume/run/delete.
All data comes from the Host `automation` Remote; product copy is localized in
zh/en/ar.

## Model Experience

This package adds no model-visible text and no tokens. It presents Host-owned
task state only.

## Known Limitations and Deferred Work

- Automatic time-based delivery is not yet wired; the create form records a
  schedule and `run now` records a manual run.
