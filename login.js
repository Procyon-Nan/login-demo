import { createSignet } from './signet.js';
import { createFireflies } from './fireflies.js';
import { createTokenInput } from './token-input.js';

const form = document.querySelector('.terminal');
const input = document.querySelector('#token');
const status = form.querySelector('.terminal-status');
const signetElement = document.querySelector('.signet');
const scene = document.querySelector('.login-scene');
const signature = document.querySelector('.signature');
const signetCanvas = document.querySelector('.signet-art');
const signetMotion = document.querySelector('.signet-motion');
const signetIdleGlow = document.querySelector('.signet-idle-glow');
const debugStart = document.querySelector('#debug-start');
const debugReset = document.querySelector('#debug-reset');
let signet;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const tokenInput = createTokenInput(input, reducedMotion);
const fireflies = createFireflies(document.querySelector('.fireflies'), reducedMotion, [signetElement, form, signature]);
const themeToggle = document.querySelector('.theme-toggle');
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
let themeManuallySelected = false;
const IDLE_PERIOD = 5500;
let idleAnimations = [];
let flowId = 0;
debugReset.disabled = false;

function syncSignetMotion() {
  for (const animation of idleAnimations) {
    if (animation.playState === 'finished') continue;
    if (document.hidden) animation.pause();
    else animation.play();
  }
}

function stopIdleMotion() {
  idleAnimations.forEach(animation => animation.cancel());
  idleAnimations = [];
}

function startIdleMotion() {
  stopIdleMotion();
  if (reducedMotion.matches) return;
  // 同帧启动、共用周期与分段缓动：最高点最亮，最低点最暗。
  const timing = { duration: IDLE_PERIOD, iterations: Infinity, easing: 'linear' };
  idleAnimations = [
    signetMotion.animate([
      { transform: 'translateY(0px)', easing: 'ease-in-out' },
      { transform: 'translateY(-7px)', easing: 'ease-in-out' },
      { transform: 'translateY(0px)' },
    ], timing),
    signetIdleGlow.animate([
      { opacity: 0, easing: 'ease-in-out' },
      { opacity: 1, easing: 'ease-in-out' },
      { opacity: 0 },
    ], timing),
  ];
  syncSignetMotion();
}

// 提交瞬间把下降半周期镜像到上升半周期；位置与亮度相同，只改变方向。
function riseToIdlePeak() {
  if (reducedMotion.matches) { stopIdleMotion(); return Promise.resolve(true); }
  const phase = (idleAnimations[0]?.currentTime ?? 0) % IDLE_PERIOD;
  const risingTime = Math.min(phase, IDLE_PERIOD - phase);
  stopIdleMotion();
  const timing = { duration: IDLE_PERIOD / 2, easing: 'ease-in-out', fill: 'forwards' };
  idleAnimations = [
    signetMotion.animate([{ transform: 'translateY(0px)' }, { transform: 'translateY(-7px)' }], timing),
    signetIdleGlow.animate([{ opacity: 0 }, { opacity: 1 }], timing),
  ];
  idleAnimations.forEach(animation => { animation.currentTime = risingTime; });
  syncSignetMotion();
  // 达峰后保持当前位置和柔光，等归中完成再由渲染器逐笔接续。
  return Promise.all(idleAnimations.map(animation => animation.finished.then(() => true, () => false)))
    .then(results => results.every(Boolean));
}

reducedMotion.addEventListener('change', () => {
  if (!signet) return;
  if (scene.matches('.is-awakening, .is-lit')) {
    // 登录途中切换为减少动态效果，直接完成有限的上升，不重新启动循环。
    if (reducedMotion.matches) idleAnimations.forEach(animation => animation.finish());
  } else startIdleMotion();
});

document.addEventListener('visibilitychange', syncSignetMotion);

function setTheme(dark) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const label = dark ? '切换至明亮主题：人之律者' : '切换至暗色主题：始源之律者';
  themeToggle.setAttribute('aria-label', label);
  themeToggle.title = label;
  signet?.refreshTheme();
  fireflies.refreshTheme();
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
  debugStart.disabled = false;
  debugReset.disabled = false;
  tokenInput.start();
}

