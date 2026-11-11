# DailyFlow

DailyFlow is a small planner with browser storage, optional SQLite synchronization, dated one-off tasks, recurring daily tasks, JSON backup/restore, and browser notifications while the page is open.

## Run locally

Requirements: Node.js 24.15 or later and npm.

```powershell
npm install
npm run build:css
npm start
```

Open `http://127.0.0.1:3000`. The build generates `public/app.css`, so the page styling does not depend on Tailwind or Google Fonts CDNs at runtime. The font stack uses local system fonts.

## Data and sync

The server stores the complete workspace in `data/dailyflow.sqlite`; the browser keeps a local copy for offline use, syncs edits when the server is reachable, and checks for changes from other open clients every 15 seconds. One-off task progress and due dates persist across days. Routine and class checkmarks reset daily. Recurring task progress and the focus-session count reset daily. If two devices edit the same item at the same time, the latest whole-workspace save wins.

The default server binds to `127.0.0.1`. To let multiple devices reach it on a trusted private network, set `HOST=0.0.0.0` and a random `DAILYFLOW_API_TOKEN` of at least 32 characters. For PowerShell:

```powershell
$serverToken = node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
$env:DAILYFLOW_API_TOKEN = $serverToken
$env:HOST = '0.0.0.0'
Write-Output $serverToken
npm start
```

Enter the printed token in the app's **Server Sync** panel on each device. Put the server behind HTTPS before using it outside a trusted local network. The token protects one shared workspace; the app does not provide separate user accounts or per-user records.

Export and restore backups from the header. Restore replaces the current workspace after a confirmation prompt.

Notifications require browser permission and are checked while the page is open. They are not delivered while the browser or server is closed.

## Browser-flow tests

Install Chromium once, then run the Playwright suite:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = '0'
npx playwright install chromium
npm test
```

The test launcher starts isolated open and token-protected servers with temporary SQLite databases, then cleans them up. Browser tests cover task dates and progress, daily rollover, workspace sync between fresh browser contexts, routine/class/note/journal controls, timer controls, backup restore, imported-data markup safety, narrow mobile layout, and API authorization/validation.

## Deployment notes

The server validates incoming state and binds locally by default. The shared-token option is intentionally simple for a private single-workspace deployment. Use a proper identity provider, per-user authorization, HTTPS, backups, and database migrations before exposing personal data to the public internet.
