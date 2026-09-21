// 在原图内部计算连续到达时间场；渲染阶段只改变同一批像素的充盈度。
const FIELD_SIZE = 192;
const RENDER_SIZE = 640;
// 对应 CSS 的 17.5% 外扩，让原图自带的泛光完整落在画布内。
const ART_PADDING = 112;
const ART_SIZE = 640 + ART_PADDING * 2;
const LIGHT_DURATION = 3000;
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

function sampleImage(image, size, solid = false) {
  const surface = document.createElement('canvas');
  surface.width = surface.height = size;
  const context = surface.getContext('2d', { willReadFrequently: true });
  const scale = size / ART_SIZE;
  if (solid) {
    // 用实心区域定位，但绘制整张原图，保留外围泛光的 RGB 和透明度。
    const sx = 615 / 2744;
    const sy = 602 / 2684;
    context.drawImage(image, (ART_PADDING + 16 - 497 * sx) * scale,
      (ART_PADDING + 23 - 537 * sy) * scale, image.width * sx * scale, image.height * sy * scale);
  } else {
    context.drawImage(image, ART_PADDING * scale, ART_PADDING * scale, 640 * scale, 640 * scale);
  }
  return context.getImageData(0, 0, size, size).data;
}

function solidAlpha(pixels, offset) {
  // 仅识别用于传播的实心笔画；洋红色半透明像素是原图泛光，渲染时保留。
  return Math.min(1, pixels[offset + 1] / 240) * pixels[offset + 3] / 255;
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

export async function createSignet(canvas) {
  const [solid, outline] = await Promise.all([
    loadImage('./assets/images/elysia-signet-solid.png'),
    loadImage('./assets/images/elysia-signet.png'),
  ]);
  const fieldPixels = sampleImage(solid, FIELD_SIZE, true);
  const field = buildArrivalField(fieldPixels, FIELD_SIZE);
  const glowAt = createGlowField(fieldPixels, field);
  const fillPixels = sampleImage(solid, RENDER_SIZE, true);
  const linePixels = sampleImage(outline, RENDER_SIZE);
  canvas.width = canvas.height = RENDER_SIZE;
  const context = canvas.getContext('2d');
  const frame = context.createImageData(RENDER_SIZE, RENDER_SIZE);
  const active = [];
  for (let i = 0; i < RENDER_SIZE * RENDER_SIZE; i++) {
    const core = solidAlpha(fillPixels, i * 4);
    const sourceAlpha = fillPixels[i * 4 + 3] / 255;
    const line = linePixels[i * 4 + 3] / 255;
    if (sourceAlpha < .002 && line < .002) continue;
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
  let finish = null;
  let idleColor;
  let flowColor;

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
      const offset = pixel.offset;
      for (let channel = 0; channel < 3; channel++) {
        // 泛光始终沿用原图颜色；笔画流动色最终连续回到各像素原始 RGB。
        const lit = pixel.color[channel] + (flowColor[channel] - pixel.color[channel])
          * (1 - settledColor) * pixel.coreWeight;
        data[offset + channel] = alpha ? (lit * fillAlpha + idleColor[channel] * lineAlpha) / alpha : 0;
      }
      data[offset + 3] = alpha * 255;
    }
    context.putImageData(frame, 0, 0);
  }
  function refreshTheme() {
    const style = getComputedStyle(document.documentElement);
    const color = name => style.getPropertyValue(name).trim().slice(1).match(/../g).map(value => parseInt(value, 16));
    idleColor = color('--signet-idle');
    flowColor = color('--signet-flow');
    draw(progress);
  }
  function reset() {
    cancelAnimationFrame(request);
    if (finish) finish(false);
    finish = null;
    draw(0);
  }
  function play(reducedMotion) {
    reset();
    if (reducedMotion.matches) { draw(1); return Promise.resolve(true); }
    return new Promise(resolve => {
      finish = resolve;
      let previous = performance.now();
      let elapsed = 0;
      function tick(now) {
        // 标签页恢复时不跳过整段点亮；最后一帧确实绘制后才完成 Promise。
        elapsed += Math.min(48, now - previous);
        previous = now;
        const time = Math.min(1, elapsed / LIGHT_DURATION);
        draw(reducedMotion.matches ? 1 : time * time * (3 - 2 * time));
        if (time < 1 && !reducedMotion.matches) request = requestAnimationFrame(tick);
        else { finish = null; resolve(true); }
      }
      request = requestAnimationFrame(tick);
    });
  }
  refreshTheme();
  return { play, reset, refreshTheme };
}
