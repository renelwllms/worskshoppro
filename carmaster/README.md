## workshopPro Portal

Yellow/black mobile-first React + NestJS stack with staff portal and public QR PWA.
Used by Carmaster. Powered by workshopPro, created by Edgepoint.

### Stack
- Frontend: Vite + React + TypeScript + Tailwind + Recharts + vite-plugin-pwa
- Backend: NestJS + Prisma + PostgreSQL
- Auth: Local (for dev) + Office 365 SSO (restricted to `@carmaster.co.nz`)
- Email: Microsoft Graph send mail for quotes/invoices

### Quickstart
1) Backend env (`backend/.env`):
```
DATABASE_URL="postgresql://<user>:<pass>@<host>:<port>/cma"
JWT_SECRET="set-a-strong-secret"
AZURE_CLIENT_ID=""
AZURE_CLIENT_SECRET=""
AZURE_TENANT_ID=""
AZURE_REDIRECT_URI="https://portal.carmaster.co.nz/api/auth/azure/callback"
GRAPH_SENDER="no-reply@carmaster.co.nz"
PUBLIC_PORTAL_URL="https://portal.carmaster.co.nz"
QUOTE_TOKEN_TTL_HOURS="72"
TWILIO_ACCOUNT_SID=""
TWILIO_AUTH_TOKEN=""
TWILIO_FROM_NUMBER=""
```
2) Create database `cma` on existing Postgres server, then from `backend/`:
```
npm install
npm run prisma:generate
npx prisma migrate deploy          # or prisma migrate dev --name init
npm run prisma:seed
npm run start:dev
```
3) Frontend (`frontend/`):
```
npm install
npm run dev   # VITE_API_URL defaults to http://localhost:3000/api
```

### Features implemented
- Dashboard: current month job count + 12‑month line chart, overdue list
- Jobs: create/search/edit/delete, due-date warning, mobile image upload with type/size guard
- Customers CRM: rego/phone/email storage, quick search, job history
- Quotes: create, email via Graph with approve/decline token links; approved -> draft invoice
- Invoices: create/update, PDF generation, email with PDF link
- Settings: business profile, theme colors, Office 365 config placeholders, editable service categories/checklists (admin role only)
- Public PWA (`/q`): New Repair Job + Regular Service forms, Call Us shortcut, installable PWA; dropdown pulls editable services
- Security: JWT auth, Office 365 SSO, rate limited public routes, input validation, hashed approval tokens, upload file-type/size limits

### Deployment notes
- Reverse proxy (nginx example):
```
server {
  server_name portal.carmaster.co.nz;
  location /api/ {
    proxy_pass http://localhost:3000/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
  location / {
    root /var/www/cmaportal/frontend/dist;
    try_files $uri /index.html;
  }
  location /uploads/ {
    alias /var/www/cmaportal/backend/uploads/;
  }
}
```
- Build frontend: `npm run build` then serve `frontend/dist` (or via `@nestjs/serve-static` pointing to dist).
- Backend runs on port `3000` by default; ensure `DATABASE_URL` points to `cma` database and firewall allows Postgres.
- Microsoft Graph: create Azure AD app (web redirect `.../api/auth/azure/callback`), grant Mail.Send + openid/email/profile, set `GRAPH_SENDER` mailbox; restart backend after updating settings.
- SSL/HTTPS is required for PWA install prompts on production domains.

### Data model
- Prisma schema + generated migration in `backend/prisma/`; seed script creates admin login `admin@carmaster.co.nz` (`ChangeMe123!`) and service categories (Engine Performance, Brake & Ride Control, Safety Systems).

### Testing
- API requests are secured by JWT except public forms/quote decisions which are throttle limited.
- Run `npm run lint` / `npm run build` in each app before deploy.
