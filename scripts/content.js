import { isOpsRepo, isDifferentRepo } from './repo.js';
import { initializeOctokit, isAuthenticated } from './octokit.js';
import { extractRepoInfo, getPrInfo, getSpecificStatusCheck } from './pr-helpers.js';
import { getPreviewUrl } from './build-report.js';
import { setUpObservers, setUpNavigationListeners, setUpNoTokenObserver } from './observers.js';

export const CSS_SELECTOR = '.js-file-header-dropdown a[aria-label="Delete this file"], .js-file-header-dropdown button[aria-label="You must be signed in and have push access to delete this file."]';
const INVALID_TOKEN_MESSAGE = "GitHub authentication required. Select Extensions > Preview on Learn to sign in with your GitHub account.";
const NO_PREVIEW_URL = "No preview URL is available for this file";
const NO_OPS_BUILD_FOUND = "No OPS build status check was found";
const OPS_BUILD_PENDING = "The OPS build is still in progress";
const OPS_BUILD_FAILED = "The OPS build failed";
const NO_OPS_DETAILS_URL = "The OPS details URL isn't available";

// Helper function to remove all existing Preview on Learn buttons.
function removeAllButtons() {
  const existingButtons = document.querySelectorAll('.preview-on-learn');
  existingButtons.forEach(button => {
    const divider = button.previousElementSibling;
    if (divider && divider.classList.contains('dropdown-divider')) {
      divider.remove();
    }
    button.remove();
  });
}

// Shared state for button conditions.
const sharedButtonState = {
  latestCommitSha: null,
  lastBuildStatus: null,
  prStatus: null, // 'open', 'closed', or 'merged'.
  isDisabled: false,
  disabledReason: "",
  lastCheckTime: 0
};

// Reset shared state when navigating to a different PR
function resetSharedButtonState() {
  sharedButtonState.latestCommitSha = null;
  sharedButtonState.lastBuildStatus = null;
  sharedButtonState.prStatus = null;
  sharedButtonState.isDisabled = false;
  sharedButtonState.disabledReason = "";
  sharedButtonState.lastCheckTime = 0;
  console.log("Reset shared button state for navigation");
}

