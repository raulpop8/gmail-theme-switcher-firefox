const NATIVE_THEME_IDS = Object.freeze({
  dark: 'basicblack',
  light: 'basicwhite'
});
const GMAIL_UI_WAIT_MS = 10000;
const AUTOMATION_ATTRIBUTE = 'data-gmail-native-theme-busy';
const AUTOMATION_UI_CLASS = 'gmail-native-theme-automation-ui';
const MESSAGE_DARK_CLASS = 'gmail-message-dark-mode';
const MESSAGE_BODY_SELECTOR = '.ii.gt .a3s.aiL';
const MESSAGE_INVERT_CLASS = 'gmail-theme-invert-message';
const MESSAGE_PRESERVE_CLASS = 'gmail-theme-preserve-message';
const COMPOSE_EDITOR_SELECTOR =
  '.Am[contenteditable="true"], .LW-avf[contenteditable="true"]';
const MESSAGE_ITEM_CLASS = 'gmail-theme-message-item';
const MESSAGE_SURFACE_CLASS = 'gmail-theme-message-surface';
const CONVERSATION_CLASS = 'gmail-theme-conversation';
const COMPOSE_SHELL_CLASS = 'gmail-theme-compose-shell';
const LIGHT_SURFACE_CLASS = 'gmail-theme-light-surface';
const extensionApi = globalThis.browser ?? globalThis.chrome;
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');

let themeMode = 'auto';
let requestedNativeTheme = null;
let appliedNativeTheme = null;
let nativeThemeTask = null;

function normalizeThemeMode(mode) {
  return ['auto', 'light', 'dark'].includes(mode) ? mode : 'auto';
}

function resolveDarkMode(mode, systemIsDark) {
  if (mode === 'dark') {
    return true;
  }
  if (mode === 'light') {
    return false;
  }
  return systemIsDark;
}

function setMessageContentTheme(isDark) {
  document.documentElement?.classList.toggle(MESSAGE_DARK_CLASS, isDark);
}

function getBackgroundLuminance(element) {
  const channels = window.getComputedStyle(element)
    .backgroundColor?.match(/[\d.]+/g)?.map(Number);
  if (!channels || channels.length < 3) {
    return null;
  }

  const [red, green, blue, alpha = 1] = channels;
  if (alpha < 0.5) {
    return null;
  }

  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
}

function isLightSurface(element, preserveBackgroundImages = false) {
  const style = window.getComputedStyle(element);
  if (preserveBackgroundImages && style.backgroundImage && style.backgroundImage !== 'none') {
    return false;
  }

  const luminance = getBackgroundLuminance(element);
  return luminance !== null && luminance >= 0.72;
}

function getSurfaceArea(element) {
  const rectangle = element.getBoundingClientRect?.();
  if (!rectangle) {
    return 0;
  }

  const width = Number(rectangle.width) ||
    Math.max(0, Number(rectangle.right) - Number(rectangle.left));
  const height = Number(rectangle.height) ||
    Math.max(0, Number(rectangle.bottom) - Number(rectangle.top));
  return Math.max(0, width) * Math.max(0, height);
}

function shouldInvertMessageBody(messageBody) {
  const structuralSelector =
    'table, tbody, tr, td, div, section, article, main';
  const candidates = [
    messageBody,
    ...messageBody.querySelectorAll(structuralSelector)
  ].slice(0, 400);
  let dominantSurface = null;
  let fallbackLuminance = null;

  for (const candidate of candidates) {
    const luminance = getBackgroundLuminance(candidate);
    if (luminance === null) {
      continue;
    }

    fallbackLuminance ??= luminance;
    const area = getSurfaceArea(candidate);
    if (area < 2400) {
      continue;
    }

    if (!dominantSurface || area > dominantSurface.area * 1.1) {
      dominantSurface = { area, luminance };
      continue;
    }

    // Nested email tables often overlap almost exactly. Prefer the dark layer
    // when its footprint is close to the largest surface so an already-dark
    // newsletter is not inverted merely because a light wrapper came first.
    if (
      luminance <= 0.4 &&
      dominantSurface.luminance > 0.4 &&
      area >= dominantSurface.area * 0.75
    ) {
      dominantSurface = { area, luminance };
    }
  }

  const luminance = dominantSurface?.luminance ?? fallbackLuminance;
  return luminance === null || luminance >= 0.5;
}

