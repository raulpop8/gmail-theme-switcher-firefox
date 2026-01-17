// system theme change
if (window.matchMedia) {
  const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  
  // theme update
  function updateTheme(e) {
    const isDark = e.matches;
    
    // store the theme preference
    browser.storage.local.set({ darkMode: isDark });
    
    // notify all gmail tabs about the theme change
    browser.tabs.query({ url: "*://mail.google.com/*" }).then(tabs => {
      tabs.forEach(tab => {
        browser.tabs.sendMessage(tab.id, { 
          action: "themeChanged", 
          darkMode: isDark 
        }).catch(() => {
          // tab might not be ready, ignore error
        });
      });
    });
  }
  
  // listen for changes
  darkModeQuery.addListener(updateTheme);
  
  // initialize on install
  browser.runtime.onInstalled.addListener(() => {
    updateTheme(darkModeQuery);
  });
  
  // initialize immediately
  updateTheme(darkModeQuery);
}

// listen for tab updates to apply theme to newly loaded gmail tabs
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('mail.google.com')) {
    browser.storage.local.get('darkMode').then(data => {
      browser.tabs.sendMessage(tabId, { 
        action: "themeChanged", 
        darkMode: data.darkMode || false 
      }).catch(() => {
        // tab might not be ready yet
      });
    });
  }
});