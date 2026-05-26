# pi-planify

Pi package for reliable scheduled delivery of deferred messages into Pi sessions.

## Concept

`pi-planify` is a global user-level scheduler. A task is still fundamentally a message delivered to a specific Pi session at a future time.

For simple tasks, that message is plain text. For richer tasks, the Pi tool can build the message from structured fields such as objective, context, steps, and acceptance criteria. At delivery time, the message asks the future agent turn to execute the task and report success or failure back into the same session.

If Pi is not open, delivery uses non-interactive Pi:

```bash
pi --session <session-file> -p "<scheduled message>"
```

## Pi surfaces

Slash command:

```text
/planify in 30m "check the test results"
/planify list
/planify cancel <task-id>
/planify install-service
```

LLM tool: `planify`

Supported tool fields:

- `when` — `in 30m`, `in 2h`, or an ISO timestamp
- `message` — plain scheduled message
- `title`
- `objective`
- `context`
- `steps`
- `acceptanceCriteria`

## CLI

```bash
pi-planify add --session <file> --cwd <dir> --at <when> --message <text>
pi-planify list
pi-planify cancel <task-id>
pi-planify run-due
pi-planify install-service
```

`run-due` is intended to be called by the installed systemd user timer.

## Reliability model

- Tasks are stored in a global user queue under `~/.pi/agent/planify/`.
- The systemd user timer uses `Persistent=true`, so missed runs after sleep/reboot are caught up.
- Claimed tasks are recovered if a worker crashes before delivery completes.
- Store writes and per-session deliveries are protected by stale-aware lock directories.
- Delivery status transitions are guarded: scheduled tasks are claimed, then marked delivered or failed.

## Storage

Each task records its target session file, cwd, due time, message, status, attempts, and delivery errors.
