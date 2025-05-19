#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

// Load configuration
const CONFIG = require('./config.json');

// Configuration settings
const OUTPUT_DIR = path.join(__dirname, '../output_images');
const POLLING_INTERVAL = CONFIG.polling.intervalMs;
const MAX_RETRIES = CONFIG.polling.maxRetries;
const OUTPUT_SUFFIX = CONFIG.output.suffix;
const API_KEY = CONFIG.api.apiKey;
const PLATE_DIR = path.join(__dirname, '../plate');
const REMOTE_URL = CONFIG.googleDrive.folderUrl;
const PARALLEL_PROCESSING = CONFIG.processing.parallelProcessing || false;
const MAX_CONCURRENT = CONFIG.processing.maxConcurrent || 3;

// Find the first PNG file in the plate directory
function findPlateImage() {
  try {
    const files = fs.readdirSync(PLATE_DIR);
    const pngFile = files.find(file => file.toLowerCase().endsWith('.png'));
    
    if (pngFile) {
      return path.join(PLATE_DIR, pngFile);
    } else {
      console.error('❌ No PNG file found in the plate directory. Please add a PNG logo file.');
      process.exit(1);
    }
  } catch (error) {
    console.error(`❌ Error reading plate directory: ${error.message}`);
    process.exit(1);
  }
}

const PLATE_IMAGE_PATH = findPlateImage();

// Ensure output directory exists
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Get image URLs from the remote source
async function getImageUrls(remoteUrl) {
  console.log(`Getting images from: ${remoteUrl}`);
  
  try {
    // Extract folder ID from the Google Drive URL
    let folderId;
    if (remoteUrl.includes('/folders/')) {
      folderId = remoteUrl.split('/folders/')[1].split('/')[0].split('?')[0];
    } else {
      throw new Error('Invalid Google Drive folder URL. Must contain "/folders/" segment');
    }
    
    console.log(`Google Drive folder ID: ${folderId}`);
    
    // Get folder content using Google Drive API (public folder listing)
    const response = await axios.get(`https://drive.google.com/drive/folders/${folderId}`, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml'
      }
    });
    
    // Look for file IDs in the HTML response
    const fileIdsSet = new Set();
    const html = response.data;
    
    // Pattern to match file IDs in the HTML
    const pattern = /\/file\/d\/([a-zA-Z0-9_-]+)/g;
    let match;
    
    while ((match = pattern.exec(html)) !== null) {
      const fileId = match[1];
      if (fileId && !fileId.includes('\\') && !fileId.includes('&') && fileId.length > 10) {
        fileIdsSet.add(fileId);
      }
    }
    
    // Convert file IDs to direct download URLs
    const imageUrls = Array.from(fileIdsSet).map(fileId => 
      `https://drive.google.com/uc?export=download&id=${fileId}`
    );
    
    if (imageUrls.length === 0) {
      console.warn('⚠️ No files found in the remote folder or folder might be private');
      // Fallback to hardcoded URLs if configured folder is empty or inaccessible
      console.log('Using sample images as fallback:');
      return [
        "https://drive.google.com/uc?export=download&id=1siW1i8uEthjkZKvUnNCkr0lS9tGvHf5m",
        "https://drive.google.com/uc?export=download&id=1_LUKh35xzw5li7QgFhlb-QHjBNvea7y5"
      ];
    }
    
    console.log(`Found ${imageUrls.length} images in remote folder:`);
    imageUrls.forEach(url => console.log(`- ${url}`));
    return imageUrls;
    
  } catch (error) {
    console.error(`❌ Error fetching files from Google Drive: ${error.message}`);
    
    // Fallback to hardcoded URLs if there's an error
    console.log('Using sample images as fallback:');
    return [
      "https://drive.google.com/uc?export=download&id=1siW1i8uEthjkZKvUnNCkr0lS9tGvHf5m",
      "https://drive.google.com/uc?export=download&id=1_LUKh35xzw5li7QgFhlb-QHjBNvea7y5"
    ];
  }
}

