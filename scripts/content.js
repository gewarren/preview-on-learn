import { isOpsRepo, clearOpsRepoCache } from './ops.js';
import { initializeOctokit } from './octokit.js';
import { extractRepoInfo, getLatestPrCommit, getSpecificStatusCheck } from './pr-helpers.js';
import { fetchBuildReport } from './build-report.js';
import { extractPreviewLinks } from './build-report.js';

// Track the current repository to detect navigation changes
let currentRepoKey = null;

// Function to check if we've navigated to a different repository
function checkForRepositoryChange() {
  const repoInfo = extractRepoInfo();
  if (!repoInfo) {
    return false;
  }

  const newRepoKey = `${repoInfo.owner}/${repoInfo.repo}`.toLowerCase();

  if (currentRepoKey && currentRepoKey !== newRepoKey) {
    console.log(`Repository changed from ${currentRepoKey} to ${newRepoKey}`);

    // Clear the cache for the previous repository
    const [prevOwner, prevRepo] = currentRepoKey.split('/');
    clearOpsRepoCache(prevOwner, prevRepo);

    // Clear button state for new repository
    buttonState.latestCommitSha = null;
    buttonState.lastBuildStatus = null;
    buttonState.isDisabled = false;
    buttonState.disabledReason = "";
    buttonState.lastCheckTime = 0;

    currentRepoKey = newRepoKey;
    return true;
  } else if (!currentRepoKey) {
    // First time setting the repository
    currentRepoKey = newRepoKey;
    console.log(`Initial repository set to ${currentRepoKey}`);
  }

  return false;
}

// Shared state for button conditions
const buttonState = {
  latestCommitSha: null,
  lastBuildStatus: null,
  isDisabled: false,
  disabledReason: "",
  lastCheckTime: 0
};

// Function to check and update button state
async function checkButtonState() {
  // Check if we've navigated to a different repository
  const repositoryChanged = checkForRepositoryChange();

  // Only check once every 15 seconds to avoid too many API calls
  const now = Date.now();
  if (!repositoryChanged && now - buttonState.lastCheckTime < 15000) {
    return buttonState;
  }

  buttonState.lastCheckTime = now;
  console.log("Checking button state...");

  try {
    // Check if this is an OPS repo.
    const isOps = await isOpsRepo();

    if (!isOps) {
      console.log("Not an OPS repo, buttons will not be added");
      buttonState.isDisabled = true;
      buttonState.disabledReason = "Not an OPS repository";
      return buttonState;
    }

    // Get repository info
    const repoInfo = extractRepoInfo();
    if (!repoInfo) {
      buttonState.isDisabled = true;
      buttonState.disabledReason = "Could not determine repository information";
      return buttonState;
    }

    // Check the latest commit
    const currentCommitSha = await getLatestPrCommit(
      repoInfo.owner,
      repoInfo.repo,
      repoInfo.prNumber
    );

    if (!currentCommitSha) {
      buttonState.isDisabled = true;
      buttonState.disabledReason = "Could not determine latest commit";
      return buttonState;
    }

    // Check if the commit SHA has changed
    if (currentCommitSha === buttonState.latestCommitSha) {
      console.log("Latest commit SHA hasn't changed, checking if build status changed");

      // Even if commit hasn't changed, check build status in case it changed from pending to success/failure
      const opsCheck = await getSpecificStatusCheck(
        repoInfo.owner,
        repoInfo.repo,
        currentCommitSha,
        "OpenPublishing.Build"
      );

      const currentBuildStatus = opsCheck ? opsCheck.status : null;

      if (currentBuildStatus === buttonState.lastBuildStatus) {
        console.log("Build status hasn't changed, keeping current button state");
        return buttonState; // No change needed, keep current state
      }

      console.log(`Build status changed from ${buttonState.lastBuildStatus} to ${currentBuildStatus}`);
      buttonState.lastBuildStatus = currentBuildStatus;

      // Update button state based on new build status
      if (!opsCheck) {
        buttonState.isDisabled = true;
        buttonState.disabledReason = "No OPS build found for this PR";
      } else if (opsCheck.status === 'pending') {
        buttonState.isDisabled = true;
        buttonState.disabledReason = "OPS build is still in progress";
      } else if (opsCheck.status !== 'success') {
        buttonState.isDisabled = true;
        buttonState.disabledReason = "OPS build failed - preview not available";
      } else if (!opsCheck.details_url) {
        buttonState.isDisabled = true;
        buttonState.disabledReason = "OPS details URL isn't available";
      } else {
        // Build was successful
        buttonState.isDisabled = false;
        buttonState.disabledReason = "";
      }

      return buttonState;
    }

    // Commit SHA has changed, update it and check build status
    console.log(`Commit SHA changed from ${buttonState.latestCommitSha} to ${currentCommitSha}`);
    buttonState.latestCommitSha = currentCommitSha;

    // Check build status for the new commit
    const opsCheck = await getSpecificStatusCheck(
      repoInfo.owner,
      repoInfo.repo,
      currentCommitSha,
      "OpenPublishing.Build"
    );

    // Determine button state based on build status
    if (!opsCheck) {
      buttonState.isDisabled = true;
      buttonState.disabledReason = "No OPS build found for this PR";
      buttonState.lastBuildStatus = null;
    } else if (opsCheck.status === 'pending') {
      buttonState.isDisabled = true;
      buttonState.disabledReason = "OPS build is still in progress";
      buttonState.lastBuildStatus = 'pending';
    } else if (opsCheck.status !== 'success') {
      buttonState.isDisabled = true;
      buttonState.disabledReason = "OPS build failed - preview not available";
      buttonState.lastBuildStatus = opsCheck.status;
    } else if (!opsCheck.details_url) {
      buttonState.isDisabled = true;
      buttonState.disabledReason = "OPS details URL isn't available";
      buttonState.lastBuildStatus = opsCheck.status;
    } else {
      // Build was successful
      buttonState.isDisabled = false;
      buttonState.disabledReason = "";
      buttonState.lastBuildStatus = 'success';
    }

    return buttonState;
  } catch (error) {
    console.error("Error in checkButtonState:", error);
    buttonState.isDisabled = true;
    buttonState.disabledReason = "Error checking build status";
    return buttonState;
  }
}