function classifyMessageBody(messageBody) {
  const shouldInvert = shouldInvertMessageBody(messageBody);
  messageBody.classList.toggle(MESSAGE_INVERT_CLASS, shouldInvert);
  messageBody.classList.toggle(MESSAGE_PRESERVE_CLASS, !shouldInvert);
}

function decorateMessageBody(messageBody) {
  classifyMessageBody(messageBody);

  const messageItem = messageBody.closest('[role="listitem"]') ||
    messageBody.closest('.Bk') ||
    messageBody.parentElement;
  if (!messageItem) {
    return null;
  }

  const conversation = messageItem.closest?.('[role="main"]') || null;
  if (messageItem.classList.contains(MESSAGE_ITEM_CLASS)) {
    return conversation;
  }

  messageItem.classList.add(MESSAGE_ITEM_CLASS);

  let surface = messageItem;
  for (let depth = 0; surface && depth < 6; depth += 1) {
    surface.classList.add(MESSAGE_SURFACE_CLASS);
    if (surface.matches?.('[role="main"]')) {
      break;
    }
    surface = surface.parentElement;
  }

  conversation?.classList.add(MESSAGE_SURFACE_CLASS);

  const candidates = [messageItem, ...messageItem.querySelectorAll('*')];
  for (const candidate of candidates) {
    if (candidate === messageBody || messageBody.contains(candidate)) {
      continue;
    }
    if (candidate.matches('img, video, iframe, canvas, svg')) {
      continue;
    }
    if (isLightSurface(candidate, true)) {
      candidate.classList.add(MESSAGE_SURFACE_CLASS);
    }
  }

  return conversation;
}

function decorateConversation(conversation) {
  conversation.classList.add(CONVERSATION_CLASS, MESSAGE_SURFACE_CLASS);

  const candidates = [conversation, ...conversation.querySelectorAll('*')];
  for (const candidate of candidates) {
    if (candidate.closest?.('.a3s.aiL')) {
      continue;
    }
    if (candidate.matches('img, video, iframe, canvas, svg')) {
      continue;
    }
    if (isLightSurface(candidate, true)) {
      candidate.classList.add(MESSAGE_SURFACE_CLASS);
    }
  }
}

function decorateComposeEditor(editor) {
  const shell = editor.closest('[role="dialog"]') ||
    editor.closest('.M9') ||
    editor.closest('.aoP');
  if (!shell) {
    return;
  }

  shell.classList.add(COMPOSE_SHELL_CLASS);
  const candidates = [shell, ...shell.querySelectorAll('*')];

  for (const candidate of candidates) {
    if (candidate !== editor && editor.contains(candidate)) {
      continue;
    }
    if (candidate.matches('img, video, iframe, canvas, svg')) {
      continue;
    }
    if (isLightSurface(candidate)) {
      candidate.classList.add(LIGHT_SURFACE_CLASS);
    }
  }
}

function decorateGmailSurfaces() {
  const conversations = new Set();
  for (const messageBody of document.querySelectorAll(MESSAGE_BODY_SELECTOR)) {
    const conversation = decorateMessageBody(messageBody);
    if (conversation) {
      conversations.add(conversation);
    }
  }

  for (const conversation of conversations) {
    decorateConversation(conversation);
  }

  for (const editor of document.querySelectorAll(COMPOSE_EDITOR_SELECTOR)) {
    decorateComposeEditor(editor);
  }
}

let decorationTimer = null;
function scheduleSurfaceDecoration() {
  if (decorationTimer !== null) {
    return;
  }

  decorationTimer = window.setTimeout(() => {
    decorationTimer = null;
    decorateGmailSurfaces();
  }, 0);
}

function isUsableControl(element) {
  if (!element || element.hasAttribute?.('disabled')) {
    return false;
  }

  const style = window.getComputedStyle(element);
  return style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    element.getClientRects().length > 0;
}

function waitForGmailUi(locate, description, timeout = GMAIL_UI_WAIT_MS) {
  const immediateMatch = locate();
  if (immediateMatch) {
    return Promise.resolve(immediateMatch);
  }

  return new Promise((resolve, reject) => {
    let observer = null;
    const timer = window.setTimeout(() => {
      observer?.disconnect();
      reject(new Error(`Gmail did not expose ${description} within ${timeout}ms`));
    }, timeout);

    function inspect() {
      const match = locate();
      if (!match) {
        return;
      }

      observer?.disconnect();
      window.clearTimeout(timer);
      resolve(match);
    }

    if (typeof MutationObserver === 'function' && document.documentElement) {
      observer = new MutationObserver(inspect);
      observer.observe(document.documentElement, {
        attributes: true,
        childList: true,
        subtree: true
      });
    }

    inspect();
  });
}

