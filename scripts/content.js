import { Octokit } from "@octokit/rest";

const octokit = new Octokit();

// Global variables.
let isOpsRepoCache = null;
let isCheckingOpsRepo = false; // Flag to prevent concurrent checks.
let observerPaused = false; // Flag to temporarily pause the observer during button addition.

// Gets the latest commit SHA of the PR.
async function getLatestPrCommit(owner, repo, prNumber) {
  try {
    // Get list of commits in the PR.
    const { data: commits } = await octokit.pulls.listCommits({
      owner,
      repo,
      pull_number: prNumber
    });

    if (commits && commits.length > 0) {
      // The last commit in the array is the latest one.
      const latestCommit = commits[commits.length - 1];
      console.log(`Latest commit SHA: ${latestCommit.sha}`);
      return latestCommit.sha;
    } else {
      console.warn('No commits found in this PR');
      return null;
    }
  } catch (error) {
    console.error('Error fetching PR commits:', error);
    return null;
  }
}

// Gets status checks for a specific commit.
async function getStatusChecks(owner, repo, commitSha) {
  try {
    const { data: statusChecks } = await octokit.repos.getCombinedStatusForRef({
      owner,
      repo,
      ref: commitSha
    });

    return statusChecks.statuses;
  } catch (error) {
    console.error('Error fetching status checks:', error);
    return [];
  }
}

// Gets a specific status check by name.
async function getSpecificStatusCheck(owner, repo, commitSha, checkName) {
  try {
    const statusChecks = await getStatusChecks(owner, repo, commitSha);

    const matchingStatusCheck = statusChecks.find(status =>
      status.context.toLowerCase().includes(checkName.toLowerCase())
    );

    if (matchingStatusCheck) {
      console.log(`Found matching status check: ${matchingStatusCheck.context}`);
      return {
        name: matchingStatusCheck.context,
        status: matchingStatusCheck.state,
        details_url: matchingStatusCheck.target_url
      };
    }

    console.warn(`No status check found with name containing "${checkName}"`);
    return null;
  } catch (error) {
    console.error('Error fetching specific status check:', error);
    return null;
  }
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
    console.log(`Found ${tables.length} tables with MsoNormalTable class`);

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

      console.log(`Found file: ${filePath} with preview URL: ${previewUrl}`);

      if (filePath && previewUrl) {
        previewLinks[filePath] = previewUrl;
      }
    }
  } else {
    console.log(`Row ${row.rowIndex} missing file link or preview link`);
  }
}

async function handleClick(event) {
  console.log("Preview on Learn button clicked!");

  const menuItem = event.currentTarget;

  const [originalFileName, newFileName = originalFileName] = menuItem
    .closest('[data-path]')
    .querySelector(".Link--primary")
    .textContent
    .split(" → ");

  console.log(`File name is ${newFileName}.`);

  const repoInfo = extractRepoInfo();
  if (repoInfo) {
    try {
      // Get the latest commit SHA.
      const commitSha = await getLatestPrCommit(
        repoInfo.owner,
        repoInfo.repo,
        repoInfo.prNumber
      );

      if (commitSha) {
        // Get the OPS status check.
        const opsCheck = await getSpecificStatusCheck(
          repoInfo.owner,
          repoInfo.repo,
          commitSha,
          "OpenPublishing.Build"
        );

        if (opsCheck && opsCheck.details_url) {
          if (opsCheck.state === 'pending') {
            console.log('OPS build is still in progress');
            // TODO - add a wait and loop.
            return;
          }

          if (opsCheck.status !== 'success') {
            // TODO - add more robust handling here.
            console.warn('Check not successful.');
            return;
          }

          // Fetch and parse the build report
          console.log("Fetching build report from:", opsCheck.details_url);
          const buildReportDoc = await fetchBuildReport(opsCheck.details_url);

          if (buildReportDoc) {
            const previewLinks = extractPreviewLinks(buildReportDoc);

            if (previewLinks && Object.keys(previewLinks).length > 0) {
              // Try to find a match for the current file.
              let previewUrl = null;

              if (previewLinks[newFileName]) {
                previewUrl = previewLinks[newFileName];
                console.log(`Found preview URL for ${newFileName}: ${previewUrl}`);
              }

              // If we found a preview URL, use it.
              if (previewUrl) {
                window.open(previewUrl, '_blank');
                return;
              } else {
                console.warn(`No preview link found for ${newFileName} in the build report`);
              }
            } else {
              console.warn('No preview links found in the build report');
            }
          }
        }
      }
    } catch (error) {
      console.error('Error:', error);
    }
  }
}

// Extracts repository information from the URL.
function extractRepoInfo() {
  const pathParts = window.location.pathname.split('/');
  if (pathParts.length >= 4) {
    return {
      owner: pathParts[1],
      repo: pathParts[2],
      prNumber: pathParts[4]
    };
  }
  return null;
}

