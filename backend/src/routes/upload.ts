import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import xxhash from 'xxhash-wasm';
import { authenticateToken } from '../middleware/auth';
import { uploadTracker } from '../services/uploads/uploadTracker';
import { s3Service } from '../services/s3/s3Service';
import { s3FileProcessor } from '../services/s3/s3FileProcessor'; // Corrected casing
import { logger } from '../utils/logger';
import { getTelegramBot } from '../services/telegram/telegramBot'; // Import the function
const router = express.Router();
const prisma = new PrismaClient();

// Extend Express.Request to include files from multer
interface MulterRequest extends Request {
  files: Express.Multer.File[];
}

// Helper function to generate formatted upload token
function generateUploadToken(): string {
  const segments = uuidv4().split('-').slice(0, 4);
  return segments.join('-').toUpperCase();
}

// Configure multer for file uploads with client/project structure
const storage = multer.diskStorage({
  destination: async (req: Request, _file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => {
    try {
      const { token } = req.params;
      const uploadLink = await prisma.uploadLink.findUnique({
        where: { token },
        include: { 
          project: {
            include: {
              client: true
            }
          }
        }
      });

      if (!uploadLink) {
        cb(new Error('Invalid upload link'), '');
        return;
      }

      // Use the TUS organized directory structure
      // This matches where TUS stores its finalized files
      // The path below assumes you've set an environment variable in your backend
      // If not available, we fall back to the local path
      const organizedDir = process.env.TUS_ORGANIZED_DIR || path.join(__dirname, '../../organized');
      
      const uploadDir = path.join(organizedDir, 
        uploadLink.project.client.code || 'default',
        uploadLink.project.name
      );

      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      cb(null, uploadDir);
    } catch (error) {
      cb(error as Error, '');
    }
  },
  filename: (_req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
    // Use the original filename, only replacing characters that would cause filesystem issues
    // Allow spaces, apostrophes, parentheses and other common characters
    const originalName = file.originalname;
    // Replace only problematic characters like slashes, colons, etc.
    const safeName = originalName.replace(/[\/\\:*?"<>|]/g, '_');
    cb(null, safeName);
  }
});

// Modified upload limits for handling large files with XHR upload
const upload = multer({ 
  storage,
  limits: {
    fileSize: process.env.MAX_FILE_SIZE ? parseInt(process.env.MAX_FILE_SIZE) : 10 * 1024 * 1024 * 1024, // Default 10GB
  }
});

// Create a new client
router.post('/clients', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { name, code } = req.body;

    // Generate a code from the name if not provided
    const clientCode = code || name
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '') // Remove special characters
      .slice(0, 10); // Take first 10 characters

    const client = await prisma.client.create({
      data: {
        name,
        code: clientCode,
      }
    });

    res.json({
      status: 'success',
      data: client
    });
  } catch (error) {
    console.error('Failed to create client:', error);
    if ((error as any).code === 'P2002') {
      res.status(400).json({
        status: 'error',
        message: 'A client with this code already exists'
      });
    } else {
      res.status(500).json({
        status: 'error',
        message: 'Failed to create client'
      });
    }
  }
});

// Get all clients
router.get('/clients', authenticateToken, async (_req: Request, res: Response) => {
  try {
    const clients = await prisma.client.findMany({
      include: {
        projects: {
          include: {
            uploadLinks: true,
            files: true,
          }
        }
      }
    });
    
    res.json({
      status: 'success',
      data: clients
    });
  } catch (error) {
    console.error('Failed to fetch clients:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch clients'
    });
  }
});

// Update a client
router.put('/clients/:clientId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { clientId } = req.params;
    const { name } = req.body;
    
    // Check if client exists
    const clientExists = await prisma.client.findUnique({
      where: { id: clientId }
    });
    
    if (!clientExists) {
      return res.status(404).json({
        status: 'error',
        message: 'Client not found'
      });
    }
    
    // Update the client
    const updatedClient = await prisma.client.update({
      where: { id: clientId },
      data: { name }
    });
    
    res.json({
      status: 'success',
      data: updatedClient
    });
  } catch (error) {
    console.error('Failed to update client:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update client'
    });
  }
});

