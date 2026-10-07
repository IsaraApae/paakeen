# ป้าคีน

A LINE chatbot that records income and expenses, with a web app for summaries and charts. Type "กาแฟ 60", send a slip, a voice note or a PDF, and it's recorded. It runs free on Cloudflare Workers (with a D1 database) and Gemini's free tier.

- `src/index.js`: the bot (LINE webhook, Gemini, reminders, chat menu) and the web app's API
- `public/index.html`: the web app, opened from the LINE chat menu
- `make-menu.py`: draws the chat menu image (`public/menu.jpg`)
- `test.mjs`: end-to-end check against a mock LINE and Gemini (`node test.mjs`)

## Setup

1. Create a LINE Messaging API channel and a Gemini API key.
2. `npx wrangler d1 create paakeen`, then put the database id in `wrangler.toml`, and set `APP_ORIGIN` to your worker's URL.
3. `npx wrangler secret put LINE_CHANNEL_SECRET`, then the same for `LINE_CHANNEL_ACCESS_TOKEN` and `GEMINI_API_KEY`.
4. `npx wrangler deploy`, then set the LINE webhook URL to `https://<your worker>/webhook`.
