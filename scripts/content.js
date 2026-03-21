import { isOpsRepo, isDifferentRepo } from './repo.js';
import { initializeOctokit } from './octokit.js';
import { extractRepoInfo, getPrInfo, getSpecificStatusCheck } from './pr-helpers.js';
import { getPreviewUrl } from './build-report.js';
import { setUpObservers, setUpNavigationListeners, setUpTokenObserver, setUpNoTokenObserver } from './observers.js';
import { hasGitHubToken } from './auth.js';

export const CSS_SELECTOR = '.js-file-header-dropdown a[aria-label="Delete this file"], .js-file-header-dropdown button[aria-label="You must be signed in and have push access to delete this file."], li[data-variant="danger"] > a[role="menuitem"][aria-keyshortcuts="d"]';
const INVALID_TOKEN_MESSAGE = "You haven't entered a GitHub token or the token you entered is invalid. Go to Extensions > Preview on Learn and enter a valid PAT. The PAT should have 'repo' scope and be configured for SSO.";
const NO_PREVIEW_URL = "No preview URL is available for this file";
const NO_OPS_BUILD_FOUND = "No OPS build status check was found";
const OPS_BUILD_PENDING = "The OPS build is still in progress";
const OPS_BUILD_FAILED = "The OPS build failed";
const NO_OPS_DETAILS_URL = "The OPS details URL isn't available";

// Helper function to remove all existing Preview on Learn buttons.
function removeAllButtons() {
  const existingButtons = document.querySelectorAll('.preview-on-learn');
  existingButtons.forEach(button => {
    // New UI: button <a> is inside a wrapper <li>, with a divider <li> before it.
    const parentLi = button.parentElement;
    if (parentLi && parentLi.tagName === 'LI' && parentLi.getAttribute('role') === 'none') {
      const liDivider = parentLi.previousElementSibling;
      if (liDivider && liDivider.tagName === 'LI' && liDivider.getAttribute('aria-hidden') === 'true') {
        liDivider.remove();
      }
      parentLi.remove();
      return;
    }

    // Old UI: divider is the previous sibling <div>.
    const divider = button.previousElementSibling;
    if (divider && divider.classList.contains('dropdown-divider')) {
      divider.remove();
    }
    button.remove();
  });
}

// Helper to find the file path element, handling both old and new GitHub UI.
// In the new UI, the action menu may be in a portal outside the file header,
// so we trace back via the menu's aria-labelledby to find the trigger button's container.
function getFilePathElement(element) {
  const directPath = element.closest('[data-path]');
  if (directPath) return directPath;

  const menu = element.closest('ul[role="menu"]');
  if (menu) {
    const triggerId = menu.getAttribute('aria-labelledby');
    if (triggerId) {
      const triggerElement = document.getElementById(triggerId);
      if (triggerElement) {
        return triggerElement.closest('[data-path]');
      }
    }
  }

  return null;
}

// Helper to extract the file name from the menu's "View file" blob link.
// Used as a fallback when getFilePathElement can't find the [data-path] container
// (e.g. when the menu is rendered in a React portal in the new GitHub UI).
function getFileNameFromMenu(element) {
  const menu = element.closest('ul[role="menu"]');
  if (!menu) return null;

  // Look for the "View file" link which has a blob URL like:
  // /owner/repo/blob/{sha}/path/to/file.md
  const blobLink = menu.querySelector('a[href*="/blob/"]');
  if (blobLink) {
    const href = blobLink.getAttribute('href');
    const blobMatch = href.match(/\/blob\/[a-f0-9]+\/(.+)$/);
    if (blobMatch) {
      return blobMatch[1];
    }
  }

  // Fallback: look for the delete link and extract path from it.
  // href like /owner/repo/delete/branch/path/to/file.md
  const deleteLink = menu.querySelector('li[data-variant="danger"] > a[href*="/delete/"]');
  if (deleteLink) {
    const href = deleteLink.getAttribute('href');
    const deleteMatch = href.match(/\/delete\/[^/]+\/(.+)$/);
    if (deleteMatch) {
      return deleteMatch[1];
    }
  }

  return null;
}

