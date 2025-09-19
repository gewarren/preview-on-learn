import { extractRepoInfo } from './pr-helpers.js';

// Cache for OPS repo results, keyed by "owner/repo".
const opsRepoCache = new Map();
// Flag to prevent concurrent checks.
let isCheckingOpsRepo = false;
let currentRepoKey = null;

// Checks if user navigated to a different repo.
export function isDifferentRepo() {
    const repoInfo = extractRepoInfo();
    if (!repoInfo) {
        return false;
    }

    const newRepoKey = `${repoInfo.owner}/${repoInfo.repo}`.toLowerCase();

    if (currentRepoKey && currentRepoKey !== newRepoKey) {
        console.log(`Repository changed from ${currentRepoKey} to ${newRepoKey}`);

        // Clear button state for new repo.
        buttonState.latestCommitSha = null;
        buttonState.lastBuildStatus = null;
        buttonState.isDisabled = false;
        buttonState.disabledReason = "";
        buttonState.lastCheckTime = 0;

        currentRepoKey = newRepoKey;
        return true;
    } else if (!currentRepoKey) {
        // First time setting the repo
        currentRepoKey = newRepoKey;
        console.log(`Initial repo set to ${currentRepoKey}`);
    }

    return false;
}

// Checks if the current repo is an OPS (docs) repo.
export async function isOpsRepo() {
    // If already checking, return the current cached value or false.
    if (isCheckingOpsRepo) {
        return false;
    }

    const repoInfo = extractRepoInfo();
    if (!repoInfo) {
        return false;
    }

    // Create cache key
    const cacheKey = `${repoInfo.owner}/${repoInfo.repo}`.toLowerCase();

    // Check if we already have a cached result for this repository
    if (opsRepoCache.has(cacheKey)) {
        const cachedResult = opsRepoCache.get(cacheKey);
        console.log(`Using cached OPS repo result for ${cacheKey}: ${cachedResult}`);
        return cachedResult;
    }

    try {
        // Set flag to prevent concurrent checks.
        isCheckingOpsRepo = true;

        console.log(`Checking if ${cacheKey} is an OPS repo...`);

        // First check if it's a known OPS repo based on organization/repo.
        if (isKnownOpsRepo(repoInfo.owner, repoInfo.repo)) {
            console.log("Found in known OPS repos list");
            opsRepoCache.set(cacheKey, true);
            return true;
        }

        // Check for the existence of the OPS config file with fetch.
        try {
            const rawUrl = `https://raw.githubusercontent.com/${repoInfo.owner}/${repoInfo.repo}/main/.openpublishing.publish.config.json`;

            const response = await fetch(rawUrl, {
                method: 'HEAD',
                cache: 'no-cache'
            });

            if (response.ok) {
                console.log("OPS config file found via raw URL - this is an OPS repo");
                opsRepoCache.set(cacheKey, true);
                return true;
            } else if (response.status === 404) {
                // 404 means the file definitely doesn't exist.
                console.log("OPS config file not found (404) - this is NOT an OPS repo");
                opsRepoCache.set(cacheKey, false);
                return false;
            } else {
                // For other status codes (like 403), don't cache the result
                // as it might be a temporary issue
                console.log(`Raw content fetch returned status ${response.status} - not caching result`);
                return false;
            }
        } catch (rawFetchError) {
            console.log("Raw content fetch failed:", rawFetchError);
            // Don't cache on fetch errors as they might be temporary
            return false;
        }
    } catch (error) {
        console.error("Error checking for OPS repo:", error);
        // Don't cache on errors as they might be temporary
        return false;
    } finally {
        // Reset flag when done.
        isCheckingOpsRepo = false;
    }
}

// Helper function to check if the repo is a known OPS repo.
function isKnownOpsRepo(owner, repo) {
    // Any repo in the MicrosoftDocs organization is a docs repo.
    if (owner.toLowerCase() === 'microsoftdocs') {
        return true;
    }

    // List of known OPS repositories outside of MicrosoftDocs.
    const knownOpsRepos = [
        { owner: 'dotnet', repo: 'docs' },
        { owner: 'dotnet', repo: 'docs-aspire' },
        { owner: 'dotnet', repo: 'docs-desktop' },
        // ...
    ];

    // Check if the repository matches any known OPS repos.
    return knownOpsRepos.some(knownRepo =>
        knownRepo.owner.toLowerCase() === owner.toLowerCase() &&
        knownRepo.repo.toLowerCase() === repo.toLowerCase()
    );
}

