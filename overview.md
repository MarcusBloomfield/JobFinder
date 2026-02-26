# Project Overview (LLM Context)

## What this project is
`WebJobFinder` is a full-stack TypeScript app that:
1. Uploads and parses a resume (`.pdf`/`.docx`).
2. Uses an LLM to generate job search terms.
3. Scrapes job listings from job sites.
4. Scores each job against the resume.
5. Displays ranked matches in a React UI.

## High-level architecture
- Frontend: React + TypeScript + Webpack (`/src`, built to `/dist`).
- Backend: Express + TypeScript (`/backend/src`).
- Transport: Frontend calls backend at `http://localhost:5000/api`.
- Data contracts: shared shape (duplicated interfaces) for `Resume` and `Job`.

## Runtime flow
1. User uploads resume in UI (`ResumeUploader`).
2. Frontend sends multipart file to `POST /api/resume/parse`.
3. Backend extracts text (`pdf-parse` or `mammoth`) and returns `Resume`.
4. Frontend calls `POST /api/openai/generate-search-terms`.
5. Backend uses Gemini service to produce search terms.
6. Frontend calls `POST /api/scrape/jobs` with terms + sites + location.
7. Backend scrapes jobs (currently implemented for Seek config) via Puppeteer/Cheerio.
8. Frontend calls `POST /api/openai/evaluate-job-matches-bulk`.
9. Backend scores each job with Gemini and returns match scores.
10. Frontend sorts jobs by score and renders cards.

## Important directories and files
- Root frontend entry: `src/index.tsx`, `src/App.tsx`
- Frontend state orchestration: `src/hooks/useJobSearch.ts`
- Frontend services:
  - `src/services/resumeParserService.ts`
  - `src/services/scrapeService.ts`
  - `src/services/openAiService.ts`
- Backend server: `backend/src/server.ts`
- Backend routes:
  - `backend/src/routes/resumeRoutes.ts`
  - `backend/src/routes/scrapeRoutes.ts`
  - `backend/src/routes/openaiRoutes.ts`
- Backend controllers:
  - `backend/src/controllers/resumeController.ts`
  - `backend/src/controllers/scrapeController.ts`
  - `backend/src/controllers/openaiController.ts`
- Backend services:
  - `backend/src/services/resumeParserService.ts`
  - `backend/src/services/scrapeService.ts`
  - `backend/src/services/geminiService.ts`
- Models:
  - `src/models/Resume.ts`, `src/models/Job.ts`
  - `backend/src/models/Resume.ts`, `backend/src/models/Job.ts`

## API surface
- Health:
  - `GET /api/health`
- Resume:
  - `POST /api/resume/parse` (multipart field: `file`)
- Scraping:
  - `POST /api/scrape/site`
  - `POST /api/scrape/jobs`
- AI (route name still `openai`):
  - `POST /api/openai/generate-search-terms`
  - `POST /api/openai/evaluate-job-match`
  - `POST /api/openai/evaluate-job-matches-bulk`

## Environment and config
- Frontend assumes backend URL is hardcoded to `http://localhost:5000/api`.
- Backend env vars:
  - `PORT` (default `5000`)
  - `NODE_ENV`
  - `GEMINI_API_KEY` (required for AI features)
- Note: legacy docs/scripts still mention `OPENAI_API_KEY`, but runtime AI service is Gemini.

## Local run commands
- Root:
  - `npm start` (frontend dev server)
  - `npm run dev` (frontend + backend concurrently)
- Backend:
  - `cd backend && npm run dev`
  - `cd backend && npm run build`
  - `cd backend && npm run test:gemini`

## Current implementation realities (important for agents)
- Naming mismatch:
  - Route/service names use `openai*`, but implementation uses Gemini (`geminiService.ts`).
- Scraping site support mismatch:
  - Controllers allow `seek`, `indeed`, `linkedin`, but backend `siteConfigs` currently only defines `seek`.
  - Calling unsupported configured sites can fail in backend and trigger frontend fallback behavior.
- Fallback-heavy frontend:
  - Frontend services include mock fallbacks if backend calls fail (resume parse, scrape, scoring).
  - This can mask backend failures during manual testing.
- Default location mismatch:
  - Hook default is `"Australia"` while service/controller defaults often use `"Perth, WA"`.
- Encoding artifacts:
  - Some backend logs contain mojibake characters in console strings.

## Development notes for LLM contributors
- Prefer changing both frontend and backend model interfaces together.
- Keep route names stable unless updating all frontend service URLs.
- If modernizing AI integration, choose one naming scheme (`openai` vs `ai`/`gemini`) and migrate consistently.
- If expanding scraping, add site config in backend service and keep controller validation aligned.
- Avoid relying on frontend fallback paths for verification; validate backend responses explicitly.

## Quick sanity checklist
1. Backend up on `:5000` and health endpoint responds.
2. Resume upload succeeds and extracted text is non-empty.
3. Search terms endpoint returns array of strings.
4. Scrape endpoint returns non-empty jobs for configured site(s).
5. Bulk score endpoint returns `{ id, matchScore }[]`.
6. UI shows sorted jobs with visible match percentages.