// Create a new project
router.post('/clients/:clientId/projects', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { clientId } = req.params;
    const { name, description } = req.body;
    const project = await prisma.project.create({
      data: {
        name,
        description,
        clientId,
      },
      include: {
        client: true
      }
    });
    res.json({
      status: 'success',
      data: project
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'error',
      message: 'Failed to create project'
    });
  }
});

// Get all projects for a client
router.get('/clients/:clientId/projects', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { clientId } = req.params;
    const projects = await prisma.project.findMany({
      where: { clientId },
      include: {
        uploadLinks: true,
        files: true,
      }
    });
    res.json({
      status: 'success',
      data: projects
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'error',
      message: 'Failed to fetch projects'
    });
  }
});

// Get all projects regardless of client
router.get('/projects', authenticateToken, async (_req: Request, res: Response) => {
  try {
    const projects = await prisma.project.findMany({
      include: {
        client: true,
        uploadLinks: true,
        files: true,
      }
    });
    res.json({
      status: 'success',
      data: projects
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'error',
      message: 'Failed to fetch projects'
    });
  }
});

// Create an upload link for a project
router.post('/projects/:projectId/upload-links', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { expiresAt, usageLimit, token } = req.body;
    
    // If usageLimit is undefined or null, explicitly set maxUses to null to override the default
    const maxUses = usageLimit === undefined || usageLimit === null ? null : usageLimit;
    
    // Use provided token or generate a new one
    const uploadToken = token || generateUploadToken();
    
    const uploadLink = await prisma.uploadLink.create({
      data: {
        token: uploadToken,
        projectId,
        expiresAt: new Date(expiresAt),
        maxUses,
      },
      include: {
        project: {
          include: {
            client: true
          }
        }
      }
    });

    // Generate the full upload URL
    const uploadUrl = `https://upload.colourstream.johnrogerscolour.co.uk/${uploadLink.token}`;
    
    res.json({
      status: 'success',
      data: {
        ...uploadLink,
        uploadUrl
      }
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'error',
      message: 'Failed to create upload link'
    });
  }
});

// Validate upload link and get project info
router.get('/upload-links/:token', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const uploadLink = await prisma.uploadLink.findUnique({
      where: { token },
      include: {
        project: {
          include: {
            client: true
          }
        }
      }
    });

    if (!uploadLink) {
      return res.status(404).json({ 
        status: 'error',
        message: 'Upload link not found'
      });
    }

    if (uploadLink.expiresAt < new Date()) {
      return res.status(403).json({ 
        status: 'error',
        message: 'Upload link has expired'
      });
    }

    // If maxUses is null, it means unlimited uses
    if (uploadLink.maxUses !== null && uploadLink.usedCount >= uploadLink.maxUses) {
      return res.status(403).json({ 
        status: 'error',
        message: 'Upload link has reached maximum uses'
      });
    }

    res.json({
      status: 'success',
      data: {
        clientCode: uploadLink.project.client.code, // Use client code for consistency
        projectName: uploadLink.project.name,
        expiresAt: uploadLink.expiresAt
      }
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'error',
      message: 'Failed to validate upload link'
    });
  }
});

// Get project files
router.get('/projects/:projectId/files', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const files = await prisma.uploadedFile.findMany({
      where: { projectId },
      include: {
        project: {
          include: {
            client: true
          }
        }
      }
    });
    res.json({
      status: 'success',
      data: files
    });
  } catch (error) {
    console.error('Failed to fetch files:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Failed to fetch files'
    });
  }
});

