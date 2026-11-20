"""
A minimal MCP client - shows the protocol flow from the diagram with no LLM:

  MCP Client --(start server, handshake)--> MCP Server
  MCP Client --(list tools)---------------> MCP Server
  MCP Client --(call tool)----------------> MCP Server --(call API / DB)--> External
  MCP Client <-(tool output)--------------- MCP Server

In a real app an LLM (Claude, GPT, a LangGraph agent...) decides WHICH tool to
call with WHICH arguments. Here we hard-code those choices so you can see each step.

Run:  uv run client.py
"""

import asyncio
import sys
from pathlib import Path

from mcp import Client, StdioServerParameters

SERVER = StdioServerParameters(
    command=sys.executable,                       # same Python as this script
    args=[str(Path(__file__).with_name("server.py"))],
)


def text_of(result) -> str:
    return "\n".join(c.text for c in result.content if hasattr(c, "text"))


async def main() -> None:
    async with Client(SERVER) as client:
        print("1) Connected to:", client.server_info.name if client.server_info else "server")

        tools = await client.list_tools()
        print("2) Tools the server offers:")
        for t in tools.tools:
            print(f"   - {t.name}: {t.description}")

        print("3) call add_note ->", text_of(await client.call_tool(
            "add_note", {"text": "Buy milk on the way home"})))
        print("4) call search_notes('milk') ->", text_of(await client.call_tool(
            "search_notes", {"keyword": "milk"})))
        print("5) call get_weather('Bangkok') ->", text_of(await client.call_tool(
            "get_weather", {"city": "Bangkok"})))


if __name__ == "__main__":
    asyncio.run(main())
