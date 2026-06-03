# WebJobFinder Backend

This is the backend server for the WebJobFinder application. It provides APIs for scraping job listings, parsing resumes, using OpenAI to analyze job matches, and persisting application runs in SQLite.

## Features

- **Job Scraping**: Scrape job listings from multiple job sites (Seek, Indeed, LinkedIn)
- **Resume Parsing**: Extract text and information from PDF and DOCX resume files
- **OpenAI Integration**: Generate job search terms and evaluate job matches based on resume content
- **Application Tracking**: Store auto-apply attempts and outcomes in SQLite for later progress reporting

## Prerequisites

- Node.js (v24+ recommended)
- npm or yarn
- OpenAI API key (for AI-powered features)

## Setup and Installation

1. Clone the repository
2. Navigate to the backend directory:
```
cd backend
```
3. Install dependencies:
```
npm install
```
4. Create a `.env` file based on `.env.example` and add your OpenAI API key:
```
PORT=5000
NODE_ENV=development
OPENAI_API_KEY=your_openai_api_key_here
PLAYWRIGHT_HEADLESS=false
PLAYWRIGHT_SLOWMO_MS=250
PLAYWRIGHT_BROWSER_CHANNEL=chrome
# Optional: reuse your real Chrome profile. Close Chrome first if you use a live profile.
# PLAYWRIGHT_USER_DATA_DIR=C:\Users\your-user\AppData\Local\Google\Chrome\User Data
LLM_TIMEOUT_MS=20000
LLM_MAX_RESUME_CHARS=12000
LLM_MAX_JOB_DESC_CHARS=4000
LLM_MIN_SEARCH_TERMS=5
LLM_MAX_SEARCH_TERMS=8
```

5. Build the TypeScript code:
```
npm run build
```

## Running the Server

### Development Mode

```
npm run dev
```

This starts the server in development mode with hot reloading using nodemon.

### Production Mode

```
npm run build
npm start
```

## API Endpoints

### Health Check
- `GET /api/health` - Check if the server is running

### Job Scraping
- `POST /api/scrape/site` - Scrape jobs from a specific job site
- `POST /api/scrape/jobs` - Scrape jobs from multiple job sites

### Resume Parsing
- `POST /api/resume/parse` - Parse and extract information from a resume file

### AI Integration (Sandboxed)
- `POST /api/openai/generate-search-terms` - Generate job search terms from a resume
- `POST /api/openai/evaluate-job-match` - Evaluate how well a job matches a resume
- `POST /api/openai/evaluate-job-matches-bulk` - Evaluate multiple jobs with sandboxed LLM calls

### Application Tracking
- `GET /api/applications/history` - Retrieve recent tracked application runs
- `GET /api/applications/summary` - Retrieve status counts and daily activity totals
- `POST /api/applications/statuses` - Retrieve the latest stored status for a list of job URLs

## Technologies Used

- Express.js
- TypeScript
- Playwright (for web scraping)
- Cheerio (for HTML parsing)
- Multer (for file uploads)
- OpenAI API
- PDF Parser and DOCX Parser
- SQLite via Node's built-in `node:sqlite`

## Data Storage

Tracked application data is stored locally in `backend/data/jobfinder.sqlite` by default.
You can override the database path with `APPLICATION_TRACKING_DB_PATH`.
