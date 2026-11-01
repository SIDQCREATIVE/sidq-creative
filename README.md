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
| `YOUTUBE_API_KEY` | recommended | Free key from Google Cloud (YouTube Data API v3). Reads YouTube views for every account, checks that a typed channel exists and approves hand-added YouTube accounts by itself when the code is in the channel description |
| `SCRAPECREATORS_API_KEY` | optional, **paid** | Does the same for TikTok and Instagram accounts that did not sign in: checks the username, finds the code in the bio and reads the views of a video. Read section 4 before you switch it on |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | optional | "Connect YouTube" button (section 5) |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | optional | "Connect TikTok" button (section 5) |
| `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` | optional | "Connect Instagram" button (section 5). Optional `INSTAGRAM_API_VERSION` (default `v23.0`) |
| `DISCORD_WEBHOOK_STAFF`, `DISCORD_WEBHOOK_PAYOUTS`, `DISCORD_WEBHOOK_CAMPAIGNS` | optional | Posts alerts to your Discord channels |
| `DISCORD_BOT_TOKEN` | optional | For the Discord server bot (later) |
| `DISCORD_REDIRECT_URI` | optional | Only if your Discord redirect is not `SITE_URL/auth/discord/callback` |
| `DISABLE_JOBS` | no | Set to anything to switch off the background jobs (not normally wanted) |
| `PLATFORM_MOCK_URL` | **never in production** | Test-only: sends YouTube / TikTok / Instagram calls to a fake server on this same machine. Ignored for any other address |

Staff panel > Settings > Connections shows which of these are in place (green tick) and which are missing. It never shows a secret value.

### Update to a new version (every time, in this order)

1. Unzip the new zip on your computer and open the folder `sidq-creative`. At the top of it are the files `server.js`, `package.json`, `release.json` and `README.md`, and the folders `lib`, `routes` and `public`.
2. In your GitHub repository, upload **everything inside that folder**: all the files and all three folders. Replace the files that have the same name. Do not upload the folder `sidq-creative` itself. Its contents must sit at the top of the repository, next to `package.json`.
3. **Do not skip `server.js`, `package.json` and `release.json`.** They sit at the top, outside the folders, and are the easiest to forget. An old `server.js` next to new folders is what once made the clipper page and Settings say "Something went wrong on our side".
4. Railway deploys by itself after the upload. Wait until the deployment says Success.
5. Open `https://your-domain/version`. You should see two green **OK** lines: "All files are from this release" and "Everything this release needs is in the database".
   * A red **PROBLEM** line names the file that is still old. Upload that file again from the zip and wait for the deployment.
   * "Page not found" means the new files are not live yet. Check that the deployment finished and that the files sit at the top of the repository.
6. Staff > Settings > **Website health** shows the same and the last errors the server had. Your data is never touched by an update. The tables are upgraded by themselves when the server starts.

### If a page says "Something went wrong on our side"

* You (the owner) see the real reason in brackets after that sentence: "(Only the owner sees this: ...)". Staff and clippers only see the friendly sentence. Secrets and passwords are removed from it before it is shown.
* Open `/version` first. Most problems are one old file.
* Staff > Settings > Website health lists the last 10 errors with the time and the address that failed.
* Railway > your service > Deployments > View logs shows the same errors. Copy the last 20 lines when you ask for help. Never copy your variables.

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
* **Views are read automatically** when the clip is on a connected account (YouTube, TikTok, Instagram), or is a YouTube clip and `YOUTUBE_API_KEY` is set, or is a TikTok / Instagram clip and the data service key is set (section 4). Nobody types them in. For any other clip staff enter the views from the analytics recording.
* If the campaign asks for audience analytics, the clipper sends a **screen recording** (section 6) after the rules check.
* When the window ends the website pays the clip into the clipper's wallet: `views x rate per 1,000`, with the campaign's minimum views, maximum payout per clip and budget cap. Clips that look suspicious, have analytics to check, or whose views could not be read for more than 36 hours are **not** paid automatically: a person decides.
* The wallet is an append-only ledger in whole cents (USD). Minimum payout is $10 (change it in Settings). Methods: bank transfer, PayPal, USDT, EasyPaisa and JazzCash (shown in PKR at the rate you set).
* Sunday (Asia/Karachi) is a staff day off: campaigns cannot be launched and the portals show a notice. Clippers can still post and submit.