// Handle file upload
router.post('/upload/:token', upload.array('files'), async (req: Request, res: Response) => {
  const multerReq = req as MulterRequest;
  if (!multerReq.files) {
    return res.status(400).json({ 
      status: 'error',
      message: 'No files uploaded'
    });
  }
  
  try {
    const { token } = req.params;
    const files = multerReq.files;
    const useS3 = req.query.S3 === 'true';

    const uploadLink = await prisma.uploadLink.findUnique({
      where: { token },
      include: {
        project: {
          include: {
            client: true
          }
        }
      }
    });

    if (!uploadLink) {
      // Delete uploaded files since the link is invalid
      for (const file of files) {
        await fs.promises.unlink(file.path);
      }
      return res.status(404).json({ 
        status: 'error',
        message: 'Upload link not found'
      });
    }

    if (uploadLink.expiresAt < new Date()) {
      // Delete uploaded files since the link has expired
      for (const file of files) {
        await fs.promises.unlink(file.path);
      }
      return res.status(403).json({ 
        status: 'error',
        message: 'Upload link has expired'
      });
    }

    // If maxUses is null, it means unlimited uses
    if (uploadLink.maxUses !== null && uploadLink.usedCount >= uploadLink.maxUses) {
      // Delete uploaded files since the link has reached max uses
      for (const file of files) {
        await fs.promises.unlink(file.path);
      }
      return res.status(403).json({ 
        status: 'error',
        message: 'Upload link has reached maximum uses'
      });
    }

    // Initialize XXHash64 - fast and reliable hashing
    const xxhash64 = await xxhash();

    // Process files and update database
    const uploadedFiles = await Promise.all(files.map(async (file) => {
      // Generate a unique ID for the upload (similar to tusId in the tus flow)
      const xhrUploadId = `xhr-${uuidv4()}`;
      
      // Initial tracking for beginning of upload (similar to post-create hook)
      uploadTracker.trackUpload({
        id: xhrUploadId,
        size: file.size,
        offset: 0,
        metadata: {
          filename: file.originalname,
          filetype: file.mimetype,
          token: token,
          clientName: uploadLink.project.client.name,
          projectName: uploadLink.project.name,
          storage: useS3 ? 's3' : 'local'
        },
        createdAt: new Date(),
      });
      
      try {
        // Calculate file hash for integrity and deduplication
        const fileBuffer = await fs.promises.readFile(file.path);
        const fileHash = xxhash64.h64Raw(Buffer.from(fileBuffer)).toString(16);

        // Check for existing file with same hash in this project
        const existingFile = await prisma.uploadedFile.findFirst({
          where: {
            projectId: uploadLink.projectId,
            hash: fileHash
          }
        });

        if (existingFile) {
          // Delete the duplicate file
          await fs.promises.unlink(file.path);
          
          // Track the upload as complete
          uploadTracker.completeUpload(xhrUploadId);
          
          return existingFile;
        }

        let filePath = file.path;
        let fileUrl = '';

        // If S3 storage is requested, upload to S3
        if (useS3) {
          // Generate S3 key based on client, project, and filename
          // Using the clean $CLIENT/$PROJECT/FILENAME structure
          const s3Key = s3Service.generateKey(
            uploadLink.project.client.code || 'default',
            uploadLink.project.name,
            file.originalname
          );

          // Enhanced logging for debugging filename issues
          console.log(`File upload request - Original filename: "${file.originalname}"`);
          console.log(`Generated S3 key: "${s3Key}" for file: "${file.originalname}"`);
          console.log(`Client code: "${uploadLink.project.client.code || 'default'}", Project name: "${uploadLink.project.name}"`);

          // Log the generated S3 key for debugging
          console.log(`Generated S3 key for upload: ${s3Key} for file: ${file.originalname}`);

          // Upload file to S3
          fileUrl = await s3Service.uploadFile(
            fileBuffer,
            s3Key,
            file.mimetype,
            {
              clientName: uploadLink.project.client.name,
              projectName: uploadLink.project.name,
              originalName: file.originalname
            }
          );

          // Delete the local file after successful S3 upload
          await fs.promises.unlink(file.path);
          
          // Update the file path to use the S3 URL
          filePath = fileUrl;
        }

        // Create new file record
        const uploadedFile = await prisma.uploadedFile.create({
          data: {
            name: file.originalname,
            path: filePath,
            size: parseFloat(file.size.toString()),
            mimeType: file.mimetype,
            hash: fileHash,
            project: {
              connect: { id: uploadLink.projectId }
            },
            status: 'completed',
            completedAt: new Date(),
            storage: useS3 ? 's3' : 'local',
            url: useS3 ? fileUrl : null
          }
        });

        // Track the upload as complete (similar to post-finish hook)
        uploadTracker.completeUpload(xhrUploadId);

        return uploadedFile;
      } catch (error) {
        console.error('Error processing file:', error);
        
        // Track upload error
        uploadTracker.trackUpload({
          id: xhrUploadId,
          size: file.size,
          offset: 0,
          metadata: {
            filename: file.originalname,
            filetype: file.mimetype,
            token: token,
            clientName: uploadLink.project.client.name,
            projectName: uploadLink.project.name,
            error: error instanceof Error ? error.message : 'Unknown error',
            storage: useS3 ? 's3' : 'local'
          },
          createdAt: new Date(),
          isComplete: true
        });
        
        throw error;
      }
    }));

    // Update the upload link usage count
    await prisma.uploadLink.update({
      where: { id: uploadLink.id },
      data: { usedCount: { increment: 1 } }
    });

    res.json({
      status: 'success',
      data: uploadedFiles
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Failed to process upload'
    });
  }
});