// Process a single image URL
async function processImage(imageUrl) {
  // Generate filename from URL
  let filename;
  
  try {
    // Check if it's a Google Drive URL and extract file ID
    if (imageUrl.includes('drive.google.com')) {
      // Handle different Google Drive URL formats
      if (imageUrl.includes('id=')) {
        // Format: https://drive.google.com/uc?export=download&id=FILE_ID
        const idParam = imageUrl.split('id=')[1];
        filename = idParam ? idParam.split('&')[0] : `image_${Date.now()}`;
      } else if (imageUrl.includes('/d/')) {
        // Format: https://drive.google.com/file/d/FILE_ID/view
        const urlParts = imageUrl.split('/d/');
        if (urlParts[1]) {
          filename = urlParts[1].split('/')[0];
        } else {
          filename = `image_${Date.now()}`;
        }
      } else {
        // Fallback for other formats
        filename = `image_${Date.now()}`;
      }
    } else {
      // For non-Google Drive URLs
      const urlParts = imageUrl.split('/');
      filename = urlParts[urlParts.length - 1].split('?')[0];
      
      // If filename is still empty or has invalid characters
      if (!filename || filename.includes('=') || filename.includes('&')) {
        filename = `image_${Date.now()}`;
      }
    }
  } catch (error) {
    console.warn(`⚠️ Error extracting filename from URL: ${error.message}`);
    // Fallback to timestamp-based filename
    filename = `image_${Date.now()}`;
  }
  
  const outputPath = path.join(OUTPUT_DIR, `${filename}${OUTPUT_SUFFIX}.png`);
  
  console.log(`\n=========================================`);
  console.log(`Processing: ${filename}`);
  console.log(`Image URL: ${imageUrl}`);
  console.log(`=========================================\n`);
  
  try {
    // Create form data for API request
    const formData = new FormData();
    formData.append('image_url', imageUrl);
    formData.append('cut_type', CONFIG.processing.cutType);
    formData.append('guideline_id', CONFIG.processing.guidelineId);
    formData.append('license_plate', fs.createReadStream(PLATE_IMAGE_PATH));
    
    console.log('📤 Sending request to Car-Cutter API...');
    console.log(`API Endpoint: ${CONFIG.api.baseUrl}/submission`);
    console.log('Request Parameters:');
    console.log(`- image_url: ${imageUrl}`);
    console.log(`- cut_type: ${CONFIG.processing.cutType}`);
    console.log(`- guideline_id: ${CONFIG.processing.guidelineId}`);
    console.log(`- license_plate: ${PLATE_IMAGE_PATH}`);
    
    // Send request to the API
    const response = await axios.post(
      `${CONFIG.api.baseUrl}/submission`, 
      formData, 
      {
        headers: {
          ...formData.getHeaders(),
          'Authorization': `Bearer ${API_KEY}`
        }
      }
    );
    
    console.log('\n📥 API Response:');
    console.log(`Status Code: ${response.status}`);
    console.log('Response Body:');
    console.log(JSON.stringify(response.data, null, 2));
    console.log('Submission successful');
    
    // Poll for status until complete
    const processedImageUrl = await pollForCompletion(imageUrl);
    
    // Download the result
    console.log('📥 Downloading processed image...');
    await downloadResult(processedImageUrl, outputPath);
    console.log(`✅ Saved to: ${path.basename(outputPath)}`);
    return true;
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    if (error.response) {
      console.error('Response Status:', error.response.status);
      console.error('Response Headers:', JSON.stringify(error.response.headers, null, 2));
      console.error('Response Data:', JSON.stringify(error.response.data, null, 2));
    }
    return false;
  }
}