// Helper to extract the file name for a given element, trying multiple strategies.
function getFileName(element) {
  // Strategy 1: Find [data-path] container and extract from it.
  const filePathElement = getFilePathElement(element);
  if (filePathElement) {
    const linkElement = filePathElement.querySelector(".Link--primary");
    const fullText = linkElement?.textContent;

    // Try to extract filename from text content first (handles renames with "old \u2192 new").
    let fileName = fullText?.split(" \u2192 ").pop();

    // If filename is invalid or looks truncated, use data-path.
    if (!fileName || fileName.includes('\u2026') || fileName.startsWith('...')) {
      const dataPath = filePathElement.getAttribute('data-path');
      if (dataPath) {
        fileName = dataPath;
      }
    }

    if (fileName) return fileName;
  }

  // Strategy 2: Extract from menu links (new UI fallback).
  return getFileNameFromMenu(element);
}

// Shared state for button conditions.
const sharedButtonState = {
  latestCommitSha: null,
  lastBuildStatus: null,
  prStatus: null, // 'open', 'closed', or 'merged'.
  isDisabled: false,
  disabledReason: "",
  lastCheckTime: 0,
  previewUrlsFetched: false // Track if we've fetched preview URLs for current commit
};

// Reset shared state when navigating to a different PR
function resetSharedButtonState() {
  sharedButtonState.latestCommitSha = null;
  sharedButtonState.lastBuildStatus = null;
  sharedButtonState.prStatus = null;
  sharedButtonState.isDisabled = false;
  sharedButtonState.disabledReason = "";
  sharedButtonState.lastCheckTime = 0;
  sharedButtonState.previewUrlsFetched = false; // Reset preview URLs fetched flag
  console.log("Reset shared button state for navigation");
}

