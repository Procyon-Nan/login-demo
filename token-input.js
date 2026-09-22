// 提示逐字出现的间隔；光标移动时长在 login.css 的 .token-caret 中调整。
const HINT_INTERVAL = 110;
const HINT = '请输入登陆密钥';

export function createTokenInput(input, reducedMotion) {
  const field = input.closest('.token-field');
  const measure = field.querySelector('.token-measure');
  const caret = field.querySelector('.token-caret');
  let hintTimer = 0;
  let caretFrame = 0;

  function stopHint() {
    window.clearTimeout(hintTimer);
    hintTimer = 0;
  }

  function updateCaret() {
    caretFrame = 0;
    if (input.disabled || document.activeElement !== input) return;
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? start;
    field.classList.toggle('has-selection', start !== end);
    const position = input.selectionDirection === 'backward' ? start : end;
    measure.textContent = '•'.repeat(Array.from(input.value.slice(0, position)).length);
    const x = measure.getBoundingClientRect().width - input.scrollLeft;
    // 两侧各留 2px，长密钥横向滚动后光标仍处于可见的输入范围。
    field.style.setProperty('--caret-x', `${Math.max(0, Math.min(x, input.clientWidth - 4))}px`);
    // 输入或移动插入点时重新保持高亮，停顿后再继续闪动。
    const blink = caret.getAnimations().find(animation => animation.animationName === 'caret-blink');
    if (blink) blink.currentTime = 0;
  }

  function scheduleCaret() {
    if (!caretFrame) caretFrame = requestAnimationFrame(updateCaret);
  }

  function start() {
    stopHint();
    if (document.activeElement === input || input.value) return;
    input.placeholder = '';
    let length = 0;
    function typeNext() {
      input.placeholder = HINT.slice(0, ++length);
      hintTimer = length < HINT.length ? window.setTimeout(typeNext, HINT_INTERVAL) : 0;
    }
    if (reducedMotion.matches) input.placeholder = HINT;
    else typeNext();
  }

  function reset() {
    stopHint();
    cancelAnimationFrame(caretFrame);
    caretFrame = 0;
    input.placeholder = '';
    measure.textContent = '';
    field.classList.remove('has-selection');
    field.style.setProperty('--caret-x', '0px');
  }

  field.classList.add('has-custom-caret');
  input.addEventListener('focus', () => {
    stopHint();
    input.placeholder = '';
    scheduleCaret();
  });
  input.addEventListener('blur', () => {
    if (!input.disabled) input.placeholder = HINT;
  });
  for (const event of ['input', 'select', 'keyup', 'click', 'scroll']) {
    input.addEventListener(event, scheduleCaret);
  }
  document.addEventListener('selectionchange', scheduleCaret);
  new ResizeObserver(scheduleCaret).observe(input);
  document.fonts.ready.then(scheduleCaret);
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches && hintTimer) {
      stopHint();
      input.placeholder = HINT;
    }
  });

  return { start, reset };
}
