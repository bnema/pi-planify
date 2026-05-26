# pi-planify

`pi-planify` is a global user-level scheduler task planifier plugin for Pi (Linux/systend only).

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
