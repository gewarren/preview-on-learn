# Preview on Learn Browser Extension

A browser extension for Microsoft Edge and Google Chrome that adds a "Preview on Learn" menu option to the hamburger menu on each file in the "Files changed" tab of a GitHub pull request.

## Features

- 🔗 Adds "Preview on Learn" option to GitHub PR file menus
- 🌐 Works on Microsoft Edge and Google Chrome
- ⚡ Automatically detects GitHub pull request pages
- 🎯 Integrates seamlessly with GitHub's existing UI
- 📱 Responsive design that matches GitHub's styling

## Installation

### For Development

1. Clone this repository:
   ```bash
   git clone https://github.com/gewarren/preview-on-learn.git
   cd preview-on-learn
   ```

2. Load the extension in your browser:

   **Chrome:**
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the extension directory

   **Edge:**
   - Open `edge://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the extension directory

## Usage

1. Navigate to any GitHub pull request
2. Click on the "Files changed" tab
3. For any file, click the hamburger menu (⋯) in the top-right corner of the file header
4. Select "Preview on Learn" from the dropdown menu
5. The file will open in Microsoft Learn preview in a new tab

## File Structure

```
preview-on-learn/
├── manifest.json          # Extension manifest (Manifest V3)
├── content-script.js      # Main content script for GitHub integration
├── styles.css            # CSS styles for the menu option
├── popup.html            # Extension popup interface
├── icons/                # Extension icons
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── README.md             # This file
```

## Technical Details

- **Manifest Version**: 3 (latest standard)
- **Permissions**: 
  - `activeTab`: Access to the current tab
  - `https://github.com/*`: Host permissions for GitHub
- **Content Script**: Runs on all GitHub pages and detects PR file views
- **Mutation Observer**: Handles dynamic content loading on GitHub's SPA

## Browser Compatibility

- ✅ Google Chrome (Manifest V3 compatible)
- ✅ Microsoft Edge (Manifest V3 compatible)
- ✅ Other Chromium-based browsers

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test the extension in both Chrome and Edge
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.