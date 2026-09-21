# AgenDial

A small centralized outbound calling app. Advisors do not receive a batch of clients in advance. Every client sits in one shared pool, and the backend assigns the next available client only when an advisor is ready to work.

Linphone Desktop places the actual SIP call. This app never stores SIP usernames, passwords, or other telephony credentials.

## What it does

1. Admin signs in and creates advisor (or extra admin) accounts.
2. Admin uploads a client CSV into the shared **Available** pool.
3. An advisor signs in. If they already have an **In Progress** client, that client is restored. Otherwise the server atomically claims the next available client.
4. The advisor sees every phone number for that one client, clicks **Call**, and Linphone starts the call.
5. After each call the advisor must save a result. History is kept; the phone row also stores the latest result.
6. When every number for the client has feedback, the client becomes **Completed** and the server claims the next available client automatically.

Two advisors can never receive the same client. Assignment happens in a SQLite `BEGIN IMMEDIATE` transaction with `UPDATE ... WHERE status = 'available'`.

## Stack

- Node.js 20+ and Express
- SQLite via `better-sqlite3` (single process, WAL mode)
- Vanilla HTML/CSS/JavaScript

Run a **single Node process** against the SQLite file. Multiple app replicas on one SQLite file are not supported. The data layer is ordinary SQL, so moving to PostgreSQL later is straightforward if you need multi-instance deploys.

## Setup

```bash
cd click-to-call-linphone
npm install
```

Create an environment file:

```bash
cp .env.example .env
```

Minimum values:

```bash
PORT=3000
DATABASE_PATH=./data/app.db
SESSION_SECRET=replace-with-a-long-random-string
ADMIN_USERNAME=admin
ADMIN_PASSWORD=choose-a-strong-password
```

Create the first admin and start the server:

```bash
export ADMIN_USERNAME=admin
export ADMIN_PASSWORD='choose-a-strong-password'
export SESSION_SECRET='replace-with-a-long-random-string'
npm run seed
npm start
```