// Delete a project
router.delete('/projects/:projectId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;

    // Get project with all associated files
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        files: true,
        client: true
      }
    });

    if (!project) {
      return res.status(404).json({
        status: 'error',
        message: 'Project not found'
      });
    }

    // Delete all files from S3
    for (const file of project.files) {
      if (file.storage === 's3' && file.path) {
        try {
          await s3Service.deleteFile(file.path);
          console.log(`Deleted file from S3: ${file.path}`);
        } catch (s3Error) {
          console.error(`Failed to delete file from S3: ${file.path}`, s3Error);
          // Continue with deletion even if S3 deletion fails
        }
      }
    }

    // Delete the project (cascading delete will handle upload links)
    await prisma.project.delete({
      where: { id: projectId }
    });

    res.json({
      status: 'success',
      message: 'Project deleted successfully'
    });
  } catch (error) {
    console.error('Failed to delete project:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Failed to delete project'
    });
  }
});

// Update a project
router.put('/projects/:projectId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { name, description } = req.body;
    
    // Check if project exists
    const projectExists = await prisma.project.findUnique({
      where: { id: projectId }
    });
    
    if (!projectExists) {
      return res.status(404).json({
        status: 'error',
        message: 'Project not found'
      });
    }
    
    // Update the project
    const updatedProject = await prisma.project.update({
      where: { id: projectId },
      data: { 
        name: name !== undefined ? name : undefined,
        description: description !== undefined ? description : undefined
      },
      include: {
        client: true
      }
    });
    
    res.json({
      status: 'success',
      data: updatedProject
    });
  } catch (error) {
    console.error('Failed to update project:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update project'
    });
  }
});

// Get a single project
router.get('/projects/:projectId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        client: true,
        uploadLinks: true,
        files: true,
      }
    });

    if (!project) {
      return res.status(404).json({
        status: 'error',
        message: 'Project not found'
      });
    }

    // Check if .turbosort file exists for this project
    // Note: The turbosort directory is stored in a .turbosort file in the project directory,
    // not in the database. This allows for easier integration with external file-based tools.
    let turbosortContent = null;
    try {
      // Construct the path to the project directory
      const projectPath = path.join(process.env.UPLOAD_DIR || 'uploads', projectId);
      const turbosortPath = path.join(projectPath, '.turbosort');
      
      // Check if the file exists locally
      if (fs.existsSync(turbosortPath)) {
        // Read the content of the .turbosort file
        turbosortContent = fs.readFileSync(turbosortPath, 'utf8').trim();
      } 
      // If not found locally and we have client info, try to get from S3
      else if (project.client && project.client.code) {
        try {
          // Generate S3 key based on client and project name
          const s3Key = s3Service.generateKey(
            project.client.code,
            project.name,
            '.turbosort'
          );

          // Try to get the file from S3
          const s3Object = await s3Service.getFileContent(s3Key);
          if (s3Object) {
            turbosortContent = s3Object.toString('utf8').trim();
            
            // Cache the S3 content locally for future use
            if (!fs.existsSync(projectPath)) {
              fs.mkdirSync(projectPath, { recursive: true });
            }
            fs.writeFileSync(turbosortPath, turbosortContent);
            console.log(`Cached turbosort file from S3 to local path: ${turbosortPath}`);
          }
        } catch (s3Error) {
          console.error('Failed to get turbosort file from S3:', s3Error);
          // Don't fail the request if we can't get the file from S3
        }
      }
    } catch (err) {
      console.error('Error reading .turbosort file:', err);
      // Don't fail the request if we can't read the file
    }

    // Add the turbosort content to the response
    res.json({
      status: 'success',
      data: {
        ...project,
        turbosortDirectory: turbosortContent
      }
    });
  } catch (error) {
    console.error('Failed to fetch project:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Failed to fetch project'
    });
  }
});

