// DOM scraping utilities to extract PR info from the GitHub page
// This avoids the need for API calls and authentication

/**
 * Extract the latest commit SHA from the GitHub PR page.
 * GitHub shows this in various places on the page.
 */
export function getCommitShaFromDom() {
    console.log('DOM Scraper: Looking for commit SHA...');

    // Method 1: Look for the latest commit in the conversation/timeline
    // GitHub shows commits with links like "username committed abc1234"
    const timelineCommits = document.querySelectorAll('.TimelineItem a[href*="/commits/"], .TimelineItem a[href*="/commit/"]');
    for (const link of timelineCommits) {
        const href = link.getAttribute('href');
        const match = href.match(/\/commits?\/([a-f0-9]{7,40})/);
        if (match) {
            const sha = match[1];
            console.log('DOM Scraper: Found commit SHA from timeline:', sha);
            return sha;
        }
    }

    // Method 2: Look in the merge box area
    const mergeBox = document.querySelector('.merge-message code, .merge-pr .commit-ref');
    if (mergeBox) {
        const sha = mergeBox.textContent.trim();
        if (sha && sha.length >= 7) {
            console.log('DOM Scraper: Found commit SHA from merge box:', sha);
            return sha;
        }
    }

    // Method 3: Look for commit links anywhere on the page
    const commitLinks = document.querySelectorAll('a[href*="/commit/"], a[href*="/commits/"]');
    for (const link of commitLinks) {
        const href = link.getAttribute('href');
        const match = href.match(/\/commits?\/([a-f0-9]{40})/);
        if (match) {
            console.log('DOM Scraper: Found commit SHA from link:', match[1]);
            return match[1];
        }
    }

    // Method 4: Look for the sha in clipboard-copy elements
    const clipboardCopies = document.querySelectorAll('clipboard-copy[value]');
    for (const el of clipboardCopies) {
        const value = el.getAttribute('value');
        if (value && /^[a-f0-9]{7,40}$/.test(value)) {
            console.log('DOM Scraper: Found commit SHA from clipboard-copy:', value);
            return value;
        }
    }

    // Method 5: Look in data attributes
    const elementsWithSha = document.querySelectorAll('[data-commit], [data-sha], [data-hovercard-url*="commit"]');
    for (const el of elementsWithSha) {
        const sha = el.getAttribute('data-commit') || el.getAttribute('data-sha');
        if (sha && /^[a-f0-9]{7,40}$/.test(sha)) {
            console.log('DOM Scraper: Found commit SHA from data attribute:', sha);
            return sha;
        }
        // Check hovercard URL
        const hovercard = el.getAttribute('data-hovercard-url');
        if (hovercard) {
            const match = hovercard.match(/\/commits?\/([a-f0-9]{7,40})/);
            if (match) {
                console.log('DOM Scraper: Found commit SHA from hovercard:', match[1]);
                return match[1];
            }
        }
    }

    // Method 6: Look for short SHAs (7 chars) in code elements near "commit" text
    const codeElements = document.querySelectorAll('code, .sha, .commit-id');
    for (const el of codeElements) {
        const text = el.textContent.trim();
        if (/^[a-f0-9]{7,40}$/.test(text)) {
            console.log('DOM Scraper: Found commit SHA from code element:', text);
            return text;
        }
    }

    console.log('DOM Scraper: Could not find commit SHA in DOM');
    return null;
}

/**
 * Get PR status (open, closed, merged) from the DOM
 */
export function getPrStatusFromDom() {
    // Look for the PR state badge
    const stateBadge = document.querySelector('.State, [data-testid="state-badge"], .gh-header-meta .State');
    if (stateBadge) {
        const text = stateBadge.textContent.trim().toLowerCase();
        if (text.includes('merged')) return 'merged';
        if (text.includes('closed')) return 'closed';
        if (text.includes('open')) return 'open';
    }

    // Look for merge indicators
    const mergedBanner = document.querySelector('.merged, .State--merged, [data-testid="merged-banner"]');
    if (mergedBanner) {
        console.log('PR status from DOM: merged');
        return 'merged';
    }

    const closedBanner = document.querySelector('.closed, .State--closed');
    if (closedBanner) {
        console.log('PR status from DOM: closed');
        return 'closed';
    }

    // Default to open if we can't determine
    console.log('PR status from DOM: open (default)');
    return 'open';
}

/**
 * Get the OPS build status check details URL from the DOM.
 * This is the key piece we need to fetch the build report.
 */
