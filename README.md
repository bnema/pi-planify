# pi-planify

`pi-planify` schedules follow-up messages for Pi sessions.

It supports two delivery modes:

- **Live delivery** for reminders created from an open Pi session with `/planify` or the `planify` tool. The reminder returns as a visible user message in that session.
- **Headless delivery** for tasks created with the `pi-planify` CLI. The worker starts a non-interactive Pi process for the target session.

## Scheduling from Pi

Use `/planify` when you want the reminder to come back into the session you are using now.

```text
/planify in 30m "check the test results"
/planify every 1h "check the test results"
/planify in 10m every 1h max 5 "check the test results"
/planify list
/planify cancel <task-id>
/planify install-service
```

The LLM can also schedule reminders with the `planify` tool. Supported fields:

- `when` — `in 30m`, `in 2h`, or an ISO timestamp. Optional when `every` is set.
- `every` — recurring interval like `30m`, `1h`, or `1d`. Without `when`, the first run happens after one interval.
- `maxRuns` — maximum successful deliveries for a recurring task. Omit to repeat until cancelled.
- `message` — plain scheduled message.
- `title`, `objective`, `context`, `steps`, `acceptanceCriteria` — structured task fields.

Live tasks are tied to the session file that scheduled them. The Pi extension delivers due live tasks while that session is open. If the session is closed at the due time, the task remains scheduled and is delivered when the session is opened again.

## Scheduling from the CLI

Use the CLI when you want a background worker to run the task without an open Pi TUI.

```bash
pi-planify add --session <file> --cwd <dir> --at <when> --message <text>
pi-planify add --session <file> --cwd <dir> --every 1h --max-runs 5 --message <text>
pi-planify list
pi-planify cancel <task-id>
pi-planify run-due
pi-planify install-service
```

CLI `add` creates headless tasks. `run-due` delivers due headless tasks by running:

```bash
pi --session <session-file> -p "<scheduled message>"
```

`install-service` installs a systemd user timer that runs `pi-planify run-due` every minute.

## Delivery behavior

- Live delivery uses the active Pi extension and `pi.sendUserMessage(...)`.
- Headless delivery uses `pi-planify run-due` and a non-interactive `pi -p` process.
- Each delivery first claims a scheduled task, then marks it delivered or failed.
- Live and headless delivery use the same per-session lock, so deliveries for the same session are serialized.
- Recurring tasks are rescheduled only after successful delivery.
- Failed recurring tasks stay failed instead of looping silently.
- `maxRuns` counts successful deliveries only.

## Storage and recovery

Tasks are stored in a global user queue under `~/.pi/agent/planify/`.

Each task records its target session file, cwd, due time, message, delivery mode, status, attempts, recurrence settings, successful run count, and delivery errors.

Claimed tasks are recovered if a live session or headless worker exits before delivery completes. The systemd timer uses `Persistent=true`, so missed headless runs after sleep or reboot are caught up.
