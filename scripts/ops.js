import { extractRepoInfo } from './pr-helpers.js';

// Cache for OPS repo results, keyed by "owner/repo"
const opsRepoCache = new Map();

// Flag to prevent concurrent checks.
let isCheckingOpsRepo = false;

// Clears the cache for a specific repository or all repositories
export function clearOpsRepoCache(owner = null, repo = null) {
    if (owner && repo) {
        const key = `${owner}/${repo}`.toLowerCase();
        opsRepoCache.delete(key);
        console.log(`Cleared OPS repo cache for ${key}`);
    } else {
        opsRepoCache.clear();
        console.log("Cleared all OPS repo cache");
    }
}

// Checks if it's an OPS repo.
async function checkIfOpsRepo() {
    if (isCheckingOpsRepo) {
        return;
    }

    console.log("Checking if this is an OPS repo...");
    await isOpsRepo();
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
        // ...
    ];

    // Check if the repository matches any known OPS repos.
    return knownOpsRepos.some(knownRepo =>
        knownRepo.owner.toLowerCase() === owner.toLowerCase() &&
        knownRepo.repo.toLowerCase() === repo.toLowerCase()
    );
}