Open [http://localhost:3000](http://localhost:3000) and sign in.

On a fresh database, `npm start` can also create the first admin if `ADMIN_PASSWORD` is set and no users exist yet.

## Tests

```bash
npm test
```

The suite covers:

- Linphone URI construction and injection rejection
- Concurrent client claiming over HTTP and across separate SQLite connections
- Admin vs advisor permissions
- Restore-on-refresh, mandatory feedback, auto-completion, auto-claim, and return-to-pool

## Docker

The deployable unit is `docker-compose.yml` plus `Dockerfile`. One service, `web`, listens on port 3000. SQLite is stored in the named volume `agendial-data`, mounted at `/app/data`. Do not add a bind mount. A named volume survives redeploys and can be backed up from Dokploy. Keep a single replica: several processes must not write the same SQLite file.

Local run:

```bash
cp .env.example .env
# set SESSION_SECRET, ADMIN_USERNAME, and ADMIN_PASSWORD
docker compose up --build
```

Open http://localhost:3000. `ADMIN_PASSWORD` creates the first admin only when the database is empty. Changing it later does not update that user.

## Dokploy

Push this repository, including `Dockerfile`, `docker-compose.yml`, and `.dockerignore`.

1. In a Dokploy project, choose **Create Service** → **Compose**. Do not create an Application or a Database.
2. **General:** GitHub provider, this repository and branch, Compose type **Docker Compose** (not Stack), Compose path `docker-compose.yml`.
3. **Environment.** Dokploy writes these next to the compose file as `.env`, which the service loads:

```bash
SESSION_SECRET=a-long-random-string-different-from-local
ADMIN_USERNAME=admin
ADMIN_PASSWORD=choose-a-strong-password
```

`PORT`, `NODE_ENV`, and `DATABASE_PATH` are already set in the compose file. Do not add a volume in the Dokploy UI.

4. **Domains** → **Add Domain**. Service `web`, port `3000`, your host, HTTPS on. Point the DNS record at the Dokploy server. Traefik labels are added by Dokploy; do not write them into the compose file.
5. **Deploy.**

The production database starts empty. Create advisors and import the CSV in the admin UI. Linphone stays on each advisor's computer, not on the server.

On the next deploy, the app migrates `/app/data/app.db` before it serves traffic. Existing clients move into an active campaign named **Importación inicial**. Users, phone numbers, assignments, and call history stay. Copy the `agendial-data` volume in Dokploy before that deploy. If the migration finds a repeated account, it stops and leaves the file unchanged.

To change the architecture later, edit `docker-compose.yml`, push, and deploy again. Keep the volume name `agendial-data` if the SQLite file should be preserved.

Advisors must use a desktop browser on a machine that has Linphone installed. Click-to-call will not work from a phone.

## Linphone configuration

Official URI handler reference:

[https://wiki.linphone.org/xwiki/wiki/public/view/Linphone/URI%20Handlers%20(Desktop%20only)/](https://wiki.linphone.org/xwiki/wiki/public/view/Linphone/URI%20Handlers%20(Desktop%20only)/)

This app uses the **recommended** Linphone-specific scheme so the OS opens Linphone rather than some other softphone:

```text
sip-linphone:0996006236?linphone-action=call
```

The `+` is URL-encoded (`%2B`) when the link is generated. The helper is `callWithLinphone(phoneNumber)` in `public/js/linphone.js`, backed by `src/lib/phone.js`.

On each advisor workstation:

1. Install [Linphone Desktop](https://www.linphone.org/).
2. Add the SIP account **inside Linphone**. Do not put SIP credentials in this web app.
3. Select that SIP account as the **active account**. Phone numbers without a domain are turned into SIP URIs using the active account. If no account is selected, Linphone may open but not dial.
4. Confirm the OS associates `sip-linphone:` links with Linphone. Installing Linphone Desktop normally registers this handler.
5. Allow the browser to open `sip-linphone` links when prompted.

The SIP registrar, proxy, and codecs stay in Linphone. This app only launches the approved URI.

## Usage

### Admin

- **Users** — create Admin or Advisor accounts, activate/deactivate, reset passwords.
- **CSV import** — upload a file, name the campaign, map name/id and phone columns, import. Each file becomes its own campaign. The first campaign is active. Later ones stay inactive until an admin activates them. Duplicate `client_id` values inside the same campaign are skipped. The same id can exist in another campaign. Clients with no valid phone numbers are skipped.
- **Campaigns** — one campaign is active. Advisors only receive new clients from that campaign. Activating another one does not take away a client already in progress.
- **Client pool** — counts plus a table for the selected campaign (the active one by default): Available / In Progress / Completed, current advisor, and phone progress.
- **Client details** — extra fields, phone state, full call-attempt history. **Return to pool** clears assignment for an In Progress client and does not delete history.

A sample file is included: `sample-clients.csv`.

Accepted CSV columns can vary. At minimum map:

- a name or client identifier
- one or more phone columns

Phone numbers are stored as separate rows, not as `phone_1` / `phone_2` fields.

The operational extract (`NUMERO`, `CLIENTE`, `Cuenta Contrato`, `numeros_contacto`) maps automatically:

- `CLIENTE` is the name
- `Cuenta Contrato` is the client id. Inside one campaign each contract is one queue item, so importing that campaign's file again does not duplicate it
- `NUMERO` and every value inside `numeros_contacto` become separate phone rows. Values split on `|`
- `0995606551`, `995606551`, and `+593995606551` are stored and dialed as `0995606551`. The local PBX rejects the `+593` form.
- rows with no usable number are skipped
- cédula, address, canton, and debt stay on the client and are visible while calling

Feedback is saved per phone number after each call, including when one client has many contact numbers.

### Advisor

The advisor works from one screen:

1. Sign in.
2. The current client is restored, or the next Available client from the active campaign is claimed.
3. Click **Call** on a number. Linphone comes to the foreground and dials.
4. Choose a result (`No contesta`, `Contestó`, `Número equivocado`, `Volver a llamar`, `No interesado`, `Interesado`, `Desconectado / inválido`) and save.
5. Repeat for every number.
6. The client completes and the next client appears. The advisor never picks a client id.

If the pool is empty, the screen shows: **No hay clientes disponibles.**

## Data model

- `users` — hashed passwords (`bcrypt`), role `admin` | `advisor`
- `campaigns` — one import each. Only one row can be active
- `clients` — `available` | `in_progress` | `completed`, campaign, assigned advisor, extra CSV fields as JSON
- `phone_numbers` — one row per number, latest status/result
- `call_attempts` — append-only history per call

An advisor can have at most one `in_progress` client (enforced by a partial unique index).

## API

| Method | Path | Who |
| --- | --- | --- |
| POST | `/auth/login` | public |
| POST | `/auth/logout` | signed in |
| GET | `/api/me` | signed in |
| POST | `/api/admin/users` | admin |
| GET | `/api/admin/users` | admin |
| PATCH | `/api/admin/users/:id` | admin |
| POST | `/api/admin/import/preview` | admin |
| POST | `/api/admin/import/commit` | admin |
| GET | `/api/admin/clients` | admin |
| GET | `/api/admin/clients/summary` | admin |
| GET | `/api/admin/clients/:id` | admin |
| POST | `/api/admin/clients/:id/return-to-pool` | admin |
| GET | `/api/advisor/current-client` | advisor (restore or claim) |
| POST | `/api/advisor/claim-next-client` | advisor (restore or claim) |
| POST | `/api/advisor/phone-numbers/:id/attempt` | advisor who owns the client |

The backend chooses the next client. Advisors cannot submit an arbitrary client id to take someone from the pool.
