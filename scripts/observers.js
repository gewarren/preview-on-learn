import { isOpsRepo } from './repo.js';
import { extractRepoInfo } from './pr-helpers.js';
import { CSS_SELECTOR } from './content.js';

// Sets up observers to watch for DOM changes.
export function setUpObservers(updateAllButtons, checkButtonState, addButton, updateButtonState) {
    console.log('Setting up mutation observers');

    let commitCheckInterval = null;
    let lastKnownPrStatus = null;

    function startInterval() {
        if (commitCheckInterval) return; // Already running

        console.log('Starting commit check interval');
        commitCheckInterval = setInterval(async () => {
            const repoInfo = extractRepoInfo();
            if (repoInfo) {
                // Check if this is an OPS repo first.
                const isOps = await isOpsRepo();
                if (!isOps) {
                    return;
                }

                // Get the current button state, which includes PR status.
                const state = await checkButtonState();
                if (state) {
                    // Check if PR status changed from closed/merged to open.
                    if (lastKnownPrStatus &&
                        (lastKnownPrStatus === 'closed' || lastKnownPrStatus === 'merged') &&
                        state.prStatus === 'open') {
                        console.log('PR was reopened, updating all buttons');
                    }

                    lastKnownPrStatus = state.prStatus;

                    // If PR is closed or merged, pause the interval.
                    if (state.prStatus === 'closed' || state.prStatus === 'merged') {
                        console.log('PR is closed, pausing interval checks');
                        stopInterval();
                        // Update buttons one more time to show the current state.
                        updateAllButtons();
                        return;
                    }
                }

                // Always update buttons to trigger build status checks.
                updateAllButtons();
            }
        }, 15000); // Check every 15 seconds.
    }

    function stopInterval() {
        if (commitCheckInterval) {
            console.log('Stopping commit check interval');
            clearInterval(commitCheckInterval);
            commitCheckInterval = null;
        }
    }

    // Start the interval initially.
    startInterval();

    // Observer for file header dropdown additions when user has a token.
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

                    // Check if this is an OPS repo first.
                    const isOps = await isOpsRepo();
                    if (!isOps) {
                        console.log('Not an OPS repo, skipping button addition');
                        return;
                    }

                    // Get current button state once for all dropdowns.
                    const state = await checkButtonState();

                    // Find menu items in each dropdown that we want to add our button after.
                    for (const dropdown of dropdowns) {
                        const menuItems = dropdown.querySelectorAll(CSS_SELECTOR);
                        if (menuItems.length > 0) {
                            console.log('Found menu items to modify');
                            menuItems.forEach(item => {
                                // Check if we've already added our button to this menu.
                                const previewButton = dropdown.querySelector('.preview-on-learn');
                                if (!previewButton) {
                                    addButton(item, state.isDisabled, state.disabledReason, state);
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
        stopInterval();
    });

    return {
        fileObserver,
        commitCheckInterval,
        stopInterval,
        startInterval
    };
}

// Sets up navigation listeners for GitHub's SPA behavior
export function setUpNavigationListeners(onNavigationChange) {
    let lastUrl = window.location.href;

    // Listen for history changes (forward/back navigation).
    window.addEventListener('popstate', function () {
        if (window.location.href !== lastUrl) {
            console.log('Navigation detected via popstate');
            lastUrl = window.location.href;
            onNavigationChange();
        }
    });

    // Override pushState to detect programmatic navigation.
    const originalPushState = history.pushState;
    history.pushState = function () {
        originalPushState.apply(this, arguments);
        if (window.location.href !== lastUrl) {
            console.log('Navigation detected via pushState');
            lastUrl = window.location.href;
            onNavigationChange();
        }
    };

    // Override replaceState to detect programmatic navigation.
    const originalReplaceState = history.replaceState;
    history.replaceState = function () {
        originalReplaceState.apply(this, arguments);
        if (window.location.href !== lastUrl) {
            console.log('Navigation detected via replaceState');
            lastUrl = window.location.href;
            onNavigationChange();
        }
    };

    // Also check for URL changes via MutationObserver as a fallback.
    const urlObserver = new MutationObserver(function () {
        if (window.location.href !== lastUrl) {
            console.log('Navigation detected via MutationObserver');
            lastUrl = window.location.href;
            onNavigationChange();
        }
    });

    urlObserver.observe(document, {
        childList: true,
        subtree: true
    });

    // Return cleanup function.
    return function cleanup() {
        urlObserver.disconnect();
        // Restore original history methods.
        history.pushState = originalPushState;
        history.replaceState = originalReplaceState;
    };
}

// Sets up observer for when no GitHub token is present.
export function setUpNoTokenObserver(addButton, invalidTokenMessage) {
    const noTokenObserver = new MutationObserver(async (mutations) => {
        for (const mutation of mutations) {
            if (mutation.type !== 'childList' || mutation.addedNodes.length === 0) {
                continue;
            }

            for (const node of mutation.addedNodes) {
                if (!(node instanceof HTMLElement)) {
                    continue;
                }

                // Check if a dropdown menu was added.
                const dropdowns = node.classList?.contains('js-file-header-dropdown')
                    ? [node]
                    : [...node.querySelectorAll('.js-file-header-dropdown')];

                if (dropdowns.length > 0) {
                    // Check if this is an OPS repo first.
                    const isOps = await isOpsRepo();
                    if (!isOps) {
                        continue;
                    }

                    // Add disabled buttons to new dropdowns.
                    for (const dropdown of dropdowns) {
                        const menuItems = dropdown.querySelectorAll(CSS_SELECTOR);
                        if (menuItems.length > 0) {
                            menuItems.forEach(item => {
                                // Check if we've already added our button to this dropdown.
                                const previewButton = dropdown.querySelector('.preview-on-learn');
                                if (!previewButton) {
                                    addButton(item, true, invalidTokenMessage);
                                }
                            });
                        }
                    }
                }
            }
        }
    });

    // Start observing for new dropdowns.
    noTokenObserver.observe(document.body, {
        childList: true,
        subtree: true
    });

    // Return cleanup function.
    return function cleanup() {
        noTokenObserver.disconnect();
    };
}
