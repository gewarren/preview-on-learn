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

        // Create a cache key for this repo/PR combination
        const cacheKey = `${repoInfo.owner}/${repoInfo.repo}/pull/${repoInfo.prNumber}`;

        // Check if we have cached data for this PR
        if (buildReportCache.has(cacheKey)) {
            const cached = buildReportCache.get(cacheKey);
            console.log(`Using cached preview links for PR #${repoInfo.prNumber} commit ${cached.commitSha}`);

            // Move to end (LRU)
            buildReportCache.delete(cacheKey);
            buildReportCache.set(cacheKey, cached);

            return cached.previewLinks[fileName] || null;
        }

        // Check if there's already a request in progress for this PR
        if (inProgressRequests.has(cacheKey)) {
            console.log(`Waiting for in-progress request for PR #${repoInfo.prNumber}`);
            const cached = await inProgressRequests.get(cacheKey);
            return cached.previewLinks[fileName] || null;
        }

        console.log(`Fetching fresh data for PR #${repoInfo.prNumber}`);

        // Create a promise for this request and store it
        const requestPromise = fetchPrData(repoInfo, cacheKey);
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
async function fetchPrData(repoInfo, cacheKey) {
    // Get the latest commit SHA and PR status
    const prInfo = await getPrInfo(
        repoInfo.owner,
        repoInfo.repo,
        repoInfo.prNumber
    );

    if (!prInfo || !prInfo.commitSha) {
        throw new Error('Could not get PR info');
    }

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

    console.log(`Cached preview links for PR #${repoInfo.prNumber} commit ${prInfo.commitSha} (${Object.keys(previewLinks).length} files)`);

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
                        console.log("Found table with matching headers");
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
    console.log(`Table has ${rows.length} rows`);

    // Process each row (skip the header row).
    for (let i = 1; i < rows.length; i++) {
        processRow(rows[i], previewLinks);
    }

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
            }
        }
    } else {
        console.log(`Row ${row.rowIndex} missing file link or preview link`);
    }
}
