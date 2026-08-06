(() => {
  'use strict';

  const MOBILE_BREAKPOINT = 760;
  const body = document.body;
  const sidebar = document.querySelector('.sidebar');
  const topbar = document.querySelector('.topbar');
  const nav = document.getElementById('nav');
  const content = document.getElementById('content');

  if (!body || !sidebar || !topbar || !nav || document.getElementById('mobileMenuButton')) {
    return;
  }

  const menuButton = document.createElement('button');
  menuButton.type = 'button';
  menuButton.id = 'mobileMenuButton';
  menuButton.className = 'mobile-menu-button';
  menuButton.setAttribute('aria-label', 'Open GarageLog navigation');
  menuButton.setAttribute('aria-controls', 'nav');
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16"></path>
    </svg>`;

  const pageTitle = document.createElement('strong');
  pageTitle.className = 'mobile-page-title';
  pageTitle.setAttribute('aria-live', 'polite');
  pageTitle.textContent = 'GarageLog';

  const backdrop = document.createElement('button');
  backdrop.type = 'button';
  backdrop.className = 'mobile-nav-backdrop';
  backdrop.setAttribute('aria-label', 'Close GarageLog navigation');

  topbar.insertBefore(pageTitle, topbar.firstChild);
  topbar.insertBefore(menuButton, pageTitle);
  document.body.appendChild(backdrop);

  function isMobile() {
    return window.innerWidth <= MOBILE_BREAKPOINT;
  }

  function updatePageTitle() {
    const activeLabel = nav.querySelector('.nav-btn.active span')?.textContent?.trim();
    const pageHeading = content?.querySelector('.page-head h1')?.textContent?.trim();
    pageTitle.textContent = activeLabel || pageHeading || 'GarageLog';
  }

  function openNavigation() {
    if (!isMobile()) return;
    body.classList.add('mobile-nav-open');
    menuButton.setAttribute('aria-expanded', 'true');
    menuButton.setAttribute('aria-label', 'Close GarageLog navigation');
    requestAnimationFrame(() => {
      sidebar.querySelector('.nav-btn.active, .nav-btn')?.focus({ preventScroll: true });
    });
  }

  function closeNavigation({ restoreFocus = false } = {}) {
    const wasOpen = body.classList.contains('mobile-nav-open');
    body.classList.remove('mobile-nav-open');
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', 'Open GarageLog navigation');
    if (restoreFocus && wasOpen) menuButton.focus({ preventScroll: true });
  }

  menuButton.addEventListener('click', () => {
    if (body.classList.contains('mobile-nav-open')) {
      closeNavigation({ restoreFocus: true });
    } else {
      openNavigation();
    }
  });

  backdrop.addEventListener('click', () => closeNavigation({ restoreFocus: true }));

  nav.addEventListener('click', event => {
    if (event.target.closest('[data-page]')) {
      window.setTimeout(() => {
        closeNavigation();
        updatePageTitle();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }, 0);
    }
  });

  sidebar.addEventListener('click', event => {
    if (event.target.closest('[data-action], #sidebarVehicle')) {
      window.setTimeout(() => closeNavigation(), 0);
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && body.classList.contains('mobile-nav-open')) {
      event.preventDefault();
      closeNavigation({ restoreFocus: true });
    }
  });

  window.addEventListener('resize', () => {
    if (!isMobile()) closeNavigation();
    updatePageTitle();
  });

  const navObserver = new MutationObserver(updatePageTitle);
  navObserver.observe(nav, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

  if (content) {
    const contentObserver = new MutationObserver(updatePageTitle);
    contentObserver.observe(content, { childList: true, subtree: true });
  }

  updatePageTitle();
})();
