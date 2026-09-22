// 在样式表加载前同步设置主题，避免暗色首屏闪出亮色背景。
(() => {
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  let manuallySelected = false;

  function updateLabel() {
    const toggle = document.querySelector('.theme-toggle');
    if (!toggle) return;
    const dark = document.documentElement.dataset.theme === 'dark';
    const label = dark ? '切换至明亮主题：人之律者' : '切换至暗色主题：始源之律者';
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
  }

  function setTheme(dark) {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    updateLabel();
    document.dispatchEvent(new Event('login-theme-change'));
  }

  setTheme(systemTheme.matches);
  systemTheme.addEventListener('change', event => {
    if (!manuallySelected) setTheme(event.matches);
  });
  document.addEventListener('DOMContentLoaded', () => {
    updateLabel();
    document.querySelector('.theme-toggle').addEventListener('click', () => {
      manuallySelected = true;
      setTheme(document.documentElement.dataset.theme !== 'dark');
    });
  }, { once: true });
})();
