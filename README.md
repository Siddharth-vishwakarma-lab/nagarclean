# NagarClean

NagarClean is a static HTML civic sanitation interface with a small Node.js API for staff authentication and complaint workflows.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:4000/`.

## Demo staff login

The server creates this HQ demo account on first start when no HQ account with the configured email exists:

- Email: `admin@nagarclean.demo`
- Password: `Admin@123`
- Role: Headquarters

Zone Office demo account:

- Email: `admin@nagarclean.demo`
- Password: `Zone@123`
- Role: Zone Office, Zone 1

Additional Zone Office demo accounts:

| Zone | Email | Password |
| --- | --- | --- |
| Zone 2 | `zone2@nagarclean.demo` | `Zone2@123` |
| Zone 3 | `zone3@nagarclean.demo` | `Zone3@123` |
| Zone 4 | `zone4@nagarclean.demo` | `Zone4@123` |

The defaults are intended for local demonstration only. Set these variables in Render:

- `DEMO_ADMIN_EMAIL`
- `DEMO_ADMIN_PASSWORD`
- `DEMO_ZONE_EMAIL`
- `DEMO_ZONE_PASSWORD`
- `DEMO_ZONE2_EMAIL` / `DEMO_ZONE2_PASSWORD`
- `DEMO_ZONE3_EMAIL` / `DEMO_ZONE3_PASSWORD`
- `DEMO_ZONE4_EMAIL` / `DEMO_ZONE4_PASSWORD`
- `ALLOWED_ORIGIN` to the deployed URL, for example `https://nagarclean.onrender.com`

The same email can be used once for Headquarters and once for a Zone Office. Duplicate signup is rejected only for the same email and role.

## Public citizen demo login

The main page creates this local demo citizen account in the browser:

- Email: `citizen@nagarclean.demo`
- Password: `Citizen@123`

Citizens must sign in before the report form opens. Public demo accounts and their reports are stored in that browser's local storage.

## Deploy on Render

Use the included `render.yaml` Blueprint, or create a Node Web Service with:

- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/api/health`

## Important production limitation

The prototype stores users and complaints in `data/nagarclean-data.json` and keeps sessions in memory. Render's default filesystem is ephemeral, so data can be lost after a restart or redeploy. Use a database such as Render Postgres and a shared session store before treating this as production infrastructure.

The server blocks public access to the JSON data file and only accepts credentialed cross-origin requests from `ALLOWED_ORIGIN`.
