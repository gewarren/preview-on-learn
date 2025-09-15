async function handleClick(event) {
  console.log("Preview on Learn button clicked!");

  const menuItem = event.currentTarget;

  const [originalFileName, newFileName = originalFileName] = menuItem
    .closest('[data-path]')
    .querySelector(".Link--primary")
    .textContent
    .split(" → ");

  console.log(`File name is ${newFileName}.`);

  if (newFileName.endsWith('.md')) {
    const repoInfo = extractRepoInfo();
    // Remove the last 3 characters (.md).
    const fileNameSansExtension = newFileName.substring(0, newFileName.length - 3);
    const learnUrl = generateLearnPreviewUrl(fileNameSansExtension, repoInfo.prNumber);
    window.open(learnUrl, '_blank');
  }
}

// Extract repository information from the URL.
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

// Generate Learn preview URL.
function generateLearnPreviewUrl(filePath, prNumber) {
  const baseUrl = 'https://review.learn.microsoft.com';
  return `${baseUrl}/${filePath.replace('docs', 'dotnet')}?branch=pr-en-us-${prNumber}`;
}

function addButton(fileMenu) {
  // Check if this menu already has our custom button.
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

// Adds buttons to all matching dropdown menus.
function addButtonsToDropdowns() {
  const dropdownMenus = document.querySelectorAll(".js-file-header-dropdown .dropdown-menu");
  dropdownMenus.forEach(menu => {
    addButton(menu);
  });
}

// Initial addition of buttons.
addButtonsToDropdowns();

// Set up observer to watch for DOM changes.
const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    // If new nodes are added...
    if (mutation.addedNodes && mutation.addedNodes.length > 0) {
      // Check if any of the added nodes contain our target elements
      // or if there are dropdown menus that don't have our button yet.
      const hasNewDropdowns = document.querySelectorAll(".js-file-header-dropdown .dropdown-menu:not(:has(.preview-on-learn))").length > 0;

      if (hasNewDropdowns) {
        addButtonsToDropdowns();
      }
    }
  });
});

// Start observing the document.
observer.observe(document.body, {
  childList: true,     // Watch for changes to the direct children.
  subtree: true,       // Watch for changes in the entire subtree.
  attributes: false,   // Don't watch for changes to attributes.
  characterData: false // Don't watch for changes to text content.
});

// Clean up the observer when the page is unloaded.
window.addEventListener('unload', () => {
  observer.disconnect();
});
