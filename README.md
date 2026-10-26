# SIDQ Creative website

Node.js + Express + PostgreSQL. One website with four parts:

| Address | What it is |
|---|---|
| `/` | Public website (landing pages, blog, SEO) |
| `/clipper` | Clipper portal: accounts, campaigns, clips, analytics recording, wallet, support |
| `/staff` (also `/admin`) | Staff panel: clip review, payouts, campaigns, people, website content, settings |
| `/connect/setup` | Helper page that lists the exact redirect addresses for the Google, TikTok and Instagram developer apps |

Everything is stored in PostgreSQL (tables are created automatically on first start). No Volume is needed.

---

## 1. Deploy on Railway

1. Push this folder's contents to a GitHub repository. In Railway: New Project > Deploy from GitHub repo.
2. In the same project: + New > Database > Add PostgreSQL.
3. Open your website service > Variables > add `DATABASE_URL` as a reference to the Postgres variable (or the value `${{Postgres.DATABASE_URL}}`).
4. Add the variables from the table below.
5. Settings > Networking > Generate Domain (or add your own domain).

### Variables

Set secrets **only** in Railway Variables. Never paste them in a chat, a file or GitHub.

| Variable | Needed? | What it does |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection (reference from the Postgres service) |
| `ADMIN_PASSWORD` | yes | Long password only you know. Emergency owner login for `/staff` |
| `SITE_URL` | yes | Your address, for example `https://sidqcreative.com` (SEO tags, Discord login, invite links) |
| `SESSION_SECRET` | yes | Long random text. Signs login cookies. Changing it logs everybody out |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | yes | Discord login (see section 2) |
| `OWNER_DISCORD_ID` | yes | Your own Discord user ID. You become the owner the first time you log in |
| `DATA_KEY` | yes | Long random text. Encrypts saved payout details and the saved YouTube / TikTok / Instagram logins. **Set it once and never change it** (if it changes, saved payout details and connections cannot be read any more) |
| `YOUTUBE_API_KEY` | recommended | Free key from Google Cloud (YouTube Data API v3). Reads YouTube views for every account and approves hand-added YouTube accounts by itself |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | optional | "Connect YouTube" button (section 4) |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | optional | "Connect TikTok" button (section 4) |
| `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` | optional | "Connect Instagram" button (section 4). Optional `INSTAGRAM_API_VERSION` (default `v23.0`) |
| `DISCORD_WEBHOOK_STAFF`, `DISCORD_WEBHOOK_PAYOUTS`, `DISCORD_WEBHOOK_CAMPAIGNS` | optional | Posts alerts to your Discord channels |
| `DISCORD_BOT_TOKEN` | optional | For the Discord server bot (later) |
| `DISCORD_REDIRECT_URI` | optional | Only if your Discord redirect is not `SITE_URL/auth/discord/callback` |
| `DISABLE_JOBS` | no | Set to anything to switch off the background jobs (not normally wanted) |
| `PLATFORM_MOCK_URL` | **never in production** | Test-only: sends YouTube / TikTok / Instagram calls to a fake server on this same machine. Ignored for any other address |

Staff panel > Settings > Connections shows which of these are in place (green tick) and which are missing. It never shows a secret value.

---

## 2. Discord login (clippers and staff)

1. discord.com/developers/applications > your application > OAuth2.
2. Add this redirect, exactly: `https://YOUR-DOMAIN/auth/discord/callback`
3. Put `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` in Railway Variables.
4. If the client secret was ever shown to anyone (a chat, a PDF, a screenshot), press **Reset Secret** in the Discord Developer Portal and put the new one in Railway.

Clippers log in at `/clipper`, staff at `/staff`. The owner has every role and every panel. Other staff get one role each (admin, manager, moderator, finance, support) in People > Team, and see only the panels that role allows.

---

## 3. How clips, views and money work

* A clipper connects an account, joins a campaign, posts a clip and pastes its link.
* Staff check the rules and approve. The clip then counts views for the campaign's tracking window (7 days by default).
* **Views are read automatically** when the clip is on a connected account (YouTube, TikTok, Instagram) or is a YouTube clip and `YOUTUBE_API_KEY` is set. Nobody types them in. For other clips staff enter the views from the analytics recording.
* If the campaign asks for audience analytics, the clipper sends a **screen recording** (section 5) after the rules check.
* When the window ends the website pays the clip into the clipper's wallet: `views x rate per 1,000`, with the campaign's minimum views, maximum payout per clip and budget cap. Clips that look suspicious, have analytics to check, or whose views could not be read for more than 36 hours are **not** paid automatically: a person decides.
* The wallet is an append-only ledger in whole cents (USD). Minimum payout is $10 (change it in Settings). Methods: bank transfer, PayPal, USDT, EasyPaisa and JazzCash (shown in PKR at the rate you set).
* Sunday (Asia/Karachi) is a staff day off: campaigns cannot be launched and the portals show a notice. Clippers can still post and submit.

Background jobs (Staff > Settings > Background jobs, each can be run by hand): read views every 20 minutes (Instagram clips every 2 hours), pay finished clips every 10 minutes, check hand-added YouTube accounts every 5 minutes, end finished campaigns every 5 minutes, keep connections healthy every 3 hours, tidy old data once a day.

---

## 4. Connect YouTube / TikTok / Instagram (automatic verification and views)

When a clipper presses **Connect**, they sign in on the platform. That proves the account is theirs, so it is **approved on the spot** (no code in the bio, no waiting for staff), and the website then reads the views of their own videos through the platform's official API. The website can only read the profile and video numbers. It cannot post, delete or see passwords. The login is stored encrypted and is deleted when the clipper removes the account.

