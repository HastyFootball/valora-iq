# ValoraIQ Platform Rebuild

A Vite + React rebuild of ValoraIQ as a premium real estate intelligence workspace.

## Includes

- Public landing page
- Login/signup prototype screens
- Persona-specific Appraiser and Agent/Broker dashboards
- Real routing with React Router
- Project workspace UI
- CSV import with PapaParse
- Active/Pending/Sold market snapshot
- Appraiser adjustment grid and reconciliation placeholders
- Agent seller presentation, net sheet, and renovation ROI flows
- AI workflow assistant placeholder
- Photo management placeholder
- Premium dark visual system aligned to the ValoraIQ logo

## Run locally

```bash
npm install
npm run dev
```

## Deploy to Vercel

Push this folder to GitHub and import it into Vercel. Vercel will run `npm run build` and serve the `dist` folder.

## Notes

Auth, database persistence, billing, and team accounts are intentionally stubbed until Supabase is added.
