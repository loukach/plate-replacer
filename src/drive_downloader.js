const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

/**
 * Downloads all files from a Google Drive folder
 * @param {string} folderId - The Google Drive folder ID
 * @param {string} destPath - Destination path to save downloaded files
 * @returns {Promise<Array<string>>} - Array of downloaded file paths
 */
async function downloadDriveFolder(folderId, destPath) {
  console.log(`Downloading files from Google Drive folder: ${folderId}`);
  
  // Make sure destination directory exists
  fs.mkdirSync(destPath, { recursive: true });
  
  try {
    // Initialize Drive API (for public files only)
    const drive = google.drive({ version: 'v3' });
    
    // List files in the folder
    console.log('Listing files in the Drive folder...');
    
    try {
      console.log('\n==== GOOGLE DRIVE API REQUEST ====');
      console.log('Requesting file list with parameters:');
      console.log(` - Folder ID: ${folderId}`);
      console.log(` - Query: '${folderId}' in parents and trashed = false`);
      console.log('==================================\n');
      
      const response = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'files(id, name, mimeType)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      });
      
      console.log('\n==== GOOGLE DRIVE API RESPONSE ====');
      console.log('Response data:', JSON.stringify(response.data, null, 2));
      console.log('====================================\n');
      
      if (!response.data.files || response.data.files.length === 0) {
        console.log('No files found in the Drive folder.');
        return [];
      }
      
      // Filter image files
      const imageFiles = response.data.files.filter(file => 
        file.mimeType.startsWith('image/') || 
        file.mimeType === 'application/octet-stream'
      );
      
      console.log(`Found ${imageFiles.length} image files to download.`);
      
      if (imageFiles.length === 0) {
        return [];
      }
      
      // Direct download link for Google Drive
      const getDownloadLink = (fileId) => 
        `https://drive.google.com/uc?export=download&id=${fileId}`;
      
      // Download each file
      const downloadedFiles = [];
      
      for (const file of imageFiles) {
        const filePath = path.join(destPath, file.name);
        console.log(`Downloading: ${file.name}`);
        
        try {
          // Download the file using google drive API
          const dest = fs.createWriteStream(filePath);
          
          const response = await drive.files.get(
            { fileId: file.id, alt: 'media' },
            { responseType: 'stream' }
          );
          
          response.data
            .on('end', () => {
              console.log(`Downloaded: ${file.name}`);
            })
            .on('error', (err) => {
              console.error(`Error downloading ${file.name}: ${err}`);
              fs.unlinkSync(filePath);
            })
            .pipe(dest);
          
          // Wait for download to complete
          await new Promise((resolve, reject) => {
            dest.on('finish', resolve);
            dest.on('error', reject);
          });
          
          downloadedFiles.push(filePath);
          
        } catch (err) {
          console.error(`Error downloading file ${file.name}: ${err.message}`);
          // Clean up partial download if it exists
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        }
      }
      
      return downloadedFiles;
      
    } catch (err) {
      console.error(`Error listing files: ${err.message}`);
      console.log('Note: Google Drive access may be restricted. Make sure the folder is publicly accessible.');
      return [];
    }
    
  } catch (error) {
    console.error(`Error accessing Google Drive: ${error.message}`);
    return [];
  }
}

/**
 * Extract folder ID from Google Drive URL
 * @param {string} url - Google Drive URL
 * @returns {string|null} - Folder ID or null if not found
 */
function extractFolderId(url) {
  // Match folder ID from URL patterns like:
  // - https://drive.google.com/drive/folders/1JK6krCUAgSUqX7H5RzLCjtMNqWPnKU0W?usp=sharing
  // - https://drive.google.com/drive/u/0/folders/1JK6krCUAgSUqX7H5RzLCjtMNqWPnKU0W
  const folderIdRegex = /folders\/([a-zA-Z0-9_-]+)/;
  const match = url.match(folderIdRegex);
  
  if (match && match[1]) {
    return match[1];
  }
  
  return null;
}

module.exports = {
  downloadDriveFolder,
  extractFolderId
};