The button for a platform appears on the clipper's Accounts page only when its variables are set **and** `DATA_KEY` is set. Without them, clippers still add accounts by hand with the bio code (YouTube is then checked automatically, TikTok and Instagram by staff).

Open `https://YOUR-DOMAIN/connect/setup` to copy the exact redirect addresses. They must match letter for letter (https, domain, path, no slash at the end).

### YouTube (Google Cloud)
1. console.cloud.google.com > create a project > APIs & Services > enable **YouTube Data API v3**.
2. OAuth consent screen: type External. Add the scope `https://www.googleapis.com/auth/youtube.readonly`.
3. Credentials > Create credentials > OAuth client ID > Web application. Add the redirect address from `/connect/setup`.
4. Copy the client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
5. Optional but recommended: Credentials > API key, restricted to YouTube Data API v3, into `YOUTUBE_API_KEY`.
6. While the consent screen is in **Testing**, only the test users you list can connect, and Google makes their login expire after 7 days (the clipper then sees a Reconnect button). To remove both limits, publish the app and complete Google's verification for the read-only YouTube scope.

### TikTok (developers.tiktok.com)
1. Manage apps > Connect an app. Add the products **Login Kit** and **Display API**.
2. Scopes: `user.info.basic`, `user.info.profile`, `user.info.stats`, `video.list`.
3. Login Kit > Redirect URI: the address from `/connect/setup`.
4. Copy the client key and secret into `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET`.
5. Submit the app for review. Until TikTok approves it, only the accounts you add as sandbox / target users can connect.

### Instagram (developers.facebook.com)
1. Create an app (type Business) > add the product **Instagram** > **API setup with Instagram login**.
2. Permissions: `instagram_business_basic` and `instagram_business_manage_insights`.
3. Set: Valid OAuth redirect URI (from `/connect/setup`), **Deauthorize callback URL** `https://YOUR-DOMAIN/connect/instagram/deauthorize`, and **Data deletion request URL** `https://YOUR-DOMAIN/connect/instagram/delete`.
4. Copy the Instagram app ID and secret into `INSTAGRAM_APP_ID` and `INSTAGRAM_APP_SECRET`.
5. Until Meta approves your app (App Review), only Instagram testers you add can connect. Clippers need a **Business or Creator** account (switching is free in the Instagram app). Instagram numbers can be up to 48 hours late.

### Check it with real accounts before you announce it
Each platform's approval is the only part that cannot be tested without them. With your own accounts:
1. Connect each platform from `/clipper#accounts`. The account should show Verified and Connected.
2. Submit one of your own clips. Its views should appear at once ("Tracked automatically").
3. Submit a clip that is **not** yours. It must be refused (TikTok and YouTube) or carry a red "not found on the connected account" warning for staff (Instagram).
4. Remove the app inside the platform's own settings and confirm the clipper sees "Reconnect".

---

## 5. Analytics proof: screen recording

A screenshot can be edited; a continuous recording cannot be edited easily. When staff ask for analytics, the clipper:

* **On a computer:** presses **Record my screen**, picks Entire screen, opens the analytics of the video (username, views, then countries, age and gender) and presses Stop. Needs HTTPS (Railway gives it).
* **On a phone:** uses the phone's own screen recorder (iPhone: Control Center > Screen Recording; Android: Quick settings > Screen record) and uploads the video.

Rules: MP4, MOV or WebM; up to 80 MB per file; up to 2 recordings and 6 files per request (screenshots are still accepted). Staff watch the recording inside the clip page. Recordings are stored in the database and deleted 90 days after the clip is paid or rejected. A 3-minute recording is about 20 to 30 MB, so watch your Railway database size if you have many clippers.

---

## 6. Website content, videos and SEO

* The videos of the home page live in `public/videos/` (`file.mp4` plus `file.jpg` as the preview picture): `raw`, `edited`, `diary-1`, `diary-2`, `lacy-1`, `lacy-2` and `rubio-1`. The `.jpg` previews are in the main zip. The `.mp4` files are big, so they come as two extra zips (`sidq-videos-1.zip`, `sidq-videos-2.zip`). Unzip all three zips into the same folder so `public/videos/` holds all 14 files. If your GitHub repository already has these `.mp4` files in `public/videos/`, keep them and skip the video zips.
* To add a short to the carousel, put its `.mp4` and `.jpg` in `public/videos/`, then in Staff > Website > Page content add a line like `/videos/file.mp4 | Client name` (or paste a YouTube Shorts link).
* `SITE_URL` sets the address used in SEO tags. After going live add your site to Google Search Console and submit `/sitemap.xml`.
* Write blog posts in Staff > Website > Blog. Each post gets its own page at `/blog/your-title`.
* Applications from the home page arrive in Staff > Website > Applications.

## 7. Run on your computer

```
npm install
DATABASE_URL=postgres://user:pass@localhost:5432/sidq ADMIN_PASSWORD=test SESSION_SECRET=anything DATA_KEY=anything npm start
```
Open http://localhost:3000/staff (log in with the password) or /clipper.

## 8. Security notes

* Secrets live only in Railway Variables. Staff Settings shows green/red ticks, never values.
* Logins to YouTube, TikTok and Instagram and payout details are encrypted with `DATA_KEY` (AES-256-GCM).
* Every money, clip, account and people decision by staff is written to the audit log (Staff > Audit log).
* If a platform or Discord secret is ever exposed, reset it in that platform's developer portal and update the Railway variable.
