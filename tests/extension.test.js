'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');
const contentSource = fs.readFileSync(path.join(projectRoot, 'content.js'), 'utf8');

function loadContentScript() {
  const state = {
    attributes: new Set(),
    classes: new Set(),
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const documentElement = {
    classList: {
      contains(name) {
        return state.classes.has(name);
      },
      toggle(name, enabled) {
        if (enabled) {
          state.classes.add(name);
        } else {
          state.classes.delete(name);
        }
      }
    },
    removeAttribute(name) {
      state.attributes.delete(name);
    },
    setAttribute(name) {
      state.attributes.add(name);
    }
  };
  const document = {
    activeElement: null,
    documentElement,
    hidden: false,
    addEventListener() {},
    querySelector(selector) {
      return state.querySelector(selector);
    },
    querySelectorAll(selector) {
      return state.querySelectorAll(selector);
    }
  };
  const mediaQuery = {
    matches: false,
    addEventListener() {},
    addListener() {}
  };
  const neverResolves = new Promise(() => {});
  const browser = {
    storage: {
      local: {
        get() {
          return neverResolves;
        }
      },
      onChanged: {
        addListener() {}
      }
    }
  };
  const window = {
    addEventListener() {},
    getComputedStyle(element = {}) {
      return {
        backgroundColor: element.backgroundColor || 'rgba(0, 0, 0, 0)',
        backgroundImage: element.backgroundImage || 'none',
        display: 'block',
        visibility: 'visible'
      };
    },
    matchMedia() {
      return mediaQuery;
    },
    clearTimeout,
    setTimeout
  };

  class HTMLElement {}

  const context = vm.createContext({
    browser,
    console,
    document,
    HTMLElement,
    setTimeout,
    window
  });
  vm.runInContext(contentSource, context, { filename: 'content.js' });

  return { context, document, state };
}

test('manifest uses only storage and no background page', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'manifest.json'), 'utf8')
  );

  assert.deepEqual(manifest.permissions, ['storage']);
  assert.equal(manifest.background, undefined);
  assert.deepEqual(
    manifest.content_scripts[0].matches,
    ['https://mail.google.com/*']
  );
});

test('theme modes resolve Auto, Light, and Dark correctly', () => {
  const { context } = loadContentScript();

  assert.equal(vm.runInContext("normalizeThemeMode('dark')", context), 'dark');
  assert.equal(vm.runInContext("normalizeThemeMode('invalid')", context), 'auto');
  assert.equal(vm.runInContext("resolveDarkMode('dark', false)", context), true);
  assert.equal(vm.runInContext("resolveDarkMode('light', true)", context), false);
  assert.equal(vm.runInContext("resolveDarkMode('auto', true)", context), true);
  assert.equal(vm.runInContext("resolveDarkMode('auto', false)", context), false);
});

test('native theme controller uses explicit choices and DOM observation', () => {
  const { context } = loadContentScript();

  assert.equal(vm.runInContext('NATIVE_THEME_IDS.light', context), 'basicwhite');
  assert.equal(vm.runInContext('NATIVE_THEME_IDS.dark', context), 'basicblack');
  assert.match(contentSource, /function waitForGmailUi/);
  assert.match(contentSource, /new MutationObserver\(inspect\)/);
});

test('message inversion class follows the resolved extension mode', () => {
  const { context, state } = loadContentScript();

  vm.runInContext('setMessageContentTheme(true)', context);
  assert.equal(state.classes.has('gmail-message-dark-mode'), true);

  vm.runInContext('setMessageContentTheme(false)', context);
  assert.equal(state.classes.has('gmail-message-dark-mode'), false);
});

test('surface detection distinguishes light, dark, and image backgrounds', () => {
  const { context } = loadContentScript();
  context.__light = { backgroundColor: 'rgb(245, 245, 245)' };
  context.__dark = { backgroundColor: 'rgb(30, 30, 30)' };
  context.__transparent = { backgroundColor: 'rgba(255, 255, 255, 0)' };
  context.__image = {
    backgroundColor: 'rgb(255, 255, 255)',
    backgroundImage: 'url("message.png")'
  };

  assert.equal(vm.runInContext('isLightSurface(__light)', context), true);
  assert.equal(vm.runInContext('isLightSurface(__dark)', context), false);
  assert.equal(vm.runInContext('isLightSurface(__transparent)', context), false);
  assert.equal(vm.runInContext('isLightSurface(__image, true)', context), false);
});

