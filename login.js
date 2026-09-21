const form = document.querySelector('.terminal');
const input = document.querySelector('#token');
const submit = form.querySelector('button');
const status = form.querySelector('.terminal-status');
const inputLine = form.querySelector('.input-line');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const themeToggle = document.querySelector('.theme-toggle');
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
let themeManuallySelected = false;

// 固定、稀疏的分布避免刷新和主题切换时随机跳变；手机端再减半。
const stars = document.querySelector('.stars');
const starFragment = document.createDocumentFragment();
for (let index = 0; index < 36; index += 1) {
  const star = document.createElement('span');
  star.className = 'star';
  star.style.cssText = `
    --x: ${4 + ((index * 37) % 93)}%;
    --y: ${5 + ((index * 23) % 89)}%;
    --size: ${index % 5 === 0 ? 2 : 1}px;
    --opacity: ${.18 + (index % 4) * .07};
    --star-color: ${['#F8EEF7', '#B8A2E8', '#F1B8D8', '#B9E8F5'][index % 4]};
    --duration: ${26 + (index % 5) * 4}s;
    --delay: -${index * 1.7}s;
  `;
  starFragment.append(star);
}
stars.append(starFragment);

function syncBackgroundMotion() {
  document.body.toggleAttribute('data-background-paused', document.hidden);
}
document.addEventListener('visibilitychange', syncBackgroundMotion);
syncBackgroundMotion();

function setTheme(dark) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const label = dark ? '切换至明亮主题：人之律者' : '切换至暗色主题：始源之律者';
  themeToggle.setAttribute('aria-label', label);
  themeToggle.title = label;
}

setTheme(systemTheme.matches);
themeToggle.addEventListener('click', () => {
  themeManuallySelected = true;
  setTheme(document.documentElement.dataset.theme !== 'dark');
});
systemTheme.addEventListener('change', (event) => {
  if (!themeManuallySelected) setTheme(event.matches);
});

function enableInput() {
  input.disabled = false;
  submit.disabled = false;
  // 桌面端动画完成后聚焦；触屏设备由用户点击，避免自动弹出键盘。
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    input.focus({ preventScroll: true });
  }
}

// 动画可能在脚本执行前结束，读取状态以避免输入框一直处于禁用状态。
if (getComputedStyle(inputLine).opacity === '1' || reducedMotion.matches) {
  enableInput();
} else {
  inputLine.addEventListener('animationend', enableInput, { once: true });
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (submit.disabled) return;
  if (!input.value.trim()) {
    status.textContent = '请输入 token';
    input.focus();
    return;
  }

  // 仅演示页面跳转：不校验、不保存、不发送 token。
  input.value = '';
  input.disabled = true;
  submit.disabled = true;
  status.textContent = 'opening workspace…';
  window.setTimeout(() => {
    form.classList.add('is-leaving');
    window.setTimeout(() => {
      window.location.assign('./dashboard.html');
    }, reducedMotion.matches ? 0 : 300);
  }, reducedMotion.matches ? 0 : 350);
});

input.addEventListener('input', () => {
  status.textContent = '';
});

window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    form.classList.remove('is-leaving');
    status.textContent = '';
    input.value = '';
    enableInput();
  }
});