function accessibleText(element) {
  return [
    element.textContent,
    element.getAttribute?.('aria-label'),
    element.getAttribute?.('data-tooltip'),
    element.getAttribute?.('title')
  ]
    .filter(Boolean)
    .join(' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function findNamedAction(root, names) {
  return Array.from(root.querySelectorAll('button, [role="button"]')).find(element =>
    isUsableControl(element) && names.some(name => name.test(accessibleText(element)))
  );
}

function findSettingsLauncher() {
  const directMatch = document.querySelector([
    '[role="button"][aria-label="Settings"]',
    '[role="button"][aria-label="Einstellungen"]',
    '[role="button"][aria-label="Setări"]',
    '[data-tooltip="Settings"] [role="button"]'
  ].join(', '));

  if (isUsableControl(directMatch)) {
    return directMatch;
  }

  const names = [/^Settings\b/i, /^Einstellungen\b/i, /^Setări\b/i];
  return Array.from(
    document.querySelectorAll('button, a[role="button"], [role="button"]')
  ).find(element =>
    isUsableControl(element) && names.some(name => name.test(accessibleText(element)))
  );
}

function findThemeChoice(themeId) {
  const selectors = [`[data-theme-id="${themeId}"]`];
  if (themeId === NATIVE_THEME_IDS.dark) {
    selectors.push(`img[src*="/themes/${themeId}/"]`);
  }

  return Array.from(document.querySelectorAll(selectors.join(', ')))
    .find(isUsableControl);
}

function activationTarget(element) {
  return element?.closest?.(
    'button, [role="button"], [role="radio"], [role="option"], [tabindex]'
  ) || element;
}

function activateControl(element, description) {
  const target = activationTarget(element);
  if (!target || typeof target.click !== 'function') {
    throw new Error(`Gmail ${description} is not clickable`);
  }
  target.click();
}

function findThemeGalleryAction(defaultThemeChoice) {
  const names = [
    /^View all$/i,
    /^Alle ansehen$/i,
    /^Vezi toate$/i,
    /^Vedeți toate$/i
  ];
  const defaultTarget = activationTarget(defaultThemeChoice);
  let section = defaultThemeChoice.closest?.('[role="group"]') ||
    defaultThemeChoice.parentElement;
  for (let depth = 0; section && depth < 4; depth += 1) {
    const namedAction = findNamedAction(section, names);
    if (namedAction && namedAction !== defaultTarget) {
      return namedAction;
    }

    const action = Array.from(section.querySelectorAll('button, [role="button"]'))
      .find(element =>
        element !== defaultTarget &&
        !element.contains?.(defaultThemeChoice) &&
        isUsableControl(element)
      );
    if (action) {
      return action;
    }
    section = section.parentElement;
  }

  return findNamedAction(document, names);
}

function findThemeSaveAction(dialog) {
  const namedAction = findNamedAction(
    dialog,
    [
      /^Save$/i,
      /^Speichern$/i,
      /^Salvează$/i,
      /^Salvați$/i,
      /^Enregistrer$/i,
      /^Guardar$/i
    ]
  );
  if (namedAction) {
    return namedAction;
  }

  const actions = Array.from(dialog.querySelectorAll('button, [role="button"]'))
    .filter(isUsableControl);
  return actions.length > 1 ? actions.at(-1) : null;
}

function concealAutomationUi(element, concealedSurfaces) {
  const container = element.closest?.('[role="dialog"], [role="menu"]');
  const surface = container?.matches?.('[role="menu"]') && container.parentElement
    ? container.parentElement
    : container;

  if (surface?.classList) {
    surface.classList.add(AUTOMATION_UI_CLASS);
    concealedSurfaces.add(surface);
  }
}

function waitForGmailRender() {
  const scheduleFrame = typeof window.requestAnimationFrame === 'function'
    ? callback => window.requestAnimationFrame(callback)
    : callback => window.setTimeout(callback, 0);

  return new Promise(resolve => {
    scheduleFrame(() => scheduleFrame(resolve));
  });
}

async function setNativeGmailTheme(targetThemeId) {
  if (!Object.values(NATIVE_THEME_IDS).includes(targetThemeId)) {
    throw new Error(`Unsupported native Gmail theme: ${targetThemeId}`);
  }

  const settingsLauncher = await waitForGmailUi(
    findSettingsLauncher,
    'the Settings button'
  );
  const settingsWereOpen = settingsLauncher.getAttribute('aria-expanded') === 'true';
  const previouslyFocused = document.activeElement;
  const concealedSurfaces = new Set();

  document.documentElement.setAttribute(AUTOMATION_ATTRIBUTE, '');
  if (!settingsWereOpen) {
    settingsLauncher.click();
  }

  try {
    const defaultThemeChoice = await waitForGmailUi(
      () => findThemeChoice(NATIVE_THEME_IDS.light),
      'the Default theme choice'
    );
    concealAutomationUi(defaultThemeChoice, concealedSurfaces);

    if (targetThemeId === NATIVE_THEME_IDS.light) {
      activateControl(defaultThemeChoice, 'Default theme choice');
      await waitForGmailRender();
      appliedNativeTheme = targetThemeId;
      return;
    }

    const galleryAction = await waitForGmailUi(
      () => findThemeGalleryAction(defaultThemeChoice),
      'the full theme gallery action'
    );
    concealAutomationUi(galleryAction, concealedSurfaces);
    activateControl(galleryAction, 'theme gallery action');

    const darkThemeChoice = await waitForGmailUi(
      () => findThemeChoice(NATIVE_THEME_IDS.dark),
      'the Dark theme choice'
    );
    concealAutomationUi(darkThemeChoice, concealedSurfaces);
    const themeDialog = darkThemeChoice.closest?.('[role="dialog"]') || document;
    activateControl(darkThemeChoice, 'Dark theme choice');

    const saveAction = await waitForGmailUi(
      () => findThemeSaveAction(themeDialog),
      'the theme Save action'
    );
    activateControl(saveAction, 'theme Save action');
    await waitForGmailRender();
    appliedNativeTheme = targetThemeId;
  } finally {
    for (const surface of concealedSurfaces) {
      surface.classList.remove(AUTOMATION_UI_CLASS);
    }

    if (!settingsWereOpen && settingsLauncher.getAttribute('aria-expanded') === 'true') {
      settingsLauncher.click();
    }
    document.documentElement.removeAttribute(AUTOMATION_ATTRIBUTE);

    if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
      previouslyFocused.focus({ preventScroll: true });
    }
  }
}

