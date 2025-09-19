import { isOpsRepo, isDifferentRepo } from './repo.js';
import { initializeOctokit } from './octokit.js';
import { extractRepoInfo, getLatestPrCommit, getSpecificStatusCheck } from './pr-helpers.js';
import { fetchBuildReport } from './build-report.js';
import { extractPreviewLinks } from './build-report.js';
import { setUpObservers, setUpNavigationListeners, setUpTokenObserver } from './observers.js';
import { hasGitHubToken } from './auth.js';

const INVALID_TOKEN_MESSAGE = "You haven't entered a GitHub token or the token you entered is invalid. Go to Extensions > Preview on Learn and enter a valid PAT. The PAT should have 'repo' scope and be configured for SSO."

// Helper function to remove all existing Preview on Learn buttons
function removeAllButtons() {
  const existingButtons = document.querySelectorAll('.preview-on-learn');
  existingButtons.forEach(button => {
    const divider = button.previousElementSibling;
    if (divider && divider.classList.contains('dropdown-divider')) {
      divider.remove();
    }
    button.remove();
  });
  console.log(`Removed ${existingButtons.length} existing buttons`);
}

// Shared state for button conditions.
const sharedButtonState = {
  latestCommitSha: null,
  lastBuildStatus: null,
  isDisabled: false,
  disabledReason: "",
  lastCheckTime: 0
};

// Checks and updates shared button state.
// This function should only be called on OPS repos.
async function checkSharedButtonState() {
  // Check if user has a GitHub token first
  const hasToken = await hasGitHubToken();
  if (!hasToken) {
    sharedButtonState.isDisabled = true;
    sharedButtonState.disabledReason = INVALID_TOKEN_MESSAGE;
    return sharedButtonState;
  }

  // Only check once every 15 seconds to avoid too many API calls.
  const now = Date.now();
  if (now - sharedButtonState.lastCheckTime < 15000) {
    return sharedButtonState;
  }

  sharedButtonState.lastCheckTime = now;
  console.log("Checking button state...");

  try {
    // Get repo info.
    const repoInfo = extractRepoInfo();
    if (!repoInfo) {
      sharedButtonState.isDisabled = true;
      sharedButtonState.disabledReason = "Could not determine repo information";
      return sharedButtonState;
    }

    // Check the latest commit.
    const currentCommitSha = await getLatestPrCommit(
      repoInfo.owner,
      repoInfo.repo,
      repoInfo.prNumber
    );

    if (!currentCommitSha) {
      sharedButtonState.isDisabled = true;
      sharedButtonState.disabledReason = "Could not determine latest commit";
      return sharedButtonState;
    }

    if (currentCommitSha !== sharedButtonState.latestCommitSha) {
      // Commit SHA has changed, update it and check build status
      console.log(`Commit SHA changed from ${sharedButtonState.latestCommitSha} to ${currentCommitSha}`);
      sharedButtonState.latestCommitSha = currentCommitSha;

      // Check build status for the new commit.
      const opsCheck = await getSpecificStatusCheck(
        repoInfo.owner,
        repoInfo.repo,
        currentCommitSha,
        "OpenPublishing.Build"
      );

      if (!opsCheck) {
        sharedButtonState.isDisabled = true;
        sharedButtonState.disabledReason = "No OPS build found for this PR";
        sharedButtonState.lastBuildStatus = null;
        return sharedButtonState;
      }

      // Determine button state based on build status.
      if (opsCheck.status === "pending") {
        sharedButtonState.isDisabled = true;
        sharedButtonState.disabledReason = "OPS build is still in progress";
      } else if (opsCheck.status !== "success") {
        sharedButtonState.isDisabled = true;
        sharedButtonState.disabledReason = "OPS build failed - preview not available";
      } else if (!opsCheck.details_url) {
        sharedButtonState.isDisabled = true;
        sharedButtonState.disabledReason = "OPS details URL isn't available";
      } else {
        // Build was successful.
        sharedButtonState.isDisabled = false;
        sharedButtonState.disabledReason = "";
      }

      sharedButtonState.lastBuildStatus = opsCheck.status;
      return sharedButtonState;
    } else if (sharedButtonState.lastBuildStatus === "pending") {
      console.log("Commit SHA hasn't changed but build status is pending");

      // Check if build status changed from pending to success/failure.
      const opsCheck = await getSpecificStatusCheck(
        repoInfo.owner,
        repoInfo.repo,
        currentCommitSha,
        "OpenPublishing.Build"
      );

      const currentBuildStatus = opsCheck ? opsCheck.status : null;

      if (currentBuildStatus === sharedButtonState.lastBuildStatus) {
        // No change needed, keep current state.
        console.log("Build status hasn't changed, keeping current button state");
        return sharedButtonState;
      }

      console.log(`Build status changed from ${sharedButtonState.lastBuildStatus} to ${currentBuildStatus}`);

      // Update button state based on new build status.
      if (!opsCheck) {
        sharedButtonState.disabledReason = "No OPS build found for this PR";
      } else if (opsCheck.status === 'pending') {
        sharedButtonState.disabledReason = "OPS build is still in progress";
      } else if (opsCheck.status !== 'success') {
        sharedButtonState.disabledReason = "OPS build failed - preview not available";
      } else if (!opsCheck.details_url) {
        sharedButtonState.disabledReason = "OPS details URL isn't available";
      } else {
        // Build was successful - clear disablement.
        sharedButtonState.isDisabled = false;
        sharedButtonState.disabledReason = "";
      }

      sharedButtonState.lastBuildStatus = currentBuildStatus;
      return sharedButtonState;
    }

    // If we get here, nothing has changed (status or commit SHA), so return existing status.
    return sharedButtonState;

  } catch (error) {
    console.error("Error in checkButtonState:", error);
    sharedButtonState.isDisabled = true;
    sharedButtonState.disabledReason = "Error checking build status";
    return sharedButtonState;
  }
}