// Function to update an existing button's state
function updateButtonState(button, state) {
  const isDisabled = state.isDisabled;
  const disabledReason = state.disabledReason;

  // Check current state
  const currentlyDisabled = button.disabled || button.classList.contains('disabled');

  // Only make changes if the state has changed
  if (currentlyDisabled !== isDisabled) {
    console.log(`Changing button state from ${currentlyDisabled} to ${isDisabled}`);

    if (isDisabled) {
      // Disable the button
      button.classList.add('disabled');
      button.style.opacity = "0.6";
      button.style.cursor = "not-allowed";
      button.disabled = true;

      // Remove any click handlers
      const newButton = button.cloneNode(true);
      button.parentNode.replaceChild(newButton, button);

      // Add tooltip with reason
      if (disabledReason) {
        newButton.setAttribute("title", disabledReason);
        newButton.setAttribute("aria-label", disabledReason);
      }
    } else {
      // Enable the button
      button.classList.remove('disabled');
      button.style.removeProperty('opacity');
      button.style.removeProperty('cursor');
      button.disabled = false;

      // Add click handler
      button.addEventListener('click', handleClick, { capture: true });

      // Remove any disability-related attributes
      button.removeAttribute("title");
      button.removeAttribute("aria-label");
    }
  } else if (isDisabled && disabledReason) {
    // Update the reason even if disabled state hasn't changed
    button.setAttribute("title", disabledReason);
    button.setAttribute("aria-label", disabledReason);
  }
}

// Function to update all existing buttons
async function updateAllButtons() {
  const state = await checkButtonState();
  const allButtons = document.querySelectorAll('.preview-on-learn');
  console.log(`Updating ${allButtons.length} existing buttons`);

  allButtons.forEach(button => {
    updateButtonState(button, state);
  });
}

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