async function drainNativeThemeRequests() {
  while (requestedNativeTheme !== null) {
    const nextTheme = requestedNativeTheme;
    requestedNativeTheme = null;

    if (nextTheme !== appliedNativeTheme) {
      await setNativeGmailTheme(nextTheme);
    }
  }
}

function requestNativeTheme(targetThemeId) {
  requestedNativeTheme = targetThemeId;
  if (nativeThemeTask) {
    return nativeThemeTask;
  }

  nativeThemeTask = drainNativeThemeRequests()
    .catch(error => {
      appliedNativeTheme = null;
      console.warn('Gmail Dark Mode Switcher:', error.message);
    })
    .finally(() => {
      nativeThemeTask = null;
      if (requestedNativeTheme !== null) {
        requestNativeTheme(requestedNativeTheme);
      }
    });
  return nativeThemeTask;
}

function applyPreferredTheme(isDark) {
  setMessageContentTheme(isDark);
  return requestNativeTheme(
    isDark ? NATIVE_THEME_IDS.dark : NATIVE_THEME_IDS.light
  );
}

function synchronizeThemePreference() {
  return applyPreferredTheme(resolveDarkMode(themeMode, systemTheme.matches));
}

function handleSystemThemeChange() {
  if (themeMode === 'auto') {
    synchronizeThemePreference();
  }
}

if (typeof systemTheme.addEventListener === 'function') {
  systemTheme.addEventListener('change', handleSystemThemeChange);
} else {
  systemTheme.addListener(handleSystemThemeChange);
}

extensionApi.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.themeMode) {
    themeMode = normalizeThemeMode(changes.themeMode.newValue);
    synchronizeThemePreference();
  }
});

window.addEventListener('focus', () => {
  synchronizeThemePreference();
  scheduleSurfaceDecoration();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    synchronizeThemePreference();
    scheduleSurfaceDecoration();
  }
});

decorateGmailSurfaces();
if (typeof MutationObserver === 'function' && document.documentElement) {
  const surfaceObserver = new MutationObserver(scheduleSurfaceDecoration);
  surfaceObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

extensionApi.storage.local.get('themeMode')
  .then(data => {
    themeMode = normalizeThemeMode(data.themeMode);
    return synchronizeThemePreference();
  })
  .catch(error => console.warn('Gmail Dark Mode Switcher:', error.message));
