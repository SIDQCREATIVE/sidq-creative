# SIDQ Creative website

Node.js + Express. No database needed. Edits are saved in `content.json`, applications in `leads.json`.

## Deploy on Railway
1. Push this folder to a GitHub repo.
2. Railway: New Project > Deploy from GitHub repo.
3. In Variables, add `ADMIN_PASSWORD` (a long password only you know). Admin login stays off until you set it.
4. Add a Volume, mount it at `/data`, and add the variable `DATA_DIR=/data`. Without this, Railway deletes your edits and applications on every redeploy.
5. Open Settings > Networking > Generate Domain.

## Admin
Go to `/admin`. Edit texts, view numbers, clipper counts, the shorts carousel (paste YouTube Shorts links, one per line, 5 to 100) and read applications.

## Run on your computer
```
npm install
ADMIN_PASSWORD=test npm start
```
Site: http://localhost:3000 and admin: http://localhost:3000/admin
