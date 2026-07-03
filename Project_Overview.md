# Project Overview — JobFinder (LLM Context Document)

> **Purpose:** This file gives an LLM contributor everything needed to understand and continue work on this project without reading every source file. Keep it up to date when making significant structural changes.

---

## What This Project Is

**WebJobFinder** is a full-stack TypeScript application that helps job seekers find relevant listings. The user uploads a resume (PDF or DOCX), the app generates search terms via Google Gemini, scrapes job listings from job boards using Playwright, scores each job against the resume using Gemini, and displays ranked results with match percentages in a React UI.

## Current Implementation Notes

- Human intervention handoffs are handled by `src/components/HumanInterventionPanel.tsx`.
- The component is mounted globally in `src/App.tsx`, polls `/api/interventions/pending`, and opens a modal dialog only when pending handoffs exist.
- Human intervention handoffs can show repeated-question saved-answer suggestions, collect approved answers, apply them to the live generic adapter page on Continue, and optionally save them for future reuse. Sensitive categories are stored as manual-approval-only and cannot be marked for automatic reuse from the UI.
- Saved application answers are managed on the Profile page through `src/components/SavedFormAnswersManager.tsx`, backed by `/api/saved-form-answers`.
- The old inline Progress-page handoff panel was removed; resolving a handoff refreshes application tracking.
- Auto-apply now has an optional distance limit in the Profile page. The user sets a home address/current location plus max kilometres; manual and bulk auto-apply skip jobs outside that range or jobs whose location cannot be resolved.
- OpenAI-backed LLM features default to `gpt-5.4`; environment variables such as `APPLY_AGENT_MODEL`, `COVER_LETTER_MODEL`, and `PROFILE_FILL_MODEL` can still override specific flows.
- Auto-apply handles SEEK's stable first job page and choose-documents page with deterministic Playwright logic before asking the LLM. The document page uploads the selected resume and generated cover-letter DOCX through Playwright file payloads, so cover-letter upload target detection no longer depends on screenshots or native file picker dialogs.
- SEEK auto-apply treats any URL containing `apply/success` as a submitted application before final-review checks.
- Auto-apply now writes a separate `application_runs` SQLite row for each browser attempt, linked to the existing `job_applications` row. Runs track platform, status, current step/URL, latest error, screenshot path, and snapshot path.
- Paused and failed auto-apply runs persist diagnostics under `backend/.playwright/application-runs/<run-id>/`, including screenshot, HTML, visible text, structured page snapshot, detected fields, AI decision, URL/platform/adapter/step, and error stack where available.
- Application run records are exposed through `/api/application-runs`, including diagnostics, current URL/status/platform, screenshot/snapshot links, artifact URLs, and the matching linked human intervention status. Human intervention records store `applicationRunId` and expose linked artifact URLs.
- The Progress page now includes an application run status summary and `ApplicationRunViewer` in the details modal for current/past browser attempts, screenshots, failures, and intervention state.
- Application platform detection lives in `backend/src/services/applicationPlatformService.ts`. It detects seek, linkedin, employmenthero, greenhouse, lever, workday, smartrecruiters, bamboohr, ashby, pageup, successfactors, taleo, and falls back to `generic`.
- `applicationAgentService.ts` is the apply orchestrator. It creates tracked applications/runs, detects platform, enforces `APPLY_AGENT_ALLOWED_PLATFORMS`, selects the adapter, passes `APPLY_AGENT_REQUIRE_FINAL_REVIEW`, maps adapter statuses back to frontend-compatible results, and finalizes tracking.
- Auto-apply now defaults `APPLY_AGENT_REQUIRE_FINAL_REVIEW` to false when unset. The SEEK LLM should only create `review_required` handoffs when automation cannot continue, such as captcha, MFA/login, unsupported legal declarations, or missing required information.
- Job search now targets Seek, LinkedIn, and Employment Hero from the frontend and backend. Backend scraping runs the selected sites in parallel per search term, then dedupes and applies the requested total job limit.
- Seek and LinkedIn each have search URL construction covered by `backend npm run test:job-search-sites`; LinkedIn pagination uses site-specific next controls.
- The Resume section has login buttons for Seek, LinkedIn, and Employment Hero. `/api/apply/login/:platform` opens a Playwright-controlled persistent profile for each platform.
- Fully automatic apply has a user-selectable match percentage threshold in the job list header. The value is saved in browser local storage under `jobfinder.autoApplyMatchThreshold` and defaults to the previous 60% cutoff.
- Application adapter contracts live in `backend/src/services/applicationAdapters/types.ts`. The registry in `applicationAdapters/adapterRegistry.ts` currently registers `seek`, `linkedin`, `employmenthero`, and `generic`; unsupported known ATS platforms route to `generic` until dedicated adapters are added. LinkedIn and Employment Hero use site-profile safe form adapters for login/CAPTCHA handoff, resume upload, profile fields, question pages, sensitive/unknown question review, and forced final-review pause before submit.

