# Source structure

This build keeps the first implementation compact in `src/app/App.jsx` so it is easy to copy into GitHub and deploy immediately.

Recommended next refactor after Supabase:

- `src/layouts` for public/dashboard shells
- `src/pages/appraiser` for appraiser routes
- `src/pages/agent` for agent routes
- `src/features/import`, `market`, `adjustments`, `exports`, `photos`, and `assistant`
- `src/services` for CSV parsing, calculations, PDF export, and Supabase clients