// Poll until processing is complete
async function pollForCompletion(imageUrl) {
  let retries = 0;
  
  while (retries < MAX_RETRIES) {
    console.log(`\n🔍 Checking status (attempt ${retries + 1}/${MAX_RETRIES})...`);
    const statusUrl = `${CONFIG.api.baseUrl}/status?image_url=${encodeURIComponent(imageUrl)}`;
    console.log(`Status URL: ${statusUrl}`);
    
    try {
      const statusResponse = await axios.get(
        statusUrl,
        {
          headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${API_KEY}`
          }
        }
      );
      
      console.log(`Status Code: ${statusResponse.status}`);
      console.log(`Response Body:\n${JSON.stringify(statusResponse.data, null, 2)}`);
      
      if (statusResponse.data?.data?.images?.[0]) {
        const imageData = statusResponse.data.data.images[0];
        console.log(`Status: ${imageData.status} | Phase: ${imageData.phase}`);
        
        if (imageData.phase === 'ready') {
          console.log('✅ Processing complete');
          const resultUrl = `${CONFIG.api.baseUrl}/result?image_url=${encodeURIComponent(imageUrl)}`;
          console.log(`Result URL: ${resultUrl}`);
          return resultUrl;
        }
      } else {
        console.log('⚠️ Unexpected response format');
        console.log(JSON.stringify(statusResponse.data, null, 2));
      }
      
      console.log(`⏳ Waiting ${POLLING_INTERVAL/1000} seconds before next check...`);
      await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL));
      retries++;
    } catch (error) {
      console.log(`❌ Status check failed: ${error.message}`);
      if (error.response) {
        console.log('Response Status:', error.response.status);
        console.log('Response Data:', JSON.stringify(error.response.data, null, 2));
      }
      await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL));
      retries++;
    }
  }
  
  throw new Error('Processing timed out after maximum retries');
}

// Download the result
async function downloadResult(url, outputPath) {
  console.log(`Downloading from: ${url}`);
  
  try {
    // Try binary download first (most direct approach)
    console.log('First attempting direct binary download...');
    try {
      const binaryResponse = await axios({
        method: 'GET',
        url: url,
        responseType: 'arraybuffer',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Accept': 'image/png,image/jpeg,image/*'
        }
      });
      
      console.log(`Binary download status: ${binaryResponse.status}`);
      console.log(`Content type: ${binaryResponse.headers['content-type']}`);
      console.log(`Content length: ${binaryResponse.headers['content-length']} bytes`);
      
      // If we got an image directly, save it
      if (binaryResponse.headers['content-type']?.includes('image/')) {
        console.log('Successfully got image data directly');
        fs.writeFileSync(outputPath, Buffer.from(binaryResponse.data));
        
        // Verify the file size
        const fileStats = fs.statSync(outputPath);
        console.log(`File size: ${fileStats.size} bytes`);
        
        if (fileStats.size > 1000) {  // Reasonable size for an image
          console.log(`💾 Image data written to: ${outputPath}`);
          return true;
        } else {
          console.log('Image seems too small, trying other methods...');
        }
      }
    } catch (binaryError) {
      console.log(`Binary download failed: ${binaryError.message}`);
    }
    
    // If binary download failed or returned something too small, try JSON
    console.log('Attempting to get response as JSON (for base64 image data)');
    let response;
    
    try {
      response = await axios({
        method: 'GET',
        url: url,
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Accept': 'application/json'
        }
      });
    } catch (jsonError) {
      console.log('JSON request failed, trying as binary image data...');
      // If JSON request fails, try as binary image data (again, with different settings)
      response = await axios({
        method: 'GET',
        url: url,
        responseType: 'arraybuffer',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Accept': 'image/png,image/jpeg,image/*'
        }
      });
    }
    
    console.log(`Download status: ${response.status}`);
    console.log(`Content type: ${response.headers['content-type']}`);
    
    // Handle JSON response with base64 image data
    if (response.headers['content-type']?.includes('application/json')) {
      console.log('Processing JSON response with base64 image data');
      
      // Log a sample of the response structure (without the full base64 data)
      const responseSample = { ...response.data };
      if (responseSample.data?.images?.[0]?.imageUrl) {
        responseSample.data.images[0].imageUrl = responseSample.data.images[0].imageUrl.substring(0, 50) + '...';
      }
      console.log('Response structure:', JSON.stringify(responseSample, null, 2));
      
      // Extract base64 image data
      let base64Image = null;
      
      // Check different possible locations of base64 data in the response
      if (response.data.data?.images?.[0]?.imageUrl) {
        // If the API returns base64 image in imageUrl field
        base64Image = response.data.data.images[0].imageUrl;
        console.log('Found base64 image in imageUrl field');
      } else if (response.data.data?.imageUrl) {
        // If the API returns base64 image directly in data.imageUrl
        base64Image = response.data.data.imageUrl;
        console.log('Found base64 image in data.imageUrl field');
      } else if (response.data.imageUrl) {
        // If the API returns base64 image directly in imageUrl
        base64Image = response.data.imageUrl;
        console.log('Found base64 image in root imageUrl field');
      } else if (response.data.image) {
        // If the API returns base64 image in image field
        base64Image = response.data.image;
        console.log('Found base64 image in image field');
      } else if (response.data.data?.image) {
        // If the API returns base64 image in data.image field
        base64Image = response.data.data.image;
        console.log('Found base64 image in data.image field');
      } else {
        console.error('❌ Could not find base64 image data in response');
        console.log('Response data:', JSON.stringify(response.data, null, 2));
        throw new Error('No image data found in API response');
      }
      
      // Check if base64 string has a data URL prefix and remove it if present
      if (base64Image.includes(';base64,')) {
        base64Image = base64Image.split(';base64,')[1];
        console.log('Extracted base64 data from data URL');
      } else if (base64Image.includes('base64,')) {
        base64Image = base64Image.split('base64,')[1];
        console.log('Extracted base64 data from data URL without semicolon');
      }
      
      // Remove any whitespace, newlines, or other characters that might corrupt the base64 data
      base64Image = base64Image.trim().replace(/\s/g, '');
      
      // Log a sample of the base64 string for debugging
      console.log(`Base64 data sample (first 30 chars): ${base64Image.substring(0, 30)}...`);
      
      // Check if the base64 string looks valid
      if (!/^[A-Za-z0-9+/=]+$/.test(base64Image)) {
        console.warn('⚠️ Warning: Base64 string contains invalid characters');
        
        // Try to clean up the string by removing invalid characters
        const cleanedBase64 = base64Image.replace(/[^A-Za-z0-9+/=]/g, '');
        if (cleanedBase64.length < base64Image.length) {
          console.log(`Cleaned up base64 string: removed ${base64Image.length - cleanedBase64.length} invalid characters`);
          base64Image = cleanedBase64;
        }
      }
      
      // Make sure the length is valid for base64 (multiple of 4)
      if (base64Image.length % 4 !== 0) {
        console.log('Adding padding to base64 string');
        while (base64Image.length % 4 !== 0) {
          base64Image += '=';
        }
      }
      
      try {
        // Write the base64 image data to file
        console.log(`Writing base64 image data (length: ${base64Image.length}) to file`);
        fs.writeFileSync(outputPath, Buffer.from(base64Image, 'base64'));
        console.log(`💾 Base64 image data written to: ${outputPath}`);
        
        // Verify the file was written
        const fileStats = fs.statSync(outputPath);
        console.log(`File size: ${fileStats.size} bytes`);
        
        if (fileStats.size === 0) {
          throw new Error('File was created but is empty');
        }
      } catch (error) {
        console.error(`❌ Error writing file: ${error.message}`);
        
        // If we failed with base64 decoding, try writing the raw JSON response to a debug file
        const debugFilePath = `${outputPath}.debug.json`;
        console.log(`Writing raw response to debug file: ${debugFilePath}`);
        fs.writeFileSync(debugFilePath, JSON.stringify(response.data, null, 2));
        
        throw error;
      }
      return true;
    } else if (response.headers['content-type']?.includes('image/')) {
      // Handle direct image response
      console.log(`Writing direct image data to file`);
      
      try {
        // For direct image data, we need to check the type of response.data
        if (typeof response.data === 'string') {
          console.log('Response data is a string, logging first 100 chars:');
          console.log(response.data.substring(0, 100));
          
          // Try to determine if this is a raw binary image
          const isPossiblyBinary = /^\xFF\xD8|\x89PNG/.test(response.data.substring(0, 4));
          
          if (isPossiblyBinary) {
            console.log('String appears to be binary data, writing directly');
            fs.writeFileSync(outputPath, response.data, 'binary');
          } else {
            // Try to detect if it's base64
            const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
            if (base64Pattern.test(response.data.trim())) {
              console.log('String appears to be base64, decoding');
              fs.writeFileSync(outputPath, Buffer.from(response.data.trim(), 'base64'));
            } else {
              console.log('String does not appear to be base64, downloading directly');
              // Try a direct binary download as a fallback
              console.log('Trying direct binary download');
              const binaryResponse = await axios({
                method: 'GET',
                url: url,
                responseType: 'arraybuffer',
                headers: {
                  'Authorization': `Bearer ${API_KEY}`,
                  'Accept': 'image/png,image/jpeg,image/*'
                }
              });
              
              fs.writeFileSync(outputPath, Buffer.from(binaryResponse.data));
            }
          }
        } else if (response.data instanceof Buffer) {
          // If it's already a Buffer
          console.log('Response data is a Buffer');
          fs.writeFileSync(outputPath, response.data);
        } else if (response.data instanceof ArrayBuffer || response.data instanceof Uint8Array) {
          // If it's an ArrayBuffer or Uint8Array
          console.log('Response data is an ArrayBuffer/Uint8Array');
          fs.writeFileSync(outputPath, Buffer.from(response.data));
        } else {
          // Otherwise, convert to buffer
          console.log('Converting response data to Buffer, type:', typeof response.data);
          fs.writeFileSync(outputPath, Buffer.from(response.data));
        }
        
        // Verify the file was written correctly
        const fileStats = fs.statSync(outputPath);
        console.log(`File size: ${fileStats.size} bytes`);
        
        if (fileStats.size === 0) {
          throw new Error('File was created but is empty');
        }
        
        console.log(`💾 Image data written to: ${outputPath}`);
        return true;
      } catch (error) {
        console.error(`❌ Error writing image file: ${error.message}`);
        throw error;
      }
    } else {
      // Unknown response type
      console.warn('⚠️ Warning: Response is not JSON or image. Content type:', response.headers['content-type']);
      console.log('Response data sample:', typeof response.data === 'string' ? response.data.substring(0, 100) : JSON.stringify(response.data).substring(0, 100));
      throw new Error(`Unexpected response content type: ${response.headers['content-type']}`);
    }
  } catch (error) {
    console.error(`❌ Download failed: ${error.message}`);
    if (error.response) {
      console.error('Response Status:', error.response.status);
      console.error('Response Headers:', JSON.stringify(error.response.headers, null, 2));
      console.error('Response Data:', typeof error.response.data === 'string' 
        ? error.response.data.substring(0, 200)
        : JSON.stringify(error.response.data, null, 2).substring(0, 200));
    }
    throw error;
  }
}

// Process images sequentially
async function processSequentially(imageUrls) {
  let succeeded = 0;
  let failed = 0;
  
  for (const imageUrl of imageUrls) {
    const success = await processImage(imageUrl);
    if (success) succeeded++;
    else failed++;
  }
  
  return { succeeded, failed };
}

// Process images in parallel
async function processInParallel(imageUrls, maxConcurrent) {
  let succeeded = 0;
  let failed = 0;
  let activePromises = 0;
  let index = 0;
  
  // Function to process next image
  const processNext = async () => {
    if (index >= imageUrls.length) return;
    
    const currentIndex = index++;
    activePromises++;
    
    try {
      const success = await processImage(imageUrls[currentIndex]);
      if (success) succeeded++;
      else failed++;
    } catch (error) {
      console.error(`Error processing image: ${error.message}`);
      failed++;
    }
    
    activePromises--;
    await processNext();
  };
  
  // Start initial batch of promises
  const initialBatchSize = Math.min(maxConcurrent, imageUrls.length);
  const initialPromises = [];
  
  for (let i = 0; i < initialBatchSize; i++) {
    initialPromises.push(processNext());
  }
  
  // Wait for all processing to complete
  await Promise.all(initialPromises);
  
  return { succeeded, failed };
}

// Main function
async function main() {
  try {
    // Get images from remote folder
    const imageUrls = await getImageUrls(REMOTE_URL);
    
    if (imageUrls.length === 0) {
      console.error('❌ No images found in the remote folder');
      return;
    }
    
    console.log(`🔄 Processing ${imageUrls.length} images`);
    console.log(`Mode: ${PARALLEL_PROCESSING ? 'Parallel' : 'Sequential'}`);
    
    if (PARALLEL_PROCESSING) {
      console.log(`Max concurrent operations: ${MAX_CONCURRENT}`);
    }
    
    // Process all images
    let results;
    
    if (PARALLEL_PROCESSING) {
      results = await processInParallel(imageUrls, MAX_CONCURRENT);
    } else {
      results = await processSequentially(imageUrls);
    }
    
    console.log(`\n====== Processing Summary ======`);
    console.log(`Total: ${imageUrls.length}`);
    console.log(`✅ Succeeded: ${results.succeeded}`);
    console.log(`❌ Failed: ${results.failed}`);
    console.log(`===============================`);
    
  } catch (error) {
    console.error(`❌ Fatal Error: ${error.message}`);
    process.exit(1);
  }
}

// Start processing
console.log('📋 License Plate Replacer');
console.log(`🔗 Remote URL: ${REMOTE_URL}`);
console.log(`📁 Output directory: ${OUTPUT_DIR}`);
console.log(`🌄 Plate image: ${PLATE_IMAGE_PATH}`);
console.log(`📊 Processing mode: ${PARALLEL_PROCESSING ? 'Parallel' : 'Sequential'}`);
console.log('----------------------------');

main();