---

## Technology Stack

### Frontend
| Technology | Version | Role |
|---|---|---|
| React | 19 | UI framework |
| TypeScript | 5.8 | Type safety |
| Webpack | 5 | Bundler |
| Babel | 7 | Transpilation |
| Axios | 1.9 | HTTP client |
| react-dropzone | 14 | File upload UI |
| react-modal | 3 | Modal dialogs |
| uuid | — | ID generation |

### Backend
| Technology | Version | Role |
|---|---|---|
| Express.js | 4 | Web server |
| TypeScript | 5.8 | Type safety |
| Node.js | 20 | Runtime |
| Playwright | 1.60 | Browser automation / scraping |
| Cheerio | 1 | HTML parsing |
| Multer | 1.4 | File upload handling |
| pdf-parse | 1.1 | PDF text extraction |
| mammoth | 1.9 | DOCX parsing |
| @google/generative-ai | 0.24 | Gemini API client |
| dotenv | 16.4 | Environment variables |
| Morgan | 1.10 | HTTP logging |
| cors | 2.8 | CORS middleware |

---

## Directory Structure

```
JobFinder/
├── src/                            # Frontend (React + TypeScript)
│   ├── index.tsx                   # React DOM entry point
│   ├── App.tsx                     # Root component, hash-routed Search / Profile / Progress pages
│   ├── components/
│   │   ├── ResumeUploader.tsx      # Drag-drop file upload
│   │   ├── ApplicationProfilePanel.tsx # Common application answers page/card
│   │   ├── SearchTerms.tsx         # Display/edit generated search terms
│   │   ├── LocationSelector.tsx    # Location picker with presets
│   │   └── JobList.tsx             # Job cards with match scores
│   ├── hooks/
│   │   └── useJobSearch.ts         # Single hook — ALL app state lives here
│   ├── models/
│   │   ├── Resume.ts               # Resume interface (shared shape)
│   │   └── Job.ts                  # Job interface (shared shape)
│   ├── services/
│   │   ├── resumeParserService.ts  # Calls POST /api/resume/parse
│   │   ├── scrapeService.ts        # Calls POST /api/scrape/jobs
│   │   └── openAiService.ts        # Calls POST /api/openai/* (Gemini)
│   └── styles/
│       ├── main.css
│       └── App.css
│
├── backend/
│   ├── src/
│   │   ├── server.ts               # Express app setup, middleware, route mount
│   │   ├── routes/
│   │   │   ├── resumeRoutes.ts
│   │   │   ├── scrapeRoutes.ts
│   │   │   └── openaiRoutes.ts
│   │   ├── controllers/
│   │   │   ├── resumeController.ts
│   │   │   ├── scrapeController.ts
│   │   │   └── openaiController.ts
│   │   ├── services/
│   │   │   ├── resumeParserService.ts  # pdf-parse + mammoth
│   │   │   ├── scrapeService.ts        # Playwright + Cheerio, human-like delays
│   │   │   ├── geminiService.ts        # Gemini API calls
│   │   │   ├── llmSandboxService.ts    # Sanitization, rate-limit, retry, fallback
│   │   │   └── openaiService.ts        # Legacy — not actively used
│   │   ├── models/
│   │   │   ├── Resume.ts
│   │   │   └── Job.ts
│   │   ├── types/
│   │   │   └── mammoth.d.ts            # Mammoth type declarations
│   │   └── test-gemini.ts              # Manual Gemini integration test script
│   ├── dist/                           # Compiled JS output
│   ├── uploads/                        # Temp storage for uploaded files (auto-deleted)
│   ├── package.json
│   ├── tsconfig.json
│   └── .env                            # GEMINI_API_KEY lives here
│
├── public/
│   └── index.html                  # Webpack HTML template
├── dist/                           # Frontend build output
├── package.json                    # Root — frontend deps + concurrency scripts
├── tsconfig.json                   # Root TS config (targets ES5, DOM + ESNext)
├── webpack.config.js               # Entry: src/index.tsx → dist/bundle.js, port 3001
├── setup-backend.js                # One-shot backend init script
├── overview.md                     # This file
└── README.md
```

