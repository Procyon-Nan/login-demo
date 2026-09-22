// 可调参数：修改后刷新页面生效；数量包含正在淡入、淡出和被遮挡的光点。
const DESKTOP_COUNT = 30; // 视口宽度 >= 600px 时的光点数量。
const MOBILE_COUNT = 25; // 视口宽度 < 600px 时的光点数量。
const LIFETIME_RANGE = [30, 60]; // 基础寿命范围，单位秒；每次出生随机取值。
// 上升速度范围，单位为每秒移动的视口高度比例；调小会延长留在屏幕内的时间。
const RISE_SPEED_RANGE = [.023, .034];
const SPAWN_Y_RANGE = [1 / 3, .98]; // 出生高度范围：0 为页顶、1 为页底，仅在下方三分之二区域出生。
const OCCLUSION_PADDING = 18; // 主体外围完全遮挡的留白，单位 px。
const OCCLUSION_FEATHER = 82; // 桌面遮挡边缘的渐变宽度，单位 px，越大吞没和显现越柔和。
const MOBILE_OCCLUSION_FEATHER = 40; // 窄屏的遮挡渐变宽度，单位 px。
const OCCLUSION_FADE_MS = 180; // 主体显隐时遮挡强度的平滑响应时间，单位 ms。
// 实际寿命仍受上边缘限制；被主体遮挡不会改变寿命或触发重生。
const TRAIL_STEPS = 48;
const random = (min, max) => min + Math.random() * (max - min);
const smoothstep = (a, b, value) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function createFireflies(canvas, reducedMotion, protectedElements) {
  const context = canvas.getContext('2d');
  let width = 0;
  let height = 0;
  let elapsed = 0;
  let previous = null;
  let request;
  let palette;
  let core;
  let flights = [];
  let active = false;
  const occluders = protectedElements.map(element => ({ element, opacity: null }));

  // 可拉伸的柔边遮罩：中心像素填满主体区域，四边与四角保留平滑渐变。
  const maskRadius = 64;
  const mask = document.createElement('canvas');
  mask.width = mask.height = maskRadius * 2 + 1;
  const maskContext = mask.getContext('2d');
  const center = maskRadius + .5;
  const feather = maskContext.createRadialGradient(center, center, 0, center, center, maskRadius);
  for (let i = 0; i <= 16; i++) {
    feather.addColorStop(i / 16, `rgba(0, 0, 0, ${1 - smoothstep(0, 1, i / 16)})`);
  }
  maskContext.fillStyle = feather;
  maskContext.fillRect(0, 0, mask.width, mask.height);

  function spawn(index, count) {
    const flight = {
      // 按横向分区错开出生点，每次重生重新抽取方向、弧度和寿命。
      x: (index + random(.1, .9)) / count,
      y: random(...SPAWN_Y_RANGE),
      rise: random(...RISE_SPEED_RANGE),
      drift: random(-.003, .003),
      sway: random(.045, .10),
      period: random(14, 24),
      phase: random(0, Math.PI * 2),
      lifetime: random(...LIFETIME_RANGE),
      fadeDuration: random(3, 6),
      tailDuration: random(5, 8),
      size: random(.65, 1.1),
      // 就位后错开淡入；减少动态效果时直接保留短尾迹的静态状态。
      born: elapsed + (reducedMotion.matches ? -2500 : random(0, 1800)),
    };
    // 任意高度出生，也在上边缘前淡出，避免离屏后长期占用光点名额。
    flight.lifetime = Math.min(flight.lifetime, (flight.y - .015) / flight.rise);
    flight.fadeDuration = Math.min(flight.fadeDuration, flight.lifetime * .35);
    return flight;
  }

  function point(flight, t) {
    const angle = flight.phase + t * Math.PI * 2 / flight.period;
    return {
      x: (flight.x + flight.drift * t) * width
        + (Math.sin(angle) - Math.sin(flight.phase)) * flight.sway * Math.min(width, 1000),
      y: (flight.y - flight.rise * t) * height,
    };
  }

  function drawFlight(flight, index) {
    const age = (elapsed - flight.born) / 1000;
    if (age < 0) return;
    if (age >= flight.lifetime) {
      flights[index] = spawn(index, flights.length);
      return;
    }
    const color = palette[index % palette.length];
    const size = flight.size * (width < 600 ? .8 : 1);
    const tail = Math.min(age, flight.tailDuration);
    const points = Array.from({ length: TRAIL_STEPS + 1 }, (_, i) =>
      point(flight, age - tail * (1 - i / TRAIL_STEPS)));
    const opacity = smoothstep(0, Math.min(2.5, flight.lifetime * .3), age)
      * (1 - smoothstep(flight.lifetime - flight.fadeDuration, flight.lifetime, age));
    const from = points[TRAIL_STEPS];
    const gradient = context.createLinearGradient(points[0].x, points[0].y, from.x, from.y);
    gradient.addColorStop(0, `rgba(${color}, 0)`);
    gradient.addColorStop(.4, `rgba(${color}, ${opacity * size * .12})`);
    gradient.addColorStop(1, `rgba(${color}, ${opacity * size * .65})`);
    // 一条连续、渐细的带状轮廓，避免分段描边接缝叠加成虚线。
    const edges = points.map((p, i) => {
      const before = points[Math.max(0, i - 1)];
      const after = points[Math.min(TRAIL_STEPS, i + 1)];
      const angle = Math.atan2(after.y - before.y, after.x - before.x);
      const halfWidth = (.04 + .55 * i / TRAIL_STEPS) * size;
      return { x: Math.sin(angle) * halfWidth, y: -Math.cos(angle) * halfWidth };
    });
    context.beginPath();
    points.forEach((p, i) => {
      const x = p.x + edges[i].x;
      const y = p.y + edges[i].y;
      if (i === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    for (let i = TRAIL_STEPS; i >= 0; i--) {
      context.lineTo(points[i].x - edges[i].x, points[i].y - edges[i].y);
    }
    context.closePath();
    context.fillStyle = gradient;
    context.fill();

    const radius = 13 * size;
    const glow = context.createRadialGradient(from.x, from.y, 0, from.x, from.y, radius);
    glow.addColorStop(0, `rgba(${color}, ${opacity * .65})`);
    glow.addColorStop(.22, `rgba(${color}, ${opacity * .33})`);
    glow.addColorStop(1, `rgba(${color}, 0)`);
    context.fillStyle = glow;
    context.fillRect(from.x - radius, from.y - radius, radius * 2, radius * 2);
    context.beginPath();
    context.arc(from.x, from.y, 1.15 * size, 0, Math.PI * 2);
    context.fillStyle = `rgba(${core}, ${opacity * .9})`;
    context.fill();
  }

  function applyOcclusion(delta) {
    const featherSize = width < 600 ? MOBILE_OCCLUSION_FEATHER : OCCLUSION_FEATHER;
    const source = [0, maskRadius, maskRadius + 1, mask.width];
    context.save();
    context.globalCompositeOperation = 'destination-out';
    context.fillStyle = '#000';
    for (const occluder of occluders) {
      const style = getComputedStyle(occluder.element);
      const target = style.visibility === 'hidden' ? 0 : Number(style.opacity);
      if (occluder.opacity === null || reducedMotion.matches) occluder.opacity = target;
      else occluder.opacity += (target - occluder.opacity) * (1 - Math.exp(-delta / OCCLUSION_FADE_MS));
      context.globalAlpha = occluder.opacity;
      const rect = occluder.element.getBoundingClientRect();
      const left = rect.left - OCCLUSION_PADDING;
      const right = rect.right + OCCLUSION_PADDING;
      const top = rect.top - OCCLUSION_PADDING;
      const bottom = rect.bottom + OCCLUSION_PADDING;
      const xs = [left - featherSize, left, right, right + featherSize];
      const ys = [top - featherSize, top, bottom, bottom + featherSize];
      for (let row = 0; row < 3; row++) {
        for (let column = 0; column < 3; column++) {
          if (row === 1 && column === 1) {
            // 实心区域直接填充，避免缩放采样留下极低透明度的残影。
            context.fillRect(left, top, right - left, bottom - top);
            continue;
          }
          context.drawImage(mask,
            source[column], source[row], source[column + 1] - source[column], source[row + 1] - source[row],
            xs[column], ys[row], xs[column + 1] - xs[column], ys[row + 1] - ys[row]);
        }
      }
    }
    context.restore();
  }

  function draw(delta = 0) {
    context.clearRect(0, 0, width, height);
    if (!active) return;
    flights.forEach(drawFlight);
    // 仅擦除落在主体后方的像素；外侧尾迹保留，移动出来后自然重新显现。
    applyOcclusion(delta);
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const count = width < 600 ? MOBILE_COUNT : DESKTOP_COUNT;
    if (active && flights.length !== count) flights = Array.from({ length: count }, (_, i) => spawn(i, count));
    draw();
  }

  function refreshTheme() {
    const style = getComputedStyle(document.documentElement);
    palette = ['--firefly-pink', '--firefly-violet'].map(name => style.getPropertyValue(name).trim());
    core = style.getPropertyValue('--firefly-core').trim();
    draw();
  }

  function tick(now) {
    const delta = previous === null ? 0 : Math.min(now - previous, 50);
    elapsed += delta;
    previous = now;
    draw(delta);
    request = requestAnimationFrame(tick);
  }

  function syncMotion() {
    cancelAnimationFrame(request);
    previous = null;
    if (active && !document.hidden && !reducedMotion.matches) request = requestAnimationFrame(tick);
    else draw();
  }

  function start() {
    if (active) return;
    active = true;
    resize();
    syncMotion();
  }

  function reset() {
    active = false;
    elapsed = 0;
    flights = [];
    occluders.forEach(occluder => { occluder.opacity = null; });
    syncMotion();
  }

  refreshTheme();
  resize();
  syncMotion();
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', syncMotion);
  reducedMotion.addEventListener('change', syncMotion);
  // 静态模式不申请动画帧，主体切换布局时仍更新遮挡区域。
  const observer = new MutationObserver(() => {
    if (reducedMotion.matches) draw();
  });
  observer.observe(protectedElements[0].closest('.login-scene'), { attributes: true, attributeFilter: ['data-phase'] });
  return { refreshTheme, start, reset };
}
