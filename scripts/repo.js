import { extractRepoInfo } from './pr-helpers.js';

// Track the current repo to detect navigation changes.
let currentRepoKey = null;

// Flag to prevent concurrent checks.
let isCheckingOpsRepo = false;

// Cache for OPS repo results (both positive and negative).
const opsRepoCache = new Map();

// Checks if user navigated to a different repo.
export function checkForRepositoryChange() {
    const repoInfo = extractRepoInfo();
    if (!repoInfo) {
        return false;
    }

    const newRepoKey = `${repoInfo.owner}/${repoInfo.repo}`.toLowerCase();

    if (currentRepoKey && currentRepoKey !== newRepoKey) {
        console.log(`Repository changed from ${currentRepoKey} to ${newRepoKey}`);

        // Clear the cache for the previous repo
        const [prevOwner, prevRepo] = currentRepoKey.split('/');
        clearOpsRepoCache(prevOwner, prevRepo);

        currentRepoKey = newRepoKey;
        return true;
    } else if (!currentRepoKey) {
        // First time setting the repo.
        currentRepoKey = newRepoKey;
        console.log(`Initial repo set to ${currentRepoKey}`);
        return false;
    }

    // Same repo navigation
    console.log(`Navigation within same repo: ${currentRepoKey}`);
    return false;
}

// Clears the cache for a specific repo or all repositories.
function clearOpsRepoCache(owner = null, repo = null) {
    if (owner && repo) {
        const key = `${owner}/${repo}`.toLowerCase();
        opsRepoCache.delete(key);
        console.log(`Cleared OPS repo cache for ${key}`);
    } else {
        opsRepoCache.clear();
        console.log("Cleared all OPS repo cache");
    }
}

// Checks if the current repo is an OPS (docs) repo.
export async function isOpsRepo() {
    // If already checking, return false to prevent concurrent checks.
    if (isCheckingOpsRepo) {
        console.log("OPS repo check already in progress, returning false");
        return false;
    }

    const repoInfo = extractRepoInfo();
    if (!repoInfo) {
        console.log("No repo info available, returning false");
        return false;
    }

    const cacheKey = `${repoInfo.owner}/${repoInfo.repo}`.toLowerCase();

    // Check if we already have a cached result (positive or negative)
    if (opsRepoCache.has(cacheKey)) {
        const cachedResult = opsRepoCache.get(cacheKey);
        console.log(`Using cached OPS repo result for ${cacheKey}: ${cachedResult}`);
        return cachedResult;
    }

    try {
        // Set flag to prevent concurrent checks.
        isCheckingOpsRepo = true;

        console.log(`Checking if ${repoInfo.owner}/${repoInfo.repo} is an OPS repo...`);

        // First check if it's a known OPS repo based on organization/repo.
        if (isKnownOpsRepo(repoInfo.owner, repoInfo.repo)) {
            console.log("Found in known OPS repos list");
            opsRepoCache.set(cacheKey, true);
            return true;
        }

        // Try to check for the existence of the OPS config file with fetch.
        try {
            // Use the raw GitHub content URL which might have different permissions.
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
                // For other status codes (like 403), return false but don't cache
                console.log(`Raw content fetch returned status ${response.status} - assuming not OPS repo (not cached)`);
                return false;
            }
        } catch (rawFetchError) {
            console.log("Raw content fetch failed:", rawFetchError);
            return false;
        }
    } catch (error) {
        console.error("Error checking for OPS repo:", error);
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
        // ...
    ];

    // Check if the repo matches any known OPS repos.
    return knownOpsRepos.some(knownRepo =>
        knownRepo.owner.toLowerCase() === owner.toLowerCase() &&
        knownRepo.repo.toLowerCase() === repo.toLowerCase()
    );
}
