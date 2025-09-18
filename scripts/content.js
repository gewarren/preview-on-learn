import { checkForRepositoryChange, isOpsRepo } from './repo.js';
import { initializeOctokit } from './octokit.js';
import { extractRepoInfo, getLatestPrCommit, getSpecificStatusCheck } from './pr-helpers.js';
import { fetchBuildReport } from './build-report.js';
import { extractPreviewLinks } from './build-report.js';

function addButton(showCommentsMenuItem) {
  try {
    // Create and add divider.
    let divider = document.createElement("div");
    divider.className = "dropdown-divider";
    divider.setAttribute("role", "none");
    showCommentsMenuItem.after(divider);

    // Create new button.
    let menuItem = document.createElement("button");

    // Set attributes and properties.
    menuItem.className = "pl-5 dropdown-item btn-link preview-on-learn";
    menuItem.setAttribute("role", "menuitem");
    menuItem.setAttribute("type", "button");
    menuItem.textContent = "Preview on Learn";
    // Disable button by default.
    menuItem.disabled = true;
    menuItem.classList.add("disabled");
    menuItem.style.pointerEvents = 'none';

    // Runs checks to enable menu item.
    async function updateButtonState() {
      // Check if the original DOM element still exists
      if (!showCommentsMenuItem || !showCommentsMenuItem.parentNode) {
        console.log("Original menu item no longer exists, clearing interval");
        if (menuItem.statusCheckInterval) {
          clearInterval(menuItem.statusCheckInterval);
          delete menuItem.statusCheckInterval;
        }
        return;
      }

      // If it's not an OPS repo, return.
      const isOps = await isOpsRepo();
      if (!isOps) {
        console.log("Not an OPS repo, button will remain disabled");
        return;
      }

      // Extract file name with null checks.
      let fileName = null;
      const dataPathElem = showCommentsMenuItem.closest('[data-path]');
      if (dataPathElem) {
        const link = dataPathElem.querySelector('.Link--primary');
        if (link) {
          // Handles renamed files.
          const split = link.textContent.split(' → ');
          fileName = split.length > 1 ? split[1] : split[0];
        }
      }

      // If we can't find the file name, stop trying
      if (!fileName) {
        console.log("Could not extract file name, stopping status checks");
        if (menuItem.statusCheckInterval) {
          clearInterval(menuItem.statusCheckInterval);
          delete menuItem.statusCheckInterval;
        }
        return;
      }

      console.log(`File name is ${fileName}.`);

      const repoInfo = extractRepoInfo();
      if (!repoInfo) {
        console.error("Failed to extract repository information from URL");
        return;
      }

      try {
        // Get the latest commit SHA.
        const commitSha = await getLatestPrCommit(
          repoInfo.owner,
          repoInfo.repo,
          repoInfo.prNumber
        );
        if (!commitSha) {
          console.error("Failed to get latest PR commit SHA");
          return;
        }

        // Check if we already have a successful build for this commit
        if (menuItem.dataset.lastSuccessfulCommit === commitSha && menuItem.dataset.buildStatus === 'success') {
          console.log(`Already have successful build for commit ${commitSha}, skipping status check`);
          return;
        }

        // Only check build status if commit changed or we don't have a successful build yet
        if (menuItem.dataset.lastCheckedCommit !== commitSha || menuItem.dataset.buildStatus !== 'success') {
          console.log(`Checking build status for commit ${commitSha}`);

          // Store the commit we're checking
          menuItem.dataset.lastCheckedCommit = commitSha;

          // Get the OPS status check.
          const opsCheck = await getSpecificStatusCheck(
            repoInfo.owner,
            repoInfo.repo,
            commitSha,
            "OpenPublishing.Build"
          );
          if (!opsCheck) {
            console.error("Failed to find OPS build status check");
            return;
          }

          // Store the build status
          menuItem.dataset.buildStatus = opsCheck.status;

          if (opsCheck.status === 'pending') {
            console.log('OPS build is still in progress');
            menuItem.title = "The OPS build is still in progress...";

            // Disable the button if it was previously enabled
            menuItem.disabled = true;
            menuItem.style.pointerEvents = '';

            // Remove the preview URL since build is pending
            delete menuItem.dataset.previewUrl;

            // Remove click handler by cloning the element
            const disabledMenuItem = menuItem.cloneNode(true);
            disabledMenuItem.dataset.buildStatus = 'pending';
            disabledMenuItem.dataset.lastCheckedCommit = commitSha;
            disabledMenuItem.statusCheckInterval = menuItem.statusCheckInterval;

            // Replace with the disabled version
            menuItem.parentNode.replaceChild(disabledMenuItem, menuItem);
            menuItem = disabledMenuItem;

            return;
          }

          if (opsCheck.status !== 'success' || !opsCheck.details_url) {
            console.log('OPS build was not successful');
            menuItem.title = "The OPS build was not successful or the build report URL isn't available.";

            // Disable the button if it was previously enabled
            menuItem.disabled = true;
            menuItem.style.pointerEvents = '';

            // Remove the preview URL since build failed
            delete menuItem.dataset.previewUrl;

            // Remove click handler by cloning the element
            const disabledMenuItem = menuItem.cloneNode(true);
            disabledMenuItem.dataset.buildStatus = opsCheck.status;
            disabledMenuItem.dataset.lastCheckedCommit = commitSha;
            disabledMenuItem.statusCheckInterval = menuItem.statusCheckInterval;

            // Replace with the disabled version
            menuItem.parentNode.replaceChild(disabledMenuItem, menuItem);
            menuItem = disabledMenuItem;

            return;
          }

          // Build was successful - cache this commit as successful
          menuItem.dataset.lastSuccessfulCommit = commitSha;

          // Fetch and parse the build report.
          const buildReportDoc = await fetchBuildReport(opsCheck.details_url);

          if (!buildReportDoc) {
            console.error("Failed to fetch or parse build report");
            return;
          }

          const previewLinks = extractPreviewLinks(buildReportDoc);
          if (!previewLinks || Object.keys(previewLinks).length === 0) {
            console.log('No preview links found in the build report');
            menuItem.title = "No preview links were found in the build report.";
            // Enable pointer events so tooltip shows, but keep button disabled
            menuItem.style.pointerEvents = '';
            return;
          }

          let previewUrl = null;
          if (previewLinks[fileName]) {
            previewUrl = previewLinks[fileName];
            console.log(`Found preview URL for ${fileName}: ${previewUrl}`);
          }

          if (previewUrl) {
            // Enable button and store previewUrl.
            menuItem.disabled = false;
            menuItem.style.pointerEvents = '';
            menuItem.style.opacity = '';
            menuItem.title = ""; // Clear any error tooltip
            menuItem.dataset.previewUrl = previewUrl;

            // Remove any existing click listener and add new one
            const newMenuItem = menuItem.cloneNode(true);

            // Restore the cached data on the new element
            newMenuItem.dataset.lastSuccessfulCommit = commitSha;
            newMenuItem.dataset.buildStatus = 'success';
            newMenuItem.dataset.lastCheckedCommit = commitSha;
            newMenuItem.dataset.previewUrl = previewUrl;
            newMenuItem.statusCheckInterval = menuItem.statusCheckInterval;

            newMenuItem.addEventListener('click', function () {
              window.open(newMenuItem.dataset.previewUrl, '_blank');
            }, { capture: true });

            // Replace the old element with the new one
            menuItem.parentNode.replaceChild(newMenuItem, menuItem);

            // Update menuItem reference to point to the new element
            menuItem = newMenuItem;

            console.log('Button enabled for successful build');
          } else {
            // Remain disabled.
            return;
          }
        }
      } catch (error) {
        console.error('Error in updateButtonState:', error);
        return;
      }
    }

    // Initial state check
    updateButtonState();

    // Set up periodic checking for build status changes
    const statusCheckInterval = setInterval(updateButtonState, 30000); // Check every 30 seconds

    // Store interval ID on the button for cleanup
    menuItem.statusCheckInterval = statusCheckInterval;

    // Add new button to menu below divider.
    divider.after(menuItem);

    console.log(`Successfully added preview button`);
  } catch (error) {
    console.error("Error adding button:", error);
  }
}

