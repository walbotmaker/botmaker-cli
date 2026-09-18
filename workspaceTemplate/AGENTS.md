# Working in this workspace

This folder is a Botmaker workspace, managed by the `bmc` CLI. Every file under
`src/<type>/` is one client action: code that runs on Botmaker's servers, not
here. `bmc run` executes it locally so you can check it before sending it.

| Folder | Type | What it is |
|---|---|---|
| `src/user/` | USER | Code a bot rule runs during a conversation |
| `src/mcp/` | AI_FUNCTION | A TypeScript function the AI can call as a tool |
| `src/whatsappflow/` | WHATSAPP_FLOW | The endpoint behind a WhatsApp Flow |
| `src/webchatforms/` | WEBCHAT_FORM | The endpoint behind a Webchat Form |
| `src/endpoint/` | ENDPOINT | An HTTP endpoint |
| `src/schedule/` | SCHEDULE | A task that runs on a cron schedule |

The `.d.ts` files in this folder describe everything in scope inside a client
action (`flow`, `botmakerAPI`, `User`, `bmconsole`, …). Read the one for the
type you are editing before writing code.

## Checking your work

Always pass `--json`. Then stdout holds one JSON object and nothing else, and
the exit code says what happened: **0 if it worked, 1 if anything failed.**

```bash
bmc run --json src/mcp/ventas/mifn.ts -p myNumber 21
```

```json
{
  "ok": true,
  "type": "AI_FUNCTION",
  "name": "ventas/mifn",
  "durationMs": 34,
  "result": 42,
  "inputSchema": { "type": "object", "properties": { "myNumber": {} } },
  "logs": [{ "level": "log", "message": "what the code printed" }]
}
```

Anything the client action prints goes to `logs`, so it can never break the
JSON. Progress messages and the human-readable output go to stderr.

When it fails, `ok` is false and `error` says why:

```json
{ "ok": false, "error": { "kind": "COMPILE", "code": "TS_COMPILE_FAILED", "message": "..." } }
```

`kind` is `COMPILE` (the TypeScript did not build), `RUNTIME` (the code threw)
or `USAGE` (you asked for something that does not apply). `code` is a stable
string that is never translated — match on it, not on `message`.

## MCP functions: check the contract, not only the result

`--schema` compiles the function and prints the input schema **without running
it**. That schema is built from the JSDoc and the signature, and it is exactly
what the model will see as a tool, so a wrong parameter name or a missing
description shows up here first.

```bash
bmc run --json --schema src/mcp/ventas/mifn.ts
```

The order of the schema's properties is also the order `-p` values are passed
to the function.

## Flows and forms: one screen per run

`flowstate.json` in this folder stands in for what WhatsApp or Webchat would
send: which screen the user is on. Each run answers with `nextScreen` and
rewrites `flowstate.json`, so running the same command again advances to the
next screen.

```bash
bmc run --json src/whatsappflow/alta.js     # INIT      -> screen DATOS
bmc run --json src/whatsappflow/alta.js     # DATOS     -> screen RESUMEN
```

To start over, set `flowstate.json` back to `{"action":"INIT","screen":"","data":{}}`.

`chat.json` and `catalog.json` are the local stand-ins for the chat and the
product catalog, so `botmakerAPI` calls answer from disk instead of production.
Edit them to set up a case.

## Things that will trip you up

- **Only `run` has a meaningful exit code.** `status`, `push`, `pull` and the
  rest still exit 0 when they fail, so read their output.
- **Set `BMC_LANG=en`** if you parse human-readable output: messages otherwise
  follow the machine's language.
- **`--json` does not work on ENDPOINT or SCHEDULE client actions.** Those start
  a local server and never return a single result.
- **`push` and `publish` send code to Botmaker** and affect the live bot. Ask
  before running either.
- **Do not edit `.bmc` by hand.** It is the CLI's record of which file belongs
  to which remote client action.