test('message decoration marks the real item and ancestor surfaces', () => {
  const { context } = loadContentScript();

  function createSurface(parentElement, isMain = false) {
    const classes = new Set();
    return {
      classes,
      parentElement,
      classList: {
        add: (...names) => names.forEach(name => classes.add(name)),
        contains: name => classes.has(name)
      },
      matches: selector => isMain && selector === '[role="main"]',
      querySelectorAll: () => []
    };
  }

  const main = createSurface(null, true);
  const wrapper = createSurface(main);
  const item = createSurface(wrapper);
  context.__messageBody = {
    closest: selector => selector === '[role="listitem"]' ? item : null,
    contains: () => false,
    parentElement: item
  };

  vm.runInContext('decorateMessageBody(__messageBody)', context);

  assert.equal(item.classes.has('gmail-theme-message-item'), true);
  assert.equal(item.classes.has('gmail-theme-message-surface'), true);
  assert.equal(wrapper.classes.has('gmail-theme-message-surface'), true);
  assert.equal(main.classes.has('gmail-theme-message-surface'), true);
});

test('conversation decoration darkens light UI but protects the email body', () => {
  const { context } = loadContentScript();

  function createCandidate(backgroundColor, insideMessage = false) {
    const classes = new Set();
    return {
      backgroundColor,
      classes,
      classList: {
        add: (...names) => names.forEach(name => classes.add(name))
      },
      closest: selector => insideMessage && selector === '.a3s.aiL' ? {} : null,
      matches: () => false
    };
  }

  const messageBody = createCandidate('rgb(255, 255, 255)', true);
  const replyFooter = createCandidate('rgb(255, 255, 255)');
  const conversation = createCandidate('rgb(255, 255, 255)');
  conversation.querySelectorAll = () => [messageBody, replyFooter];
  context.__conversation = conversation;

  vm.runInContext('decorateConversation(__conversation)', context);

  assert.equal(conversation.classes.has('gmail-theme-conversation'), true);
  assert.equal(conversation.classes.has('gmail-theme-message-surface'), true);
  assert.equal(replyFooter.classes.has('gmail-theme-message-surface'), true);
  assert.equal(messageBody.classes.has('gmail-theme-message-surface'), false);
});

test('compose decoration marks its shell and discovered light panels', () => {
  const { context } = loadContentScript();

  function createCandidate(backgroundColor, selectorMatch = false) {
    const classes = new Set();
    return {
      backgroundColor,
      classes,
      classList: { add: name => classes.add(name) },
      matches: () => selectorMatch
    };
  }

  const lightHeader = createCandidate('rgb(240, 244, 249)');
  const darkPanel = createCandidate('rgb(26, 26, 26)');
  const image = createCandidate('rgb(255, 255, 255)', true);
  const shell = createCandidate('rgb(255, 255, 255)');
  shell.querySelectorAll = () => [lightHeader, darkPanel, image];

  context.__editor = {
    closest: selector => selector === '.M9' ? shell : null,
    contains: () => false
  };

  vm.runInContext('decorateComposeEditor(__editor)', context);

  assert.equal(shell.classes.has('gmail-theme-compose-shell'), true);
  assert.equal(shell.classes.has('gmail-theme-light-surface'), true);
  assert.equal(lightHeader.classes.has('gmail-theme-light-surface'), true);
  assert.equal(darkPanel.classes.has('gmail-theme-light-surface'), false);
  assert.equal(image.classes.has('gmail-theme-light-surface'), false);
});

test('native theme queue applies light once and restores Gmail controls', async () => {
  const { context, state } = loadContentScript();
  let settingsClicks = 0;
  let tileClicks = 0;
  let settingsOpen = false;

  const settingsButton = {
    click() {
      settingsClicks += 1;
      settingsOpen = !settingsOpen;
    },
    getAttribute(name) {
      return name === 'aria-expanded' && settingsOpen ? 'true' : null;
    },
    getClientRects() {
      return [{}];
    }
  };
  const themeTile = {
    click() {
      tileClicks += 1;
    },
    closest() {
      return themeTile;
    },
    getClientRects() {
      return [{}];
    }
  };

  state.querySelector = selector => selector.includes('Settings')
    ? settingsButton
    : null;
  state.querySelectorAll = selector => selector.includes('data-theme-id="basicwhite"')
    ? [themeTile]
    : [];

  await vm.runInContext("requestNativeTheme('basicwhite')", context);
  await vm.runInContext("requestNativeTheme('basicwhite')", context);

  assert.equal(settingsClicks, 2);
  assert.equal(tileClicks, 1);
  assert.equal(settingsOpen, false);
  assert.equal(state.attributes.has('data-gmail-native-theme-busy'), false);
});

