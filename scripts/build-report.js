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
            console.log('No preview links found in build report');
            return null;
        }

        console.log(`Found ${Object.keys(previewLinks).length} preview links in build report`);
        console.log('Available files:', Object.keys(previewLinks));

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
        console.log('Fetching build report from:', reportUrl);

        // Fetch the build report HTML.
        const response = await fetch(reportUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch build report: ${response.status} ${response.statusText}`);
        }

        console.log('Response status:', response.status);
        console.log('Content-Length:', response.headers.get('content-length'));
        console.log('Content-Type:', response.headers.get('content-type'));

        // Get the HTML content.
        let html = await response.text();
        console.log(`Fetched build report HTML (${html.length} characters)`);

        // Check if HTML appears complete
        const hasClosingHtml = html.includes('</html>') || html.includes('</HTML>');
        const hasClosingBody = html.includes('</body>') || html.includes('</BODY>');

        console.log(`HTML completeness check: closing html tag: ${hasClosingHtml}, closing body tag: ${hasClosingBody}`);

        if (!hasClosingHtml && !hasClosingBody) {
            console.warn('WARNING: HTML appears to be incomplete (missing closing tags)');
        }

        // Fix malformed HTML in the raw string before parsing
        html = fixMalformedHTMLInRawString(html);

        // Parse the HTML.
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        return doc;
    } catch (error) {
        console.error('Error fetching build report:', error);
        return null;
    }
}

// Fix malformed HTML in the raw HTML string before DOM parsing
function fixMalformedHTMLInRawString(html) {
    console.log('Fixing malformed HTML in raw string...');

    // Check for various patterns without logging the entire HTML
    const patterns = [
        { name: 'TRstyle=', regex: /TRstyle=/g },
        { name: '<TRstyle=', regex: /<TRstyle=/g },
    ];

    patterns.forEach(pattern => {
        const matches = html.match(pattern.regex);
        if (matches) {
            console.log(`Found ${matches.length} instances of ${pattern.name}`);
        } else {
            console.log(`No ${pattern.name} patterns found`);
        }
    });

    // Fix malformed patterns
    let fixedHTML = html.replace(/<TRstyle=/gi, '<TR style=');
    fixedHTML = fixedHTML.replace(/TRstyle=/gi, 'TR style=');

    if (fixedHTML !== html) {
        console.log('Successfully fixed malformed TRstyle patterns in raw string');
    } else {
        console.log('No changes made to HTML - no TRstyle patterns found');
    }

    return fixedHTML;
}

// Extracts preview links from the build report.
function extractPreviewLinks(buildReportDoc) {
    try {
        if (!buildReportDoc) return null;

        console.log("Starting to extract preview links from build report");

        const headerTables = buildReportDoc.querySelectorAll('table.MsoNormalTable');
        console.log(`Found ${headerTables.length} tables with class 'MsoNormalTable'`);

        // Find the header table with the expected headers (File, Status, Preview URL)
        let targetTable = null;

        for (let i = 0; i < headerTables.length; i++) {
            const table = headerTables[i];
            console.log(`Examining table ${i + 1}/${headerTables.length}`);

            const firstRow = table.querySelector('tr');
            if (firstRow) {
                const cells = firstRow.querySelectorAll('td');
                const headers = Array.from(cells).map(cell => cell.textContent.trim());
                console.log(`Table ${i + 1} headers:`, headers);

                // Check if this table has the expected headers in the first three columns
                if (headers.length >= 3 &&
                    headers[0] === 'File' &&
                    headers[1] === 'Status' &&
                    headers[2] === 'Preview URL') {

                    console.log(`Found target table ${i + 1} with expected headers`);
                    targetTable = table;
                    break;
                }
            }
        }

        if (!targetTable) {
            console.log('No table found with expected headers (File, Status, Preview URL)');
            return null;
        }

        // Now extract links from the fixed table
        console.log('Extracting links from target table...');
        return extractLinksFromTable(targetTable);

    } catch (error) {
        console.error('Error extracting preview links:', error);
        return null;
    }
}

// Helper: Extracts links from a table.
function extractLinksFromTable(table) {
    // Store file paths as keys and preview URLs as values.
    const previewLinks = {};

    // Debug: Log the actual table HTML to see what we're working with
    console.log('Target table HTML sample:', table.innerHTML.substring(0, 1000));

    const rows = table.querySelectorAll('tr');
    console.log(`Table has ${rows.length} rows`);

    // Debug: Log info about each row
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const cells = row.querySelectorAll('td');
        console.log(`Row ${i + 1}: ${cells.length} cells, innerHTML sample: ${row.innerHTML.substring(0, 200)}`);
    }

    // Process each row (skip the header row).
    for (let i = 1; i < rows.length; i++) {
        processRow(rows[i], previewLinks);
    }

    console.log(`Extraction complete. Found ${Object.keys(previewLinks).length} preview links:`)
    Object.entries(previewLinks).forEach(([file, url]) => {
        console.log(`  ${file} -> ${url}`);
    });

    return previewLinks;
}

// Helper: Processes a table row.
function processRow(row, previewLinks) {
    const cells = row.querySelectorAll('td');
    console.log(`Processing row ${row.rowIndex || 'unknown'} with ${cells.length} cells`);

    if (cells.length >= 3) {
        // First cell contains the file path.
        const fileCell = cells[0];
        const fileLink = fileCell.querySelector('a');

        // Third cell contains the preview link.
        const previewCell = cells[2];
        const previewLink = previewCell.querySelector('a');

        console.log(`Row ${row.rowIndex || 'unknown'} - File link found: ${!!fileLink}, Preview link found: ${!!previewLink}`);

        if (fileLink && previewLink) {
            const filePath = fileLink.textContent.trim();
            const previewUrl = previewLink.href;

            console.log(`Row ${row.rowIndex || 'unknown'} - File: '${filePath}', Preview URL: '${previewUrl}'`);

            if (filePath && previewUrl) {
                previewLinks[filePath] = previewUrl;
            } else {
                console.log(`Row ${row.rowIndex || 'unknown'} - Missing filePath or previewUrl`);
            }
        } else {
            if (!fileLink) console.log(`Row ${row.rowIndex || 'unknown'} - No file link found in first cell`);
            if (!previewLink) console.log(`Row ${row.rowIndex || 'unknown'} - No preview link found in third cell`);
        }
    } else {
        console.log(`Row ${row.rowIndex || 'unknown'} has insufficient cells (${cells.length}, need at least 3)`);
    }
}