---

## Data Models

### Resume
```typescript
{
  id: string;
  fileName: string;
  fileType: 'pdf' | 'docx';
  content: string;                    // Full raw text
  skills?: string[];
  experience?: string[];
  education?: string[];
  generatedSearchTerms?: string[];    // Populated by Gemini
}
```

### Job
```typescript
{
  id: string;
  title: string;
  company: string;
  description: string;
  url: string;
  location?: string;
  salary?: string;
  datePosted?: string;
  matchScore?: number;                // 0–100, assigned by Gemini
  isFavorite?: boolean;
}
```

### JobDetails
```typescript
{
  employerName: string;
  employerContactName: string;
  employerContactEmail: string;
  employerContactNumber: string;
  jobTitle: string;
  jobLocation: string;
  suburbOrPostcode: string;
  applicationMethod: '' | 'seek' | 'company_website' | 'linkedin' | 'employmenthero' | 'email' | 'recruiter' | 'referral' | 'other';
  applicationSubmittedDate: string;  // YYYY-MM-DD
  interviewedForJob: boolean;
  employedForJob: boolean;
}
```

> **Tracked applications** now persist a `jobDetails` payload in SQLite and expose it through the Progress modal for manual completion and editing. When core fields are missing, the modal can also rehydrate company, location, and description from the original job listing.

> **Progress stats** now focus on funnel counts the user can maintain from the Progress page: jobs applied for, interviewed for, and employed for.

> **Auto-apply cover letters** are generated inside the SEEK adapter (`backend/src/services/applicationAdapters/seekAdapter.ts`), kept short/warm, cleaned deterministically, written to a DOCX artifact, and uploaded with the `upload_cover_letter` action. The adapter is explicitly blocked from typing cover-letter or motivation text directly into website fields; if a site only accepts typed cover-letter text, it requests human review.

> **Cover letter examples** can be uploaded from the front-page Resume section as PDF/DOCX files. `POST /api/cover-letter-examples/parse` extracts text and saves the examples in the browser-saved `ApplicationProfile`; auto-apply sends up to three examples to the cover-letter generator as style-only references.

> **Auto-apply resumes** are selected from user-uploaded resumes only. `applicationAdapters/seekAdapter.ts` ranks the active resume plus stored uploaded resumes by job relevance and uses the best original upload as the active resume. `applicationAgentService.ts` owns run/tracking orchestration around the selected adapter. No tailored/generated resume file is created for auto-apply. The tracked application stores the exact uploaded resume filename and full resume text snapshot so Progress and Profile can show what was actually used for each job.

