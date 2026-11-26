# Live Reply Assistant

You open this app during a conversation. It listens to the other person (in their language), checks your background notes and documents, and shows you **what they said** in English and **what to say back** in plain words. It never says "according to the document". It talks like a normal person.

## How to use it
1. **Knowledge:** type some background about yourself or your business and click **Save background**. Click **Browse files…** to add documents (PDF, Word .docx, TXT, CSV). They are saved on the server.
2. **Languages:** pick the language they speak and the language you want your reply in. Tick *Also show my reply in their language* if you want to read it out in their language.
3. Click **Start**. The other person talks. After about a second of quiet, a card shows:
   - **They said:** the meaning in English
   - **You say:** the reply to speak (prices and numbers come from your documents)
   - **Note:** a private hint, for example when the answer isn't in your documents
4. While **you** are talking, press **I'm talking** (or the Space key) so your own voice is ignored. Press it again when you're done.
5. Click **Stop** to stop listening and cancel any reply that's still being written.

You can also type or paste what they said into the box and press Enter.

## Run it
Requires Node 20+ and an Anthropic API key.

```bash
cd live-reply-assistant
npm install
ANTHROPIC_API_KEY=sk-ant-... npm start
# open http://localhost:3000 in Chrome or Edge
```

Optional settings (environment variables):
| Variable | What it does |
|---|---|
| `ANTHROPIC_API_KEY` | Required. Your Claude API key. |
| `APP_PASSWORD` | Asks for a password before anyone can open the app. **Set this when you host it.** |
| `PORT` | Port to listen on (default 3000). |
| `CLAUDE_MODEL` | Model to use (default `claude-opus-5-5`). |

## Host it
Any host that runs Node or Docker works (Render, Railway, Fly.io, a VPS, etc.):

```bash
docker build -t live-reply-assistant .
docker run -p 3000:3000 -e ANTHROPIC_API_KEY=sk-ant-... -e APP_PASSWORD=choose-one -v $(pwd)/data:/app/data live-reply-assistant
```

Things to know:
- **Use HTTPS.** Browsers only give microphone access on `https://` sites (or `localhost`). Most hosts give you HTTPS automatically.
- **Use Chrome or Edge.** Live listening uses the browser's built-in speech recognition. Firefox doesn't support it, and Safari support is limited. In Chrome, the audio is sent to Google's speech service to turn it into text.
- Documents are stored in `data/knowledge.json`. Mount that folder (as above) so they're kept when you restart.
- Scanned PDFs (photos of pages) have no text to read. Use text-based PDFs, Word files or TXT.
