import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken } from '../middleware/auth';
import fs from 'fs';
import path from 'path';
import { uploadTracker } from '../services/uploads/uploadTracker';
import { getTelegramBot } from '../services/telegram/telegramBot';

const router = express.Router();
const prisma = new PrismaClient();

// Define the UploadStatus enum inline since it seems to be missing from the Prisma client
enum UploadStatus {
  uploading = 'uploading',
  completed = 'completed',
  cancelled = 'cancelled',
  error = 'error'
}

interface TusHookEvent {
  Upload: {
    ID: string;
    Size: number;
    Offset?: number;
    MetaData: {
      filename: string;
      filetype: string;
      projectId?: string;
      token?: string;
      clientName?: string;
      projectName?: string;
    };
    Storage: {
      Type: string;
      Path: string;
      Bucket?: string;
      Key?: string;
    };
  };
  Type: 'pre-create' | 'post-create' | 'post-receive' | 'post-finish' | 'post-terminate';
}

// Define the uploads directory path
const UPLOADS_DIR = path.join(__dirname, '../../uploads');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// TUS webhook handler
router.post('/hooks', async (req: Request, res: Response) => {
  try {
    console.log('[TELEGRAM-DEBUG] TUS webhook received:', JSON.stringify(req.body || {}));
    
    // Check if the request body is empty
    if (!req.body || typeof req.body !== 'object') {
      console.error('[TELEGRAM-DEBUG] Error: Invalid request body format');
      return res.status(400).json({
        status: 'error',
        message: 'Invalid request body format'
      });
    }
    
    // Extract event data - don't validate strictly as tusd may send different formats
    const event = req.body as TusHookEvent;
    const { Upload, Type } = event;
    
    // Safe access to nested properties with fallbacks
    const filename = Upload?.MetaData?.filename || 'unnamed-file';
    const token = Upload?.MetaData?.token || null;
    const clientName = Upload?.MetaData?.clientName || null;
    const projectName = Upload?.MetaData?.projectName || null;
    let projectId = Upload?.MetaData?.projectId || 'default';
    
    // Log metadata including client and project names
    console.log('[TELEGRAM-DEBUG] Upload metadata details:', {
      id: Upload?.ID,
      filename,
      size: Upload?.Size,
      type: Type,
      token,
      clientName,
      projectName,
      projectId
    });

    // If token is provided, try to find the associated project
    if (token) {
      try {
        const uploadLink = await prisma.uploadLink.findUnique({
          where: { token },
          include: {
            project: true
          }
        });

        if (uploadLink) {
          // Found a valid upload link, use its project ID
          projectId = uploadLink.projectId;
          
          // Update the upload link usage count for post-finish events
          if (Type === 'post-finish') {
            await prisma.uploadLink.update({
              where: { id: uploadLink.id },
              data: { usedCount: { increment: 1 } }
            });
          }
          
          console.log(`Using project ID ${projectId} from upload link token ${token}`);
        }
      } catch (err) {
        console.error('Error finding upload link by token:', err);
      }
    }

    // Process the hook based on type
    if (!Type) {
      // If Type is missing, just return success to not block uploads
      return res.status(200).json({ status: 'success' });
    }

    switch (Type) {
      case 'pre-create':
        // Validate the upload request
        // Check for disallowed file extensions - be very thorough
        if (filename === '.turbosort' || filename.toLowerCase().endsWith('.turbosort')) {
          console.log(`[UPLOAD-VALIDATION] Blocked .turbosort file upload attempt: ${filename}`);
          return res.status(400).json({
            status: 'error',
            message: 'Files with .turbosort extension are not allowed'
          });
        }
        
        // Extra validation for token-based uploads (client portal)
        if (token) {
          console.log(`[UPLOAD-VALIDATION] Token-based upload attempt for: ${filename}, token: ${token}`);
          
          // Double-check file extension for token-based uploads 
          if (filename === '.turbosort' || filename.toLowerCase().endsWith('.turbosort')) {
            console.log(`[UPLOAD-VALIDATION] Blocked token-based .turbosort file upload attempt: ${filename}`);
            return res.status(400).json({
              status: 'error',
              message: 'Files with .turbosort extension are not allowed'
            });
          }
        }
        
        // For the default project, we'll skip project validation
        if (projectId !== 'default') {
          const project = await prisma.project.findUnique({
            where: { id: projectId },
            include: { client: true }
          });

          if (!project) {
            return res.status(404).json({
              status: 'error',
              message: 'Project not found'
            });
          }
        }

        // Additional validations can be added here
        return res.status(200).json({ status: 'success' });

      case 'post-create':
        // Check for .turbosort files at creation time
        if (filename === '.turbosort' || filename.toLowerCase().endsWith('.turbosort')) {
          console.log(`[UPLOAD-VALIDATION] Detected .turbosort file in post-create: ${filename}. Rejecting.`);
          
          // Create a rejected record in the database
          await prisma.uploadedFile.create({
            data: {
              project: {
                connect: { id: projectId }
              },
              name: filename,
              size: parseFloat(Upload.Size.toString()),
              mimeType: Upload.MetaData.filetype || 'application/octet-stream',
              status: UploadStatus.error,
              tusId: Upload.ID,
              path: 'REJECTED: .turbosort files are not allowed',
              s3Key: Upload.Storage.Key,
              s3Bucket: Upload.Storage.Bucket,
            }
          });
          
          // We continue with the normal flow but we've marked the file as rejected
          break;
        }
        
        // Record the upload initiation
        await prisma.uploadedFile.create({
          data: {
            project: {
              connect: { id: projectId }
            },
            name: filename,
            size: parseFloat(Upload.Size.toString()), // Use parseFloat for Float type
            mimeType: Upload.MetaData.filetype || 'application/octet-stream',
            status: UploadStatus.uploading,
            tusId: Upload.ID,
            path: Upload.Storage.Path,
            s3Key: Upload.Storage.Key,
            s3Bucket: Upload.Storage.Bucket,
          }
        });
        
        // Track the upload in the uploadTracker (enables Telegram notifications)
        console.log('[TELEGRAM-DEBUG] Tracking new upload in uploadTracker:', Upload.ID);
        try {
          uploadTracker.trackUpload({
            id: Upload.ID,
            size: Upload.Size,
            offset: 0,
            metadata: Upload.MetaData,
            createdAt: new Date()
          });
          console.log('[TELEGRAM-DEBUG] Successfully tracked upload:', Upload.ID);
        } catch (err) {
          console.error('[TELEGRAM-DEBUG] Error tracking upload:', err);
        }
        
        break;

      case 'post-receive':
        // Check for .turbosort files during upload progress
        if (filename === '.turbosort' || filename.toLowerCase().endsWith('.turbosort')) {
          console.log(`[UPLOAD-VALIDATION] Detected .turbosort file in post-receive: ${filename}. Aborting upload.`);
          
          // Mark the file as rejected in the database
          await prisma.uploadedFile.updateMany({
            where: {
              tusId: Upload.ID
            },
            data: {
              status: UploadStatus.error,
              path: 'REJECTED: .turbosort files are not allowed'
            }
          });
          
          // We return success here because we don't want to interfere with TUS's internal state
          // But we've marked the file as rejected in the database
          break;
        }
        
        // Update the upload tracker with progress (sends Telegram progress notifications)
        console.log('[TELEGRAM-DEBUG] Updating upload progress:', Upload.ID, 'Progress:', Math.round(((Upload.Offset || 0) / Upload.Size) * 100) + '%');
        try {
          uploadTracker.trackUpload({
            id: Upload.ID,
            size: Upload.Size,
            offset: Upload.Offset || 0,
            metadata: Upload.MetaData,
            createdAt: new Date()
          });
          console.log('[TELEGRAM-DEBUG] Successfully updated upload progress');
        } catch (err) {
          console.error('[TELEGRAM-DEBUG] Error updating upload progress:', err);
        }
        break;

      case 'post-finish':
        // Double-check for .turbosort files that may have slipped through
        if (filename === '.turbosort' || filename.toLowerCase().endsWith('.turbosort')) {
          console.log(`[UPLOAD-VALIDATION] Detected .turbosort file in post-finish: ${filename}. Rejecting and cleaning up.`);
          
          // Delete the file if it exists
          try {
            if (Upload.Storage.Path && fs.existsSync(Upload.Storage.Path)) {
              fs.unlinkSync(Upload.Storage.Path);
              console.log(`[UPLOAD-VALIDATION] Deleted .turbosort file: ${Upload.Storage.Path}`);
            }
          } catch (err) {
            console.error(`[UPLOAD-VALIDATION] Error deleting .turbosort file:`, err);
          }
          
          // Mark the file as rejected in the database
          await prisma.uploadedFile.updateMany({
            where: {
              tusId: Upload.ID
            },
            data: {
              status: UploadStatus.error,
              completedAt: new Date(),
              path: 'REJECTED: .turbosort files are not allowed'
            }
          });
          
          return res.status(400).json({
            status: 'error',
            message: 'Files with .turbosort extension are not allowed'
          });
        }
        
        // For local storage, create a symlink to the uploaded file
        // with a more recognizable name
        const sourcePath = Upload.Storage.Path;
        const destPath = path.join(UPLOADS_DIR, `${Upload.ID}_${filename}`);
        
        // Create a symlink to the original file
        try {
          if (fs.existsSync(sourcePath)) {
            // On Linux/macOS, create a symlink
            fs.symlinkSync(sourcePath, destPath);
            console.log(`Created symlink from ${sourcePath} to ${destPath}`);
          } else {
            console.error(`Source file not found: ${sourcePath}`);
          }
        } catch (err) {
          console.error('Error creating symlink:', err);
        }

        // Update the file status to completed
        await prisma.uploadedFile.updateMany({
          where: {
            tusId: Upload.ID
          },
          data: {
            status: UploadStatus.completed,
            completedAt: new Date(),
            path: destPath, // Update the path to the symlink
          }
        });
        
        // Mark upload as complete in the uploadTracker (sends Telegram completion notification)
        console.log('[TELEGRAM-DEBUG] Marking upload as complete in uploadTracker:', Upload.ID);
        try {
          uploadTracker.completeUpload(Upload.ID);
          console.log('[TELEGRAM-DEBUG] Successfully marked upload as complete');
        } catch (err) {
          console.error('[TELEGRAM-DEBUG] Error marking upload as complete:', err);
        }
        
        break;

      case 'post-terminate':
        // Update the file status to cancelled
        await prisma.uploadedFile.updateMany({
          where: {
            tusId: Upload.ID
          },
          data: {
            status: UploadStatus.cancelled,
          }
        });
        break;
    }

    res.status(200).json({ status: 'success' });
  } catch (error) {
    console.error('[TELEGRAM-DEBUG] TUS webhook error:', error);
    console.error('[TELEGRAM-DEBUG] Error stack:', error instanceof Error ? error.stack : 'No stack available');
    console.error('[TELEGRAM-DEBUG] Request body was:', typeof req.body, JSON.stringify(req.body || {}));
    console.error('[TELEGRAM-DEBUG] Request headers were:', JSON.stringify(req.headers));
    
    res.status(500).json({
      status: 'error',
      message: 'Failed to process TUS webhook',
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

// New endpoint for receiving Telegram notifications from hook scripts
router.post('/telegram-notify', async (req: Request, res: Response) => {
  try {
    console.log('[TELEGRAM-DEBUG] Received notification from hook script:', JSON.stringify(req.body || {}));
    
    // Check if the request body is empty
    if (!req.body || typeof req.body !== 'object') {
      console.error('[TELEGRAM-DEBUG] Error: Invalid request body format in telegram-notify');
      return res.status(400).json({
        status: 'error',
        message: 'Invalid request body format'
      });
    }
    
    const { type, uploadId, filename, size, offset, progress, client, project, targetPath, status, uploadSpeed } = req.body;
    
    // Get Telegram bot instance
    const telegramBot = getTelegramBot();
    if (!telegramBot) {
      console.error('[TELEGRAM-DEBUG] Error: Telegram bot not initialized');
      return res.status(500).json({
        status: 'error',
        message: 'Telegram bot not initialized'
      });
    }
    
    // Get existing upload information for calculating speed if not provided
    let calculatedSpeed;
    if (type === 'upload_progress' && !uploadSpeed && uploadId) {
      const existingUpload = uploadTracker.getUpload(uploadId);
      if (existingUpload && existingUpload.previousOffset !== undefined && existingUpload.previousUpdateTime) {
        const bytesDiff = (offset || 0) - existingUpload.previousOffset;
        const timeDiffMs = new Date().getTime() - existingUpload.previousUpdateTime.getTime();
        if (timeDiffMs > 0) {
          calculatedSpeed = (bytesDiff / timeDiffMs) * 1000; // bytes per second
        }
      }
    }
    
    // Prepare message based on notification type
    let message = '';
    
    // Determine if we should clean up message ID after completion/termination
    const isCompletionEvent = type === 'upload_complete' || type === 'upload_terminated';
    
    // Format transfer speed in human-readable format
    const formatSpeed = (bytesPerSecond: number): string => {
      if (bytesPerSecond < 1024) return `${bytesPerSecond.toFixed(2)} B/s`;
      if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(2)} KB/s`;
      if (bytesPerSecond < 1024 * 1024 * 1024) return `${(bytesPerSecond / (1024 * 1024)).toFixed(2)} MB/s`;
      return `${(bytesPerSecond / (1024 * 1024 * 1024)).toFixed(2)} GB/s`;
    };
    
    switch (type) {
      case 'upload_started':
        message = `<b>🔄 Upload Started</b>
<b>File:</b> ${filename || 'Unknown'}
<b>Size:</b> ${formatFileSize(size)}
<b>Client:</b> ${client || 'Unknown'}
<b>Project:</b> ${project || 'Unknown'}
<b>ID:</b> ${uploadId}`;
        break;
        
      case 'upload_progress':
        message = `<b>⏳ Upload Progress: ${progress || 0}%</b>
<b>File:</b> ${filename || 'Unknown'}
<b>Progress:</b> ${formatFileSize(offset || 0)} of ${formatFileSize(size)}`;
        
        // Add speed information if available
        if (uploadSpeed || calculatedSpeed) {
          const speedValue = uploadSpeed || calculatedSpeed;
          message += `\n<b>Speed:</b> ${formatSpeed(speedValue)}`;
        }
        
        message += `
<b>Client:</b> ${client || 'Unknown'}
<b>Project:</b> ${project || 'Unknown'}
<b>ID:</b> ${uploadId}`;
        break;
        
      case 'upload_complete':
        message = `<b>✅ Upload Completed</b>
<b>File:</b> ${filename || 'Unknown'}
<b>Size:</b> ${formatFileSize(size)}
<b>Client:</b> ${client || 'Unknown'}
<b>Project:</b> ${project || 'Unknown'}
<b>ID:</b> ${uploadId}
<b>Location:</b> ${targetPath || 'Unknown'}
<b>Status:</b> ${status || 'Unknown'}`;
        break;
        
      case 'upload_terminated':
        message = `<b>❌ Upload Terminated</b>
<b>File:</b> ${filename || 'Unknown'}
<b>Size:</b> ${formatFileSize(size)}
<b>Client:</b> ${client || 'Unknown'}
<b>Project:</b> ${project || 'Unknown'}
<b>ID:</b> ${uploadId}`;
        break;
        
      default:
        message = `<b>📊 Upload Notification</b>
<b>Type:</b> ${type || 'Unknown'}
<b>File:</b> ${filename || 'Unknown'}
<b>ID:</b> ${uploadId}`;
    }
    
    // Send message to Telegram with upload ID for editing
    const success = await telegramBot.sendMessage(message, uploadId);
    
    // If this is a completion event and we have a storage path available,
    // clean up the message ID file after sending the final notification
    if (isCompletionEvent && uploadId && success) {
      try {
        // The TelegramBot class handles cleanup internally now
        console.log(`[TELEGRAM-DEBUG] Upload ${type} event - message cleaning will be handled by TelegramBot class`);
      } catch (cleanupError) {
        console.error(`[TELEGRAM-DEBUG] Error cleaning up message ID for upload ${uploadId}:`, cleanupError);
      }
    }
    
    if (success) {
      console.log('[TELEGRAM-DEBUG] Successfully sent notification to Telegram');
      return res.status(200).json({
        status: 'success',
        message: 'Notification sent to Telegram'
      });
    } else {
      console.error('[TELEGRAM-DEBUG] Failed to send notification to Telegram');
      return res.status(500).json({
        status: 'error',
        message: 'Failed to send notification to Telegram'
      });
    }
  } catch (error) {
    console.error('[TELEGRAM-DEBUG] Error in telegram-notify endpoint:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Helper function to format file size
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Get upload status
router.get('/status/:tusId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { tusId } = req.params;
    const file = await prisma.uploadedFile.findFirst({
      where: {
        tusId
      },
      include: {
        project: {
          include: {
            client: true
          }
        }
      }
    });

    if (!file) {
      return res.status(404).json({
        status: 'error',
        message: 'Upload not found'
      });
    }

    // No need to convert size to string anymore since it's a float
    const response = {
      status: 'success',
      data: file
    };

    res.json(response);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch upload status'
    });
  }
});

export default router; 