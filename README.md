# SIDQ Creative website

Node.js + Express + PostgreSQL. Site content, shorts and applications are stored in the database.

## Deploy on Railway
1. Push this folder's contents to a GitHub repo and deploy it on Railway (New Project > Deploy from GitHub repo).
2. In the same project click + New > Database > Add PostgreSQL.
3. Open your website service > Variables > Add a variable reference > pick `DATABASE_URL` from Postgres.
   (Or add a variable named `DATABASE_URL` with the value `${{Postgres.DATABASE_URL}}`.)
4. Add the variable `ADMIN_PASSWORD` (a long password only you know).
5. Settings > Networking > Generate Domain. Admin is at `/admin`.

Tables are created automatically on first start. No Volume is needed.

## Run on your computer
```
npm install
DATABASE_URL=postgres://user:pass@localhost:5432/sidq ADMIN_PASSWORD=test npm start
```

## Videos and SEO
- Put videos in `public/videos/` (file.mp4 plus file.jpg as the preview image). In admin, add a line like `/videos/file.mp4 | Client name`.
- Optional variable `SITE_URL` (for example https://sidqcreative.com) sets the address used in SEO tags.
- After going live, add your site to Google Search Console and submit `/sitemap.xml`.
- Write blog posts in admin under Blog (SEO). Each post gets its own page at `/blog/your-title`.
