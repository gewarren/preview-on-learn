import { extractRepoInfo, getPrInfo, getSpecificStatusCheck } from './pr-helpers.js';

// Cache for build report data
const buildReportCache = new Map();
// Track in-progress requests to prevent duplicate API calls
const inProgressRequests = new Map();
const MAX_CACHE_SIZE = 50;

// Cache cleanup to prevent memory issues
function cleanupCache() {
    if (buildReportCache.size > MAX_CACHE_SIZE) {
        const oldestKey = buildReportCache.keys().next().value;
        buildReportCache.delete(oldestKey);
        console.log(`Removed oldest cached entry: ${oldestKey}`);
    }
}

// Gets preview URL for a file from the build report.
export async function getPreviewUrl(fileName) {
    try {
        const repoInfo = extractRepoInfo();
        if (!repoInfo) {
            return null;
        }

        // Get the current commit SHA first
        const prInfo = await getPrInfo(
            repoInfo.owner,
            repoInfo.repo,
            repoInfo.prNumber
        );

        if (!prInfo || !prInfo.commitSha) {
            return null;
        }

        // Create a cache key using commit SHA instead of PR number
        const cacheKey = `${repoInfo.owner}/${repoInfo.repo}/commit/${prInfo.commitSha}`;

        // Check if we have cached data for this specific commit
        if (buildReportCache.has(cacheKey)) {
            const cached = buildReportCache.get(cacheKey);
            console.log(`Using cached preview links for commit ${prInfo.commitSha}`);

            // Move to end (LRU)
            buildReportCache.delete(cacheKey);
            buildReportCache.set(cacheKey, cached);

            return cached.previewLinks[fileName] || null;
        }

        // Check if there's already a request in progress for this commit
        if (inProgressRequests.has(cacheKey)) {
            console.log(`Waiting for in-progress request for commit ${prInfo.commitSha}`);
            const cached = await inProgressRequests.get(cacheKey);
            return cached.previewLinks[fileName] || null;
        }

        console.log(`Fetching fresh data for commit ${prInfo.commitSha}`);

        // Create a promise for this request and store it
        const requestPromise = fetchPrData(repoInfo, cacheKey, prInfo);
        inProgressRequests.set(cacheKey, requestPromise);

        try {
            // Wait for the request to complete
            const cached = await requestPromise;
            return cached.previewLinks[fileName] || null;
        } finally {
            // Clean up the in-progress request regardless of success/failure
            inProgressRequests.delete(cacheKey);
        }

    } catch (error) {
        console.error('Error getting preview URL:', error);
        return null;
    }
}

// Separate function to handle the actual data fetching
async function fetchPrData(repoInfo, cacheKey, prInfo) {
    // We already have prInfo, so no need to fetch it again

    // Get the OPS status check
    const opsCheck = await getSpecificStatusCheck(
        repoInfo.owner,
        repoInfo.repo,
        prInfo.commitSha,
        "OpenPublishing.Build"
    );

    if (!opsCheck || !opsCheck.details_url || opsCheck.status !== 'success') {
        throw new Error('OPS status check not available or not successful');
    }

    // Fetch and parse the build report
    const buildReportDoc = await fetchBuildReport(opsCheck.details_url);
    if (!buildReportDoc) {
        throw new Error('Could not fetch build report');
    }

    const previewLinks = extractPreviewLinks(buildReportDoc);
    if (!previewLinks || Object.keys(previewLinks).length === 0) {
        console.log('No preview links found in build report');
        throw new Error('No preview links found');
    }

    // Cache the complete result
    const cacheData = {
        commitSha: prInfo.commitSha,
        prStatus: prInfo.prStatus,
        previewLinks: previewLinks,
        timestamp: Date.now()
    };

    buildReportCache.set(cacheKey, cacheData);
    cleanupCache();

    console.log(`Cached preview links for commit ${prInfo.commitSha} (${Object.keys(previewLinks).length} files)`);

    return cacheData;
}

// Fetches and parses the build report.
async function fetchBuildReport(reportUrl) {
    try {
        // Fetch the build report HTML.
        const response = await fetch(reportUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch build report: ${response.status} ${response.statusText}`);
        }

        // Get the HTML content.
        const html = await response.text();
        console.log('Fetched build report HTML');

        // Parse the HTML.
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        return doc;
    } catch (error) {
        console.error('Error fetching build report:', error);
        return null;
    }
}

// Extracts preview links from the build report.
function extractPreviewLinks(buildReportDoc) {
    try {
        if (!buildReportDoc) return null;

        console.log("Starting to extract preview links from build report");

        const tables = buildReportDoc.querySelectorAll('table.MsoNormalTable');

        if (tables.length > 0) {
            // Look at each table to find one with the expected headers.
            for (const table of tables) {
                const firstRow = table.querySelector('tr');
                if (firstRow) {
                    const cells = firstRow.querySelectorAll('td');
                    const headers = Array.from(cells).map(cell => cell.textContent.trim());

                    if (headers.includes('File') && headers.some(h => h.includes('Preview URL'))) {
                        return extractLinksFromTable(table);
                    }
                }
            }
        }

        return null;
    } catch (error) {
        console.error('Error extracting preview links:', error);
        return null;
    }
}

// Helper: Extracts links from a table.
function extractLinksFromTable(table) {
    // Store file paths as keys and preview URLs as values.
    const previewLinks = {};

    const rows = table.querySelectorAll('tr');

    // Process each row (skip the header row).
    for (let i = 1; i < rows.length; i++) {
        processRow(rows[i], previewLinks);
    }

    console.log(`Extracted ${Object.keys(previewLinks).length} preview links:`, Object.keys(previewLinks));
    return previewLinks;
}

// Helper: Processes a table row.
function processRow(row, previewLinks) {
    const cells = row.querySelectorAll('td');

    if (cells.length >= 3) {
        // First cell contains the file path.
        const fileCell = cells[0];
        const fileLink = fileCell.querySelector('a');

        // Third cell contains the preview link.
        const previewCell = cells[2];
        const previewLink = previewCell.querySelector('a');

        if (fileLink && previewLink) {
            const filePath = fileLink.textContent.trim();
            const previewUrl = previewLink.href;

            if (filePath && previewUrl) {
                previewLinks[filePath] = previewUrl;
            } else {
            }
        }
    }
}