> **Auto-apply distance checks** are implemented in `src/services/jobDistanceService.ts` and `backend/src/services/jobDistanceService.ts`. `ApplicationProfile` stores `homeAddress` and `maxAutoApplyDistanceKm`; if a max distance is set, auto-apply only proceeds when the job location can be resolved and is within range. Remote jobs are allowed.

> **Human intervention** is wired through SQLite-backed `/api/interventions/*` routes and the Progress page panel. When the apply agent reaches a review-required stop, it creates a pending intervention linked to the exact `applicationRunId`, exposes diagnostic artifacts in the handoff dialog, keeps the browser session open, and resumes/skips/fails based on the user action.

> **Application runs** are persisted by `backend/src/services/applicationRunTrackingService.ts` in the shared SQLite database. Statuses are `running`, `waiting_for_user`, `ready_for_review`, `submitted`, `skipped`, and `failed`; this keeps attempt diagnostics separate from final `job_applications` records.
> `backend/src/controllers/applicationRunController.ts` and `backend/src/routes/applicationRunRoutes.ts` expose run listing/detail/cancel APIs for frontend polling and debug views.
> Run platform values come from `backend/src/services/applicationPlatformService.ts`; use `npm run test:platform-detection --prefix backend` for a focused smoke check.

> **Profile Fill with AI** is available on the Profile page. It sends stored parsed resumes plus the current browser-saved profile to `POST /api/apply/profile/fill`, where `applicationProfileFillService.ts` asks OpenAI to extract only resume-supported fields and preserve existing profile values unless the resume explicitly replaces them.

> **Note:** Models are duplicated across `src/models/` and `backend/src/models/`. Keep them in sync when changing the shape.

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Server status check |
| POST | `/api/resume/parse` | Parse uploaded resume (`multipart/form-data`, field: `file`) |
| POST | `/api/cover-letter-examples/parse` | Parse uploaded cover letter example (`multipart/form-data`, field: `file`) |
| POST | `/api/scrape/site` | Scrape a single job site |
| POST | `/api/scrape/jobs` | Scrape multiple sites across multiple search terms |
| POST | `/api/openai/generate-search-terms` | Generate search terms from resume via Gemini |
| POST | `/api/openai/evaluate-job-match` | Single job match evaluation |
| POST | `/api/openai/evaluate-job-matches-bulk` | Bulk scoring (batched, retried, with fallback) |
| POST | `/api/apply/profile/fill` | Fill the saved application profile from stored parsed resumes using AI |
| POST | `/api/apply/login/:platform` | Open a persistent login browser for `seek`, `linkedin`, or `employmenthero` |
| GET | `/api/application-runs` | List application run attempts, optionally filtered by `applicationId` or `status` |
| GET | `/api/application-runs/:id` | Get one application run with diagnostics, artifacts, and latest intervention status |
| POST | `/api/application-runs/:id/cancel` | Cancel an active run by marking it skipped |
| POST | `/api/applications/:applicationId/enrich` | Refresh missing tracked application metadata from the original listing |
| PATCH | `/api/applications/:applicationId/job-details` | Save persisted employer/application details for a tracked job |
| GET | `/api/interventions/pending` | List pending auto-apply handoffs for the Progress page |
| POST | `/api/interventions/:id/continue` | Resume a paused auto-apply run |
| POST | `/api/interventions/:id/skip` | Skip a paused auto-apply run |
| POST | `/api/interventions/:id/fail` | Mark a paused auto-apply run failed |

---

## Runtime Flow (Step-by-Step)

### 1. Resume Upload
- `ResumeUploader` → multipart `POST /api/resume/parse`
- `resumeParserService` extracts text with `pdf-parse` (PDF) or `mammoth` (DOCX)
- Regex-based extraction of skills, experience, education sections
- Temp file in `backend/uploads/` deleted immediately after parsing
- Returns `Resume` object

