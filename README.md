# SI Project Command Center

A lightweight, private project tracker that runs entirely inside your own Google account. Built with **Google Apps Script**, with **Google Sheets** as the database and **Google Drive** for file storage. No servers, no third-party services, no build step.

## Features

- Multiple projects with type, status, priority, stack, repo, local path, constraints, "where I left off" and next action
- Per-project **phases** (roadmap with reordering), **problems**, **pending** items, **deferred** items and **notes** (pinnable)
- **Documents** tab: upload files (up to 15 MB) to Drive or attach links, replace versions, categorise
- **Resume brief**: one click generates a Markdown summary to paste into a new AI chat
- Global search (press `/`), status filters, stale-project highlighting, archive before delete
- Dark UI, responsive layout, keyboard friendly

## How it works

| Layer | Implementation |
|-------|----------------|
| Backend | `Code.gs` – CRUD API, input validation, `LockService` for safe concurrent writes |
| Database | A Google Sheet auto-created on first run (tabs: `Projects`, `Items`, `Docs`) |
| Files | A Drive folder auto-created on first run, one subfolder per project |
| Frontend | `Index.html` + `Styles.html` + `JavaScript.html` (vanilla JS, no dependencies) |

IDs of the sheet and folder are stored in **Script Properties**, so no secrets or IDs live in the code.

## Install (manual)

1. Go to [script.google.com](https://script.google.com) → **New project**.
2. Create files matching `src/`: `Code.gs`, `Index.html`, `Styles.html`, `JavaScript.html`. Paste the contents of each.
3. Project Settings → enable **Show "appsscript.json" manifest file**, then paste `src/appsscript.json`.
4. **Deploy → New deployment → Web app** (Execute as: *Me*, Who has access: *Only myself*).
5. Open the web app URL and authorise access. The data sheet and Drive folder are created automatically.

## Install (with clasp)

```bash
npm install -g @google/clasp
clasp login
cp .clasp.json.example .clasp.json   # then put your own scriptId inside
clasp push
clasp deploy
```

## Privacy and security

- Deployed as **Only myself** by default; all data stays in your Drive.
- Requested scopes: Sheets and Drive (needed to create the data sheet and store files).
- If you open access to other people, they would read and write *your* sheet and Drive, since the app runs as the deploying user.
- User content is HTML-escaped on render, and links are limited to `http(s)`.

## Limitations

- Upload size capped at 15 MB (base64 transfer through Apps Script).
- Designed for personal or small-scale use; Sheets is not a high-concurrency database.
- Deleting a project moves its Drive folder to trash; deleting sheet rows is permanent.

## Project structure

```
src/
  Code.gs          backend
  Index.html       page shell
  Styles.html      CSS
  JavaScript.html  frontend logic
  appsscript.json  manifest
```

## License

[MIT](LICENSE) © 2026 Shahinur Islam
