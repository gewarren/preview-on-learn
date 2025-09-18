import { isOpsRepo } from './ops.js';
import { extractRepoInfo } from './pr-helpers.js';
import { getLatestPrCommit } from './pr-helpers.js';
import { getSpecificStatusCheck } from './pr-helpers.js';
import { initializeOctokit } from './octokit.js';
import { fetchBuildReport } from './build-report.js';
import { extractPreviewLinks } from './build-report.js';

// Open docs preview when the menu item is clicked.
async function handleClick(event) {
  const menuItem = event.currentTarget;

  const [originalFileName, newFileName = originalFileName] = menuItem
    .closest('[data-path]')
    .querySelector(".Link--primary")
    .textContent
    .split(" → ");

  console.log(`File name is ${newFileName}.`);

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

    // Get the OPS status check.
    const opsCheck = await getSpecificStatusCheck(
      repoInfo.owner,
      repoInfo.repo,
      commitSha,
      "OpenPublishing.Build"
    );

    if (!opsCheck || !opsCheck.details_url) {
      console.error("Failed to find OPS build status check or details URL");
      return;
    }

    if (opsCheck.status === 'pending') {
      console.log('OPS build is still in progress');
      alert("The OPS build is still in progress. Please try again later when the build completes.");
      return;
    }

    if (opsCheck.status !== 'success') {
      console.warn('OPS build was not successful');
      alert("The OPS build was not successful. Please check the build status and try again after a successful build.");
      return;
    }

    // Fetch and parse the build report.
    console.log("Fetching build report from:", opsCheck.details_url);
    const buildReportDoc = await fetchBuildReport(opsCheck.details_url);

    if (!buildReportDoc) {
      console.error("Failed to fetch or parse build report");
      return;
    }

    const previewLinks = extractPreviewLinks(buildReportDoc);

    if (!previewLinks || Object.keys(previewLinks).length === 0) {
      console.warn('No preview links found in the build report');
      alert("No preview links were found in the build report. This could be because the build is still processing or there was an issue with the build.");
      return;
    }

    // Try to find a match for the current file.
    let previewUrl = null;

    // Try exact match first.
    if (previewLinks[newFileName]) {
      previewUrl = previewLinks[newFileName];
      console.log(`Found preview URL for ${newFileName}: ${previewUrl}`);
    }

    // If we found a preview URL, use it.
    if (previewUrl) {
      window.open(previewUrl, '_blank');
    } else {
      console.warn(`No preview link found for ${newFileName} in the build report`);
      alert(`No preview link was found for "${newFileName}" in the build report. This file might not be part of the published content.`);
    }
  } catch (error) {
    console.error('Error in previewFile:', error);
    alert("An error occurred while trying to preview the file. Please check the console for details.");
  }
}

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

    // Add event listener.
    menuItem.addEventListener('click', handleClick, { capture: true });

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

async function init() {
  // Initialize when page loads.
  console.log('Initializing extension');

  // Set up observers for dynamic changes.
  initializeOctokit();
  const observer = setUpObservers();

  if (isPrFilesPage()) {
    addMenuItems();
  }

  // Clean up when navigating away.
  window.addEventListener('beforeunload', () => {
    observer.disconnect();
  });
}

init();