test('switching to dark selects and saves Gmail native dark theme', async () => {
  const { context, state } = loadContentScript();
  let settingsOpen = false;
  let viewAllClicks = 0;
  let themeClicks = 0;
  let saveClicks = 0;

  const visibleElement = {
    getClientRects() {
      return [{}];
    }
  };
  const settingsButton = {
    ...visibleElement,
    click() {
      settingsOpen = !settingsOpen;
    },
    getAttribute(name) {
      return name === 'aria-expanded' && settingsOpen ? 'true' : null;
    }
  };
  const viewAllButton = {
    ...visibleElement,
    click() {
      viewAllClicks += 1;
    }
  };
  const saveButton = {
    ...visibleElement,
    textContent: 'Save',
    click() {
      saveClicks += 1;
    },
    hasAttribute() {
      return false;
    }
  };
  const dialog = {
    querySelectorAll() {
      return [saveButton];
    }
  };
  const themeElement = {
    ...visibleElement,
    click() {
      themeClicks += 1;
    },
    closest(selector) {
      return selector === '[role="dialog"]' ? dialog : themeElement;
    }
  };
  const themeSection = {
    parentElement: null,
    querySelectorAll() {
      return [viewAllButton];
    }
  };
  const defaultThemeTile = { ...visibleElement, parentElement: themeSection };

  state.querySelector = selector => {
    if (selector.includes('Settings')) {
      return settingsButton;
    }
    if (selector.includes('data-theme-id="basicwhite"')) {
      return defaultThemeTile;
    }
    return null;
  };
  state.querySelectorAll = selector => {
    if (selector.includes('basicwhite')) {
      return [defaultThemeTile];
    }
    if (selector.includes('basicblack')) {
      return [themeElement];
    }
    return [];
  };

  await vm.runInContext("setNativeGmailTheme('basicblack')", context);

  assert.equal(viewAllClicks, 1);
  assert.equal(themeClicks, 1);
  assert.equal(saveClicks, 1);
  assert.equal(settingsOpen, false);
  assert.equal(state.attributes.has('data-gmail-native-theme-busy'), false);
});

test('Gmail stylesheet combines message inversion with dark outer canvases', () => {
  const styles = fs.readFileSync(path.join(projectRoot, 'styles.css'), 'utf8');

  assert.match(styles, /\.ii\.gt \.a3s\.aiL/);
  assert.match(styles, /\.aUU/);
  assert.match(styles, /\.gmail-theme-message-surface/);
  assert.match(styles, /\.gmail-theme-conversation/);
  assert.match(styles, /\.M9/);
  assert.match(styles, /\.gmail-theme-compose-shell/);
  assert.match(styles, /\.gmail-theme-light-surface/);
  assert.match(styles, /gmail-theme-compose-shell > :first-child/);
  assert.match(styles, /\.aoT/);
  assert.match(styles, /\.Am\[contenteditable="true"\]/);
  assert.match(
    styles,
    /\.gmail-theme-compose-shell\s+\[contenteditable="true"\] :not\(a\)/
  );
  assert.match(
    styles,
    /-webkit-text-fill-color: var\(--gmail-content-text\) !important;/
  );
  assert.match(styles, /--gmail-content-link: #8ab4f8/);
  assert.match(styles, /:is\(img, video, iframe, canvas, svg\)/);
  assert.doesNotMatch(styles, /\.LW-avf/);
  assert.doesNotMatch(
    styles,
    /html\.gmail-message-dark-mode\s*\{[^}]*filter\s*:/i
  );
  assert.match(styles, /data-gmail-native-theme-busy/);
  assert.match(styles, /gmail-native-theme-automation-ui/);
});

test('compose options menus and nested submenus use readable dark colors', () => {
  const styles = fs.readFileSync(path.join(projectRoot, 'styles.css'), 'utf8');

  assert.match(styles, /\.J-M\[role="menu"\]/);
  assert.match(styles, /\.J-N \.J-N-Jz/);
  assert.match(styles, /\.J-N-JE/);
  assert.match(styles, /\[aria-disabled="true"\]/);
  assert.match(styles, /\.J-Kh/);
  assert.match(styles, /\.J-N-JX/);
});
