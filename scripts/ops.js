import { extractRepoInfo } from './pr-helpers.js';

// Flag to prevent concurrent checks.
let isCheckingOpsRepo = false;

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

    try {
        // Set flag to prevent concurrent checks.
        isCheckingOpsRepo = true;

        const repoInfo = extractRepoInfo();
        if (!repoInfo) {
            return false;
        }

        console.log("Checking if this is an OPS repo...");

        // First check if it's a known OPS repo based on organization/repo.
        if (isKnownOpsRepo(repoInfo.owner, repoInfo.repo)) {
            console.log("Found in known OPS repos list");
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
                return true;
            } else if (response.status === 404) {
                // 404 means the file definitely doesn't exist.
                console.log("OPS config file not found (404) - this is NOT an OPS repo");
                return false;
            } else {
                // For other status codes (like 403), just log it.
                console.log(`Raw content fetch returned status ${response.status}`);
            }
        } catch (rawFetchError) {
            console.log("Raw content fetch failed:", rawFetchError);
        }

        // If we get here, it's not a known OPS repo.
        console.log("Not identified as an OPS repo");
        return false;
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

    // Check if the repository matches any known OPS repos.
    return knownOpsRepos.some(knownRepo =>
        knownRepo.owner.toLowerCase() === owner.toLowerCase() &&
        knownRepo.repo.toLowerCase() === repo.toLowerCase()
    );
}

