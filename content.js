// apply theme to Gmail
function applyTheme(isDark) {
  const htmlElement = document.documentElement;
  
  if (isDark) {
    htmlElement.classList.add('gmail-dark-mode');
    htmlElement.classList.remove('gmail-light-mode');
  } else {
    htmlElement.classList.add('gmail-light-mode');
    htmlElement.classList.remove('gmail-dark-mode');
  }
}

// listen for messages from background script
browser.runtime.onMessage.addListener((message) => {
  if (message.action === "themeChanged") {
    applyTheme(message.darkMode);
  }
});

// initialize theme on page load
browser.storage.local.get('darkMode').then(data => {
  applyTheme(data.darkMode || false);
});

// watch for DOM changes to reapply if gmail resets styles
const observer = new MutationObserver(() => {
  browser.storage.local.get('darkMode').then(data => {
    const isDark = data.darkMode || false;
    const htmlElement = document.documentElement;
    
    // only reapply if class is missing
    if (isDark && !htmlElement.classList.contains('gmail-dark-mode')) {
      applyTheme(isDark);
    } else if (!isDark && !htmlElement.classList.contains('gmail-light-mode')) {
      applyTheme(isDark);
    }
  });
});

// start observing after DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.documentElement, { 
      attributes: true, 
      attributeFilter: ['class'] 
    });
  });
} else {
  observer.observe(document.documentElement, { 
    attributes: true, 
    attributeFilter: ['class'] 
  });
}