Background jobs (Staff > Settings > Background jobs, each can be run by hand): read views every 20 minutes (connected Instagram clips every 2 hours, clips read by the data service as often as you set), pay finished clips every 10 minutes, look for codes in the bios of hand-added accounts every 5 minutes, end finished campaigns every 5 minutes, keep connections healthy every 3 hours, tidy old data once a day.

---

## 4. Accounts and views without the clipper signing in

Two things happen by themselves, with only the keys you set in Railway (no clipper has to sign in):

1. **The username is checked at once.** A username that does not exist is refused with a clear message, and nothing is saved.
2. **The account is approved when the code is in the bio.** The clipper gets a short one-time code (`SIDQ-XXXXXX`), pastes it anywhere in the bio (YouTube: channel description) and the website finds it. **A correct name alone is never enough**: anyone can type anybody's username, so a name proves nothing. Only the owner of an account can change its bio, so the code is the proof. (The other proof is the Connect button of section 5.)

Then the views of every clip posted from that account are read by the website, again and again while the clip is tracked, and once more right before it is paid.

| | YouTube | TikTok | Instagram |
|---|---|---|---|
| Key you set | `YOUTUBE_API_KEY` (free) | `SCRAPECREATORS_API_KEY` (paid) | `SCRAPECREATORS_API_KEY` (paid) |
| Username that does not exist | refused at once | refused at once | refused at once |
| Private account | n/a | refused (it must be public) | refused (it must be public) |
| Account approved | code in the channel description | code in the bio | code in the bio |
| Views of a clip | read automatically | read automatically | read automatically |
| Who posted the video | checked (channel id) | checked (author must be the clipper's account) | checked (owner or co-author must be the clipper's account) |

The website looks for the code when the clipper presses **Check now**, and in the background every 9 minutes during the first 2 hours, then every 12 hours, for 3 days. Staff can still approve or reject any account by hand (Staff > Accounts). A staff rejection cannot be undone by the clipper: they ask for a new code with "Send for review again". The same real TikTok or Instagram account cannot be verified for two clippers. A username that somebody typed but never proved (no code found, no clips) stops blocking after 24 hours, so it cannot keep the real owner out.

### The data service for TikTok and Instagram (optional, paid)

TikTok has no official key that reads other people's videos, and Instagram's official way needs every clipper to sign in. So for TikTok and Instagram the website can use **ScrapeCreators** (scrapecreators.com), a service that reads **public** TikTok and Instagram pages and returns the bio, the follower count, who posted a video and its views. One key does both platforms.

Please read this before you switch it on:

* It is a third-party **paid** service (at the time of writing about $47 for 25,000 requests, and a new account gets 100 free requests to test). Check their current prices.
* It is **not an official API**. It reads public pages, so it can be slow, wrong, or stop working if TikTok or Instagram change or block something. Using such a service may go against the platforms' terms of use. That is your decision as the owner.
* Connect (section 5) is free and exact and is the better way. A clipper who signs in never uses the data service, except as a fallback when their login has expired.
* Without the key nothing breaks: TikTok and Instagram accounts are checked by your team and views come from the screen recordings, as before.

**Switch it on**
1. Create an account at scrapecreators.com and copy the API key.
2. Railway > your service > Variables: add `SCRAPECREATORS_API_KEY`. Never paste the key in a chat, a file or GitHub.
3. Staff > Settings > **TikTok and Instagram data service** > **Test the key**. It looks up two public accounts (2 requests) and must show a green line for TikTok and for Instagram. If a line is red, the message says why (wrong key, no credits left, or an answer the website cannot read).
4. Set the **daily request limit** (default 3,000; 0 pauses the service) and **read each clip again every N hours** (default 6) in the same card.

**What it costs.** One request for each of these: a username lookup when a clipper adds an account, each look for a code, each clip when it is submitted, each re-read of a clip, and one last read right before a clip is paid. A clip tracked for 7 days with the default 6 hours is about 30 requests. So 1,000 clips in progress cost roughly 30,000 requests a week, about $56 at the price above. The daily limit stops a surprise bill. Background jobs use at most 90% of it, so a clipper can always add an account or submit a clip with the rest.

**When it fails, nothing wrong is approved or paid**
* An answer that cannot be read is an error, never a guess. No account is approved and no clip is paid from it.
* Key refused, credits ended, service busy or daily limit reached: the service pauses and Settings says why. Clippers can still add accounts (checked later) and submit clips (accepted with a red warning for staff, and read automatically once the service works again, or a person types the views from the analytics recording).
* A video must be posted by the clipper's own account. A video of another account is refused. When the service does not say who posted it, staff get a warning instead of views.
* A clip whose views could not be read for more than 36 hours is never paid automatically.
* A video that cannot be read is tried again only after the wait you set, and a clip that is waiting for a person never costs a request.

