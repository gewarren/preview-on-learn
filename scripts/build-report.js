import { extractRepoInfo, getPrInfo, getSpecificStatusCheck } from './pr-helpers.js';

// Cache for build report data - one entry per PR with latest commit
const buildReportCache = new Map();
// Track in-progress requests to prevent duplicate API calls
const inProgressRequests = new Map();
// Cache for docset configurations fetched from repos
const docsetCache = new Map();
const MAX_CACHE_SIZE = 50;

// Cache cleanup to prevent memory issues
function cleanUpCache() {
    if (buildReportCache.size > MAX_CACHE_SIZE) {
        const oldestKey = buildReportCache.keys().next().value;
        buildReportCache.delete(oldestKey);
        console.log(`Removed oldest cached entry: ${oldestKey}`);
    }
}

/**
 * Fetch the docset base URL from the repo's docfx.json file.
 * The breadcrumb_path in docfx.json contains the published URL path.
 * Always fetches from the public repo (without -pr suffix) via raw URLs.
 * 
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} [filePath] - Optional file path to help locate docfx.json
 */
async function fetchDocsetFromConfig(owner, repo, filePath = null) {
    const cacheKey = `${owner}/${repo}`.toLowerCase();

    // Check cache first
    if (docsetCache.has(cacheKey)) {
        return docsetCache.get(cacheKey);
    }

    // Always use the public repo (without -pr suffix)
    const publicRepo = repo.replace(/-pr$/i, '');

    // Extract the content folder from the file path if provided
    // e.g., "aspnetcore/blazor/security/csp.md" -> "aspnetcore"
    let contentFolder = null;
    if (filePath) {
        const pathParts = filePath.split('/');
        if (pathParts.length >= 2) {
            contentFolder = pathParts[0];
        }
    }

    // Common locations for docfx.json in different repo structures
    // Try content folder first if available (most specific)
    const docfxPaths = [];
    if (contentFolder && contentFolder !== 'docs') {
        docfxPaths.push(`${contentFolder}/docfx.json`);
    }
    docfxPaths.push(
        'docs/docfx.json',
        `${publicRepo}/docfx.json`,  // e.g., well-architected/docfx.json
        'docfx.json',
    );

    try {
        // Try raw URLs for the public repo
        for (const docfxPath of docfxPaths) {
            const urlsToTry = [
                `https://raw.githubusercontent.com/${owner}/${publicRepo}/main/${docfxPath}`,
                `https://raw.githubusercontent.com/${owner}/${publicRepo}/master/${docfxPath}`,
            ];

            for (const configUrl of urlsToTry) {
                try {
                    console.log(`Trying to fetch docfx.json from: ${configUrl}`);
                    const response = await fetch(configUrl);
                    if (response.ok) {
                        const config = await response.json();
                        const basePath = extractBasePathFromDocfx(config);
                        if (basePath) {
                            console.log(`Found docset base path: ${basePath}`);
                            docsetCache.set(cacheKey, basePath);
                            return basePath;
                        }
                    }
                } catch (e) {
                    // Try next URL
                }
            }
        }

        console.log('Could not determine docset path from docfx.json');
        docsetCache.set(cacheKey, null);
        return null;
    } catch (error) {
        console.log('Error fetching docfx.json:', error.message);
        docsetCache.set(cacheKey, null);
        return null;
    }
}

/**
 * Extract the base path from a docfx.json config object.
 * The breadcrumb_path contains the published URL path, e.g.:
 * "/azure/cloud-adoption-framework/_bread/toc.json" -> "azure/cloud-adoption-framework"
 * "/azure/architecture/bread/toc.json" -> "azure/architecture"
 * "/azure/well-architected/breadcrumb/toc.json" -> "azure/well-architected"
 */