### 2. Generate Search Terms
- Auto-triggered after successful parse
- `POST /api/openai/generate-search-terms` with resume content
- `llmSandboxService` sanitizes input (max 12 000 chars, PII redacted)
- `geminiService` calls `gemini-2.5-flash` at temperature 0.1
- Returns 5–8 search terms as JSON array
- Displayed in `SearchTerms` component — user can edit before searching

### 3. Scrape Jobs
- User clicks "Search Jobs" (or submits custom terms)
- `POST /api/scrape/jobs` with `{ searchTerms, sites, location, pageLimit }`
- Backend runs each selected site in parallel for a search term, then moves to the next term
- Each site scrape: Playwright launches Chromium, uses human-like delays, random UA and scrolling, then Cheerio extracts jobs
- Results deduplicated by `title + company`
- Current implementation searches Seek, LinkedIn, and Employment Hero, running selected sites in parallel per search term before deduping and applying the total job limit.

### 4. Bulk Score Jobs
- `POST /api/openai/evaluate-job-matches-bulk` with all jobs + resume
- Processed in batches of 3 concurrent Gemini calls
- Each call: sanitize → Gemini evaluate → validate score (0–100 finite number)
- Retry: up to 2 retries with exponential backoff (750ms base, capped at 60s)
- Fallback: token-overlap heuristic if all retries fail
- Returns `{ id, matchScore }[]`

### 5. Display Results
- Jobs sorted descending by `matchScore`
- Color coding: ≥80% green, 60–79% yellow, <60% red
- Clicking a card opens job URL in new tab
- Visited jobs get visual indicator

### 6. Auto-Apply With Uploaded Resume Selection
- `applyToJob` no longer creates tailored or generated resume files.
- The agent receives the most relevant uploaded resume as `activeResume` plus a `resumeLibrary` of other uploaded resumes.
- Resume uploads use only original user-uploaded files.
- The selected uploaded resume filename and full text snapshot are persisted with the tracked application and shown in the Progress and Profile history views.
- The agent can switch to another uploaded resume when it is materially more relevant for the role.
- The agent receives a per-step checklist so it must verify the active resume, upload/check resume fields, fix validation messages, and avoid `done` while required resume upload work is still visible.
- SEEK job detail apply clicks and the SEEK choose-documents upload step are handled before LLM planning. Snapshot capture also prioritizes upload controls and richer labels so hidden file inputs are included when the LLM still needs structured page context.
- The apply controller does not scrape/enrich the listing during an apply run; the visible browser opens the job URL only from the application agent.
- Review-required stops create human intervention records and wait for Continue Bot, Skip Application, or Mark Failed from the Progress page.
- Each apply attempt creates an `application_runs` record before launching Playwright. The agent updates the run on each step with the current URL plus latest screenshot/snapshot artifacts, then marks it submitted, waiting_for_user, ready_for_review, skipped, or failed.
- `backend/src/services/formExtractionService.ts` extracts visible enabled form controls for the Universal Apply generic adapter, including labels, surrounding text, options, current values, required/visibility state, and stable selector hints.
- `backend/src/services/formMappingService.ts` maps extracted controls to safe applicant data with deterministic rules first. It maps contact/location/link/resume/cover-letter/profile-supported fields, sends legal/work-rights/salary/demographic/availability/certification/degree/clearance/reference/uncertain fields to human review, and only uses OpenAI as a constrained field-key classifier with strict JSON validation.

---

## Environment Variables

### Backend (`backend/.env`)
```env
PORT=5000
NODE_ENV=development
GEMINI_API_KEY=<required>

# Optional LLM sandbox tuning
LLM_TIMEOUT_MS=20000
LLM_MIN_CALL_INTERVAL_MS=60
LLM_MAX_RESUME_CHARS=12000
LLM_MAX_JOB_DESC_CHARS=4000
LLM_MAX_SEARCH_TERMS=8
LLM_MIN_SEARCH_TERMS=5
```