// Checks and updates shared button state.
// This function should only be called on OPS repos.
async function checkSharedButtonState() {
  try {
    // Check if user is authenticated with GitHub first.
    const hasToken = await isAuthenticated();
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

    // Check that we're still on a PR files page.
    if (!isPrFilesPage()) {
      return null;
    }

    sharedButtonState.lastCheckTime = now;
    console.log("Checking button state...");

    // Get repo info.
    const repoInfo = extractRepoInfo();
    if (!repoInfo) {
      sharedButtonState.isDisabled = true;
      sharedButtonState.disabledReason = "Could not determine repo information";
      return sharedButtonState;
    }

    // Check the latest commit and PR status.
    const prInfo = await getPrInfo(
      repoInfo.owner,
      repoInfo.repo,
      repoInfo.prNumber
    );

    if (!prInfo) {
      sharedButtonState.isDisabled = true;
      sharedButtonState.disabledReason = "Could not determine latest commit";
      return sharedButtonState;
    }

    const { commitSha: currentCommitSha, prStatus } = prInfo;

    // Check if PR status changed.
    if (prStatus !== sharedButtonState.prStatus) {
      console.log(`PR status changed from ${sharedButtonState.prStatus} to ${prStatus}`);
      sharedButtonState.prStatus = prStatus;
    }

    // If PR is closed, disable buttons and skip build checks.
    if (prStatus === 'closed') {
      sharedButtonState.isDisabled = true;
      sharedButtonState.disabledReason = "Pull request is closed";
      return sharedButtonState;
    }

    // For merged PRs, we'll still check for preview URLs like open PRs
    // but we won't check build status since merged PRs don't get new builds

    if (currentCommitSha !== sharedButtonState.latestCommitSha) {
      // Commit SHA has changed, update it and check build status.
      console.log(`Commit SHA changed from ${sharedButtonState.latestCommitSha} to ${currentCommitSha}`);
      sharedButtonState.latestCommitSha = currentCommitSha;

      // For merged PRs, skip build status checks and enable buttons
      // Individual buttons will be disabled if no preview URL is found
      if (prStatus === 'merged') {
        sharedButtonState.isDisabled = false;
        sharedButtonState.disabledReason = "";
        sharedButtonState.lastBuildStatus = "merged"; // Use special status
        return sharedButtonState;
      }

      // Check build status for the new commit.
      const opsCheck = await getSpecificStatusCheck(
        repoInfo.owner,
        repoInfo.repo,
        currentCommitSha,
        "OpenPublishing.Build"
      );

      if (!opsCheck) {
        console.log("No OPS build check found, disabling buttons");
        sharedButtonState.isDisabled = true;
        sharedButtonState.disabledReason = NO_OPS_BUILD_FOUND;
        sharedButtonState.lastBuildStatus = null;
        return sharedButtonState;
      }

      // Determine button state based on build status.
      if (opsCheck.status === "pending") {
        sharedButtonState.isDisabled = true;
        sharedButtonState.disabledReason = OPS_BUILD_PENDING;
      } else if (opsCheck.status !== "success") {
        sharedButtonState.isDisabled = true;
        sharedButtonState.disabledReason = OPS_BUILD_FAILED;
      } else if (!opsCheck.details_url) {
        sharedButtonState.isDisabled = true;
        sharedButtonState.disabledReason = NO_OPS_DETAILS_URL;
      } else {
        // Build was successful.
        sharedButtonState.isDisabled = false;
        sharedButtonState.disabledReason = "";
      }

      sharedButtonState.lastBuildStatus = opsCheck.status;
      return sharedButtonState;
    } else if (sharedButtonState.lastBuildStatus === "pending") {
      // For merged PRs, skip build status checks
      if (prStatus === 'merged') {
        return sharedButtonState;
      }

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
        sharedButtonState.isDisabled = true;
        sharedButtonState.disabledReason = NO_OPS_BUILD_FOUND;
      } else if (opsCheck.status === 'pending') {
        sharedButtonState.isDisabled = true;
        sharedButtonState.disabledReason = OPS_BUILD_PENDING;
      } else if (opsCheck.status !== 'success') {
        sharedButtonState.isDisabled = true;
        sharedButtonState.disabledReason = OPS_BUILD_FAILED;
      } else if (!opsCheck.details_url) {
        sharedButtonState.isDisabled = true;
        sharedButtonState.disabledReason = NO_OPS_DETAILS_URL;
      } else {
        // Build was successful - clear disablement.
        sharedButtonState.isDisabled = false;
        sharedButtonState.disabledReason = "";
      }

      sharedButtonState.lastBuildStatus = currentBuildStatus;
      return sharedButtonState;
    } else if (!sharedButtonState.lastBuildStatus || sharedButtonState.isDisabled) {
      // For merged PRs, skip build status checks
      if (prStatus === 'merged') {
        return sharedButtonState;
      }

      // Force a recheck if we don't have a valid build status or if buttons are currently disabled.
      const opsCheck = await getSpecificStatusCheck(
        repoInfo.owner,
        repoInfo.repo,
        currentCommitSha,
        "OpenPublishing.Build"
      );

      if (!opsCheck) {
        sharedButtonState.isDisabled = true;
        sharedButtonState.disabledReason = NO_OPS_BUILD_FOUND;
        sharedButtonState.lastBuildStatus = null;
        return sharedButtonState;
      }

      // Update state based on current build status.
      if (opsCheck.status === "pending") {
        sharedButtonState.isDisabled = true;
        sharedButtonState.disabledReason = OPS_BUILD_PENDING;
      } else if (opsCheck.status !== "success") {
        sharedButtonState.isDisabled = true;
        sharedButtonState.disabledReason = OPS_BUILD_FAILED;
      } else if (!opsCheck.details_url) {
        sharedButtonState.isDisabled = true;
        sharedButtonState.disabledReason = NO_OPS_DETAILS_URL;
      } else {
        // Build was successful.
        sharedButtonState.isDisabled = false;
        sharedButtonState.disabledReason = "";
      }

      sharedButtonState.lastBuildStatus = opsCheck.status;
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
  console.log(`Updating button. Current disabled state is ${state.isDisabled}, reason: ${state.disabledReason}`);

  const isNowDisabled = state.isDisabled;
  let disabledReason = state.disabledReason;

  // Check current state.
  const currentlyDisabled = button.disabled || button.classList.contains('disabled');

  // Update the button only if the state or the reason has changed.
  if (currentlyDisabled === isNowDisabled && button.disabledReason === disabledReason) {
    return;
  }

  // If the shared state says the button should be disabled, always respect that.
  if (isNowDisabled) {
    button.classList.add('disabled');
    button.disabled = true;

    // Add tooltip with reason.
    if (disabledReason) {
      button.disabledReason = disabledReason;
      button.title = disabledReason;
    }
    return;
  }

  // Button should be enabled, try to get/update preview URL.
  const filePathElement = button.closest('[data-path]');
  if (filePathElement) {
    const linkElement = filePathElement.querySelector(".Link--primary");
    const fullText = linkElement?.textContent;

    // Try to extract filename from text content first (handles renames with "old → new").
    let fileName = fullText?.split(" → ").pop();

    // If filename is invalid or looks truncated, use data-path.
    if (!fileName || fileName.includes('…') || fileName.startsWith('...')) {
      const dataPath = filePathElement.getAttribute('data-path');
      if (dataPath) {
        fileName = dataPath;
      }
    }

    if (fileName) {
      try {
        // Await the preview URL.
        console.log(`Attempting to get preview URL for '${fileName}' on ${state.prStatus} PR`);
        const previewUrl = await getPreviewUrl(fileName);

        if (previewUrl) {
          console.log(`Adding preview URL to ${fileName}: ${previewUrl}`);
          button.title = previewUrl;
          button.dataset.previewUrl = previewUrl;

          // Enable the button and return.
          button.disabled = false;
          button.classList.remove('disabled');
          return;
        } else {
          // Likely an unpublished file (e.g. docfx.json).
          console.log(`No preview URL found for '${fileName}' on ${state.prStatus} PR`);
          disabledReason = NO_PREVIEW_URL;
        }
      } catch (error) {
        console.error(`Error getting preview URL for '${fileName}' on ${state.prStatus} PR:`, error);
        disabledReason = NO_PREVIEW_URL;
      }
    }
  }

  // If we get here, button should be disabled (no preview URL found).
  console.log(`Disabling button for ${state.prStatus} PR because: ${disabledReason}`);
  button.classList.add('disabled');
  button.disabled = true;

  // Add tooltip with reason.
  if (disabledReason) {
    button.disabledReason = disabledReason;
    button.title = disabledReason;
  }
}

// Updates all existing buttons (called from interval observer).
async function updateAllButtons() {
  const state = await checkSharedButtonState();
  const allButtons = document.querySelectorAll('.preview-on-learn');

  if (!state) {
    console.log("Couldn't get shared button state");
    return;
  }

  allButtons.forEach(button => {
    updateButtonState(button, state);
  });
}

function addButton(showCommentsMenuItem, isDisabled = false, disabledReason = "") {
  try {
    // Check if a button already exists in this dropdown.
    const dropdown = showCommentsMenuItem.closest('.js-file-header-dropdown');
    if (dropdown && dropdown.querySelector('.preview-on-learn')) {
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
      menuItem.disabled = true;

      // Add tooltip with reason.
      if (disabledReason) {
        menuItem.title = disabledReason;
      }
    } else {
      // Get and store the preview URL.
      const filePathElement = showCommentsMenuItem.closest('[data-path]');
      if (filePathElement) {
        const linkElement = filePathElement.querySelector(".Link--primary");
        const fullText = linkElement?.textContent;

        // Try to extract filename from text content first (handles renames with "old → new").
        let fileName = fullText?.split(" → ").pop();

        // If filename is invalid or looks truncated, use data-path.
        if (!fileName || fileName.includes('…') || fileName.startsWith('...')) {
          const dataPath = filePathElement.getAttribute('data-path');
          if (dataPath) {
            fileName = dataPath;
          }
        }

        if (fileName) {
          getPreviewUrl(fileName).then(previewUrl => {
            if (previewUrl && !menuItem.disabled) {
              menuItem.title = previewUrl;
              menuItem.dataset.previewUrl = previewUrl;
            }
          }).catch((error) => {
            console.warn("Error while getting preview URL:", error);
          });
        }
      }
    }

    // Add event listener to ALL buttons (enabled or disabled).
    menuItem.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (menuItem.dataset.previewUrl) {
        window.open(menuItem.dataset.previewUrl, '_blank');
      }
    }, { capture: true });

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

    // Remove any existing buttons first to prevent duplicates.
    removeAllButtons();

    // Check shared button state.
    const state = await checkSharedButtonState();

    // Add "Preview on Learn" menu item after "Delete file" menu item.
    const deleteFileItems = document.querySelectorAll(CSS_SELECTOR);
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
  // Basic init if the user isn't authenticated with GitHub.
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    console.log("User isn't authenticated.");

    let cleanupNoTokenObserver = null;
    let cleanupNoTokenNavigation = null;

    // Function to check and add buttons if on PR files page.
    async function checkAndAddNoTokenButtons() {
      if (isPrFilesPage()) {
        const isOps = await isOpsRepo();
        if (isOps) {
          // Remove any existing buttons first.
          removeAllButtons();

          // Add disabled buttons with token message for existing dropdowns.
          const deleteFileItems = document.querySelectorAll(CSS_SELECTOR);
          deleteFileItems.forEach(item => {
            addButton(item, true, INVALID_TOKEN_MESSAGE);
          });

          // Set up observer for new dropdowns that appear dynamically (if not already set up).
          if (!cleanupNoTokenObserver) {
            cleanupNoTokenObserver = setUpNoTokenObserver(addButton, INVALID_TOKEN_MESSAGE);
          }
        }
      } else {
        // Clean up observer if we're not on files page.
        if (cleanupNoTokenObserver) {
          cleanupNoTokenObserver();
          cleanupNoTokenObserver = null;
        }
      }
    }

    // Check initially.
    await checkAndAddNoTokenButtons();

    // Set up navigation listeners to detect when user navigates to/from files page.
    cleanupNoTokenNavigation = setUpNavigationListeners(async () => {
      // Reset state when navigating
      resetSharedButtonState();
      await checkAndAddNoTokenButtons();
    });

    // Clean up when navigating away.
    window.addEventListener('beforeunload', () => {
      if (cleanupNoTokenObserver) {
        cleanupNoTokenObserver();
      }
      if (cleanupNoTokenNavigation) {
        cleanupNoTokenNavigation();
      }
    });

    return;
  }

  // User has token, set up full functionality.
  await fullInit();
}