// 每段等待实际动画结束；流程编号阻止重置前的异步任务继续点亮或跳转。
async function runPhase(phase, element, run, subtree = false) {
  if (run !== flowId) return false;
  scene.dataset.phase = phase;
  const animations = element.getAnimations({ subtree });
  await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
  return run === flowId;
}

async function enterLogin() {
  const run = ++flowId;
  fireflies.reset();
  tokenInput.reset();
  input.disabled = true;
  debugStart.disabled = true;
  startIdleMotion();
  if (!await runPhase('entering', signetElement, run)) return;
  // 等字标和两侧横线实际完成，再让刻印离开中央。
  await Promise.all(signature.getAnimations({ subtree: true })
    .map(animation => animation.finished.catch(() => {})));
  if (!await runPhase('shifting', signetElement, run)) return;
  if (!await runPhase('opening', form, run, true)) return;
  scene.dataset.phase = 'ready';
  fireflies.start();
  enableInput();
}

// 资源准备好后先在中央显现刻印，左移完成后才展开输入框。
createSignet(signetCanvas, signetIdleGlow).then(renderer => {
  signet = renderer;
  return enterLogin();
}).catch(error => {
  console.error('刻印资源初始化失败', error);
  scene.dataset.phase = 'ready';
  status.textContent = '页面资源加载失败，请刷新重试';
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (input.disabled) return;
  if (!input.value.trim()) {
    status.textContent = '请输入登陆密钥';
    input.focus();
    return;
  }

  await playSignet(false);
});

async function playSignet(preview) {
  if (debugStart.disabled) return;
  const run = ++flowId;
  // 重播从未亮状态开始；正常登录直接承接当前轮廓及柔光。
  const replay = scene.dataset.phase === 'lit';
  if (replay) {
    signet.reset();
    startIdleMotion();
  }
  scene.classList.remove('is-lit');
  const peakReady = riseToIdlePeak();
  // 上升与输入框收起、刻印归中同时进行，二者完成后再点亮。
  input.value = '';
  input.blur();
  input.disabled = true;
  tokenInput.reset();
  debugStart.disabled = true;
  form.setAttribute('aria-busy', 'true');
  status.textContent = '';
  scene.classList.add('is-awakening');
  if (!replay) {
    if (!await runPhase('closing', form, run, true)) return;
    if (!await runPhase('centering', signetElement, run)) return;
  }
  scene.dataset.phase = 'waiting-peak';
  if (!await peakReady || run !== flowId) return;
  scene.dataset.phase = 'lighting';
  if (!await signet.play(reducedMotion) || run !== flowId) return;
  scene.classList.add('is-lit');
  scene.dataset.phase = 'lit';
  if (preview) {
    scene.classList.remove('is-awakening');
    form.removeAttribute('aria-busy');
    debugStart.disabled = false;
    return;
  }
  // 前 360ms 保持完整点亮，随后整体淡出，最后才进入业务页。
  const completed = await scene.animate([
    { opacity: 1, offset: 0 },
    { opacity: 1, offset: .5 },
    { opacity: 0, offset: 1 },
  ], { duration: reducedMotion.matches ? 0 : 720, fill: 'forwards' }).finished.then(() => true, () => false);
  if (completed && run === flowId) window.location.assign('./dashboard.html');
}

function resetLogin() {
  flowId += 1;
  stopIdleMotion();
  scene.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
  signet?.reset();
  scene.classList.remove('is-awakening', 'is-lit');
  scene.dataset.phase = 'loading';
  form.removeAttribute('aria-busy');
  status.textContent = '';
  input.value = '';
  // 后退恢复时先落到隐藏、居中的初始布局，再重新入场。
  signetElement.style.transition = 'none';
  getComputedStyle(signetElement).translate;
  signetElement.style.transition = '';
  if (signet) enterLogin();
}

debugStart.addEventListener('click', () => playSignet(true));
debugReset.addEventListener('click', () => window.location.reload());

input.addEventListener('input', () => {
  status.textContent = '';
});

window.addEventListener('pageshow', (event) => {
  if (event.persisted) resetLogin();
});
