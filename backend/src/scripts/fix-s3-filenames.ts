/**
 * S3 Filename Fixer
 * 
 * This script detects files in S3 with UUID prefixes and renames them to follow the
 * CLIENT/PROJECT/filename structure. It can be run on a schedule or triggered by events.
 */

import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { s3Service } from '../services/s3/s3Service';
import { logger } from '../utils/logger';
import { PrismaClient } from '@prisma/client';

// Use the existing Prisma client
const prisma = new PrismaClient();

// UUID detection regex - include trailing hyphen if present
const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-?/i;

/**
 * Initialize S3 client for direct operations
 */
const s3Client = new S3Client({
  region: process.env.S3_REGION || 'us-east-1',
  endpoint: process.env.S3_ENDPOINT || 'http://minio:9000',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
    secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
  },
  forcePathStyle: true,
});

const bucket = process.env.S3_BUCKET || 'uploads';

/**
 * List all objects in the S3 bucket 
 * (Helper function since s3Service doesn't expose this directly)
 */
async function listAllS3Objects() {
  try {
    const command = new ListObjectsV2Command({
      Bucket: bucket,
    });
    
    const response = await s3Client.send(command);
    
    if (!response.Contents) {
      logger.info('No objects found in bucket');
      return [];
    }
    
    logger.info(`Found ${response.Contents.length} objects in bucket`);
    return response.Contents;
  } catch (error) {
    logger.error('Error listing S3 objects:', error);
    throw error;
  }
}

/**
 * Extract client and project from a path
 * @param path S3 object key path
 * @returns Extracted client and project codes
 */
function extractPathInfo(path: string): { clientCode: string | null; projectCode: string | null } {
  const parts = path.split('/').filter(Boolean);
  
  if (parts.length >= 2) {
    return {
      clientCode: parts[0] || null,
      projectCode: parts[1] || null
    };
  }
  
  // Not enough parts to extract client/project
  return {
    clientCode: null, 
    projectCode: null
  };
}

/**
 * Determine if a key contains a UUID
 * @param key S3 object key
 * @returns Whether the key contains a UUID
 */
function hasUuid(key: string): boolean {
  return UUID_REGEX.test(key);
}

/**
 * Attempt to find a file in the database by key or similar keys
 * @param key S3 object key
 * @returns Client and project information if found
 */