// Full init with GitHub queries if user has added a GitHub token.
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

    // Reset state when navigating to ensure we don't carry over previous PR state
    resetSharedButtonState();

    // If user navigates to a files page, restart interval in case PR status changed.
    if (isPrFilesPage()) {
      observers.startInterval();
    }
  });

  // Clean up when navigating away.
  window.addEventListener('beforeunload', () => {
    observers.fileObserver.disconnect();
    observers.stopInterval();
    cleanupNavigation();
  });
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "authenticate") {
    // Handle authentication request from popup - just try to initialize
    initializeOctokit().then((result) => {
      if (result) {
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: "Failed to initialize with stored token" });
      }
    }).catch((error) => {
      console.error("Authentication failed:", error);
      sendResponse({ success: false, error: error.message });
    });
    return true; // Keep message channel open for async response
  } else if (message.action === "getUserInfo") {
    // Get user info request from popup
    isAuthenticated().then(async (authenticated) => {
      if (authenticated) {
        try {
          await initializeOctokit();
          const { octokit } = await import('./octokit.js');
          const { data: user } = await octokit.users.getAuthenticated();
          sendResponse({ success: true, user });
        } catch (error) {
          console.error("Failed to get user info:", error);
          sendResponse({ success: false, error: error.message });
        }
      } else {
        sendResponse({ success: false, error: "Not authenticated" });
      }
    }).catch((error) => {
      console.error("Authentication check failed:", error);
      sendResponse({ success: false, error: error.message });
    });
    return true; // Keep message channel open for async response
  } else if (message.action === "authCompleted") {
    // Handle auth completed notification from popup
    console.log("Authentication completed by popup, reinitializing extension");
    initializeOctokit().then(() => {
      // Reload the page to update the UI state with the new auth
      location.reload();
    });
  } else if (message.action === "authCleared") {
    // Handle auth cleared notification from popup
    console.log("Authentication cleared by popup");
    location.reload(); // Reload to update the UI state
  }
});

init();
