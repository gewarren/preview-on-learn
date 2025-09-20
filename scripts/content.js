import { isOpsRepo, isDifferentRepo } from './repo.js';
import { initializeOctokit } from './octokit.js';
import { extractRepoInfo, getLatestPrCommit, getSpecificStatusCheck } from './pr-helpers.js';
import { getPreviewUrl } from './build-report.js';
import { setUpObservers, setUpNavigationListeners, setUpTokenObserver, setUpNoTokenObserver } from './observers.js';
import { hasGitHubToken } from './auth.js';

export const CSS_SELECTOR = '.js-file-header-dropdown a[aria-label="Delete this file"], .js-file-header-dropdown button[aria-label="You must be signed in and have push access to delete this file."]';
const INVALID_TOKEN_MESSAGE = "You haven't entered a GitHub token or the token you entered is invalid. Go to Extensions > Preview on Learn and enter a valid PAT. The PAT should have 'repo' scope and be configured for SSO.";
const NO_PREVIEW_URL = "No preview URL is available for this file, possibly because it isn't published on learn.microsoft.com.";
const NO_OPS_BUILD_FOUND = "No OPS build status check was found";
const OPS_BUILD_PENDING = "The OPS build is still in progress";
const OPS_BUILD_FAILED = "The OPS build failed";
const NO_OPS_DETAILS_URL = "The OPS details URL isn't available";

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

  // Check that we're still on a PR files page.
  if (!isPrFilesPage()) {
    return null;
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

  const isNowDisabled = state.isDisabled;
  let disabledReason = state.disabledReason;

  // Check current state.
  const currentlyDisabled = button.disabled || button.classList.contains('disabled');

  // Update the button only if the state or the reason has changed.
  if (currentlyDisabled === isNowDisabled && button.disabledReason === disabledReason) {
    return;
  }

  console.log(`Changing button state from ${currentlyDisabled} to ${isNowDisabled} or changing disabled reason`);

  if (!isNowDisabled) {
    // Try to get preview URL.
    const filePathElement = button.closest('[data-path]');
    if (filePathElement) {
      const linkElement = filePathElement.querySelector(".Link--primary");
      const fullText = linkElement?.textContent;

      // Try to extract filename from text content first (handles renames with "old → new")
      let fileName = fullText?.split(" → ").pop();

      // If we still don't have a valid filename or it looks truncated, use data-path
      if (!fileName || fileName.includes('…') || fileName.startsWith('...')) {
        const dataPath = filePathElement.getAttribute('data-path');
        if (dataPath) {
          fileName = dataPath; // Use the full path from data-path
          console.log("Using full path from data-path:", fileName);
        }
      }

      if (fileName) {
        try {
          // Await the preview URL
          const previewUrl = await getPreviewUrl(fileName);

          if (previewUrl) {
            console.log(`Adding preview URL to ${fileName}`);
            button.title = previewUrl;
            button.dataset.previewUrl = previewUrl;

            // Enable the button and return;
            button.disabled = false;
            return;
          } else {
            // Likely an unpublished file (e.g. docfx.json).
            console.log(`No preview URL found for '${fileName}'`);
            disabledReason = NO_PREVIEW_URL;
          }
        } catch (error) {
          console.error('Error getting preview URL:', error);
          disabledReason = NO_PREVIEW_URL;
        }
      }
    }
  }

  // Button needs to be disabled if we get here.

  button.classList.add('disabled');
  button.disabled = true;

  // Add tooltip with reason
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

        // Try to extract filename from text content first (handles renames with "old → new")
        let fileName = fullText?.split(" → ").pop();

        // If we still don't have a valid filename or it looks truncated, use data-path
        if (!fileName || fileName.includes('…') || fileName.startsWith('...')) {
          const dataPath = filePathElement.getAttribute('data-path');
          if (dataPath) {
            fileName = dataPath; // Use the full path from data-path
            console.log("Using full path from data-path (addButton):", fileName);
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

    // Remove any existing buttons first to prevent duplicates
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

// Basic init if the user hasn't added a GitHub token.
async function init() {
  // Check if user has a GitHub token.
  const hasToken = await hasGitHubToken();

  if (!hasToken) {
    console.log("No GitHub token found.");

    let cleanupNoTokenObserver = null;
    let cleanupNoTokenNavigation = null;

    // Only set up token observer to wait for token to be entered.
    const cleanupTokenObserver = setUpTokenObserver(
      async () => {
        console.log("GitHub token detected, reinitializing extension");
        // Token was added, reinitialize the extension.
        await initializeOctokit();

        // Clean up the token-only observer, no-token observer, and navigation listeners.
        cleanupTokenObserver();
        if (cleanupNoTokenObserver) {
          cleanupNoTokenObserver();
        }
        if (cleanupNoTokenNavigation) {
          cleanupNoTokenNavigation();
        }

        // Remove existing disabled buttons.
        removeAllButtons();

        await fullInit();
      },
      async () => {
        // Token removal shouldn't happen when we're in no-token mode, but handle it gracefully.
        console.log("Token was removed while in no-token mode");
      }
    );

    // Function to check and add buttons if on PR files page
    async function checkAndAddNoTokenButtons() {
      if (isPrFilesPage()) {
        const isOps = await isOpsRepo();
        if (isOps) {
          // Remove any existing buttons first
          removeAllButtons();

          // Add disabled buttons with token message for existing dropdowns.
          const deleteFileItems = document.querySelectorAll(CSS_SELECTOR);
          deleteFileItems.forEach(item => {
            addButton(item, true, INVALID_TOKEN_MESSAGE);
          });

          // Set up observer for new dropdowns that appear dynamically (if not already set up)
          if (!cleanupNoTokenObserver) {
            cleanupNoTokenObserver = setUpNoTokenObserver(addButton, INVALID_TOKEN_MESSAGE);
          }
        }
      } else {
        // Clean up observer if we're not on files page
        if (cleanupNoTokenObserver) {
          cleanupNoTokenObserver();
          cleanupNoTokenObserver = null;
        }
      }
    }

    // Check initially
    await checkAndAddNoTokenButtons();

    // Set up navigation listeners to detect when user navigates to/from files page
    cleanupNoTokenNavigation = setUpNavigationListeners(async () => {
      await checkAndAddNoTokenButtons();
    });

    // Clean up when navigating away.
    window.addEventListener('beforeunload', () => {
      cleanupTokenObserver();
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