function extractBasePathFromDocfx(config) {
    const breadcrumbPath = config?.build?.globalMetadata?.breadcrumb_path;
    if (breadcrumbPath) {
        // Extract the base path by removing the breadcrumb folder and file
        // Handles "_bread", "bread", and "breadcrumb" folder names
        const match = breadcrumbPath.match(/^\/(.+?)\/(?:_?breadcrumb?|_?bread)\//);
        if (match) {
            return match[1];
        }
    }
    return null;
}

/**
 * Construct a preview URL directly from the file path without needing the build report.
 * This is used as a fallback when the OPS build status check isn't accessible.
 * 
 * Pattern: https://review.learn.microsoft.com/en-us/{docset}/{doc-path}?branch=pr-en-us-{pr-number}
 */
async function constructPreviewUrl(fileName, prNumber, owner, repo) {
    // Only works for markdown files
    if (!fileName.endsWith('.md')) {
        return null;
    }

    // Extract the path after the content folder
    // Common patterns: docs/*, articles/*, content/*, or repo-name-based folders like well-architected/*
    // The content folder is typically the first directory in the path
    const pathParts = fileName.split('/');
    if (pathParts.length < 2) {
        console.log(`File ${fileName} is not in a content folder`);
        return null;
    }

    // The doc path is everything after the first folder (the content folder)
    let docPath = pathParts.slice(1).join('/');

    // Remove the .md extension
    docPath = docPath.replace(/\.md$/i, '');

    // Handle "-content" suffix files - these are published without the "-content" in the URL
    // e.g., "baseline-microsoft-foundry-chat-content.md" -> "baseline-microsoft-foundry-chat"
    docPath = docPath.replace(/-content$/, '');

    // Handle index files - they typically map to the folder path
    if (docPath.endsWith('/index') || docPath === 'index') {
        docPath = docPath.replace(/\/?index$/, '');
    }

    // Get the docset base path from the repo's OPS config
    // Pass the fileName so we can try looking in the content folder
    const docset = await fetchDocsetFromConfig(owner, repo, fileName);

    if (!docset) {
        // Fallback: use repo name without -pr/-docs suffix
        const fallbackDocset = repo.toLowerCase().replace(/-pr$/, '').replace(/-docs$/, '');
        console.log(`No docset config found, using fallback: ${fallbackDocset}`);
        const previewUrl = `https://review.learn.microsoft.com/en-us/${fallbackDocset}/${docPath}?branch=pr-en-us-${prNumber}`;
        console.log(`Constructed preview URL (fallback): ${previewUrl}`);
        return previewUrl;
    }

    // Construct the preview URL
    const previewUrl = `https://review.learn.microsoft.com/en-us/${docset}/${docPath}?branch=pr-en-us-${prNumber}`;

    console.log(`Constructed preview URL for ${fileName}: ${previewUrl}`);
    return previewUrl;
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

        // Use PR-based cache key
        const cacheKey = `${repoInfo.owner}/${repoInfo.repo}/pull/${repoInfo.prNumber}`;

        // Check if we have cached data for this PR and it matches current commit
        if (buildReportCache.has(cacheKey)) {
            const cached = buildReportCache.get(cacheKey);

            if (cached.commitSha === prInfo.commitSha) {
                console.log(`Using cached preview links for PR #${repoInfo.prNumber} commit ${prInfo.commitSha}`);

                // Move to end (LRU)
                buildReportCache.delete(cacheKey);
                buildReportCache.set(cacheKey, cached);

                return cached.previewLinks[fileName] || null;
            } else {
                // Commit SHA has changed, invalidate cache
                console.log(`Commit SHA changed from ${cached.commitSha} to ${prInfo.commitSha}, invalidating cache for PR #${repoInfo.prNumber}`);
                buildReportCache.delete(cacheKey);
            }
        }

        // Check if there's already a request in progress for this PR
        if (inProgressRequests.has(cacheKey)) {
            console.log(`Waiting for in-progress request for PR #${repoInfo.prNumber}`);
            try {
                const cached = await inProgressRequests.get(cacheKey);
                return cached.previewLinks[fileName] || null;
            } catch (error) {
                // If the in-progress request failed, try constructing URL directly
                console.log('In-progress request failed, trying direct URL construction');
                return await constructPreviewUrl(fileName, repoInfo.prNumber, repoInfo.owner, repoInfo.repo);
            }
        }

        console.log(`Fetching fresh data for PR #${repoInfo.prNumber} commit ${prInfo.commitSha}`);

        // Create a promise for this request and store it
        const requestPromise = fetchPrData(repoInfo, cacheKey, prInfo);
        inProgressRequests.set(cacheKey, requestPromise);

        try {
            // Wait for the request to complete
            const cached = await requestPromise;
            return cached.previewLinks[fileName] || null;
        } catch (error) {
            // If fetching the build report fails, try constructing the URL directly
            console.log('Build report fetch failed, trying direct URL construction:', error.message);
            return await constructPreviewUrl(fileName, repoInfo.prNumber, repoInfo.owner, repoInfo.repo);
        } finally {
            // Clean up the in-progress request regardless of success/failure
            inProgressRequests.delete(cacheKey);
        }

    } catch (error) {
        console.error('Error getting preview URL:', error);
        // Last resort: try to construct URL directly
        const repoInfo = extractRepoInfo();
        if (repoInfo) {
            return await constructPreviewUrl(fileName, repoInfo.prNumber, repoInfo.owner, repoInfo.repo);
        }
        return null;
    }
}

// Separate function to handle the actual data fetching
async function fetchPrData(repoInfo, cacheKey, prInfo) {
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

    // Cache the complete result (overwrites any existing cache for this PR)
    const cacheData = {
        commitSha: prInfo.commitSha,
        prStatus: prInfo.prStatus,
        previewLinks: previewLinks,
        timestamp: Date.now()
    };

    buildReportCache.set(cacheKey, cacheData);
    cleanUpCache();

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
            }
        }
    }
}