// Adds a "Preview on Learn" menu item to all matching
// dropdown menus if the repo is an OPS repo.
async function addMenuItems() {
  try {
    // Check if this is an OPS repo.
    const isOps = await isOpsRepo();

    if (isOps) {
      // Add "Preview on Learn" menu item after "Delete file" menu item.
      const showCommentsItems = document.querySelectorAll('.js-file-header-dropdown a[aria-label="Delete this file"], .js-file-header-dropdown button[aria-label="You must be signed in and have push access to delete this file."]');
      showCommentsItems.forEach(menuItem => {
        addButton(menuItem);
      });

    } else {
      console.log("Not adding buttons - isOpsRepo() returned false");
    }
  } catch (error) {
    console.error("Error in addButtonsToDropdowns:", error);
  }
}

// Checks if we're specifically on the PR files page.
function isPrFilesPage() {
  const path = window.location.pathname;
  return path.includes('/pull/') && path.includes('/files');
}

// Set up observers to watch for DOM changes.
function setUpObservers() {
  console.log('Setting up mutation observers');

  // Observer for file header dropdown additions.
  const fileObserver = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      // Only interested in added nodes.
      if (mutation.type !== 'childList' || mutation.addedNodes.length === 0) {
        continue;
      }

      // Check each added node.
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) {
          continue;
        }

        // Check if a dropdown menu was added.
        const dropdowns = node.classList?.contains('js-file-header-dropdown')
          ? [node]
          : [...node.querySelectorAll('.js-file-header-dropdown')];

        if (dropdowns.length > 0) {
          console.log('Detected new file dropdown(s):', dropdowns.length);

          // Find menu items in each dropdown that we want to add our button after.
          for (const dropdown of dropdowns) {
            const menuItems = dropdown.querySelectorAll('a[aria-label="Delete this file"], button[aria-label="You must be signed in and have push access to delete this file."]');
            if (menuItems.length > 0) {
              console.log('Found menu items to modify');
              menuItems.forEach(item => {
                // Check if we've already added our button to this menu.
                const previewButton = dropdown.querySelector('.preview-on-learn');
                if (!previewButton) {
                  addButton(item);
                }
              });
            }
          }
        }
      }
    }
  });

  // Start observing the whole document for file changes.
  fileObserver.observe(document.body, {
    childList: true,
    subtree: true
  });

  return fileObserver;
}

