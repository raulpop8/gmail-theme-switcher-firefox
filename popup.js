// Get DOM elements
const autoBtn = document.getElementById('auto-btn');
const lightBtn = document.getElementById('light-btn');
const darkBtn = document.getElementById('dark-btn');

// Load current settings
async function loadSettings() {
  try {
    const data = await browser.storage.local.get(['themeMode']);
    const mode = data.themeMode || 'auto';
    
    // Update button states
    updateActiveButton(mode);
  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

// Update which button appears active
function updateActiveButton(mode) {
  // Remove active class from all buttons
  [autoBtn, lightBtn, darkBtn].forEach(btn => btn.classList.remove('active'));
  
  // Add active class to selected button
  if (mode === 'auto') {
    autoBtn.classList.add('active');
  } else if (mode === 'light') {
    lightBtn.classList.add('active');
  } else if (mode === 'dark') {
    darkBtn.classList.add('active');
  }
}

// Apply theme change
async function applyTheme(mode) {
  try {
    let isDark = false;
    
    if (mode === 'auto') {
      // Use system preference
      const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
      isDark = darkModeQuery.matches;
    } else {
      // Use manual selection
      isDark = mode === 'dark';
    }
    
    // Save settings
    await browser.storage.local.set({ 
      themeMode: mode,
      darkMode: isDark 
    });
    
    // Update UI
    updateActiveButton(mode);
    
    // Notify all Gmail tabs
    const tabs = await browser.tabs.query({ url: "*://mail.google.com/*" });
    for (const tab of tabs) {
      try {
        await browser.tabs.sendMessage(tab.id, { 
          action: "themeChanged", 
          darkMode: isDark 
        });
      } catch (error) {
        // Tab might not be ready, ignore
      }
    }
    
  } catch (error) {
    console.error('Error applying theme:', error);
  }
}

// Event listeners
autoBtn.addEventListener('click', () => applyTheme('auto'));
lightBtn.addEventListener('click', () => applyTheme('light'));
darkBtn.addEventListener('click', () => applyTheme('dark'));

// Initialize on popup open
loadSettings();