import { Request, Response } from 'express';
import { logger } from '../utils/logger';
import { uploadTracker } from '../services/uploads/uploadTracker';

/**
 * Controller for handling tusd webhook events
 */
export class TusdHooksController {
  /**
   * Handle pre-create hook
   * This is called before an upload is created
   */
  handlePreCreate(req: Request, res: Response): void {
    try {
      const hookData = req.body;
      logger.info('tusd pre-create hook received', { uploadId: hookData.Upload?.ID });
      
      // You can validate the upload here and reject it if needed
      // For example, check file type, size limits, etc.
      
      res.status(200).json({ message: 'Pre-create hook processed' });
    } catch (error) {
      logger.error('Error in pre-create hook:', error);
      res.status(500).json({ error: 'Failed to process pre-create hook' });
    }
  }
  
  /**
   * Handle post-create hook
   * This is called after an upload is created
   */
  handlePostCreate(req: Request, res: Response): void {
    try {
      const hookData = req.body;
      const uploadId = hookData.Upload?.ID;
      const size = hookData.Upload?.Size || 0;
      const metadata = hookData.Upload?.MetaData || {};
      
      logger.info('tusd post-create hook received', { uploadId });
      
      // Track the new upload
      uploadTracker.trackUpload({
        id: uploadId,
        size,
        offset: 0,
        metadata,
        createdAt: new Date(),
        isComplete: false
      });
      
      res.status(200).json({ message: 'Post-create hook processed' });
    } catch (error) {
      logger.error('Error in post-create hook:', error);
      res.status(500).json({ error: 'Failed to process post-create hook' });
    }
  }
  
  /**
   * Handle post-receive hook
   * This is called after a chunk is received
   */
  handlePostReceive(req: Request, res: Response): void {
    try {
      const hookData = req.body;
      const uploadId = hookData.Upload?.ID;
      const size = hookData.Upload?.Size || 0;
      const offset = hookData.Upload?.Offset || 0;
      const metadata = hookData.Upload?.MetaData || {};
      
      logger.debug('tusd post-receive hook received', { 
        uploadId, 
        progress: `${Math.round((offset / size) * 100)}%` 
      });
      
      // Update the upload progress
      uploadTracker.trackUpload({
        id: uploadId,
        size,
        offset,
        metadata,
        createdAt: new Date()
      });
      
      res.status(200).json({ message: 'Post-receive hook processed' });
    } catch (error) {
      logger.error('Error in post-receive hook:', error);
      res.status(500).json({ error: 'Failed to process post-receive hook' });
    }
  }
  
  /**
   * Handle post-finish hook
   * This is called when an upload is completed
   */
  handlePostFinish(req: Request, res: Response): void {
    try {
      const hookData = req.body;
      const uploadId = hookData.Upload?.ID;
      
      logger.info('tusd post-finish hook received', { uploadId });
      
      // Mark the upload as complete
      uploadTracker.completeUpload(uploadId);
      
      res.status(200).json({ message: 'Post-finish hook processed' });
    } catch (error) {
      logger.error('Error in post-finish hook:', error);
      res.status(500).json({ error: 'Failed to process post-finish hook' });
    }
  }
  
  /**
   * Handle post-terminate hook
   * This is called when an upload is terminated
   */
  handlePostTerminate(req: Request, res: Response): void {
    try {
      const hookData = req.body;
      const uploadId = hookData.Upload?.ID;
      
      logger.info('tusd post-terminate hook received', { uploadId });
      
      // You can handle upload termination here
      // For example, clean up any associated resources
      
      res.status(200).json({ message: 'Post-terminate hook processed' });
    } catch (error) {
      logger.error('Error in post-terminate hook:', error);
      res.status(500).json({ error: 'Failed to process post-terminate hook' });
    }
  }
} 