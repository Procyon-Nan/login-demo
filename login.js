import { createSignet } from './signet.js';

const form = document.querySelector('.terminal');
const input = document.querySelector('#token');
const submit = form.querySelector('button');
const status = form.querySelector('.terminal-status');
const inputLine = form.querySelector('.input-line');
const scene = document.querySelector('.login-scene');
let signet;
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
  signet?.refreshTheme();
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

// 刻印资源和传播场准备好后才允许提交，避免空白刻印直接进入业务页。
createSignet(document.querySelector('.signet-art')).then(renderer => {
  signet = renderer;
  if (getComputedStyle(inputLine).opacity === '1' || reducedMotion.matches) enableInput();
  else inputLine.addEventListener('animationend', enableInput, { once: true });
}).catch(error => {
  console.error('刻印资源初始化失败', error);
  status.textContent = '页面资源加载失败，请刷新重试';
});

form.addEventListener('submit', async (event) => {
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
  form.setAttribute('aria-busy', 'true');
  status.textContent = '';
  scene.classList.add('is-awakening');
  if (!await signet.play(reducedMotion)) return;
  scene.classList.add('is-lit');
  // 前 360ms 保持完整点亮，随后整体淡出，最后才进入业务页。
  await scene.animate([
    { opacity: 1, offset: 0 },
    { opacity: 1, offset: .5 },
    { opacity: 0, offset: 1 },
  ], { duration: reducedMotion.matches ? 0 : 720, fill: 'forwards' }).finished;
  window.location.assign('./dashboard.html');
});

input.addEventListener('input', () => {
  status.textContent = '';
});

window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    scene.getAnimations().forEach(animation => animation.cancel());
    signet?.reset();
    scene.classList.remove('is-awakening', 'is-lit');
    form.removeAttribute('aria-busy');
    status.textContent = '';
    input.value = '';
    if (signet) enableInput();
  }
});
