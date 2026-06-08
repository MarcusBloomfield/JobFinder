import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import * as coverLetterExampleController from '../controllers/coverLetterExampleController';

const router = express.Router();
const uploadsDir = path.join(__dirname, '../../uploads/cover-letter-examples');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024
  },
  fileFilter: (_req, file, cb) => {
    const allowedFileTypes = ['.pdf', '.docx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedFileTypes.includes(ext)) {
      cb(null, true);
      return;
    }

    cb(new Error(`Invalid file type. Supported types: ${allowedFileTypes.join(', ')}`));
  }
});

router.post('/parse', upload.single('file'), coverLetterExampleController.parseCoverLetterExample);

export default router;
