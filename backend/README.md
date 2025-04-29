# WebJobFinder Backend

This is the backend server for the WebJobFinder application. It provides APIs for scraping job listings, parsing resumes, and using OpenAI to analyze job matches.

## Features

- **Job Scraping**: Scrape job listings from multiple job sites (Seek, Indeed, LinkedIn)
- **Resume Parsing**: Extract text and information from PDF and DOCX resume files
- **OpenAI Integration**: Generate job search terms and evaluate job matches based on resume content

## Prerequisites

- Node.js (v16+)
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

### OpenAI Integration
- `POST /api/openai/init` - Initialize OpenAI with API key
- `POST /api/openai/generate-search-terms` - Generate job search terms from a resume
- `POST /api/openai/evaluate-job-match` - Evaluate how well a job matches a resume

## Technologies Used

- Express.js
- TypeScript
- Puppeteer (for web scraping)
- Cheerio (for HTML parsing)
- Multer (for file uploads)
- OpenAI API
- PDF Parser and DOCX Parser 