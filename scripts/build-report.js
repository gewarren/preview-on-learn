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
 * Fetch the docset base URL from the repo's .openpublishing.publish.config.json file.
 * This file contains the actual docset configuration used by OPS.
 */
async function fetchDocsetFromConfig(owner, repo) {
    const cacheKey = `${owner}/${repo}`.toLowerCase();

    // Check cache first
    if (docsetCache.has(cacheKey)) {
        return docsetCache.get(cacheKey);
    }

    try {
        // Try multiple URL patterns to fetch the OPS config file
        // For private repos, raw.githubusercontent.com won't work, but the GitHub blob page might
        const urlsToTry = [
            // Public repos - raw content
            `https://raw.githubusercontent.com/${owner}/${repo}/main/.openpublishing.publish.config.json`,
            // Try master branch too
            `https://raw.githubusercontent.com/${owner}/${repo}/master/.openpublishing.publish.config.json`,
        ];

        for (const configUrl of urlsToTry) {
            try {
                console.log(`Trying to fetch OPS config from: ${configUrl}`);
                const response = await fetch(configUrl);
                if (response.ok) {
                    const config = await response.json();
                    const basePath = extractBasePathFromConfig(config);
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

        // If raw URLs fail (private repo), fall back to a heuristic based on repo name
        // MicrosoftDocs repos typically follow patterns like:
        // - azure-docs-pr -> azure
        // - cloud-adoption-framework-pr -> azure/cloud-adoption-framework
        const basePath = inferDocsetFromRepoName(repo);
        if (basePath) {
            console.log(`Inferred docset base path from repo name: ${basePath}`);
            docsetCache.set(cacheKey, basePath);
            return basePath;
        }

        console.log('Could not determine docset path');
        docsetCache.set(cacheKey, null);
        return null;
    } catch (error) {
        console.log('Error fetching OPS config:', error.message);
        docsetCache.set(cacheKey, null);
        return null;
    }
}

/**
 * Extract the base path from an OPS config object
 */
function extractBasePathFromConfig(config) {
    if (config.docsets_to_publish && config.docsets_to_publish.length > 0) {
        const docset = config.docsets_to_publish[0];

        // Check for explicit base_path fields
        let basePath = docset.base_path || docset.site_base_path || null;

        if (!basePath && docset.docset_name) {
            // Derive from docset_name - replace first hyphen with slash
            // e.g., "azure-cloud-adoption-framework" -> "azure/cloud-adoption-framework"
            basePath = docset.docset_name.replace(/-/, '/');
        }

        if (basePath) {
            return basePath.replace(/^\//, '');
        }
    }
    return null;
}

/**
 * Infer the docset base path from the repo name using common patterns
 */
function inferDocsetFromRepoName(repoName) {
    const name = repoName.toLowerCase();

    // Remove common suffixes
    let baseName = name.replace(/-pr$/, '').replace(/-docs$/, '');

    // Known patterns for MicrosoftDocs repos
    // These repos have docset paths that don't match their repo names
    const knownPatterns = {
        'cloud-adoption-framework': 'azure/cloud-adoption-framework',
        'azure-docs': 'azure',
        'azure-stack-docs': 'azure-stack',
        'entra-docs': 'entra',
        'sql-docs': 'sql',
        'powershell-docs': 'powershell',
        'windowsserverdocs': 'windows-server',
        'memdocs': 'mem',
        'intune-docs': 'intune',
        'architecture-center': 'azure/architecture',
    };

    if (knownPatterns[baseName]) {
        return knownPatterns[baseName];
    }

    // For other repos, try the base name directly
    // This works for many repos where the docset matches the repo name
    return baseName;
}

/**
 * Construct a preview URL directly from the file path without needing the build report.
 * This is used as a fallback when the OPS build status check isn't accessible.
 * 
 * Pattern: https://review.learn.microsoft.com/en-us/{docset}/{doc-path}?branch=pr-en-us-{pr-number}
 */
async function constructPreviewUrl(fileName, prNumber, owner, repo) {
    // Only works for markdown files in docs folders
    if (!fileName.endsWith('.md')) {
        return null;
    }

    // Extract the path after 'docs/' or similar content folder
    // Common patterns: docs/*, articles/*, content/*
    const contentFolderMatch = fileName.match(/^(?:docs|articles|content)\/(.+)$/i);
    if (!contentFolderMatch) {
        console.log(`File ${fileName} is not in a recognized content folder`);
        return null;
    }

    let docPath = contentFolderMatch[1];

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
    const docset = await fetchDocsetFromConfig(owner, repo);

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