// Updates an single button's state.
// This is called from the interval observer and the mutation observer.
async function updateButtonState(button, state) {
  console.log(`Updating button. Current disabled state is ${state.isDisabled}`);

  const isDisabled = state.isDisabled;
  const disabledReason = state.disabledReason;

  // Check current state.
  const currentlyDisabled = button.disabled || button.classList.contains('disabled');

  // Update the button only if the state has changed.
  if (currentlyDisabled === isDisabled) {
    return;
  }

  console.log(`Changing button state from ${currentlyDisabled} to ${isDisabled}`);

  if (isDisabled) {
    // Disable the button
    button.classList.add('disabled');
    button.style.cursor = "not-allowed";
    button.disabled = true;

    // Remove any click handlers
    const newButton = button.cloneNode(true);
    button.parentNode.replaceChild(newButton, button);

    // Add tooltip with reason
    if (disabledReason) {
      newButton.title = disabledReason;
      newButton.ariaLabel = disabledReason;
    }
  }

  // Enable the button
  button.classList.remove('disabled');
  button.style.removeProperty('cursor');
  button.disabled = false;

  // Remove any disabled-related attributes
  button.removeAttribute("title");
  button.removeAttribute("aria-label");

  // Try to get preview URL for tooltip
  // TODO - can we also store the preview URL with the button so handleClick doesn't have to fetch it?
  // e.g. button.dataset.previewUrl = previewUrl;
  const filePathElement = button.closest('[data-path]');
  if (filePathElement) {
    const fileName = filePathElement.querySelector(".Link--primary")?.textContent?.split(" → ").pop();
    if (fileName) {
      // Set preview URL as title asynchronously
      getPreviewUrl(fileName).then(previewUrl => {
        if (previewUrl) {
          button.title = previewUrl;
        }
      }).catch(() => {
        // Silently ignore errors for tooltip
      });
    }
  }

  // Finally, add click handler.
  button.addEventListener('click', handleClick, { capture: true });
}

// Updates all existing buttons (called from interval observer).
async function updateAllButtons() {
  const state = await checkSharedButtonState();
  const allButtons = document.querySelectorAll('.preview-on-learn');

  if (!state) {
    console.warn("Couldn't get shared button state");
  }

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
    console.error("Failed to extract repo information from URL");
    return;
  }

  // TODO - we shouldn't have to get the commit and preview info.
  // We should already have everything we need.
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

// Function to get preview URL for a file.
async function getPreviewUrl(fileName) {
  try {
    const repoInfo = extractRepoInfo();
    if (!repoInfo) {
      return null;
    }

    // Get the latest commit SHA.
    const commitSha = await getLatestPrCommit(
      repoInfo.owner,
      repoInfo.repo,
      repoInfo.prNumber
    );

    if (!commitSha) {
      return null;
    }

    // Get the OPS status check.
    const opsCheck = await getSpecificStatusCheck(
      repoInfo.owner,
      repoInfo.repo,
      commitSha,
      "OpenPublishing.Build"
    );

    if (!opsCheck || !opsCheck.details_url || opsCheck.status !== 'success') {
      return null;
    }

    // Fetch and parse the build report.
    const buildReportDoc = await fetchBuildReport(opsCheck.details_url);
    if (!buildReportDoc) {
      return null;
    }

    const previewLinks = extractPreviewLinks(buildReportDoc);
    if (!previewLinks || Object.keys(previewLinks).length === 0) {
      return null;
    }

    // Try to find a match for the current file.
    return previewLinks[fileName] || null;
  } catch (error) {
    console.error('Error getting preview URL:', error);
    return null;
  }
}

