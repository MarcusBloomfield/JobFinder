import { evaluateJobMatch } from './services/llmSandboxService';
import { Resume } from './models/Resume';
import { Job } from './models/Job';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Fake resume data
const fakeResume: Resume = {
  id: 'test-resume-1',
  fileName: 'test-resume.pdf',
  fileType: 'pdf',
  content: `
John Doe
Senior Full Stack Developer

PROFESSIONAL SUMMARY
Experienced Full Stack Developer with 5+ years of expertise in React, TypeScript, Node.js, and modern web technologies.
Passionate about building scalable applications and delivering high-quality user experiences.

TECHNICAL SKILLS
- Frontend: React, TypeScript, JavaScript, HTML5, CSS3, Redux, Next.js
- Backend: Node.js, Express, REST APIs, GraphQL
- Databases: MongoDB, PostgreSQL, MySQL
- Tools: Git, Docker, AWS, CI/CD, Jest, Webpack
- Methodologies: Agile, Scrum, TDD

WORK EXPERIENCE
Senior Full Stack Developer | Tech Corp | 2020 - Present
- Built and maintained React applications serving 100k+ users
- Developed RESTful APIs using Node.js and Express
- Implemented CI/CD pipelines reducing deployment time by 60%
- Mentored junior developers and conducted code reviews

Full Stack Developer | StartupXYZ | 2018 - 2020
- Created responsive web applications using React and TypeScript
- Designed and implemented MongoDB database schemas
- Collaborated with cross-functional teams in Agile environment

EDUCATION
Bachelor of Computer Science | University of Technology | 2018
  `,
  generatedSearchTerms: []
};

// Fake job data - should be a good match
const goodMatchJob: Job = {
  id: 'test-job-1',
  title: 'Senior React Developer',
  company: 'Amazing Tech Company',
  location: 'Sydney, NSW',
  description: `
We are looking for a Senior React Developer to join our growing team.

Requirements:
- 5+ years of experience with React and TypeScript
- Strong knowledge of Node.js and Express
- Experience with MongoDB or other NoSQL databases
- Familiarity with modern CI/CD practices
- Experience with AWS cloud services
- Strong problem-solving skills and attention to detail

Responsibilities:
- Build and maintain React applications
- Develop RESTful APIs
- Collaborate with cross-functional teams
- Mentor junior developers
- Participate in code reviews

Nice to have:
- Experience with Next.js
- Knowledge of GraphQL
- Docker experience
  `,
  url: 'https://example.com/job/1',
  datePosted: new Date().toISOString()
};

// Fake job data - should be a poor match
const poorMatchJob: Job = {
  id: 'test-job-2',
  title: 'Senior Data Scientist',
  company: 'AI Research Lab',
  location: 'Melbourne, VIC',
  description: `
We are seeking a Senior Data Scientist with expertise in machine learning and AI.

Requirements:
- PhD in Computer Science, Statistics, or related field
- 5+ years of experience in machine learning and deep learning
- Expert knowledge of Python, TensorFlow, PyTorch
- Strong background in statistics and mathematics
- Experience with large-scale data processing (Spark, Hadoop)
- Publications in top-tier ML conferences

Responsibilities:
- Develop and deploy machine learning models
- Conduct research in deep learning
- Analyze large datasets
- Present findings to stakeholders
- Collaborate with research team
  `,
  url: 'https://example.com/job/2',
  datePosted: new Date().toISOString()
};

async function runTest() {
  console.log('🧪 Testing Gemini Match Percentage Functionality\n');
  console.log('=' .repeat(60));
  
  // Check if API key is set
  if (!process.env.GEMINI_API_KEY) {
    console.error('❌ ERROR: GEMINI_API_KEY is not set!');
    console.error('Please set GEMINI_API_KEY in your system environment variables or backend/.env');
    process.exit(1);
  }
  
  console.log('✓ Gemini API key found\n');
  
  try {
    // Test 1: Good match job
    console.log('Test 1: Evaluating GOOD MATCH job');
    console.log('-'.repeat(60));
    console.log(`Job: ${goodMatchJob.title} at ${goodMatchJob.company}`);
    console.log('Expected: High match score (70-100%)');
    
    const goodMatchScore = await evaluateJobMatch(goodMatchJob, fakeResume);
    console.log(`Result: ${goodMatchScore}%`);
    
    if (goodMatchScore >= 70) {
      console.log('✅ PASS: Good match detected correctly\n');
    } else if (goodMatchScore > 0) {
      console.log('⚠️  WARNING: Score is lower than expected but API is working\n');
    } else {
      console.log('❌ FAIL: Score is 0%, API may not be working\n');
    }
    
    // Test 2: Poor match job
    console.log('Test 2: Evaluating POOR MATCH job');
    console.log('-'.repeat(60));
    console.log(`Job: ${poorMatchJob.title} at ${poorMatchJob.company}`);
    console.log('Expected: Low match score (0-40%)');
    
    const poorMatchScore = await evaluateJobMatch(poorMatchJob, fakeResume);
    console.log(`Result: ${poorMatchScore}%`);
    
    if (poorMatchScore <= 40) {
      console.log('✅ PASS: Poor match detected correctly\n');
    } else if (poorMatchScore > 0) {
      console.log('⚠️  WARNING: Score is higher than expected but API is working\n');
    } else {
      console.log('❌ FAIL: Score is 0%, API may not be working\n');
    }
    
    // Summary
    console.log('=' .repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('=' .repeat(60));
    
    if (goodMatchScore > 0 && poorMatchScore >= 0) {
      console.log('✅ Gemini API is working correctly!');
      console.log(`   Good match score: ${goodMatchScore}%`);
      console.log(`   Poor match score: ${poorMatchScore}%`);
      
      if (goodMatchScore > poorMatchScore) {
        console.log('✅ Match scoring logic is working as expected!');
      } else {
        console.log('⚠️  Match scores may need tuning, but API is functional');
      }
    } else {
      console.log('❌ Gemini API is NOT working properly');
      console.log('   All scores are 0% - check your API key and error logs above');
    }
    
  } catch (error) {
    console.error('\n❌ TEST FAILED WITH ERROR:');
    console.error(error);
    process.exit(1);
  }
}

// Run the test
runTest();
