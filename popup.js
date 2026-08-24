const themeButtons = Array.from(document.querySelectorAll('.theme-btn'));

const manifest = browser.runtime.getManifest();
document.getElementById('version-number').textContent = `v${manifest.version}`;

function normalizeThemeMode(mode) {
  return ['auto', 'light', 'dark'].includes(mode) ? mode : 'auto';
}

function updateActiveButton(mode) {
  for (const button of themeButtons) {
    const isActive = button.dataset.mode === mode;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  }
}

async function loadSettings() {
  try {
    const data = await browser.storage.local.get('themeMode');
    updateActiveButton(normalizeThemeMode(data.themeMode));
  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

async function selectTheme(mode) {
  const previousMode = themeButtons.find(button =>
    button.classList.contains('active')
  )?.dataset.mode;

  updateActiveButton(mode);
  try {
    await browser.storage.local.set({ themeMode: mode });
  } catch (error) {
    updateActiveButton(previousMode || 'auto');
    console.error('Error saving settings:', error);
  }
}

for (const button of themeButtons) {
  button.addEventListener('click', () => selectTheme(button.dataset.mode));
}

loadSettings();
