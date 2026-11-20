"""
My Mac Helper - a tiny MCP server.

It plays the "MCP Services" box from the diagram:
  - Database Service  -> SQLite notes  (add_note, list_notes, search_notes)
  - Web / API Service -> weather API   (get_weather, uses free Open-Meteo, no key)

An MCP host (Claude Desktop, Claude Code, Cursor, your own client.py ...) starts
this file as a subprocess and talks to it over stdin/stdout using the MCP protocol.
"""

import sqlite3
from pathlib import Path

import httpx
from mcp.server.mcpserver import MCPServer

DB_PATH = Path.home() / "mcp-notes.db"   # e.g. /Users/<you>/mcp-notes.db

mcp = MCPServer("my-mac-helper")


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS notes ("
        " id INTEGER PRIMARY KEY AUTOINCREMENT,"
        " text TEXT NOT NULL,"
        " created TEXT DEFAULT CURRENT_TIMESTAMP)"
    )
    return conn


# ---------- Database Service ----------

@mcp.tool()
def add_note(text: str) -> str:
    """Save a note to the local SQLite database."""
    with _db() as conn:
        cur = conn.execute("INSERT INTO notes (text) VALUES (?)", (text,))
    return f"Saved note #{cur.lastrowid}"


@mcp.tool()
def list_notes(limit: int = 10) -> list[dict]:
    """List the most recent notes."""
    with _db() as conn:
        rows = conn.execute(
            "SELECT id, text, created FROM notes ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    return [{"id": r[0], "text": r[1], "created": r[2]} for r in rows]


@mcp.tool()
def search_notes(keyword: str) -> list[dict]:
    """Find notes containing a keyword."""
    with _db() as conn:
        rows = conn.execute(
            "SELECT id, text FROM notes WHERE text LIKE ?", (f"%{keyword}%",)
        ).fetchall()
    return [{"id": r[0], "text": r[1]} for r in rows]


# ---------- Web / API Service ----------

@mcp.tool()
async def get_weather(city: str) -> str:
    """Get the current weather for a city (uses the free Open-Meteo API)."""
    try:
        return await _fetch_weather(city)
    except httpx.HTTPError as e:
        return f"Weather API not reachable right now ({type(e).__name__}). Check your internet."


async def _fetch_weather(city: str) -> str:
    async with httpx.AsyncClient(timeout=10) as http:
        geo = (await http.get(
            "https://geocoding-api.open-meteo.com/v1/search",
            params={"name": city, "count": 1},
        )).json()
        if not geo.get("results"):
            return f"Could not find city '{city}'."
        place = geo["results"][0]
        wx = (await http.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": place["latitude"],
                "longitude": place["longitude"],
                "current": "temperature_2m,wind_speed_10m",
            },
        )).json()["current"]
    return (f"{place['name']}, {place.get('country', '')}: "
            f"{wx['temperature_2m']}°C, wind {wx['wind_speed_10m']} km/h")


if __name__ == "__main__":
    mcp.run()  # stdio transport (what Claude Desktop / Claude Code expect)