// Checks and updates shared button state.
// This function should only be called on OPS repos.
async function checkSharedButtonState() {
  try {
    // Check if user has a GitHub token first.
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

    if (currentCommitSha !== sharedButtonState.latestCommitSha) {
      // Commit SHA has changed, update it and check build status.
      console.log(`Commit SHA changed from ${sharedButtonState.latestCommitSha} to ${currentCommitSha}`);
      sharedButtonState.latestCommitSha = currentCommitSha;

      // Reset preview URLs fetched flag since we have a new commit
      sharedButtonState.previewUrlsFetched = false;

      // For merged PRs, skip build status checks and enable buttons.
      // Individual buttons will be disabled if no preview URL is found.
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
      // For merged PRs, skip build status checks.
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
      // For merged PRs, skip build status checks.
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
  const isNowDisabled = state.isDisabled;
  let newDisabledReason = state.disabledReason;

  // Check current state.
  const previouslyDisabled = button.classList.contains('disabled');

  // If previously enabled and is now enabled, no update needed.
  if (!previouslyDisabled && !isNowDisabled) {
    return;
  }

  // If previously disabled and now disabled and
  //  the disabled reason hasn't changed, return.
  if (previouslyDisabled === isNowDisabled &&
    (button.disabledReason === newDisabledReason ||
      (typeof button.disabledReason === "undefined" && newDisabledReason === ''))) {
    return;
  }

  // Debugging.
  //console.log(`Previously disabled: ${previouslyDisabled}`);
  //console.log(`Newly disabled: ${isNowDisabled}`);
  //console.log(`Previous disabled reason: ${button.disabledReason}`);
  //console.log(`New disabled reason: ${newDisabledReason}`);

  // Either enablement or disabled reason has changed.
  console.log('Updating button state or disabled reason.');
  console.log(`Current enabled state is ${!(state.isDisabled)}.`);
  if (state.disabledReason) {
    console.log(`Reason: ${state.disabledReason}`);
  }

  // If the shared state says the button should be disabled, always respect that.
  if (isNowDisabled) {
    button.classList.add('disabled');
    button.setAttribute('aria-disabled', 'true');
    button.removeAttribute('href');

    // Add tooltip with reason.
    if (newDisabledReason) {
      button.disabledReason = newDisabledReason;
      button.title = newDisabledReason;
    }
    return;
  }

  // Button should be enabled, try to get/update preview URL.
  const fileName = getFileName(button);

  if (fileName) {
    {
      // Optimization: Only fetch preview URL if we don't have one yet OR commit SHA has changed.
      const needsFetch = !button.href || !sharedButtonState.previewUrlsFetched;

      if (needsFetch) {
        try {
          // Await the preview URL.
          console.log(`Attempting to get preview URL for '${fileName}' on ${state.prStatus} PR`);
          const previewUrl = await getPreviewUrl(fileName);

          if (previewUrl) {
            console.log(`Adding preview URL to ${fileName}: ${previewUrl}`);
            button.href = previewUrl;
            button.removeAttribute('title');

            // Enable the button and return.
            button.classList.remove('disabled');
            button.removeAttribute('aria-disabled');

            // Mark that we've successfully fetched preview URLs for this commit.
            sharedButtonState.previewUrlsFetched = true;
            return;
          } else {
            // Likely an unpublished file (e.g. docfx.json).
            console.log(`No preview URL found for '${fileName}' on ${state.prStatus} PR`);
            newDisabledReason = NO_PREVIEW_URL;
          }
        } catch (error) {
          console.error(`Error getting preview URL for '${fileName}' on ${state.prStatus} PR:`, error);
          newDisabledReason = NO_PREVIEW_URL;
        }
      } else {
        // We already have a preview URL and commit hasn't changed, just enable the button.
        if (button.href) {
          console.log(`Enabling button and using existing preview URL for ${fileName}.`);
          button.removeAttribute('title');
          button.classList.remove('disabled');
          button.removeAttribute('aria-disabled');
          return;
        }
      }
    }
  }

  // If we get here, button should be disabled (no preview URL found).
  console.log(`Disabling button for ${state.prStatus} PR because: ${newDisabledReason}`);
  button.classList.add('disabled');
  button.setAttribute('aria-disabled', 'true');
  button.removeAttribute('href');

  // Add tooltip with reason.
  if (newDisabledReason) {
    button.disabledReason = newDisabledReason;
    button.title = newDisabledReason;
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
    // Detect which GitHub UI we're in.
    const isNewUI = !showCommentsMenuItem.closest('.js-file-header-dropdown');
    const container = isNewUI
      ? showCommentsMenuItem.closest('ul[role="menu"]')
      : showCommentsMenuItem.closest('.js-file-header-dropdown');

    // Check if a button already exists in this dropdown/menu.
    if (container && container.querySelector('.preview-on-learn')) {
      return;
    }

    let button;

    if (isNewUI) {
      // New GitHub UI: Create ActionList-style menu item.
      const deleteListItem = showCommentsMenuItem.closest('li');

      // Create divider <li>.
      // The parent <ul> has data-dividers="false" which hides ActionList dividers via CSS,
      // so we use an inline border style to ensure visibility.
      const divider = document.createElement("li");
      divider.setAttribute("aria-hidden", "true");
      divider.style.listStyle = "none";
      divider.style.borderTop = "1px solid var(--borderColor-muted, var(--color-action-list-item-inline-divider))";
      divider.style.marginTop = "4px";
      divider.style.marginBottom = "4px";

      // Create wrapper <li>.
      const listItem = document.createElement("li");
      listItem.setAttribute("role", "none");
      listItem.setAttribute("data-has-description", "false");
      const existingLi = container?.querySelector('li[role="none"]');
      if (existingLi) {
        listItem.className = existingLi.className;
      }

      // Create button <a>.
      button = document.createElement("a");
      button.setAttribute("tabindex", "-1");
      button.setAttribute("role", "menuitem");
      button.setAttribute("data-size", "medium");
      const existingLink = container?.querySelector('li[role="none"] > a[role="menuitem"]');
      if (existingLink) {
        button.className = [...existingLink.classList].join(' ');
      }
      button.classList.add('preview-on-learn');

      // Build inner label structure matching GitHub's ActionList pattern.
      const spacerSpan = document.createElement("span");
      const existingSpacer = container?.querySelector('li[role="none"] > a > span[class*="Spacer"]');
      if (existingSpacer) {
        spacerSpan.className = existingSpacer.className;
      }

      // Add leading visual icon (link-external).
      const leadingVisual = document.createElement("span");
      const existingVisual = container?.querySelector('li[role="none"] .prc-ActionList-LeadingVisual-NBr28, li[role="none"] span[class*="LeadingVisual"]');
      if (existingVisual) {
        leadingVisual.className = existingVisual.className;
      }
      const iconSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      iconSvg.setAttribute("aria-hidden", "true");
      iconSvg.setAttribute("focusable", "false");
      iconSvg.setAttribute("viewBox", "0 0 16 16");
      iconSvg.setAttribute("width", "16");
      iconSvg.setAttribute("height", "16");
      iconSvg.setAttribute("fill", "currentColor");
      iconSvg.setAttribute("display", "inline-block");
      iconSvg.setAttribute("overflow", "visible");
      iconSvg.style.verticalAlign = "text-bottom";
      const iconPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      iconPath.setAttribute("d", "M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z");
      iconSvg.appendChild(iconPath);
      leadingVisual.appendChild(iconSvg);

      const subContentSpan = document.createElement("span");
      subContentSpan.setAttribute("data-component", "ActionList.Item--DividerContainer");
      const existingSubContent = container?.querySelector('[data-component="ActionList.Item--DividerContainer"]');
      if (existingSubContent) {
        subContentSpan.className = existingSubContent.className;
      }

      const labelSpan = document.createElement("span");
      const existingLabel = container?.querySelector('span[id$="--label"]');
      if (existingLabel) {
        labelSpan.className = existingLabel.className;
      }
      labelSpan.textContent = "Preview on Learn";

      subContentSpan.appendChild(labelSpan);
      button.appendChild(spacerSpan);
      button.appendChild(leadingVisual);
      button.appendChild(subContentSpan);
      listItem.appendChild(button);

      // Insert after delete file list item.
      deleteListItem.after(divider);
      divider.after(listItem);
    } else {
      // Old GitHub UI: Create old-style dropdown menu item.
      const divider = document.createElement("div");
      divider.className = "dropdown-divider";
      divider.setAttribute("role", "none");
      showCommentsMenuItem.after(divider);

      button = document.createElement("a");
      button.className = "pl-5 dropdown-item btn-link preview-on-learn";
      button.setAttribute("role", "menuitem");
      button.textContent = "Preview on Learn";

      // Add new button to menu below divider.
      divider.after(button);
    }

    // If disabled, add appropriate styling and attributes.
    if (isDisabled) {
      button.classList.add('disabled');
      button.setAttribute('aria-disabled', 'true');

      // Add tooltip with reason.
      if (disabledReason) {
        button.title = disabledReason;
      }
    } else {
      // Get and store the preview URL.
      const fileName = getFileName(showCommentsMenuItem);
      if (fileName) {
        getPreviewUrl(fileName).then(previewUrl => {
          if (previewUrl && !button.classList.contains('disabled')) {
            button.href = previewUrl;
          }
        }).catch((error) => {
          console.warn("Error while getting preview URL:", error);
        });
      }
    }

    // Add event listener to ALL buttons (enabled or disabled).
    const handleClick = function (event) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      // Don't open if disabled
      if (button.classList.contains('disabled')) {
        return;
      }

      if (button.href) {
        // Close the dropdown/menu before opening the link.
        if (isNewUI) {
          button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        } else {
          const dropdown = button.closest('.js-file-header-dropdown');
          if (dropdown) {
            dropdown.open = false;
          }
        }

        window.open(button.href, '_blank');
      }
    };

    button.addEventListener('click', handleClick, { capture: true });

    // In the new UI, the parent <li> may intercept events before they reach the <a>.
    if (isNewUI) {
      const parentLi = button.closest('li');
      if (parentLi) {
        parentLi.addEventListener('click', handleClick, { capture: true });
      }
    }

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
  if (!path.includes('/pull/')) return false;

  // Old UI: /pull/N/files
  // New UI: /pull/N/changes
  return path.includes('/files') || path.includes('/changes');
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

    // Reset state when navigating to ensure we don't carry over previous PR state
    resetSharedButtonState();

    // If user navigates to a files page, restart interval in case PR status changed.
    if (isPrFilesPage()) {
      observers.startInterval();
    }
  });

  // Set up token observer to handle token removal,
  const cleanupTokenObserver = setUpTokenObserver(
    async () => {
      // Token was added (shouldn't happen in fullInit, but handle it)
      console.log("Token was added while extension was running");
    },
    async () => {
      // Token was removed - go back to initial state.
      console.log("GitHub token was removed, reverting to initial state");

      // Clean up current observers.
      observers.fileObserver.disconnect();
      observers.stopInterval();
      cleanupNavigation();

      // Remove all existing buttons.
      removeAllButtons();

      // Clear shared state.
      sharedButtonState.latestCommitSha = null;
      sharedButtonState.lastBuildStatus = null;
      sharedButtonState.prStatus = null;
      sharedButtonState.isDisabled = false;
      sharedButtonState.disabledReason = "";
      sharedButtonState.lastCheckTime = 0;
      sharedButtonState.previewUrlsFetched = false; // Reset preview URLs fetched flag

      // Reinitialize in no-token mode.
      await init();
    }
  );

  // Clean up when navigating away.
  window.addEventListener('beforeunload', () => {
    observers.fileObserver.disconnect();
    observers.stopInterval();
    cleanupNavigation();
    cleanupTokenObserver();
  });
}

init();
