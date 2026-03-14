// Listen for system theme changes
if (window.matchMedia) {
  const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  
  // Function to update theme
  async function updateTheme(e) {
    const isDark = e.matches;
    
    // Check if user is using auto mode
    const data = await browser.storage.local.get('themeMode');
    const mode = data.themeMode || 'auto';
    
    // Only apply system theme if in auto mode
    if (mode === 'auto') {
      // Store the theme preference
      await browser.storage.local.set({ darkMode: isDark });
      
      // Notify all Gmail tabs about the theme change
      const tabs = await browser.tabs.query({ url: "*://mail.google.com/*" });
      for (const tab of tabs) {
        try {
          await browser.tabs.sendMessage(tab.id, { 
            action: "themeChanged", 
            darkMode: isDark 
          });
        } catch (error) {
          // Tab might not be ready, ignore error
        }
      }
    }
  }
  
  // Listen for changes
  darkModeQuery.addListener(updateTheme);
  
  // Initialize on install
  browser.runtime.onInstalled.addListener(async () => {
    // Set default to auto mode
    const data = await browser.storage.local.get('themeMode');
    if (!data.themeMode) {
      await browser.storage.local.set({ themeMode: 'auto' });
    }
    updateTheme(darkModeQuery);
  });
  
  // Initialize immediately
  updateTheme(darkModeQuery);
}

// Listen for tab updates to apply theme to newly loaded Gmail tabs
browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('mail.google.com')) {
    const data = await browser.storage.local.get(['darkMode', 'themeMode']);
    
    let isDark = data.darkMode || false;
    const mode = data.themeMode || 'auto';
    
    // If in auto mode, check system preference
    if (mode === 'auto') {
      const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
      isDark = darkModeQuery.matches;
    } else {
      // Use manual setting
      isDark = mode === 'dark';
    }
    
    try {
      await browser.tabs.sendMessage(tabId, { 
        action: "themeChanged", 
        darkMode: isDark 
      });
    } catch (error) {
      // Tab might not be ready yet
    }
  }
});