# Project Overview — JobFinder (LLM Context Document)

> **Purpose:** This file gives an LLM contributor everything needed to understand and continue work on this project without reading every source file. Keep it up to date when making significant structural changes.

---

## What This Project Is

**WebJobFinder** is a full-stack TypeScript application that helps job seekers find relevant listings. The user uploads a resume (PDF or DOCX), the app generates search terms via Google Gemini, scrapes job listings from job boards using Playwright, scores each job against the resume using Gemini, and displays ranked results with match percentages in a React UI.

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
  applicationMethod: '' | 'seek' | 'company_website' | 'linkedin' | 'indeed' | 'email' | 'recruiter' | 'referral' | 'other';
  applicationSubmittedDate: string;  // YYYY-MM-DD
  interviewedForJob: boolean;
  employedForJob: boolean;
}
```

> **Tracked applications** now persist a `jobDetails` payload in SQLite and expose it through the Progress modal for manual completion and editing. When core fields are missing, the modal can also rehydrate company, location, and description from the original job listing.

> **Progress stats** now focus on funnel counts the user can maintain from the Progress page: jobs applied for, interviewed for, and employed for.

> **Auto-apply cover letters** are generated in `backend/src/services/applicationAgentService.ts`, kept short/warm, and passed through deterministic text cleanup that replaces AI-looking punctuation such as em dashes and strips invisible formatting characters before typing or tracking.

> **Auto-apply resumes** are selected from user-uploaded resumes only. `applicationAgentService.ts` ranks the active resume plus stored uploaded resumes by job relevance and uses the best original upload as the active resume. No tailored/generated resume file is created for auto-apply. The tracked application stores the exact uploaded resume filename and full resume text snapshot so Progress and Profile can show what was actually used for each job.

> **Profile Fill with AI** is available on the Profile page. It sends stored parsed resumes plus the current browser-saved profile to `POST /api/apply/profile/fill`, where `applicationProfileFillService.ts` asks OpenAI to extract only resume-supported fields and preserve existing profile values unless the resume explicitly replaces them.

> **Note:** Models are duplicated across `src/models/` and `backend/src/models/`. Keep them in sync when changing the shape.

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Server status check |
| POST | `/api/resume/parse` | Parse uploaded resume (`multipart/form-data`, field: `file`) |
| POST | `/api/scrape/site` | Scrape a single job site |
| POST | `/api/scrape/jobs` | Scrape multiple sites across multiple search terms |
| POST | `/api/openai/generate-search-terms` | Generate search terms from resume via Gemini |
| POST | `/api/openai/evaluate-job-match` | Single job match evaluation |
| POST | `/api/openai/evaluate-job-matches-bulk` | Bulk scoring (batched, retried, with fallback) |
| POST | `/api/apply/profile/fill` | Fill the saved application profile from stored parsed resumes using AI |
| POST | `/api/applications/:applicationId/enrich` | Refresh missing tracked application metadata from the original listing |
| PATCH | `/api/applications/:applicationId/job-details` | Save persisted employer/application details for a tracked job |

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
- Backend iterates all `searchTerm × site` combinations
- Each combination: Playwright launches headless Chromium → human-like delays, random UA, scrolling → Cheerio extracts jobs
- Results deduplicated by `title + company`
- **Only Seek is fully configured.** Passing `indeed` or `linkedin` throws `"Scraping configuration not found"` and triggers frontend fallback

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
| **Seek-only scraping** | `siteConfigs` only has Seek. `indeed` and `linkedin` are accepted by the controller but will throw at the service level. |
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
4. `POST /api/scrape/jobs` with `sites: ["seek"]` returns non-empty jobs array
5. `POST /api/openai/evaluate-job-matches-bulk` returns `{ id, matchScore }[]` with scores 0–100
6. UI renders sorted job cards with match percentages visible