function addButton(showCommentsMenuItem, isDisabled = false, disabledReason = "") {
  try {
    // Check if a button already exists in this dropdown
    const dropdown = showCommentsMenuItem.closest('.js-file-header-dropdown');
    if (dropdown && dropdown.querySelector('.preview-on-learn')) {
      console.log('Preview button already exists in this dropdown, skipping');
      return;
    }

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

    // If disabled, add appropriate styling and attributes.
    if (isDisabled) {
      menuItem.classList.add("disabled");
      menuItem.style.cursor = "not-allowed";
      menuItem.disabled = true;

      // Add tooltip with reason.
      if (disabledReason) {
        menuItem.title = disabledReason;
        menuItem.ariaLabel = disabledReason;
      }
    } else {
      // Add event listener only if not disabled.
      menuItem.addEventListener('click', handleClick, { capture: true });

      // For enabled buttons, try to get preview URL for tooltip
      const filePathElement = showCommentsMenuItem.closest('[data-path]');
      if (filePathElement) {
        const fileName = filePathElement.querySelector(".Link--primary")?.textContent?.split(" → ").pop();
        if (fileName) {
          // Set preview URL as title asynchronously
          getPreviewUrl(fileName).then(previewUrl => {
            if (previewUrl && !menuItem.disabled) {
              menuItem.title = previewUrl;
            }
          }).catch(() => {
            // Silently ignore errors for tooltip
          });
        }
      }
    }

    // Add new button to menu below divider.
    divider.after(menuItem);

    console.log(`Successfully added preview button${isDisabled ? " (disabled)" : ""}`);
  } catch (error) {
    console.error("Error adding button:", error);
  }
}

// Adds "Preview on Learn" menu items.
// Only called once, from init().
async function addInitialMenuItems() {
  try {
    // Check if this is an OPS repo.
    const isOps = await isOpsRepo();

    if (!isOps) {
      return;
    }

    // Remove any existing buttons first to prevent duplicates
    removeAllButtons();

    // Check shared button state.
    const state = await checkSharedButtonState();

    // Add "Preview on Learn" menu item after "Delete file" menu item.
    let cssSelector = '.js-file-header-dropdown a[aria-label="Delete this file"], .js-file-header-dropdown button[aria-label="You must be signed in and have push access to delete this file."]';
    const deleteFileItems = document.querySelectorAll(cssSelector);
    deleteFileItems.forEach(item => {
      addButton(item, state.isDisabled, state.disabledReason);
    });
  } catch (error) {
    console.error("Error in addInitialMenuItems:", error);
  }
}

// Checks if we're specifically on the PR files page.
function isPrFilesPage() {
  const path = window.location.pathname;
  return path.includes('/pull/') && path.includes('/files');
}

async function init() {
  // Check if user has a GitHub token.
  const hasToken = await hasGitHubToken();

  if (!hasToken) {
    console.log("No GitHub token found, setting up token observer only");

    // Only set up token observer to wait for token to be entered.
    const cleanupTokenObserver = setUpTokenObserver(
      async () => {
        console.log("GitHub token detected, reinitializing extension");
        // Token was added, reinitialize the extension.
        await initializeOctokit();

        // Clean up the token-only observer.
        cleanupTokenObserver();

        // Remove existing disabled buttons.
        removeAllButtons();

        await fullInit();
      },
      async () => {
        // Token removal shouldn't happen when we're in no-token mode, but handle it gracefully.
        console.log("Token was removed while in no-token mode");
      }
    );

    // Add disabled buttons if we're on a PR files page and it's an OPS repo.
    if (isPrFilesPage()) {
      const isOps = await isOpsRepo();
      if (isOps) {
        // Add disabled buttons with token message.
        const cssSelector = '.js-file-header-dropdown a[aria-label="Delete this file"], .js-file-header-dropdown button[aria-label="You must be signed in and have push access to delete this file."]';
        const deleteFileItems = document.querySelectorAll(cssSelector);
        deleteFileItems.forEach(item => {
          addButton(item, true, INVALID_TOKEN_MESSAGE);
        });
      }
    }

    // Clean up when navigating away.
    window.addEventListener('beforeunload', () => {
      cleanupTokenObserver();
    });

    return;
  }

  // User has token, set up full functionality.
  await fullInit();
}

async function fullInit() {
  // Initialize Octokit.
  await initializeOctokit();

  const observers = setUpObservers(updateAllButtons, checkSharedButtonState, addButton, updateButtonState);

  if (isPrFilesPage()) {
    addInitialMenuItems();
  }

  // Set up navigation listeners for GitHub's SPA behavior.
  const cleanupNavigation = setUpNavigationListeners(() => {
    isDifferentRepo();
  });

  // Set up token observer to handle token removal
  const cleanupTokenObserver = setUpTokenObserver(
    async () => {
      // Token was added (shouldn't happen in fullInit, but handle it)
      console.log("Token was added while extension was running");
    },
    async () => {
      // Token was removed - go back to initial state
      console.log("GitHub token was removed, reverting to initial state");

      // Clean up current observers
      observers.fileObserver.disconnect();
      clearInterval(observers.commitCheckInterval);
      cleanupNavigation();

      // Remove all existing buttons
      removeAllButtons();

      // Clear shared state
      sharedButtonState.latestCommitSha = null;
      sharedButtonState.lastBuildStatus = null;
      sharedButtonState.isDisabled = false;
      sharedButtonState.disabledReason = "";
      sharedButtonState.lastCheckTime = 0;

      // Reinitialize in no-token mode
      await init();
    }
  );

  // Clean up when navigating away.
  window.addEventListener('beforeunload', () => {
    observers.fileObserver.disconnect();
    clearInterval(observers.commitCheckInterval);
    cleanupNavigation();
    cleanupTokenObserver();
  });
}

init();

