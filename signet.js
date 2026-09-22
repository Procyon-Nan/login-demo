import { createSignetFracture } from './signet-fracture.js';

// 在原图内部计算连续到达时间场；渲染阶段只改变同一批像素的充盈度。
const FIELD_SIZE = 192;
const RENDER_SIZE = 640;
// 对应 CSS 的 17.5% 外扩，让原图自带的泛光完整落在画布内。
const ART_PADDING = 112;
const ART_SIZE = 640 + ART_PADDING * 2;
// 点亮时长，单位毫秒：数值越小越快，例如 1500 = 1.5 秒。
// 仅控制笔画充盈与原生泛光，不含输入框收起、刻印归中和向最亮状态上升的时间。
const LIGHT_DURATION = 2000;
// 前四次裂痕生长、第五次绷紧并解体的时长，单位毫秒。
const FRACTURE_DURATION = 1200;
const SHATTER_DURATION = 1700;
const smoothstep = (start, end, value) => {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
};

async function loadImage(url) {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

function sampleImage(image, size) {
  const surface = document.createElement('canvas');
  surface.width = surface.height = size;
  const context = surface.getContext('2d', { willReadFrequently: true });
  const scale = size / ART_SIZE;
  // 用实心区域定位，但绘制整张原图，保留外围泛光的 RGB 和透明度。
  const sx = 615 / 2744;
  const sy = 602 / 2684;
  context.drawImage(image, (ART_PADDING + 16 - 497 * sx) * scale,
    (ART_PADDING + 23 - 537 * sy) * scale, image.width * sx * scale, image.height * sy * scale);
  return context.getImageData(0, 0, size, size).data;
}

function solidAlpha(pixels, offset) {
  // 仅识别用于传播的实心笔画；洋红色半透明像素是原图泛光，渲染时保留。
  return Math.min(1, pixels[offset + 1] / 240) * pixels[offset + 3] / 255;
}

function buildIdleContour(pixels, size) {
  const core = Float32Array.from({ length: size * size }, (_, i) => solidAlpha(pixels, i * 4));
  const contour = new Float32Array(core.length);
  // 在动画自身的实心覆盖率上向内取 2px 边缘，保留抗锯齿；不引入另一张线稿的坐标。
  for (let y = 2; y < size - 2; y++) {
    for (let x = 2; x < size - 2; x++) {
      const i = y * size + x;
      if (!core[i]) continue;
      let interior = core[i];
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx * dx + dy * dy <= 4) interior = Math.min(interior, core[i + dy * size + dx]);
        }
      }
      contour[i] = core[i] - interior;
    }
  }
  return contour;
}

function buildArrivalField(pixels, size) {
  const count = size * size;
  const inside = Uint8Array.from({ length: count }, (_, i) => solidAlpha(pixels, i * 4) > .12);
  const clearance = Float32Array.from(inside, value => value ? size : 0);
  // 双向距离变换：离边界越远，光的传播阻力越小，形成笔画内部的主流。
  for (let i = 0; i < count; i++) {
    if (i % size) clearance[i] = Math.min(clearance[i], clearance[i - 1] + 1);
    if (i >= size) clearance[i] = Math.min(clearance[i], clearance[i - size] + 1);
  }
  for (let i = count - 1; i >= 0; i--) {
    if (i % size < size - 1) clearance[i] = Math.min(clearance[i], clearance[i + 1] + 1);
    if (i < count - size) clearance[i] = Math.min(clearance[i], clearance[i + size] + 1);
  }
  const resistance = Float32Array.from(clearance, (value, i) => inside[i] ? 1 + 2 / (value + 1) : 18);
  const arrival = new Float32Array(count).fill(Infinity);
  let source = 0;
  let nearest = Infinity;
  for (let i = 0; i < count; i++) {
    const distance = (i % size - size * (ART_PADDING + 640 * .535) / ART_SIZE) ** 2
      + (Math.floor(i / size) - size * (ART_PADDING + 640 * .48) / ART_SIZE) ** 2;
    if (inside[i] && distance < nearest) { source = i; nearest = distance; }
  }

  // Dijkstra 最小堆只用于初始化。空隙具有高阻力，允许不相连的刻印片段接续点亮。
  const heap = [];
  function push(index, time) {
    let slot = heap.length;
    heap.push({ index, time });
    while (slot > 0) {
      const parent = (slot - 1) >> 1;
      if (heap[parent].time <= time) break;
      heap[slot] = heap[parent];
      slot = parent;
    }
    heap[slot] = { index, time };
  }
  function pop() {
    const first = heap[0];
    const last = heap.pop();
    if (heap.length) {
      let slot = 0;
      while (slot * 2 + 1 < heap.length) {
        let child = slot * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1].time < heap[child].time) child++;
        if (heap[child].time >= last.time) break;
        heap[slot] = heap[child];
        slot = child;
      }
      heap[slot] = last;
    }
    return first;
  }
  arrival[source] = 0;
  push(source, 0);
  while (heap.length) {
    const { index, time } = pop();
    if (time > arrival[index]) continue;
    const x = index % size;
    const y = Math.floor(index / size);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || x + dx < 0 || x + dx >= size || y + dy < 0 || y + dy >= size) continue;
        const next = index + dy * size + dx;
        const travel = (resistance[index] + resistance[next]) * .5 * (dx && dy ? Math.SQRT2 : 1);
        const nextTime = Math.fround(time + travel);
        if (nextTime >= arrival[next]) continue;
        arrival[next] = nextTime;
        push(next, nextTime);
      }
    }
  }
  let longest = 0;
  for (let i = 0; i < count; i++) if (inside[i]) longest = Math.max(longest, arrival[i]);
  // 留出末尾 22% 给光前锋后方的颜色稳定，所有像素在进度 1 时自然达到终态。
  return Float32Array.from(arrival, time => Math.min(.78, time / longest * .78));
}

