import { extractRepoInfo, getPrInfo, getSpecificStatusCheck } from './pr-helpers.js';

// Gets preview URL for a file from the build report.
export async function getPreviewUrl(fileName) {
    try {
        const repoInfo = extractRepoInfo();
        if (!repoInfo) {
            return null;
        }

        // Get the latest commit SHA.
        const prInfo = await getPrInfo(
            repoInfo.owner,
            repoInfo.repo,
            repoInfo.prNumber
        );

        if (!prInfo || !prInfo.commitSha) {
            return null;
        }

        // Get the OPS status check.
        const opsCheck = await getSpecificStatusCheck(
            repoInfo.owner,
            repoInfo.repo,
            prInfo.commitSha,
            "OpenPublishing.Build"
        );

        if (!opsCheck || !opsCheck.details_url || opsCheck.status !== 'success') {
            return null;
        }

        // Fetch and parse the build report.
        const buildReportDoc = await fetchBuildReport(opsCheck.details_url);
        if (!buildReportDoc) {
            return null;
        }

        const previewLinks = extractPreviewLinks(buildReportDoc);
        if (!previewLinks || Object.keys(previewLinks).length === 0) {
            return null;
        }

        // Try to find a match for the current file.
        return previewLinks[fileName] || null;
    } catch (error) {
        console.error('Error getting preview URL:', error);
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
