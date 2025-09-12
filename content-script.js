// Content script for Preview on Learn extension
// Adds "Preview on Learn" menu option to GitHub PR file hamburger menus

(function() {
  'use strict';

  // Check if we're on a GitHub pull request page
  function isGitHubPRPage() {
    return window.location.hostname === 'github.com' && 
           window.location.pathname.includes('/pull/') &&
           window.location.hash.includes('#files');
  }

  // Create the "Preview on Learn" menu item
  function createPreviewMenuItem() {
    const menuItem = document.createElement('button');
    menuItem.className = 'dropdown-item btn-link preview-on-learn-item';
    menuItem.type = 'button';
    menuItem.innerHTML = `
      <span class="d-flex flex-items-center">
        <svg class="octicon octicon-link-external mr-2" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2ZM6.854 5.146a.75.75 0 0 1 0 1.061L5.207 7.854a.25.25 0 0 0 0 .353l1.647 1.647a.75.75 0 1 1-1.061 1.061L3.146 8.268a1.75 1.75 0 0 1 0-2.475l2.647-2.647a.75.75 0 0 1 1.061 0ZM12.25 2a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0V4.06l-2.97 2.97a.75.75 0 0 1-1.061-1.061L10.44 3H8.25a.75.75 0 0 1 0-1.5h3.5c.069 0 .136.01.2.03A.75.75 0 0 1 12.25 2Z"/>
        </svg>
        Preview on Learn
      </span>
    `;
    
    menuItem.addEventListener('click', handlePreviewClick);
    return menuItem;
  }

  // Handle click on "Preview on Learn" menu item
  function handlePreviewClick(event) {
    event.preventDefault();
    event.stopPropagation();
    
    // Get the file path from the nearest file header
    const fileHeader = event.target.closest('.file').querySelector('[data-path]');
    if (!fileHeader) {
      console.error('Could not find file path');
      return;
    }
    
    const filePath = fileHeader.getAttribute('data-path');
    const repoInfo = extractRepoInfo();
    
    if (repoInfo) {
      const learnUrl = generateLearnPreviewUrl(repoInfo, filePath);
      window.open(learnUrl, '_blank');
    }
  }

  // Extract repository information from the current page
  function extractRepoInfo() {
    const pathParts = window.location.pathname.split('/');
    if (pathParts.length >= 4) {
      return {
        owner: pathParts[1],
        repo: pathParts[2],
        prNumber: pathParts[4]
      };
    }
    return null;
  }

  // Generate Learn preview URL
  function generateLearnPreviewUrl(repoInfo, filePath) {
    // This is a placeholder URL structure - adjust based on actual Learn preview requirements
    const baseUrl = 'https://learn.microsoft.com/preview';
    return `${baseUrl}/${repoInfo.owner}/${repoInfo.repo}/pull/${repoInfo.prNumber}/${filePath}`;
  }

  // Add menu item to file hamburger menus
  function addPreviewMenuItems() {
    // Find all file hamburger menu buttons (kebab menus)
    const menuButtons = document.querySelectorAll('.file-actions .js-file-line-actions details summary');
    
    menuButtons.forEach(button => {
      // Skip if already processed
      if (button.closest('.file').querySelector('.preview-on-learn-item')) {
        return;
      }
      
      // Find the dropdown menu
      const dropdown = button.nextElementSibling;
      if (dropdown && dropdown.classList.contains('dropdown-menu')) {
        const menuItem = createPreviewMenuItem();
        
        // Add a separator if there are existing items
        if (dropdown.children.length > 0) {
          const separator = document.createElement('div');
          separator.className = 'dropdown-divider';
          dropdown.appendChild(separator);
        }
        
        dropdown.appendChild(menuItem);
      }
    });
  }

  // Observer to handle dynamic content loading
  function setupObserver() {
    const observer = new MutationObserver(function(mutations) {
      let shouldUpdate = false;
      
      mutations.forEach(function(mutation) {
        if (mutation.type === 'childList') {
          // Check if new file elements were added
          mutation.addedNodes.forEach(function(node) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.classList && node.classList.contains('file') ||
                  node.querySelector && node.querySelector('.file')) {
                shouldUpdate = true;
              }
            }
          });
        }
      });
      
      if (shouldUpdate) {
        setTimeout(addPreviewMenuItems, 100); // Small delay to ensure DOM is ready
      }
    });

    // Start observing
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    return observer;
  }

  // Initialize the extension
  function init() {
    if (!isGitHubPRPage()) {
      return;
    }

    // Add menu items to existing files
    addPreviewMenuItems();
    
    // Set up observer for dynamically loaded content
    setupObserver();
    
    // Also re-run when URL changes (for SPA navigation)
    let currentUrl = window.location.href;
    setInterval(() => {
      if (window.location.href !== currentUrl) {
        currentUrl = window.location.href;
        if (isGitHubPRPage()) {
          setTimeout(addPreviewMenuItems, 500);
        }
      }
    }, 1000);
  }

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();