async function findFileInDatabase(key: string): Promise<{ clientCode: string | null; projectCode: string | null }> {
  // Try to find an exact match first
  const file = await prisma.uploadedFile.findFirst({
    where: { path: key },
    include: { 
      project: {
        include: {
          client: true
        }
      }
    }
  });

  if (file?.project?.client) {
    logger.info(`Found file in database with client=${file.project.client.code} project=${file.project.name}`);
    return {
      clientCode: file.project.client.code,
      projectCode: file.project.name
    };
  }
  
  // Try to find by filename without UUID
  const filename = key.split('/').pop() || '';
  const cleanFilename = filename.replace(UUID_REGEX, '');
  
  if (cleanFilename !== filename) {
    // Try to match based on clean filename, but prioritize the most recent upload
    // This ensures that when different clients use the same assets, we use the most recent context
    const fileByName = await prisma.uploadedFile.findFirst({
      where: {
        name: {
          contains: cleanFilename
        }
      },
      include: {
        project: {
          include: {
            client: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc' // Get the most recent file
      }
    });
    
    if (fileByName?.project?.client) {
      logger.info(`Found similar file in database with client=${fileByName.project.client.code} project=${fileByName.project.name} (most recent upload)`);
      return {
        clientCode: fileByName.project.client.code,
        projectCode: fileByName.project.name
      };
    }
  }
  
  // Try to extract client/project information from existing path parts if available
  const pathParts = key.split('/');
  if (pathParts.length >= 3) {
    // The key might already have client/project information in it
    const possibleClient = pathParts[0];
    const possibleProject = pathParts[1];
    
    if (possibleClient && possibleProject && possibleClient !== 'default' && possibleProject !== 'default') {
      logger.info(`Using existing path structure for client=${possibleClient} project=${possibleProject}`);
      return {
        clientCode: possibleClient,
        projectCode: possibleProject
      };
    }
  }
  
  return {
    clientCode: null,
    projectCode: null
  };
}

/**
 * Generate a clean key for a file by removing UUID and ensuring proper structure
 * @param key Original S3 key
 * @returns Clean key in /CLIENT/PROJECT/filename format
 */
async function generateCleanKey(key: string): Promise<string> {
  // First check if we can get client/project from database
  const dbInfo = await findFileInDatabase(key);
  
  // If we couldn't find in DB, try to extract from path
  const pathInfo = extractPathInfo(key);
  
  // If the file is already in a client/project folder structure and not in default
  // and we don't have specific DB info, preserve the existing structure
  if (!dbInfo.clientCode && pathInfo.clientCode && pathInfo.projectCode && 
      pathInfo.clientCode !== 'default' && pathInfo.projectCode !== 'default') {
    // Keep existing organization if it looks valid
    const filename = key.split('/').pop() || '';
    const cleanFilename = filename.replace(UUID_REGEX, '').replace(/^-+/, '').replace(/-+/g, '-');
    
    logger.info(`Preserving existing folder structure: ${pathInfo.clientCode}/${pathInfo.projectCode}`);
    
    // Use the existing path structure but clean the filename
    return `${pathInfo.clientCode}/${pathInfo.projectCode}/${cleanFilename}`;
  }
  
  // Use DB info if available, fall back to path info, then default
  const clientCode = dbInfo.clientCode || pathInfo.clientCode || 'default';
  const projectCode = dbInfo.projectCode || pathInfo.projectCode || 'default';
  
  // Get filename and clean it - ensure we don't leave empty or double hyphens
  const filename = key.split('/').pop() || '';
  const cleanFilename = filename.replace(UUID_REGEX, '').replace(/^-+/, '').replace(/-+/g, '-');

  // Normalize client and project names - preserve case and replace spaces with underscores
  const normalizedClient = clientCode.replace(/\s+/g, '_');
  const normalizedProject = projectCode.replace(/\s+/g, '_');
  
  // Log if we're using default folders
  if (clientCode === 'default' || projectCode === 'default') {
    logger.warn(`Using default folder(s) for file: ${key} -> ${normalizedClient}/${normalizedProject}/${cleanFilename}`);
  }
  
  // Format as /CLIENT/PROJECT/filename
  return `${normalizedClient}/${normalizedProject}/${cleanFilename}`;
}

/**
 * Fix filenames in S3 by removing UUIDs and ensuring proper /CLIENT/PROJECT/filename structure
 */
export async function fixS3Filenames(): Promise<void> {
  logger.info('Starting S3 filename cleanup process');
  
  try {
    // List all objects in S3 using our helper function
    const objects = await listAllS3Objects();
    let renamedCount = 0;
    let skippedCount = 0;
    
    for (const object of objects) {
      const key = object.Key;
      
      if (!key) continue;
      
      // Skip thumbnail files and dotfiles (system files)
      if (key.includes('/_thumb/') || key.split('/').pop()?.startsWith('.')) {
        logger.debug(`Skipping system file or thumbnail: ${key}`);
        continue;
      }
      
      // Check if the key contains a UUID
      if (hasUuid(key)) {
        try {
          // Generate a clean key
          const cleanKey = await generateCleanKey(key);
          
          // Don't rename if the key is already clean
          if (cleanKey === key) {
            logger.debug(`Key is already clean: ${key}`);
            skippedCount++;
            continue;
          }
          
          // Be cautious about renaming to default directory
          const cleanKeyParts = cleanKey.split('/');
          if (cleanKeyParts[0] === 'default' || cleanKeyParts[1] === 'default') {
            // If the original key has a better structure than default/default, skip renaming
            const originalParts = key.split('/');
            if (originalParts.length >= 3 && 
                (originalParts[0] !== 'default' && originalParts[1] !== 'default')) {
              logger.warn(`Skipping renaming to default directory when original had better structure: ${key}`);
              skippedCount++;
              continue;
            }
          }
          
          // Rename the object
          logger.info(`Renaming object from ${key} to ${cleanKey}`);
          await s3Service.renameObject(key, cleanKey);
          renamedCount++;
          
          // Update file record in database if exists
          const fileRecord = await prisma.uploadedFile.findFirst({
            where: { path: key }
          });
          
          if (fileRecord) {
            await prisma.uploadedFile.update({
              where: { id: fileRecord.id },
              data: { path: cleanKey }
            });
            logger.info(`Updated database record for ${key} to ${cleanKey}`);
          }
        } catch (error) {
          logger.error(`Error renaming object ${key}:`, error);
        }
      }
    }
    
    logger.info(`S3 filename cleanup completed. Renamed ${renamedCount} objects, skipped ${skippedCount} objects.`);
  } catch (error) {
    logger.error('Error during S3 filename cleanup:', error);
    throw error;
  }
}

// If this script is run directly, execute the cleanup
if (require.main === module) {
  fixS3Filenames()
    .then(() => {
      logger.info('S3 filename cleanup completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('S3 filename cleanup failed:', error);
      process.exit(1);
    });
}

export default fixS3Filenames; 