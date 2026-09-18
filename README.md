## How to install botmaker-cli
- Run `npm i -g @botmaker.org/botmaker-cli`

---

## Commands

| Command | Alias | Description |
|---|---|---|
| `bmc import <apiToken>` | `bmc i` | Import a workspace from an API token |
| `bmc new <name>` | `bmc n` | Create a new client action (see flags below) |
| `bmc run <file>` | `bmc r` | Run a client action locally |
| `bmc push [name]` | | Push local changes to Botmaker |
| `bmc pull [name]` | | Pull remote changes |
| `bmc publish <name>` | | Publish a client action |
| `bmc status [name]` | `bmc s` | Show change status |
| `bmc diff <name> <code>` | `bmc d` | Diff local vs remote |
| `bmc rename <name> <newName>` | | Rename a client action |
| `bmc set-schedule <name> <cronString>` | | Set the cron schedule on a SCHEDULE type CA |

### `bmc new` flags

| Flag | Description | Folder |
|---|---|---|
| _(none)_ | Regular user client action | `src/user/` |
| `-e` / `--endpoint` | HTTP endpoint | `src/endpoint/` |
| `-a` / `--ai-function` | AI/MCP function (TypeScript) | `src/mcp/` |
| `-w` / `--whatsapp-flow` | WhatsApp Flow endpoint | `src/whatsappflow/` |
| `-f` / `--webchat-form` | Webchat Form endpoint | `src/webchatforms/` |
| `-S "0 * * * *"` / `--schedule-ca` | Scheduled task (5-field cron expression) | `src/schedule/` |

### Folders

A client action's name carries its folder tree, and the first segment is its
type: `user/ventas/promos/miFn` is the file `src/user/ventas/promos/mifn.js`.

```bash
bmc new ventas/promos/miFn          # -> src/user/ventas/promos/mifn.js
bmc new ventas/otro -a              # -> src/mcp/ventas/otro.ts
bmc rename ventas/promos/miFn stock/miFn
```

Older client actions whose name has no folders live at the root of their type
folder, and stay that way until you move them.

Moving files in your editor works too: `bmc status` shows them as moved and
`bmc push` renames them on the platform. Moving a whole folder is simply every
client action inside it moving at once.

Two rules the CLI enforces:

- A file cannot be moved into another type's folder. Moving a file never
  changes a client action's type, so `bmc push` offers to move it back and
  refuses the whole push if you decline. It lists every misplaced file at once,
  not one per run.
- The same file name in two different folders is fine.

If you move and rename a file at the same time, the CLI still finds it: it
matches the file by content, the way git detects renames. An exact match to the
published code or to your draft is followed silently; something merely similar
is reported and `bmc push` asks before renaming anything on the platform. With
no interactive terminal — CI, a piped command — nothing is ever assumed: the
push stops and tells you what it found.

---

## Running MCP / AI Function CAs locally

MCP CAs are TypeScript files in `src/mcp/` that export a default async function. The runner compiles the TypeScript, infers parameter names from the function signature, and calls the function with the values you supply via `-p`.

### Running

```bash
bmc run src/mcp/myFunction.ts
```

### Passing parameters

Use `-p <paramName> <paramValue>` for each parameter. Parameter names must match the function's TypeScript parameter names:

```bash
bmc run src/mcp/myFunction.ts -p city "New York" -p units "metric"
```

Multiple `-p` flags are supported. Parameter values are always passed as strings — cast inside the function if needed.

### Setting user variables

Use `-v <varName> <varValue>` to inject values into `User.get()` / `User.set()` context:

```bash
bmc run src/mcp/myFunction.ts -p query "hello" -v userId "abc123"
```

### Example CA

```typescript
/**
 * Looks up weather for a city
 * @param city - City name to query
 * @param units - Temperature units: "metric" or "imperial"
 */
export default async function getWeather(city: string, units: string) {
  return { city, units, temperature: 22 };
}
```

The output is printed as formatted JSON:

```json
{
  "city": "New York",
  "units": "metric",
  "temperature": 22
}
```

### Flags

| Flag | Description |
|---|---|
| `-p <name> <value>` | Pass a named parameter to the function |
| `-v <name> <value>` | Set a user variable accessible via `User.get()` |
| `--volatile` | Skip persisting state to `context.json` after the run |

---

## Running WhatsApp Flow and Webchat Form CAs locally

WHATSAPP_FLOW and WEBCHAT_FORM client actions are driven by a JSON payload that simulates what WhatsApp / Webchat sends to the endpoint. The runner reads from **`flowstate.json`** in your workspace root and automatically updates it after each run.

### flowstate.json

```json
{
  "action": "INIT",
  "screen": "",
  "data": {}
}
```

| Field | Type | Description |
|---|---|---|
| `action` | `"INIT"` \| `"data_exchange"` \| `"BACK"` | `INIT` — flow/form just opened. `data_exchange` — user submitted a screen. `BACK` — user navigated back (screen has `refresh_on_back: true`). |
| `screen` | `string` | Name of the screen the user is leaving. Required when `action` is `data_exchange` or `BACK`. Leave empty for `INIT`. |
| `data` | `object` | The payload sent by the flow/form JSON — usually the user's input for the current screen. |

### Running

```bash
bmc run src/whatsappflow/my_flow.js
bmc run src/webchatforms/my_form.js
```

The runner prints:
- `→ nextScreen: SCREEN_NAME` — the screen the CA wants to navigate to
- `→ flow finished (SUCCESS)` — no nextScreen set, flow/form ends
- `→ data: { ... }` — the data passed to the next screen (or back to Botmaker variables on the last screen)

After each successful run, `flowstate.json` is automatically updated so the next `bmc run` picks up where the flow left off. When the flow finishes (no `nextScreen`), it resets to `INIT` automatically.

### Testing multi-screen flows

Just keep running `bmc run` — `flowstate.json` tracks the current screen automatically. To test user input for a screen, edit the `data` field in `flowstate.json` before running.

WHATSAPP_FLOW and WEBCHAT_FORM CAs can call `saveScreenData()` to persist payload between screens and `loadPrevScreenData()` to retrieve it. Locally, this is stored in `.bmc-screendata.json` in your workspace root.

### botmakerAPI in local runs

`botmakerAPI` uses local files instead of making live HTTP calls on every run:

| Method | Local behaviour |
|--------|----------------|
| `getChat()` | Reads from `chat.json`. If missing, fetches once from the live API and saves it. |
| `updateChat(update)` | Merges changes into `chat.json` locally — never calls the API. |
| `getProducts(catalogId, skus)` | Reads from `catalog.json` (keyed by `catalogId`). If the catalog is missing, fetches once from the live API and saves it. |

To force a fresh fetch from the API, delete `chat.json` or `catalog.json`. To restart a flow from the beginning, set `flowstate.json` back to `INIT` by hand — the `bmc reset` command no longer exists.

---
