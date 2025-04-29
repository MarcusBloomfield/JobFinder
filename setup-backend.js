const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('WebJobFinder Backend Setup');
console.log('==========================');

try {
  // Check if backend directory exists
  const backendDir = path.join(__dirname, 'backend');
  if (!fs.existsSync(backendDir)) {
    console.error('Error: Backend directory not found. Please make sure you are in the root directory of the project.');
    process.exit(1);
  }

  // Navigate to backend directory and install dependencies
  console.log('\n1. Installing backend dependencies...');
  execSync('cd backend && npm install', { stdio: 'inherit' });

  // Create .env file if it doesn't exist
  const envFile = path.join(backendDir, '.env');
  if (!fs.existsSync(envFile)) {
    console.log('\n2. Creating .env file...');
    const envContent = `PORT=5000
NODE_ENV=development
# Add your OpenAI API key here
OPENAI_API_KEY=`;
    fs.writeFileSync(envFile, envContent);
    console.log('Created .env file. Please add your OpenAI API key to the .env file.');
  } else {
    console.log('\n2. .env file already exists. Skipping creation.');
  }

  // Create uploads directory if it doesn't exist
  const uploadsDir = path.join(backendDir, 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    console.log('\n3. Creating uploads directory...');
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('Created uploads directory.');
  } else {
    console.log('\n3. Uploads directory already exists. Skipping creation.');
  }

  // Build the TypeScript code
  console.log('\n4. Building TypeScript code...');
  execSync('cd backend && npm run build', { stdio: 'inherit' });

  console.log('\n5. Backend setup complete!');
  console.log('\nYou can now start the backend server with:');
  console.log('cd backend && npm run dev');
  console.log('\nMake sure to start the frontend server separately with:');
  console.log('npm start');

} catch (error) {
  console.error('\nError during setup:', error.message);
  process.exit(1);
} 