// Delete a client
router.delete('/clients/:clientId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { clientId } = req.params;
    
    // Check if client exists and get all associated data
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: { 
        projects: {
          include: {
            files: true,
            uploadLinks: true
          }
        }
      }
    });
    
    if (!client) {
      return res.status(404).json({
        status: 'error',
        message: 'Client not found'
      });
    }

    // Delete all files from S3 for each project
    for (const project of client.projects) {
      for (const file of project.files) {
        if (file.storage === 's3' && file.path) {
          try {
            await s3Service.deleteFile(file.path);
            console.log(`Deleted file from S3: ${file.path}`);
          } catch (s3Error) {
            console.error(`Failed to delete file from S3: ${file.path}`, s3Error);
            // Continue with deletion even if S3 deletion fails
          }
        }
      }
    }
    
    // Delete the client (cascading delete will handle projects and upload links)
    await prisma.client.delete({
      where: { id: clientId }
    });
    
    res.json({
      status: 'success',
      message: 'Client deleted successfully'
    });
  } catch (error) {
    console.error('Failed to delete client:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Failed to delete client. Make sure there are no active uploads for this client.'
    });
  }
});

// Delete an upload link
router.delete('/upload-links/:linkId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { linkId } = req.params;
    
    // Check if upload link exists
    const uploadLink = await prisma.uploadLink.findUnique({
      where: { id: linkId }
    });
    
    if (!uploadLink) {
      return res.status(404).json({
        status: 'error',
        message: 'Upload link not found'
      });
    }
    
    // Delete the upload link
    await prisma.uploadLink.delete({
      where: { id: linkId }
    });
    
    res.json({
      status: 'success',
      message: 'Upload link deleted successfully'
    });
  } catch (error) {
    console.error('Failed to delete upload link:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Failed to delete upload link'
    });
  }
});

// Update upload link
router.put('/upload-links/:linkId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { linkId } = req.params;
    const { expiresAt, maxUses } = req.body;
    
    // Check if upload link exists
    const uploadLink = await prisma.uploadLink.findUnique({
      where: { id: linkId },
      include: {
        project: {
          include: {
            client: true
          }
        }
      }
    });
    
    if (!uploadLink) {
      return res.status(404).json({
        status: 'error',
        message: 'Upload link not found'
      });
    }
    
    // Update the upload link
    const updatedLink = await prisma.uploadLink.update({
      where: { id: linkId },
      data: {
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        maxUses: maxUses !== undefined ? maxUses : undefined
      },
      include: {
        project: {
          include: {
            client: true
          }
        }
      }
    });
    
    // Generate the full upload URL
    const uploadUrl = `https://upload.colourstream.johnrogerscolour.co.uk/${updatedLink.token}`;
    
    res.json({
      status: 'success',
      data: {
        ...updatedLink,
        uploadUrl
      }
    });
  } catch (error) {
    console.error('Failed to update upload link:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Failed to update upload link'
    });
  }
});

// Get all upload links with client and project information (with a fixed route name)
router.get('/upload-links-all', authenticateToken, async (req: Request, res: Response) => {
  try {
    console.log('GET /upload-links-all - Request received');
    console.log('User ID from auth token:', req.user?.userId);
    console.log('Auth headers:', req.headers.authorization);
    
    // Check if we have upload links in the database
    const count = await prisma.uploadLink.count();
    console.log(`Total upload links in database: ${count}`);
    
    // Always return links regardless of auth to debug the issue
    const uploadLinks = await prisma.uploadLink.findMany({
      include: {
        project: {
          include: {
            client: true
          }
        }
      },
      orderBy: [
        { createdAt: 'desc' }
      ]
    });
    
    console.log(`Found ${uploadLinks.length} upload links`);
    
    res.json({
      status: 'success',
      data: uploadLinks
    });
  } catch (error) {
    console.error('Failed to fetch upload links:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Failed to fetch upload links'
    });
  }
});

