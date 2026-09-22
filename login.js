import { createSignet } from './signet.js';
import { createFireflies } from './fireflies.js';
import { createTokenInput } from './token-input.js';

const form = document.querySelector('.terminal');
const input = document.querySelector('#token');
const status = form.querySelector('.terminal-status');
const welcome = form.querySelector('.terminal-welcome');
const welcomeText = welcome.querySelector('span');
const failureMeter = form.querySelector('.failure-meter');
const failureSegments = failureMeter.querySelectorAll('.failure-segments > span');
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
const DEMO_KEY = '123'; // 本地演示密钥，仅在前端比较。
const MAX_FAILURES = 5; // 本轮最多允许的错误提交次数，重置页面后清零。
const IDLE_PERIOD = 5500;
let idleAnimations = [];
let inputShake;
let failedAttempts = 0;
let flowId = 0;
debugReset.disabled = false;

function syncSignetMotion() {
  for (const animation of idleAnimations) {
    if (animation.playState === 'finished') continue;
    if (document.hidden || scene.classList.contains('is-locked')) animation.pause();
    else animation.play();
  }
  signet?.syncMotion();
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
  if (reducedMotion.matches) inputShake?.cancel();
  if (!signet) return;
  signet.syncMotion();
  if (scene.matches('.is-awakening, .is-lit')) {
    // 登录途中切换为减少动态效果，直接完成有限的上升，不重新启动循环。
    if (reducedMotion.matches) idleAnimations.forEach(animation => animation.finish());
  } else if (!scene.classList.contains('is-locked')) startIdleMotion();
  else if (reducedMotion.matches) stopIdleMotion();
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

function shakeInput() {
  inputShake?.cancel();
  if (reducedMotion.matches) return;
  // 整个输入框左右衰减抖动：位移单位为 px，总时长为 ms。
  inputShake = form.animate(
    [0, -8, 7, -5, 3, -1, 0].map(x => ({
      transform: `translateX(${x}px)`,
      easing: 'ease-in-out',
    })),
    { duration: 420 },
  );
}

function updateFailureMeter() {
  failureMeter.setAttribute('aria-valuenow', failedAttempts);
  failureMeter.setAttribute('aria-valuetext', `已输错 ${failedAttempts} 次，最多 ${MAX_FAILURES} 次`);
  failureSegments.forEach((segment, index) => segment.classList.toggle('is-lit', index < failedAttempts));
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
  failedAttempts = 0;
  updateFailureMeter();
  scene.classList.remove('is-locked');
  inputShake?.cancel();
  fireflies.reset();
  tokenInput.reset();
  welcomeText.textContent = '';
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
  if (input.disabled || failedAttempts >= MAX_FAILURES) return;
  if (input.value !== DEMO_KEY) {
    shakeInput();
    const run = flowId;
    const exhausted = ++failedAttempts === MAX_FAILURES;
    updateFailureMeter();
    if (exhausted) {
      scene.classList.add('is-locked');
      input.disabled = true;
      input.blur();
      tokenInput.reset();
      debugStart.disabled = true;
    }
    if (await signet.breakApart(failedAttempts, reducedMotion) && exhausted && run === flowId) {
      // 保留当前整体位置与柔光，后续由每块晶片独立漂浮，不突然回落。
      idleAnimations.forEach(animation => animation.pause());
      input.value = '';
      welcomeText.textContent = '错误次数过多，请稍后刷新重试';
      scene.dataset.phase = 'exhausted';
    }
    return;
  }
  await playSignet(false);
});

async function playSignet(preview) {
  if (debugStart.disabled) return;
  inputShake?.cancel();
  const run = ++flowId;
  // 重播从未亮状态开始；正常登录直接承接当前轮廓及柔光。
  const replay = scene.dataset.phase === 'lit';
  if (replay) {
    signet.reset();
    startIdleMotion();
  }
  scene.classList.remove('is-lit');
  const peakReady = riseToIdlePeak();
  // 上升与欢迎文字、输入框收起及刻印归中并行，全部完成后再点亮。
  input.value = '';
  input.blur();
  input.disabled = true;
  tokenInput.reset();
  debugStart.disabled = true;
  form.setAttribute('aria-busy', 'true');
  status.textContent = '';
  scene.classList.add('is-awakening');
  if (!replay) {
    welcomeText.textContent = '欢迎回来';
    if (!await runPhase('welcoming', welcome, run, true)) return;
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

// 长按回车只算一次提交；动画中仍可修改输入或再次主动提交。
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.repeat) event.preventDefault();
});

window.addEventListener('pageshow', (event) => {
  if (event.persisted) resetLogin();
});
