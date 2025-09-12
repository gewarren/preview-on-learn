# Installation Guide

## Quick Start

1. **Download the Extension**
   - Clone this repository or download as ZIP
   - Extract to a folder on your computer

2. **Install in Chrome**
   - Open Chrome
   - Navigate to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top-right)
   - Click "Load unpacked"
   - Select the extension folder

3. **Install in Edge**
   - Open Microsoft Edge
   - Navigate to `edge://extensions/`
   - Enable "Developer mode" (toggle in left sidebar)
   - Click "Load unpacked"
   - Select the extension folder

## Verification

After installation, you should see:
- Extension icon in your browser toolbar
- Extension listed in your extensions page
- When you click the extension icon, a popup should appear

## Usage

1. Go to any GitHub repository
2. Open a pull request
3. Click the "Files changed" tab
4. Find the hamburger menu (⋯) in the top-right of any file
5. Click it to see the "Preview on Learn" option
6. Click "Preview on Learn" to open the file in Microsoft Learn

## Troubleshooting

**Extension not loading:**
- Make sure all files are present in the folder
- Check that manifest.json is valid
- Try refreshing the extensions page

**Menu option not appearing:**
- Make sure you're on a GitHub pull request page
- Ensure you're in the "Files changed" tab
- The extension only works on github.com

**Preview not opening:**
- Check your popup blocker settings
- Ensure you have permission to open new tabs

## Development

To modify the extension:
1. Make changes to the source files
2. Go to your browser's extensions page
3. Click the refresh/reload button for this extension
4. Test your changes on GitHub