// --- Remove backend signing endpoints ---
// router.get('/s3-params/:token', ... ); 
// router.get('/s3-part-params/:token', ... );
// router.post('/s3-complete/:token', ... );
// router.post('/s3-abort/:token', ... );
// --- End remove backend signing endpoints ---

// Endpoint for Companion to notify backend after successful S3 upload
router.post('/s3-callback', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const filename = req.query.filename as string;
    // Remove multipart query param check - AwsS3Multipart plugin always uses multipart flow
    
    if (!filename) {
      return res.status(400).json({
        status: 'error',
        message: 'Filename is required'
      });
    }

    // Validate the upload token
    const uploadLink = await prisma.uploadLink.findUnique({
      where: { token },
      include: {
        project: {
          include: {
            client: true
          }
        }
      }
    });

    if (!uploadLink) {
      return res.status(404).json({
        status: 'error',
        message: 'Upload link not found'
      });
    }

    if (uploadLink.expiresAt < new Date()) {
      return res.status(403).json({
        status: 'error',
        message: 'Upload link has expired'
      });
    }

    // Clean the filename by removing UUIDs
    // This regex matches UUIDs in formats like:
    // - f53671c2-f356-417a-b14e-1c1b6476d723-Protape-Ltd-t-a-DataStores-50879.pdf
    // - prefix-uuid-filename.ext or uuid-filename.ext
    const uuidRegex = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-)/gi;
    const cleanFilename = filename.replace(uuidRegex, '');
    
    // Generate S3 key for this file - using the clean $CLIENT/$PROJECT/FILENAME structure
    // Ensure clientCode and projectName are defined here using the validated uploadLink
    const clientCode = uploadLink.project.client.code || 'default';
    const projectName = uploadLink.project.name || 'default';
    
    // Remove unused normalization variables
    // const normalizedClientCode = clientCode.replace(/\s+/g, '_');
    // const normalizedProjectName = projectName.replace(/\s+/g, '_');
    
    // Create the key directly
    const s3Key = s3Service.generateKey(clientCode, projectName, cleanFilename);
    
    logger.info(`Generated S3 key for upload: ${s3Key}`);
    
    // Enhanced logging for debugging filename issues
    logger.info(`File upload request - Original filename: "${filename}"`);
    logger.info(`Cleaned filename: "${cleanFilename}"`);
    logger.info(`Generated S3 key: "${s3Key}" for file: "${filename}"`);
    logger.info(`Client code: "${uploadLink.project.client.code || 'default'}", Project name: "${uploadLink.project.name}"`);

    // Always initiate multipart upload when using AwsS3Multipart plugin
    const { uploadId, key } = await s3Service.createMultipartUpload(s3Key, filename);
  try {
    // Companion sends upload details in the request body
    const { name, size, mimeType, metadata, s3 } = req.body;
    const s3Key = s3?.key; // Key where Companion uploaded the file

    logger.info('[/s3-callback] Received callback from Companion');
    logger.info('[/s3-callback] Body:', JSON.stringify(req.body, null, 2));

    if (!metadata || !metadata.token || !s3Key) {
      logger.error('[/s3-callback] Missing required metadata (token) or S3 key from Companion callback');
      return res.status(400).json({ status: 'error', message: 'Missing required data from Companion' });
    }

    const token = metadata.token;

    // Validate the token
    const uploadLink = await prisma.uploadLink.findUnique({
      where: { token },
      include: { project: { include: { client: true } } }
    });

    if (!uploadLink) {
      logger.error(`[/s3-callback] Invalid token received: ${token}`);
      // Optionally delete the orphaned file from S3
      // await s3Service.deleteFile(s3Key);
      return res.status(403).json({ status: 'error', message: 'Invalid upload token' });
    }

    // Check expiry and usage limits
    if (uploadLink.expiresAt < new Date() || (uploadLink.maxUses !== null && uploadLink.usedCount >= uploadLink.maxUses)) {
       logger.warn(`[/s3-callback] Expired or over-limit token used: ${token}`);
       // Optionally delete the orphaned file from S3
       // await s3Service.deleteFile(s3Key);
       return res.status(403).json({ status: 'error', message: 'Upload link expired or limit reached' });
    }

    // Generate a unique ID for tracking this specific upload instance
    const trackerId = `s3-companion-${s3Key.replace(/\//g, '-')}`;

    // Create the database record (initially with Companion's key)
    // We'll use the s3FileProcessor later to rename and update the path/URL
    const uploadedFile = await prisma.uploadedFile.create({
      data: {
        name: metadata.name || name || 'unknown', // Use metadata name if available
        path: s3Key, // Store Companion's key initially
        size: size || 0,
        mimeType: mimeType || 'application/octet-stream',
        hash: `s3-companion-${uuidv4()}`, // Placeholder hash, could get ETag from S3 later if needed
        project: { connect: { id: uploadLink.projectId } },
        status: 'processing', // Mark as processing until renamed
        completedAt: new Date(),
        storage: 's3',
        url: null // URL will be set after renaming
      }
    });

    // Increment usage count immediately
    await prisma.uploadLink.update({
      where: { id: uploadLink.id },
      data: { usedCount: { increment: 1 } }
    });

    // Trigger the S3 file processor to rename/organize the file
    // Pass the newly created file ID and the token
    logger.info(`[/s3-callback] Triggering S3 file processing for file ID: ${uploadedFile.id}, S3 Key: ${s3Key}`);
    s3FileProcessor.processFile(uploadedFile.id, token)
      .then(success => {
        if (success) {
          logger.info(`[/s3-callback] S3 file processing successful for file ID: ${uploadedFile.id}`);
          // Mark upload complete in tracker AFTER successful processing
          uploadTracker.completeUpload(trackerId); 
        } else {
          logger.error(`[/s3-callback] S3 file processing failed for file ID: ${uploadedFile.id}`);
          // Handle failure - maybe update status to 'failed'?
          prisma.uploadedFile.update({ where: { id: uploadedFile.id }, data: { status: 'failed' } }).catch();
        }
      })
      .catch(error => {
        logger.error(`[/s3-callback] Error during S3 file processing for file ID: ${uploadedFile.id}`, error);
        prisma.uploadedFile.update({ where: { id: uploadedFile.id }, data: { status: 'failed' } }).catch();
      });

    // Respond to Companion immediately - processing happens async
    res.status(200).json({ status: 'success', message: 'Upload received, processing started' });

  } catch (error) {
    logger.error('[/s3-callback] Error processing Companion callback:', error);
    res.status(500).json({ status: 'error', message: 'Internal server error processing callback' });
  }
});


