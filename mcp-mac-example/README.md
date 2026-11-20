# MCP on your Mac — a hands-on example

This folder turns the "What is MCP & How It Works?" diagram into something you can run.

| Diagram box        | In this example                                                  |
|--------------------|------------------------------------------------------------------|
| **AI Agent / Host**  | Claude Desktop or Claude Code (or `client.py` with no AI at all) |
| **MCP Client**     | Built into the host; `client.py` is a hand-written one            |
| **MCP Server / Services** | `server.py` → "my-mac-helper"                              |
| Database Service   | `add_note`, `list_notes`, `search_notes` (SQLite file `~/mcp-notes.db`) |
| Web / API Service  | `get_weather` (free Open-Meteo API, no key needed)                |

```
You ──► Claude Desktop (Host + MCP Client) ──MCP over stdio──► server.py ──► SQLite / Weather API
```

---

## Step 1 — Install the tools (Terminal)

Open **Terminal** (⌘ + Space → "Terminal").

```bash
# Homebrew (skip if `brew --version` already works)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# uv = fast Python + package manager (it installs Python for you)
brew install uv
uv --version
```

## Step 2 — Get this folder

```bash
cd ~
git clone https://github.com/rajphanee/git-course.git
cd git-course
git checkout claude/mac-setup-example-ypg2rn   # or main, once merged
cd mcp-mac-example
```

## Step 3 — Create a Python project and install the MCP SDK

```bash
uv init --bare          # creates pyproject.toml
uv add "mcp[cli]>=2" httpx
```

> The SDK is version 2. In v2 the server class is `MCPServer`
> (`from mcp.server.mcpserver import MCPServer`). Older tutorials use
> `FastMCP` from `mcp.server.fastmcp` — that is the v1 name.

## Step 4 — Read the server (`server.py`)

The whole idea fits in a few lines:

```python
from mcp.server.mcpserver import MCPServer

mcp = MCPServer("my-mac-helper")

@mcp.tool()
def add_note(text: str) -> str:
    """Save a note to the local SQLite database."""
    ...

if __name__ == "__main__":
    mcp.run()   # speaks MCP over stdin/stdout
```

The function name, type hints and docstring become the tool's description,
which is what the AI reads when it decides to call your tool.

## Step 5 — Test it without any AI (`client.py`)

```bash
uv run client.py
```

Expected output:

```
1) Connected to: my-mac-helper
2) Tools the server offers:
   - add_note: Save a note to the local SQLite database.
   - list_notes: List the most recent notes.
   - search_notes: Find notes containing a keyword.
   - get_weather: Get the current weather for a city (uses the free Open-Meteo API).
3) call add_note -> Saved note #1
4) call search_notes('milk') -> {"id": 1, "text": "Buy milk on the way home"}
5) call get_weather('Bangkok') -> Bangkok, Thailand: 31.2°C, wind 9.4 km/h
```

This is steps 2 → 8 of the "How MCP Works" diagram: the client starts the
server, asks which tools exist, calls one, and gets the tool output back.
The only missing part is the AI that chooses the tool. That comes next.

Optional: the visual **MCP Inspector** lets you click through the tools in a browser
(needs Node: `brew install node`):

```bash
uv run mcp dev server.py
```

## Step 6 — Plug it into Claude Desktop (the real "Host")

1. Install Claude Desktop from https://claude.ai/download and sign in.
2. Find the full paths you need:
   ```bash
   which uv        # e.g. /opt/homebrew/bin/uv
   pwd             # e.g. /Users/<you>/git-course/mcp-mac-example
   ```
3. Open the config: **Claude menu → Settings → Developer → Edit Config**.
   This opens `~/Library/Application Support/Claude/claude_desktop_config.json`.
4. Paste this, replacing the two paths with yours:
   ```json
   {
     "mcpServers": {
       "my-mac-helper": {
         "command": "/opt/homebrew/bin/uv",
         "args": [
           "--directory", "/Users/YOUR_NAME/git-course/mcp-mac-example",
           "run", "server.py"
         ]
       }
     }
   }
   ```
   (`claude_desktop_config.example.json` in this folder has the same content.)
5. **Quit Claude Desktop completely (⌘Q)** and open it again.
6. Click the tools/connector icon in the chat box — you should see `my-mac-helper`
   with its 4 tools.

## Step 7 — Talk to it

Try these prompts in Claude Desktop:

- "Save a note: dentist appointment Friday 3pm"
- "What notes do I have about the dentist?"
- "What's the weather in Tokyo? Save it as a note."

Claude asks your permission the first time, then calls your tools.
This is the full 12-step flow from the diagram:

| # | Diagram step       | What actually happens                                      |
|---|--------------------|------------------------------------------------------------|
| 1 | User Query         | You type "What's the weather in Tokyo?"                    |
| 2–4 | Route / Pick Tool | Claude sees the tool list and picks `get_weather`          |
| 5 | Use Tool           | Claude Desktop's MCP client sends `tools/call` to server.py |
| 6–7 | Call API / Result | server.py calls Open-Meteo and gets JSON back              |
| 8 | Tool Output        | server.py returns "Tokyo, Japan: 14°C …"                   |
| 9–10 | Create Reply     | Claude writes an answer using that output                  |
| 11–12 | Answer User     | You see the reply                                          |

(The diagram uses LangGraph + OpenAI GPT as the "brain"; here Claude plays that role.
The MCP server is the same either way — that is the point of a standard.)

## Step 8 (optional) — Use it from Claude Code in Terminal

```bash
claude mcp add my-mac-helper -- uv --directory "$PWD" run server.py
claude mcp list
claude          # then ask: "list my notes"
```

## Step 9 — Add your own tool

Add to `server.py`:

```python
import subprocess

@mcp.tool()
def battery_status() -> str:
    """Show the Mac's battery level."""
    return subprocess.run(["pmset", "-g", "batt"], capture_output=True, text=True).stdout
```

Restart Claude Desktop (⌘Q, reopen) and ask "How much battery do I have?".

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Server doesn't show in Claude Desktop | Use **full** paths (`/opt/homebrew/bin/uv`, `/Users/...`). Fully quit with ⌘Q. |
| Want to see errors | `tail -f ~/Library/Logs/Claude/mcp*.log` |
| JSON error | Check commas/quotes in the config; paste it into https://jsonlint.com |
| `No module named 'mcp.server.fastmcp'` | You have SDK v2 — use `from mcp.server.mcpserver import MCPServer` |
| Never `print()` in server.py | stdout is the MCP channel; printing breaks it. Use `print(..., file=sys.stderr)` |