export function getOpsBuildDetailsUrlFromDom() {
    console.log('DOM Scraper: Looking for OPS build details URL...');

    // Method 1: Look for direct links to OPS build reports
    const opsLinks = document.querySelectorAll('a[href*="review.learn.microsoft.com"], a[href*="ops.microsoft.com"], a[href*="OPS/builds"], a[href*="ceapex.visualstudio.com"]');
    console.log(`DOM Scraper: Found ${opsLinks.length} potential OPS links`);
    for (const link of opsLinks) {
        const href = link.getAttribute('href');
        console.log('DOM Scraper: Checking OPS link:', href);
        if (href) {
            return href;
        }
    }

    // Method 2: Look in the merge status area (bottom of PR conversation)
    // GitHub uses various class names for this area
    const mergeStatusSelectors = [
        '.merge-status-list',
        '.branch-action-item',
        '[data-testid="checks-list"]',
        '.js-merge-box',
        '.merge-pr',
        '.mergeability-details',
        '.branch-action-body',
        '.merge-status-item',
        '.status-check'
    ];

    for (const selector of mergeStatusSelectors) {
        const container = document.querySelector(selector);
        if (container) {
            console.log(`DOM Scraper: Found merge status container: ${selector}`);

            // Look for any link that might be the Details link for OPS
            const allLinks = container.querySelectorAll('a[href]');
            for (const link of allLinks) {
                const href = link.getAttribute('href') || '';
                const text = (link.textContent || '').toLowerCase();

                // Check if it's an OPS-related link
                if (href.includes('review.learn') || href.includes('ops.microsoft') ||
                    href.includes('ceapex') || href.includes('OPS/builds')) {
                    console.log('DOM Scraper: Found OPS URL in merge status:', href);
                    return href;
                }
            }
        }
    }

    // Method 3: Look for status check items that mention OpenPublishing
    const allItems = document.querySelectorAll('div, li, span, td');
    for (const item of allItems) {
        const text = item.textContent || '';
        if (text.includes('OpenPublishing') || (text.includes('OPS') && text.includes('Build'))) {
            // Found an OPS-related item, look for a Details link within or nearby
            const detailsLink = item.querySelector('a[href]');
            if (detailsLink) {
                const href = detailsLink.getAttribute('href');
                if (href && !href.startsWith('#')) {
                    console.log('DOM Scraper: Found OPS details URL near OpenPublishing text:', href);
                    return href;
                }
            }
            // Check parent for the link
            const parent = item.parentElement;
            if (parent) {
                const parentLink = parent.querySelector('a[href*="Details"], a[href*="details"]');
                if (parentLink) {
                    const href = parentLink.getAttribute('href');
                    console.log('DOM Scraper: Found OPS details URL from parent:', href);
                    return href;
                }
            }
        }
    }

    // Method 4: Search all links for "Details" text near OPS mentions
    const allLinks = document.querySelectorAll('a');
    for (const link of allLinks) {
        const text = (link.textContent || '').trim().toLowerCase();
        const href = link.getAttribute('href') || '';

        if (text === 'details') {
            // Check the surrounding context
            const parent = link.closest('div, li, tr, .merge-status-item');
            if (parent) {
                const parentText = parent.textContent.toLowerCase();
                if (parentText.includes('openpublishing') ||
                    (parentText.includes('ops') && parentText.includes('build'))) {
                    console.log('DOM Scraper: Found Details link for OPS:', href);
                    return href;
                }
            }
        }
    }

    console.log('DOM Scraper: Could not find OPS build details URL in DOM');
    return null;
}

/**
 * Check if the OPS build is still pending by looking at the DOM
 */
export function isOpsBuildPendingFromDom() {
    const statusItems = document.querySelectorAll('.merge-status-item, .status-check-item, [data-testid="status-check"]');
    for (const item of statusItems) {
        const text = item.textContent || '';
        if (text.toLowerCase().includes('openpublishing') || text.toLowerCase().includes('ops')) {
            // Check for pending indicators
            const hasPending = item.querySelector('.pending, .status-pending, [aria-label*="pending"], .octicon-dot-fill');
            const hasInProgress = text.toLowerCase().includes('in progress') || text.toLowerCase().includes('pending') || text.toLowerCase().includes('running');

            if (hasPending || hasInProgress) {
                console.log('OPS build is pending (from DOM)');
                return true;
            }

            // Check for success
            const hasSuccess = item.querySelector('.success, .status-success, [aria-label*="success"], .octicon-check');
            if (hasSuccess || text.toLowerCase().includes('successful') || text.toLowerCase().includes('passed')) {
                console.log('OPS build succeeded (from DOM)');
                return false;
            }
        }
    }

    // Unknown state
    return null;
}

/**
 * Try to get all PR info from the DOM without API calls.
 * Returns null if we can't get the essential info.
 */
export async function getPrInfoFromDom() {
    const commitSha = getCommitShaFromDom();
    const prStatus = getPrStatusFromDom();

    if (!commitSha) {
        console.log('DOM scraping: Could not get commit SHA');
        return null;
    }

    return {
        commitSha,
        prStatus
    };
}

/**
 * Try to get the OPS build check info from the DOM.
 */
export function getOpsCheckFromDom() {
    const detailsUrl = getOpsBuildDetailsUrlFromDom();
    const isPending = isOpsBuildPendingFromDom();

    if (!detailsUrl && isPending === null) {
        console.log('DOM scraping: Could not get OPS build info');
        return null;
    }

    let status = 'unknown';
    if (isPending === true) {
        status = 'pending';
    } else if (isPending === false && detailsUrl) {
        status = 'success';
    }

    return {
        status,
        details_url: detailsUrl
    };
}