// Add an endpoint to trigger S3 filename cleanup manually
router.post('/cleanup-filenames', authenticateToken, async (_req: Request, res: Response) => {
  try {
    // Start the cleanup process using the imported processor
    await s3FileProcessor.processAllFiles();
    
    res.json({
      status: 'success',
      message: 'S3 filename cleanup process completed successfully'
    });
  } catch (error) {
    console.error('Failed to run filename cleanup:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Failed to run filename cleanup process'
    });
  }
});

// New endpoint to receive progress updates from the frontend
router.post('/progress/:token', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const { uploadId, bytesUploaded, bytesTotal, filename, clientName, projectName } = req.body;

    // Basic validation
    if (!uploadId || bytesUploaded === undefined || bytesTotal === undefined || !filename || !token) {
      logger.warn('[Progress Update] Received incomplete payload:', req.body);
      return res.status(400).json({ status: 'error', message: 'Incomplete progress data' });
    }

    // Validate token (optional but good practice)
    // You might want to add a quick check here if needed, similar to other routes

    const telegramBot = getTelegramBot();
    if (!telegramBot) {
      logger.error('[Progress Update] Telegram bot not initialized.');
      // Don't block the frontend, just log the error server-side
      return res.status(200).json({ status: 'warning', message: 'Telegram bot not available' });
    }

    // Prepare data for the notification function
    const uploadInfo = {
      id: uploadId, // Use the uploadId provided by Uppy/frontend
      size: Number(bytesTotal),
      offset: Number(bytesUploaded),
      metadata: {
        filename: filename,
        // Add client/project if available in request body
        clientName: clientName || 'Unknown Client',
        projectName: projectName || 'Unknown Project',
        token: token, // Include token if needed
      },
      // isComplete: false, // Explicitly ensure progress endpoint doesn't mark as complete
      storage: 's3', // Assuming these are S3 uploads via Companion
      // uploadSpeed: Can be calculated if needed, but let telegramBot handle it for now
    };

    // Send notification (don't wait for it to finish)
    telegramBot.sendUploadNotification(uploadInfo).catch((err: any) => { // Add type to err
      logger.error(`[Progress Update] Error sending Telegram notification for ${uploadId}:`, err);
    });

    // Respond quickly to the frontend
    res.status(200).json({ status: 'success', message: 'Progress received' });

  } catch (error) {
    logger.error('[Progress Update] Error processing progress update:', error);
    // Avoid sending error back to frontend unless necessary
    res.status(500).json({ status: 'error', message: 'Internal server error processing progress' });
  }
});