function interpolate(field, x, y) {
  const left = Math.floor(x);
  const top = Math.floor(y);
  const right = Math.min(FIELD_SIZE - 1, left + 1);
  const bottom = Math.min(FIELD_SIZE - 1, top + 1);
  const tx = x - left;
  const ty = y - top;
  const upper = field[top * FIELD_SIZE + left] * (1 - tx) + field[top * FIELD_SIZE + right] * tx;
  const lower = field[bottom * FIELD_SIZE + left] * (1 - tx) + field[bottom * FIELD_SIZE + right] * tx;
  return upper * (1 - ty) + lower * ty;
}

function createGlowField(pixels, arrival) {
  const count = FIELD_SIZE * FIELD_SIZE;
  const weights = Float32Array.from({ length: count }, (_, i) => solidAlpha(pixels, i * 4));
  const source = new Float32Array(count);
  const spread = new Float32Array(count);
  const reference = new Float32Array(count);
  const scratch = new Float32Array(count);
  const response = new Float32Array(count);
  const blend = 1 - Math.exp(-1 / 7);

  // 四个方向的指数扩散，整幅网格都有连续支持；无截断半径造成的光圈边界。
  function diffuse(input, output) {
    for (let y = 0; y < FIELD_SIZE; y++) {
      const row = y * FIELD_SIZE;
      let value = input[row];
      for (let x = 0; x < FIELD_SIZE; x++) {
        value += blend * (input[row + x] - value);
        scratch[row + x] = value;
      }
      value = scratch[row + FIELD_SIZE - 1];
      for (let x = FIELD_SIZE - 1; x >= 0; x--) {
        value += blend * (scratch[row + x] - value);
        scratch[row + x] = value;
      }
    }
    for (let x = 0; x < FIELD_SIZE; x++) {
      let value = scratch[x];
      for (let y = 0; y < FIELD_SIZE; y++) {
        const index = y * FIELD_SIZE + x;
        value += blend * (scratch[index] - value);
        output[index] = value;
      }
      value = output[(FIELD_SIZE - 1) * FIELD_SIZE + x];
      for (let y = FIELD_SIZE - 1; y >= 0; y--) {
        const index = y * FIELD_SIZE + x;
        value += blend * (output[index] - value);
        output[index] = value;
      }
    }
  }

  diffuse(weights, reference);
  return progress => {
    for (let i = 0; i < count; i++) {
      // 泛光由笔画的局部亮度驱动，响应比实心充盈稍缓，不沿空隙的最短路径生长。
      source[i] = weights[i] * smoothstep(.015, .20, progress - arrival[i]);
    }
    diffuse(source, spread);
    for (let i = 0; i < count; i++) response[i] = spread[i] / reference[i];
    // 完全点亮时 source === weights，归一化响应自然为 1，恢复原素材完整泛光。
    return response;
  };
}

