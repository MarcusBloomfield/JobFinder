import { Request, Response } from 'express';
import * as savedFormAnswerService from '../services/savedFormAnswerService';

const parseOptions = (value: unknown): Array<{ label?: string; value?: string }> => {
  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const listSavedFormAnswers = (req: Request, res: Response) => {
  try {
    const question = typeof req.query.question === 'string' ? req.query.question : '';
    const controlKind = typeof req.query.controlKind === 'string' ? req.query.controlKind : undefined;

    if (question.trim()) {
      const data = savedFormAnswerService.findHighConfidenceSavedFormAnswer({
        question,
        controlKind,
        options: parseOptions(req.query.options)
      });

      return res.status(200).json({
        error: false,
        data
      });
    }

    const data = savedFormAnswerService.listSavedFormAnswers();
    return res.status(200).json({
      error: false,
      data
    });
  } catch (error) {
    console.error('Error in listSavedFormAnswers controller:', error);
    return res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'An unknown error occurred'
    });
  }
};

export const createSavedFormAnswer = (req: Request, res: Response) => {
  try {
    const data = savedFormAnswerService.createSavedFormAnswer(req.body || {});

    return res.status(201).json({
      error: false,
      data
    });
  } catch (error) {
    console.error('Error in createSavedFormAnswer controller:', error);
    return res.status(400).json({
      error: true,
      message: error instanceof Error ? error.message : 'An unknown error occurred'
    });
  }
};

export const updateSavedFormAnswer = (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id?: string };
    if (!id) {
      return res.status(400).json({
        error: true,
        message: 'Missing saved form answer id.'
      });
    }

    const data = savedFormAnswerService.updateSavedFormAnswer(id, req.body || {});
    if (!data) {
      return res.status(404).json({
        error: true,
        message: 'Saved form answer not found.'
      });
    }

    return res.status(200).json({
      error: false,
      data
    });
  } catch (error) {
    console.error('Error in updateSavedFormAnswer controller:', error);
    return res.status(400).json({
      error: true,
      message: error instanceof Error ? error.message : 'An unknown error occurred'
    });
  }
};

export const deleteSavedFormAnswer = (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id?: string };
    if (!id) {
      return res.status(400).json({
        error: true,
        message: 'Missing saved form answer id.'
      });
    }

    const deleted = savedFormAnswerService.deleteSavedFormAnswer(id);
    if (!deleted) {
      return res.status(404).json({
        error: true,
        message: 'Saved form answer not found.'
      });
    }

    return res.status(200).json({
      error: false,
      data: { id }
    });
  } catch (error) {
    console.error('Error in deleteSavedFormAnswer controller:', error);
    return res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'An unknown error occurred'
    });
  }
};
