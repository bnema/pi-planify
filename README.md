# pi-planify

Pi package for reliable scheduled delivery of deferred messages into Pi sessions.

## Concept

`pi-planify` is a global user-level scheduler. A task is just a message that should be delivered to a specific Pi session at a future time.

At the due time, the worker sends the scheduled message back into the recorded session. If Pi is not open, delivery uses non-interactive Pi:

```bash
pi --session <session-file> -p "<scheduled message>"
```

## Planned surfaces

```text
/planify in 30m "check the test results"
/planify list
/planify cancel <task-id>
/planify install-service
```

CLI:

```bash
pi-planify add --session <file> --cwd <dir> --at <when> --message <text>
pi-planify list
pi-planify cancel <task-id>
pi-planify run-due
pi-planify install-service
```

## Storage

Tasks are stored in a global user queue under:

```text
~/.pi/agent/planify/
```

Each task records its target session file, cwd, due time, message, status, attempts, and delivery errors.

## Status

Early MVP implementation in progress.
