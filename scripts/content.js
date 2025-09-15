function addButton(fileDropDown) {
  // Check if this menu already has our custom button.
  if (fileDropDown.querySelector('.preview-on-learn')) {
    return;
  }

  // Add divider.
  let divider = document.createElement("div");
  divider.className = "dropdown-divider";
  divider.setAttribute("role", "separator");
  fileDropDown.appendChild(divider);

  let previewButton = document.createElement("button");

  // Set attributes and properties.
  previewButton.className = "pl-5 dropdown-item btn-link preview-on-learn";
  previewButton.setAttribute("role", "menuitem");
  previewButton.setAttribute("type", "button");
  previewButton.textContent = "Preview on Learn";

  // Add event listener.
  previewButton.addEventListener("click", function () {
    console.log("Preview on Learn button clicked!");
  });

  fileDropDown.appendChild(previewButton);
}

// Function to add buttons to all matching dropdown menus.
function addButtonsToDropdowns() {
  const dropdownMenus = document.querySelectorAll(".js-file-header-dropdown .dropdown-menu");
  dropdownMenus.forEach(menu => {
    addButton(menu);
  });
}

// Initial addition of buttons.
addButtonsToDropdowns();

// Set up a MutationObserver to watch for DOM changes.
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

// Start observing the document with the configured parameters
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