function addButton(fileMenu) {
  // Check if this menu already has "Preview on Learn".
  if (fileMenu.querySelector('.preview-on-learn')) {
    return;
  }

  // Create and add divider.
  let divider = document.createElement("div");
  divider.className = "dropdown-divider";
  divider.setAttribute("role", "separator");
  fileMenu.appendChild(divider);

  // Create new button.
  let menuItem = document.createElement("button");

  // Set attributes and properties.
  menuItem.className = "pl-5 dropdown-item btn-link preview-on-learn";
  menuItem.setAttribute("role", "menuitem");
  menuItem.setAttribute("type", "button");
  menuItem.textContent = "Preview on Learn";

  // Add event listener.
  menuItem.addEventListener('click', handleClick, { capture: true });

  // Add new button to menu.
  fileMenu.appendChild(menuItem);
}

// Checks if the current repo is an OPS (docs) repo.
async function isOpsRepo() {
  // If already checking, return the current cached value or false.
  if (isCheckingOpsRepo) {
    console.log("Already checking OPS repo status, using cached value:", isOpsRepoCache);
    return isOpsRepoCache || false;
  }

  // If we have a cached result, use it.
  if (isOpsRepoCache !== null) {
    console.log("Using cached OPS repo status:", isOpsRepoCache);
    return isOpsRepoCache;
  }

  try {
    // Set flag to prevent concurrent checks.
    isCheckingOpsRepo = true;

    const repoInfo = extractRepoInfo();
    if (!repoInfo) {
      isOpsRepoCache = false;
      return false;
    }

    console.log("Checking if this is an OPS repo...");

    // First check if it's a known OPS repo based on organization/repo.
    if (isKnownOpsRepo(repoInfo.owner, repoInfo.repo)) {
      console.log("Found in known OPS repos list");
      isOpsRepoCache = true;
      return true;
    }

    // Try to check for the existence of the OPS config file with fetch.
    try {
      // Use the raw GitHub content URL which might have different permissions
      const rawUrl = `https://raw.githubusercontent.com/${repoInfo.owner}/${repoInfo.repo}/main/.openpublishing.publish.config.json`;

      const response = await fetch(rawUrl, {
        method: 'HEAD',
        cache: 'no-cache'
      });

      if (response.ok) {
        isOpsRepoCache = true;
        console.log("OPS config file found via raw URL - this is an OPS repo");
        return true;
      } else if (response.status === 404) {
        // 404 means the file definitely doesn't exist.
        isOpsRepoCache = false;
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
    isOpsRepoCache = false;
    return false;
  } catch (error) {
    console.error("Error checking for OPS repo:", error);
    isOpsRepoCache = false;
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

// Adds a "Preview on Learn" menu item to all matching
// dropdown menus if the repo is an OPS repo.
async function addButtonsToDropdowns() {
  // If we've already checked and it's not an OPS repo, don't add menu item.
  if (isOpsRepoCache === false) {
    return;
  }

  try {
    // Check if this is an OPS repo.
    const isOps = await isOpsRepo();

    if (isOps) {
      // Temporarily pause the observer to avoid recursion.
      observerPaused = true;

      const dropdownMenus = document.querySelectorAll(".js-file-header-dropdown .dropdown-menu:not(:has(.preview-on-learn))");
      if (dropdownMenus.length > 0) {
        console.log(`Adding buttons to ${dropdownMenus.length} dropdown menus`);
        dropdownMenus.forEach(menu => {
          addButton(menu);
        });
      }

      // Resume the observer.
      setTimeout(() => {
        observerPaused = false;
      }, 50);
    }
  } catch (error) {
    console.error("Error in addButtonsToDropdowns:", error);
    observerPaused = false;
  }
}

// Debounced version of addButtonsToDropdowns to prevent multiple rapid calls.
let debounceTimeout = null;
function debouncedAddButtonsToDropdowns() {
  if (debounceTimeout) {
    clearTimeout(debounceTimeout);
  }

  debounceTimeout = setTimeout(async () => {
    await addButtonsToDropdowns();
    debounceTimeout = null;
  }, 100); // Wait 100ms before executing
}

// Set up observer to watch for DOM changes.
const observer = new MutationObserver((mutations) => {
  // Skip if the observer is paused or we've
  // already determined it's not an OPS repo.
  if (observerPaused || isOpsRepoCache === false) {
    return;
  }

  // Check if any new dropdown menus have been added.
  const hasNewDropdowns = document.querySelectorAll(".js-file-header-dropdown .dropdown-menu:not(:has(.preview-on-learn))").length > 0;

  if (hasNewDropdowns) {
    debouncedAddButtonsToDropdowns();
  }
});

// Initialize the extension.
async function init() {
  // Check once if this is an OPS repo.
  const isOps = await isOpsRepo();

  if (isOps) {
    await addButtonsToDropdowns();

    // Start observing the document.
    observer.observe(document.body, {
      childList: true,     // Watch for changes to the direct children.
      subtree: true,       // Watch for changes in the entire subtree.
      attributes: false,   // Don't watch for changes to attributes.
      characterData: false // Don't watch for changes to text content.
    });

    console.log("Observer started");
  } else {
    console.log("Not an OPS repo - extension inactive");
  }
}

// Start the extension.
init();

// Clean up the observer when the page is unloaded.
window.addEventListener('unload', () => {
  if (observer) {
    observer.disconnect();
  }
});
