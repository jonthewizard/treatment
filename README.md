# Treatment Studio

AI-powered music video treatment generator. Paste lyrics → get directional ideas → full treatment → storyboard → export to PDF.

## Stack

- **Next.js 16** (App Router, TypeScript)
- **Tailwind CSS v4**
- **Claude** via Anthropic API (proxied through `/api/claude`)
- **EB Garamond** + **JetBrains Mono** via `next/font`

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Add your Anthropic API key
cp .env.local.example .env.local
# then edit .env.local and set ANTHROPIC_API_KEY=sk-ant-...
# Optional: ANTHROPIC_MODEL or CLAUDE_MODEL overrides the Claude snapshot (defaults to Claude Opus 4.7). Try another slug from Anthropic docs if you see intermittent API 500 errors.

# 3. Run dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Workflow

| Stage | What happens |
|-------|-------------|
| 01 Input | Enter artist, title, genre, runtime, and full lyrics with `[Section]` labels |
| 02 Ideas | Claude generates 4 directional angles — pick one or skip |
| 03 Treatment | Full treatment: title, logline, synopsis, tone, visual style, palette, characters, locations, section beats |
| 04 References | Character and location reference cards with generative placeholder visuals |
| 05 Storyboard | Shot-by-shot breakdown tied to lyric sections |
| 06 Export | Printable/PDF document — covers all stages in one paginated layout |

Progress is auto-saved to `localStorage`.

## Project Structure

```
app/
  layout.tsx          # Font setup, metadata
  page.tsx            # Root state machine (stage router)
  globals.css         # Tailwind + theme tokens
  api/claude/
    route.ts          # Anthropic API proxy (keeps key server-side)

components/
  ui/                 # Primitives: Field, Btn, Loader, Block, Frame, RefCard, ShotCard
  stages/             # One file per workflow stage

lib/
  claude.ts           # genIdeas / genConcept / genStoryboard
  prompts.ts          # System prompts
  lyrics.ts           # Section parser
  storage.ts          # localStorage persistence

types/
  index.ts            # All shared TypeScript interfaces
```
