# License Plate Replacer

A simple script that processes images by replacing license plates with a custom logo.

## How It Works

1. The script takes images either from a local folder or downloads them from Google Drive
2. Each image is sent to the Car-Cutter API with your custom logo file
3. The API processes the image, replacing license plates with the logo
4. Processed images are saved to the output folder with a suffix added to their filenames

## Setup

1. Install dependencies: `npm install`
2. Place any PNG file in the `plate` directory (this will be used as your license plate replacement)
3. Copy `src/config.example.json` to `src/config.json` and add your API key
4. Set your Google Drive folder ID or use local images

## Usage

Run the script:

```bash
npm start
```

Or make the script executable and run it directly:

```bash
chmod +x src/plate_replacer.js
./src/plate_replacer.js
```

### Custom Logo

The script will automatically use the first PNG file it finds in the `plate` directory. Requirements:

- File format: PNG with transparency (RGBA)
- Place the file in the `plate` directory
- No specific naming convention required - just ensure it has a `.png` extension

### Images Source

There are two ways to provide images to the script:

1. **Google Drive**: The script can download images from a Google Drive folder
   - Enabled by default using the URL in `config.json`
   - Make sure the folder has public access

2. **Local Files**: Place images directly in the `input_images` folder
   - The script will process any JPG/JPEG/PNG files in this directory
   - You can disable Google Drive by setting `"enabled": false` in config

## Configuration

All settings are in `src/config.json`:

```json
{
  "googleDrive": {
    "folderUrl": "https://drive.google.com/drive/folders/YOUR_FOLDER_ID",
    "enabled": true
  },
  "api": {
    "baseUrl": "https://api.car-cutter.com/vehicle/image",
    "apiKey": "your_api_key"
  },
  "processing": {
    "cutType": "none",
    "guidelineId": "default",
    "parallelProcessing": false,
    "maxConcurrent": 20
  },
  "polling": {
    "intervalMs": 5000,
    "maxRetries": 60
  },
  "output": {
    "suffix": "_processed"
  }
}
```

### Processing Options

The script supports two processing modes:

1. **Sequential Processing** (default): Images are processed one at a time, waiting for each one to complete before starting the next.
   - Set `"parallelProcessing": false` in the config

2. **Parallel Processing**: Multiple images are processed simultaneously, reducing total processing time.
   - Set `"parallelProcessing": true` to enable
   - Use `"maxConcurrent"` to control the maximum number of images processed at once (default: 3)

### Configuration

All settings are managed in the `config.json` file. Before pushing to git:

1. Remove any sensitive data (like API keys) from `config.json`
2. Use `config.example.json` as a template for others to set up their own configuration

## Security Notes

This project follows these security practices:

1. **API Keys**: Never commit API keys to Git. Always remove sensitive data from `config.json` before committing.
2. **Sensitive Data**: The `.gitignore` file excludes:
   - `config.json` with your actual API credentials
   - `node_modules` directory
   - `output_images` directory with processed results
3. **Example Files**: Example configuration files are provided:
   - `config.example.json` - Template for your config.json

## Output

Processed images are saved to the `output_images` folder with the configured suffix added to the filename.

Example: `car.jpg` → `car_processed.jpg`