### Frontend
- Backend URL is hardcoded to `http://localhost:5000/api` (not env-configurable)

---

## Running the Project

```bash
# Install all deps and set up backend (first time)
npm run setup-backend

# Full stack dev (frontend on :3001, backend on :5000)
npm run dev

# Frontend only
npm start

# Backend only
cd backend && npm run dev

# Build backend
cd backend && npm run build

# Test Gemini integration
cd backend && npm run test:gemini
```

---

## Key Architectural Patterns

### LLM Sandbox (`llmSandboxService.ts`)
All Gemini calls go through this service:
- **Input sanitization:** strips control characters, redacts emails/phones/URLs, truncates to char limits
- **Rate limiting:** enforces minimum 60ms between calls via promise chain
- **Timeout:** 20s hard limit per call
- **Output validation:** validates search term format/count and score range
- **Retry with backoff:** 2 retries, 750ms base, extracts delay from API error messages
- **Fallback scoring:** token-overlap heuristic when Gemini fails entirely

### Scraping Anti-Detection (`scrapeService.ts`)
- Random 1–5s initial delays
- Random viewport sizes and user agent strings
- Simulated mouse movements and scrolling
- 30–150ms delays between element processing
- Randomized order of search terms and sites

### Frontend Fallback Masks Backend Failures
All three frontend services (`resumeParserService`, `scrapeService`, `openAiService`) include mock data fallbacks that activate silently on backend errors. **This makes it easy to miss backend bugs during manual testing.** Always check backend logs directly.

---

## Known Issues and Gotchas

| Issue | Detail |
|---|---|
| **Route naming mismatch** | Routes/controllers use `openai*` names but implementation uses Gemini. Legacy mentions of `OPENAI_API_KEY` in docs are wrong; `GEMINI_API_KEY` is what's used. |
| **Scraper fragility** | Seek, LinkedIn, and Employment Hero use public page selectors that can break if the sites change markup or require login/challenge flows. |
| **Hardcoded backend URL** | Frontend always points to `http://localhost:5000/api`. No env var override. |
| **Default location mismatch** | `useJobSearch` hook defaults to `"Australia"`, but some service/controller defaults use `"Perth, WA"`. |
| **No persistence** | No database. All state is in-memory per browser session. |
| **No auth** | All endpoints are unauthenticated and public. |
| **Console mojibake** | Some backend log strings contain garbled characters (encoding issue, non-critical). |
| **Duplicate model interfaces** | `Resume` and `Job` interfaces exist in both `src/models/` and `backend/src/models/` — keep them in sync. |

---

## Development Guidelines for LLM Contributors

- **Model changes:** Update both `src/models/` and `backend/src/models/` together.
- **Route renames:** Update all matching frontend service `axios` call URLs if renaming any route.
- **AI naming:** If cleaning up the `openai`/`gemini` naming mismatch, migrate routes, controllers, services, and frontend services in one pass.
- **New scraping sites:** Add a `siteConfig` entry in `backend/src/services/scrapeService.ts` and add the site key to controller validation.
- **Testing backend:** Don't rely on frontend rendered output — the mock fallbacks will lie to you. Test API endpoints directly with curl or a REST client.
- **Gemini model:** Currently `gemini-2.5-flash` (free tier). Changing the model string is in `geminiService.ts`.

---

## Sanity Checklist (End-to-End Verification)

1. `GET /api/health` returns `200`
2. `POST /api/resume/parse` with a real PDF returns non-empty `content`
3. `POST /api/openai/generate-search-terms` returns an array of 5–8 strings
4. `POST /api/scrape/jobs` with `sites: ["seek", "linkedin", "employmenthero"]` returns deduped jobs
5. `POST /api/openai/evaluate-job-matches-bulk` returns `{ id, matchScore }[]` with scores 0–100
6. UI renders sorted job cards with match percentages visible