// Set turbosort directory for a project
// Note: The turbosort directory is stored in a .turbosort file in the project directory,
// not in the database. This allows for easier integration with external file-based tools.
router.post('/projects/:projectId/turbosort', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { directory } = req.body;

    if (!directory || typeof directory !== 'string') {
      return res.status(400).json({
        status: 'error',
        message: 'Directory name is required'
      });
    }

    // Validate that the project exists
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        client: true
      }
    });

    if (!project) {
      return res.status(404).json({
        status: 'error',
        message: 'Project not found'
      });
    }

    // Construct the path to the project directory
    const projectPath = path.join(process.env.UPLOAD_DIR || 'uploads', projectId);
    
    // Create the project directory if it doesn't exist
    if (!fs.existsSync(projectPath)) {
      fs.mkdirSync(projectPath, { recursive: true });
    }

    // Write the directory name to the .turbosort file
    const turbosortPath = path.join(projectPath, '.turbosort');
    fs.writeFileSync(turbosortPath, directory);

    // Also save the .turbosort file to S3 if project has a client
    if (project.client && project.client.code) {
      try {
        // Generate S3 key based on client and project name
        const s3Key = s3Service.generateKey(
          project.client.code,
          project.name,
          '.turbosort'
        );

        // Upload the .turbosort file to S3
        await s3Service.uploadFile(
          Buffer.from(directory),
          s3Key,
          'text/plain',
          {
            clientName: project.client.name,
            projectName: project.name,
            turbosortDirectory: 'true'
          }
        );

        console.log(`Turbosort file uploaded to S3 at key: ${s3Key}`);
      } catch (s3Error) {
        console.error('Failed to upload turbosort file to S3:', s3Error);
        // Don't fail the request if S3 upload fails, we still have the local file
      }
    }

    res.json({
      status: 'success',
      message: 'Turbosort directory set successfully',
      data: { directory }
    });
  } catch (error) {
    console.error('Failed to set turbosort directory:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to set turbosort directory'
    });
  }
});

// Delete turbosort file for a project
router.delete('/projects/:projectId/turbosort', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;

    // Validate that the project exists
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        client: true
      }
    });

    if (!project) {
      return res.status(404).json({
        status: 'error',
        message: 'Project not found'
      });
    }

    // Construct the path to the .turbosort file
    const projectPath = path.join(process.env.UPLOAD_DIR || 'uploads', projectId);
    const turbosortPath = path.join(projectPath, '.turbosort');
    
    // Check if the file exists before attempting to delete
    if (fs.existsSync(turbosortPath)) {
      fs.unlinkSync(turbosortPath);
    }

    // Also delete from S3 if project has a client
    if (project.client && project.client.code) {
      try {
        // Generate S3 key based on client and project name
        const s3Key = s3Service.generateKey(
          project.client.code,
          project.name,
          '.turbosort'
        );

        // Delete the .turbosort file from S3
        await s3Service.deleteFile(s3Key);
        console.log(`Turbosort file deleted from S3 at key: ${s3Key}`);
      } catch (s3Error) {
        console.error('Failed to delete turbosort file from S3:', s3Error);
        // Don't fail the request if S3 deletion fails
      }
    }

    res.json({
      status: 'success',
      message: 'Turbosort file deleted successfully'
    });
  } catch (error) {
    console.error('Failed to delete turbosort file:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to delete turbosort file'
    });
  }
});

export default router; 
