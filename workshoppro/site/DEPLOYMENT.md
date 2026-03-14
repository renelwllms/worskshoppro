# EdgePoint WorkshopPro Marketing Site Deployment

## Local runtime
- App root: `/home/epladmin/workshoppro`
- Current port: `5190`
- Bind: `127.0.0.1`

Run manually:
```bash
cd /home/epladmin/workshoppro
cp .env.example .env
npm install
npm start
```

Required `.env` values for demo-request email delivery:
- `MAILGUN_API_KEY`
- `MAILGUN_DOMAIN`
- `DEMO_REQUEST_TO`

Optional:
- `MAILGUN_FROM_EMAIL` defaults to `postmaster@MAILGUN_DOMAIN`
- `MAILGUN_FROM_NAME`
- `MAILGUN_BASE_URL` for EU Mailgun domains

## Nginx Proxy Manager target
In Nginx Proxy Manager, create a Proxy Host pointing to:
- Forward Hostname / IP: `127.0.0.1`
- Forward Port: `5190`
- Scheme: `http`

## Included pages
- `/`
- `/features/`
- `/solutions/`
- `/about/`
- `/faq/`
- `/contact/`
- `/workshop-management-software-nz/`
- `/compare/workshoppro-vs-mechanicdesk/`

## SEO files
- `/robots.txt`
- `/sitemap.xml`