// Function to refresh all existing menu items when token changes
async function refreshAllMenuItems() {
  // Clear all existing status check intervals first
  cleanupStatusIntervals();

  // Find all existing preview buttons
  const existingButtons = document.querySelectorAll('.preview-on-learn');

  if (existingButtons.length === 0) {
    console.log('No existing menu items found to refresh');
    return;
  }

  console.log(`Found ${existingButtons.length} existing menu items to refresh`);

  // For each existing button, find its parent menu and refresh it
  existingButtons.forEach(async (button) => {
    try {
      // Find the parent dropdown
      const dropdown = button.closest('.js-file-header-dropdown');
      if (!dropdown) {
        console.log('Could not find parent dropdown for button');
        return;
      }

      // Find the "Delete file" menu item to use as reference
      const deleteMenuItem = dropdown.querySelector('a[aria-label="Delete this file"], button[aria-label="You must be signed in and have push access to delete this file."]');
      if (!deleteMenuItem) {
        console.log('Could not find delete menu item as reference');
        return;
      }

      // Remove the existing button and divider
      const divider = button.previousElementSibling;
      if (divider && divider.classList.contains('dropdown-divider')) {
        divider.remove();
      }
      button.remove();

      // Add a fresh button
      addButton(deleteMenuItem);

    } catch (error) {
      console.error('Error refreshing menu item:', error);
    }
  });
}

async function init() {
  // Initialize Octokit first.
  await initializeOctokit();

  // Set up observers for dynamic changes.
  initializeOctokit();
  const observers = setUpObservers();

  if (isPrFilesPage()) {
    addMenuItems();
  }

  // Listen for changes to the GitHub token in storage
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.github_token) {
      console.log('GitHub token changed, refreshing menu items...');
      // Reinitialize Octokit with the new token
      initializeOctokit().then(() => {
        // Refresh all existing menu items
        refreshAllMenuItems();
      });
    }
  });

  // Clean up when navigating away.
  window.addEventListener('beforeunload', () => {
    observers.disconnect();
  });
}

init();

// Set up navigation listeners for GitHub's SPA behavior
let lastUrl = window.location.href;

// Function to clean up all status check intervals
function cleanupStatusIntervals() {
  document.querySelectorAll('.preview-on-learn').forEach(button => {
    if (button.statusCheckInterval) {
      clearInterval(button.statusCheckInterval);
      delete button.statusCheckInterval;
    }
  });
}

// Listen for history changes (forward/back navigation)
window.addEventListener('popstate', function () {
  if (window.location.href !== lastUrl) {
    console.log('Navigation detected via popstate');
    lastUrl = window.location.href;
    cleanupStatusIntervals();
    checkForRepositoryChange();
  }
});

// Override pushState to detect programmatic navigation
const originalPushState = history.pushState;
history.pushState = function () {
  originalPushState.apply(this, arguments);
  if (window.location.href !== lastUrl) {
    console.log('Navigation detected via pushState');
    lastUrl = window.location.href;
    cleanupStatusIntervals();
    checkForRepositoryChange();
  }
};

// Override replaceState to detect programmatic navigation
const originalReplaceState = history.replaceState;
history.replaceState = function () {
  originalReplaceState.apply(this, arguments);
  if (window.location.href !== lastUrl) {
    console.log('Navigation detected via replaceState');
    lastUrl = window.location.href;
    cleanupStatusIntervals();
    checkForRepositoryChange();
  }
};

// Also check for URL changes via MutationObserver as a fallback
const urlObserver = new MutationObserver(function () {
  if (window.location.href !== lastUrl) {
    console.log('Navigation detected via MutationObserver');
    lastUrl = window.location.href;
    cleanupStatusIntervals();
    checkForRepositoryChange();
  }
});

urlObserver.observe(document, {
  childList: true,
  subtree: true
});