export async function createSignet(canvas, idleGlowCanvas) {
  const solid = await loadImage('./assets/images/elysia-signet-solid.png');
  const fieldPixels = sampleImage(solid, FIELD_SIZE);
  const field = buildArrivalField(fieldPixels, FIELD_SIZE);
  const glowAt = createGlowField(fieldPixels, field);
  const fillPixels = sampleImage(solid, RENDER_SIZE);
  const contour = buildIdleContour(fillPixels, RENDER_SIZE);
  idleGlowCanvas.width = idleGlowCanvas.height = RENDER_SIZE;
  const idleGlowContext = idleGlowCanvas.getContext('2d');
  const idleGlowFrame = idleGlowContext.createImageData(RENDER_SIZE, RENDER_SIZE);
  canvas.width = canvas.height = RENDER_SIZE;
  const context = canvas.getContext('2d');
  const frame = context.createImageData(RENDER_SIZE, RENDER_SIZE);
  const source = document.createElement('canvas');
  const glowSource = document.createElement('canvas');
  const materialSource = document.createElement('canvas');
  const nativeGlowSource = document.createElement('canvas');
  for (const surface of [source, glowSource, materialSource, nativeGlowSource]) surface.width = surface.height = RENDER_SIZE;
  const sourceContext = source.getContext('2d');
  const glowSourceContext = glowSource.getContext('2d');
  const materialContext = materialSource.getContext('2d');
  const nativeGlowContext = nativeGlowSource.getContext('2d');
  const materialFrame = materialContext.createImageData(RENDER_SIZE, RENDER_SIZE);
  const nativeGlowFrame = nativeGlowContext.createImageData(RENDER_SIZE, RENDER_SIZE);
  const fracture = createSignetFracture(fillPixels, contour, RENDER_SIZE, (x, y) =>
    interpolate(field, x / (RENDER_SIZE - 1) * (FIELD_SIZE - 1), y / (RENDER_SIZE - 1) * (FIELD_SIZE - 1)));
  const active = [];
  for (let i = 0; i < RENDER_SIZE * RENDER_SIZE; i++) {
    const core = solidAlpha(fillPixels, i * 4);
    const sourceAlpha = fillPixels[i * 4 + 3] / 255;
    const line = contour[i];
    if (sourceAlpha < .002) continue;
    const fieldX = (i % RENDER_SIZE) / (RENDER_SIZE - 1) * (FIELD_SIZE - 1);
    const fieldY = Math.floor(i / RENDER_SIZE) / (RENDER_SIZE - 1) * (FIELD_SIZE - 1);
    active.push({
      offset: i * 4, core, glow: sourceAlpha - core, line, fieldX, fieldY,
      color: [fillPixels[i * 4], fillPixels[i * 4 + 1], fillPixels[i * 4 + 2]],
      coreWeight: sourceAlpha ? core / sourceAlpha : 0,
      arrival: interpolate(field, fieldX, fieldY),
    });
  }
  let progress = 0;
  let request = 0;
  let driftRequest = 0;
  let driftTime = 0;
  let drifting = false;
  let motionPreference;
  let animationId = 0;
  let finish = null;
  let idleColor;
  let flowColor;

  function compose() {
    fracture.draw(source, glowSource, context, idleGlowContext, progress, materialSource, nativeGlowSource);
  }

  function draw(value) {
    progress = value;
    const data = frame.data;
    const glow = glowAt(progress);
    for (const pixel of active) {
      const age = progress - pixel.arrival;
      const charge = smoothstep(0, .12, age);
      const settled = smoothstep(.025, .21, age);
      // 柔和光前锋流过后留下稳定亮色；无随机闪烁或最后一帧的整图替换。
      const front = Math.exp(-(((age - .07) / .027) ** 2)) * .6;
      const settledColor = Math.min(1, settled + front);
      const glowCharge = interpolate(glow, pixel.fieldX, pixel.fieldY);
      const fillAlpha = pixel.core * charge + pixel.glow * glowCharge;
      const lineAlpha = pixel.line * .65 * (1 - charge) * (1 - fillAlpha);
      const alpha = fillAlpha + lineAlpha;
      const materialAlpha = pixel.core * charge + lineAlpha;
      const offset = pixel.offset;
      for (let channel = 0; channel < 3; channel++) {
        // 泛光始终沿用原图颜色；笔画流动色最终连续回到各像素原始 RGB。
        const lit = pixel.color[channel] + (flowColor[channel] - pixel.color[channel])
          * (1 - settledColor) * pixel.coreWeight;
        data[offset + channel] = alpha ? (lit * fillAlpha + idleColor[channel] * lineAlpha) / alpha : 0;
        materialFrame.data[offset + channel] = materialAlpha
          ? (lit * pixel.core * charge + idleColor[channel] * lineAlpha) / materialAlpha : 0;
        nativeGlowFrame.data[offset + channel] = lit;
      }
      data[offset + 3] = alpha * 255;
      materialFrame.data[offset + 3] = materialAlpha * 255;
      // 将柔光作为连续底层，反解 source-over 的透明度；晶片只携带笔画及轮廓。
      nativeGlowFrame.data[offset + 3] = materialAlpha < 1
        ? pixel.glow * glowCharge / (1 - materialAlpha) * 255 : 0;
      // 未充盈处继续保留峰值轮廓柔光，随笔画稳定逐点交给素材原生泛光。
      idleGlowFrame.data[offset + 3] = pixel.line * (1 - settled) * 255;
    }
    sourceContext.putImageData(frame, 0, 0);
    glowSourceContext.putImageData(idleGlowFrame, 0, 0);
    materialContext.putImageData(materialFrame, 0, 0);
    nativeGlowContext.putImageData(nativeGlowFrame, 0, 0);
    compose();
  }
  function refreshTheme() {
    const style = getComputedStyle(document.documentElement);
    const color = name => style.getPropertyValue(name).trim().slice(1).match(/../g).map(value => parseInt(value, 16));
    idleColor = color('--signet-idle');
    flowColor = color('--signet-flow');
    fracture.refreshTheme(flowColor, idleColor);
    // 主题只更新柔光颜色；覆盖率由 draw 与笔画充盈同步计算。
    for (let i = 0; i < contour.length; i++) {
      idleGlowFrame.data[i * 4] = idleColor[0];
      idleGlowFrame.data[i * 4 + 1] = idleColor[1];
      idleGlowFrame.data[i * 4 + 2] = idleColor[2];
    }
    draw(progress);
  }
  function cancel() {
    animationId += 1;
    cancelAnimationFrame(request);
    cancelAnimationFrame(driftRequest);
    driftRequest = 0;
    drifting = false;
    if (finish) finish(false);
    finish = null;
  }
  // 碎片待机只合成缓存纹理；后台或减少动态效果时暂停，恢复时不跳过漂移。
  function syncMotion() {
    if (!drifting) return;
    if (document.hidden || motionPreference.matches) {
      cancelAnimationFrame(driftRequest);
      driftRequest = 0;
      return;
    }
    if (driftRequest) return;
    let previous = performance.now();
    function tick(now) {
      driftTime += Math.min(48, now - previous);
      previous = now;
      fracture.drift(driftTime);
      compose();
      driftRequest = requestAnimationFrame(tick);
    }
    driftRequest = requestAnimationFrame(tick);
  }
  function reset() {
    cancel();
    fracture.reset();
    draw(0);
  }
  // 点亮与破碎共用一个动画任务，取消后保留当前画面，可从任意裂损状态接续。
  function animate(duration, reducedMotion, render) {
    if (reducedMotion.matches) { render(1); return Promise.resolve(true); }
    return new Promise(resolve => {
      finish = resolve;
      let previous = performance.now();
      let elapsed = 0;
      function tick(now) {
        // 标签页恢复时不跳过整段点亮；最后一帧确实绘制后才完成 Promise。
        elapsed += Math.min(48, now - previous);
        previous = now;
        const time = Math.min(1, elapsed / duration);
        render(reducedMotion.matches ? 1 : time);
        if (time < 1 && !reducedMotion.matches) request = requestAnimationFrame(tick);
        else { finish = null; resolve(true); }
      }
      request = requestAnimationFrame(tick);
    });
  }
  function play(reducedMotion) {
    cancel();
    const startProgress = progress;
    return animate(LIGHT_DURATION, reducedMotion, time => {
      // 光流推进的同时，各晶片按自己的到达时间归位、闭合断口。
      draw(startProgress + (1 - startProgress) * time * (2 - time));
    });
  }
  async function breakApart(level, reducedMotion) {
    cancel();
    const run = animationId;
    fracture.begin(level);
    const completed = await animate(level === 5 ? SHATTER_DURATION : FRACTURE_DURATION, reducedMotion, time => {
      fracture.update(time);
      compose();
    });
    if (!completed || run !== animationId) return false;
    motionPreference = reducedMotion;
    driftTime = 0;
    drifting = fracture.hasFloatingPieces();
    syncMotion();
    return true;
  }
  refreshTheme();
  return { play, breakApart, reset, refreshTheme, syncMotion };
}