**Check it with your own accounts before you announce it.** The website was tested against a simulated copy of the service built from its documentation. The real answers can differ, TikTok video views most of all. That is why the Test button exists and why an unreadable answer is an error.
1. Settings > Test the key: green for both.
2. As a clipper add your own TikTok (and Instagram) username by hand. It must say "Found @you, N followers". Paste the code in your bio and press Check now: the account is verified.
3. Add a username that does not exist: it must be refused.
4. Submit one of your own videos: its views appear at once. Submit a video of another account: it must be refused.
5. Approve the clip in Staff > Clips, then press **Read views from TikTok now** (or Instagram) on it: the views update. Watch the "Requests today" number in Settings while you do this.

---

## 5. Connect YouTube / TikTok / Instagram (automatic verification and views)

When a clipper presses **Connect**, they sign in on the platform. That proves the account is theirs, so it is **approved on the spot** (no code in the bio, no waiting for staff), and the website then reads the views of their own videos through the platform's official API. The website can only read the profile and video numbers. It cannot post, delete or see passwords. The login is stored encrypted and is deleted when the clipper removes the account.

The button for a platform appears on the clipper's Accounts page only when its variables are set **and** `DATA_KEY` is set. Without them, clippers still add accounts by hand with the bio code. The website checks that code by itself for YouTube (with `YOUTUBE_API_KEY`) and for TikTok and Instagram (with the data service of section 4). Where it cannot, staff check the code.

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

## 6. Analytics proof: screen recording

A screenshot can be edited; a continuous recording cannot be edited easily. When staff ask for analytics, the clipper:

* **On a computer:** presses **Record my screen**, picks Entire screen, opens the analytics of the video (username, views, then countries, age and gender) and presses Stop. Needs HTTPS (Railway gives it).
* **On a phone:** uses the phone's own screen recorder (iPhone: Control Center > Screen Recording; Android: Quick settings > Screen record) and uploads the video.

Rules: MP4, MOV or WebM; up to 80 MB per file; up to 2 recordings and 6 files per request (screenshots are still accepted). Staff watch the recording inside the clip page. Recordings are stored in the database and deleted 90 days after the clip is paid or rejected. A 3-minute recording is about 20 to 30 MB, so watch your Railway database size if you have many clippers.

---

## 7. Website content, videos and SEO

* The videos of the home page live in `public/videos/` (`file.mp4` plus `file.jpg` as the preview picture): `raw`, `edited`, `diary-1`, `diary-2`, `lacy-1`, `lacy-2` and `rubio-1`. The `.jpg` previews are in the main zip. The `.mp4` files are big, so they come as two extra zips (`sidq-videos-1.zip`, `sidq-videos-2.zip`). Unzip all three zips into the same folder so `public/videos/` holds all 14 files. If your GitHub repository already has these `.mp4` files in `public/videos/`, keep them and skip the video zips.
* To add a short to the carousel, put its `.mp4` and `.jpg` in `public/videos/`, then in Staff > Website > Page content add a line like `/videos/file.mp4 | Client name` (or paste a YouTube Shorts link).
* `SITE_URL` sets the address used in SEO tags. After going live add your site to Google Search Console and submit `/sitemap.xml`.
* Write blog posts in Staff > Website > Blog. Each post gets its own page at `/blog/your-title`.
* Applications from the home page arrive in Staff > Website > Applications.

## 8. Run on your computer

```
npm install
DATABASE_URL=postgres://user:pass@localhost:5432/sidq ADMIN_PASSWORD=test SESSION_SECRET=anything DATA_KEY=anything npm start
```
Open http://localhost:3000/staff (log in with the password) or /clipper.

## 9. Security notes

* Secrets live only in Railway Variables. Staff Settings shows green/red ticks, never values.
* Logins to YouTube, TikTok and Instagram and payout details are encrypted with `DATA_KEY` (AES-256-GCM).
* The data service key stays on the server. Settings shows only whether it is on, the requests used today and the credits left, never the key.
* Every money, clip, account and people decision by staff is written to the audit log (Staff > Audit log).
* `/version` is public on purpose. It only says OK or PROBLEM and names files; it shows no secret, no number of users and no money. The real reason for an error is sent only to the owner, with every key, token and password removed first.
* If a platform or Discord secret is ever exposed, reset it in that platform's developer portal and update the Railway variable.