function addButton(showCommentsMenuItem, isDisabled = false, disabledReason = "") {
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

    // If disabled, add appropriate styling and attributes
    if (isDisabled) {
      menuItem.classList.add("disabled");
      menuItem.style.opacity = "0.6";
      menuItem.style.cursor = "not-allowed";
      menuItem.disabled = true;

      // Add tooltip with reason
      if (disabledReason) {
        menuItem.setAttribute("title", disabledReason);
        menuItem.setAttribute("aria-label", disabledReason);
      }
    } else {
      // Add event listener only if not disabled
      menuItem.addEventListener('click', handleClick, { capture: true });
    }

    // Add new button to menu below divider.
    divider.after(menuItem);

    console.log(`Successfully added preview button${isDisabled ? " (disabled)" : ""}`);
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
      // Check button state
      const state = await checkButtonState();

      // Add "Preview on Learn" menu item after "Delete file" menu item.
      const showCommentsItems = document.querySelectorAll('.js-file-header-dropdown a[aria-label="Delete this file"], .js-file-header-dropdown button[aria-label="You must be signed in and have push access to delete this file."]');
      showCommentsItems.forEach(menuItem => {
        addButton(menuItem, state.isDisabled, state.disabledReason);
      });
    } else {
      console.log("Not adding buttons - isOpsRepo() returned false");
    }
  } catch (error) {
    console.error("Error in addMenuItems:", error);
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

  // Set up commit check interval
  // This will check if the latest commit has changed
  const commitCheckInterval = setInterval(async () => {
    const repoInfo = extractRepoInfo();
    if (repoInfo) {
      const currentSha = await getLatestPrCommit(
        repoInfo.owner,
        repoInfo.repo,
        repoInfo.prNumber
      );

      if (currentSha && currentSha !== buttonState.latestCommitSha) {
        console.log(`Latest commit changed from ${buttonState.latestCommitSha} to ${currentSha}`);
        updateAllButtons();
      }
    }
  }, 15000); // Check every 15 seconds

  // Observer for file header dropdown additions
  const fileObserver = new MutationObserver(async mutations => {
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

          // Get current button state once for all dropdowns
          const state = await checkButtonState();

          // Find menu items in each dropdown that we want to add our button after.
          for (const dropdown of dropdowns) {
            const menuItems = dropdown.querySelectorAll('a[aria-label="Delete this file"], button[aria-label="You must be signed in and have push access to delete this file."]');
            if (menuItems.length > 0) {
              console.log('Found menu items to modify');
              menuItems.forEach(item => {
                // Check if we've already added our button to this menu.
                const previewButton = dropdown.querySelector('.preview-on-learn');
                if (!previewButton) {
                  addButton(item, state.isDisabled, state.disabledReason);
                } else {
                  updateButtonState(previewButton, state);
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

  // Update the init function to clean up all intervals
  window.addEventListener('beforeunload', () => {
    fileObserver.disconnect();
    clearInterval(commitCheckInterval);
  });

  return {
    fileObserver,
    commitCheckInterval
  };
}

async function init() {
  // Initialize Octokit first
  await initializeOctokit();

  const observers = setUpObservers();

  if (isPrFilesPage()) {
    addMenuItems();
  }

  // Clean up when navigating away.
  window.addEventListener('beforeunload', () => {
    observers.fileObserver.disconnect();
    clearInterval(observers.commitCheckInterval);
  });
}

init();

// Set up navigation listeners for GitHub's SPA behavior
let lastUrl = window.location.href;

// Listen for history changes (forward/back navigation)
window.addEventListener('popstate', function () {
  if (window.location.href !== lastUrl) {
    console.log('Navigation detected via popstate');
    lastUrl = window.location.href;
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
    checkForRepositoryChange();
  }
};

// Also check for URL changes via MutationObserver as a fallback
const urlObserver = new MutationObserver(function () {
  if (window.location.href !== lastUrl) {
    console.log('Navigation detected via MutationObserver');
    lastUrl = window.location.href;
    checkForRepositoryChange();
  }
});

urlObserver.observe(document, {
  childList: true,
  subtree: true
});

