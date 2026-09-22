// 主裂痕沿最终晶片的公共边界生长，前四次保持主体连接，第五次才释放晶片。
const CRACK_COUNT = 3;
// 前四次分别达到的路径长度比例与开口宽度；宽度使用 640 × 640 画布像素。
const CRACK_LENGTHS = [.18, .38, .65, .95];
const CRACK_WIDTHS = [.65, 1.15, 2.05, 3.4];
const smoothstep = (start, end, value) => {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
};
const noise = seed => {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};

export function createSignetCracks({ cells, core, bounds, arrivalAt, seed }) {
  const size = core.width;
  const corePixels = core.getContext('2d').getImageData(0, 0, size, size).data;
  const nodes = new Map();
  const edges = new Map();
  function node(point) {
    const key = `${point.x.toFixed(3)},${point.y.toFixed(3)}`;
    if (!nodes.has(key)) nodes.set(key, { ...point, key, edges: [] });
    return nodes.get(key);
  }
  for (const cell of cells) {
    cell.polygon.forEach((point, i) => {
      const a = node(point), b = node(cell.polygon[(i + 1) % cell.polygon.length]);
      const key = [a.key, b.key].sort().join('|');
      if (!edges.has(key)) {
        const length = Math.hypot(a.x - b.x, a.y - b.y);
        if (length < .01) return;
        let coverage = 0;
        for (let j = 0; j < 9; j++) {
          const t = (j + .5) / 9;
          const x = Math.max(0, Math.min(size - 1, Math.round(a.x + (b.x - a.x) * t)));
          const y = Math.max(0, Math.min(size - 1, Math.round(a.y + (b.y - a.y) * t)));
          coverage += corePixels[(y * size + x) * 4 + 3] / 255 / 9;
        }
        const edge = { a, b, length, coverage, owners: [], used: 0 };
        edges.set(key, edge);
        a.edges.push(edge);
        b.edges.push(edge);
      }
      edges.get(key).owners.push(cell.id);
    });
  }
  const vertices = [...nodes.values()];
  const { minX, minY, width, height } = bounds;
  const center = { x: minX + width / 2, y: minY + height / 2 };
  const nearest = point => vertices.reduce((a, b) =>
    Math.hypot(a.x - point.x, a.y - point.y) < Math.hypot(b.x - point.x, b.y - point.y) ? a : b);
  const routes = [];
  const rotation = noise(seed) * Math.PI * 2;
  for (let i = 0; i < CRACK_COUNT; i++) {
    const angle = rotation + i * Math.PI * 2 / CRACK_COUNT + (noise(seed + i + 9) - .5) * .5;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const offset = (noise(seed + i + 19) - .5) * .22;
    const start = nearest({ x: center.x - dx * width * .36 - dy * width * offset,
      y: center.y - dy * height * .36 + dx * height * offset });
    const end = nearest({ x: center.x + dx * width * .35 - dy * width * offset,
      y: center.y + dy * height * .35 + dx * height * offset });
    const distances = new Map(vertices.map(vertex => [vertex, Infinity]));
    const previous = new Map();
    const pending = new Set(vertices);
    distances.set(start, 0);
    while (pending.size) {
      let current;
      for (const vertex of pending) if (!current || distances.get(vertex) < distances.get(current)) current = vertex;
      pending.delete(current);
      if (current === end) break;
      for (const edge of current.edges) {
        const next = edge.a === current ? edge.b : edge.a;
        if (!pending.has(next)) continue;
        const backwards = Math.max(0, -((next.x - current.x) * dx + (next.y - current.y) * dy) / edge.length);
        const cost = edge.length * (1.25 - edge.coverage * .55 + backwards * 1.5 + edge.used * .7
          + noise(seed + next.x * .13 + next.y * .17) * .3);
        const distance = distances.get(current) + cost;
        if (distance < distances.get(next)) {
          distances.set(next, distance);
          previous.set(next, { vertex: current, edge });
        }
      }
    }
    const segments = [];
    for (let current = end; current !== start;) {
      const { vertex, edge } = previous.get(current);
      edge.used += 1;
      segments.unshift({ a: vertex, b: current, edge, arrival: arrivalAt((vertex.x + current.x) / 2, (vertex.y + current.y) / 2) });
      current = vertex;
    }
    let length = 0;
    for (const segment of segments) { segment.offset = length; length += segment.edge.length; }
    routes.push({ segments, length });
  }

  // 只允许三处局部细片在第二至第四次弹出，选择已经被主裂痕触及的晶片。
  function assignChips(pieces) {
    const median = pieces.map(piece => piece.mass).sort((a, b) => a - b)[Math.floor(pieces.length / 2)];
    const selected = new Set();
    for (let stage = 2; stage <= 4; stage++) {
      const reached = new Set();
      for (const route of routes) {
        for (const segment of route.segments) {
          if ((segment.offset + segment.edge.length / 2) / route.length <= CRACK_LENGTHS[stage - 1]) {
            segment.edge.owners.forEach(id => reached.add(id));
          }
        }
      }
      const candidates = pieces.filter(piece => reached.has(piece.id) && !selected.has(piece.id)
        && piece.mass > median * .08 && piece.mass < median * .7);
      if (!candidates.length) continue;
      const chip = candidates.reduce((a, b) => noise(seed + a.id * 17) > noise(seed + b.id * 17) ? a : b);
      chip.chipStage = stage;
      selected.add(chip.id);
    }
  }

  const material = document.createElement('canvas');
  const glow = document.createElement('canvas');
  const bed = document.createElement('canvas');
  const lips = document.createElement('canvas');
  for (const surface of [material, glow, bed, lips]) surface.width = surface.height = size;
  const materialContext = material.getContext('2d'), glowContext = glow.getContext('2d');
  const bedContext = bed.getContext('2d'), lipsContext = lips.getContext('2d');
  let extension = 0, widthNow = 0, opacity = 1, tension = 0;
  let fromExtension = 0, fromWidth = 0, level = 0;
  let flowColor, idleColor, shadowColor;
  function begin(nextLevel) {
    level = nextLevel;
    fromExtension = extension;
    fromWidth = widthNow;
  }
  function update(time, pull = 0, release = 0) {
    tension = pull;
    if (level < 5) {
      const t = smoothstep(.06, .96, time);
      extension = fromExtension + (CRACK_LENGTHS[level - 1] - fromExtension) * t;
      widthNow = fromWidth + (CRACK_WIDTHS[level - 1] - fromWidth) * t;
      opacity = 1;
    } else {
      widthNow = fromWidth * (1 - pull * .15);
      opacity = 1 - smoothstep(0, .7, release);
    }
  }
  function refreshTheme(flow, idle) {
    flowColor = `rgb(${flow.join(',')})`;
    idleColor = `rgb(${idle.join(',')})`;
    shadowColor = `rgb(${idle.map(value => Math.round(value * .5)).join(',')})`;
  }
  function compose(source, glowSource, progress) {
    materialContext.clearRect(0, 0, size, size);
    materialContext.drawImage(source, 0, 0);
    glowContext.clearRect(0, 0, size, size);
    glowContext.drawImage(glowSource, 0, 0);
    if (!extension || !opacity) return { material, glow };
    bedContext.clearRect(0, 0, size, size);
    lipsContext.clearRect(0, 0, size, size);
    const cuts = [];
    for (const route of routes) {
      const reach = route.length * extension;
      for (const segment of route.segments) {
        const fraction = Math.min(1, (reach - segment.offset) / segment.edge.length);
        if (fraction <= 0) break;
        const remaining = 1 - smoothstep(segment.arrival - .025, segment.arrival + .10, progress);
        if (!remaining) continue;
        const a = segment.a;
        const b = { x: a.x + (segment.b.x - a.x) * fraction, y: a.y + (segment.b.y - a.y) * fraction };
        const nx = -(segment.b.y - a.y) / segment.edge.length;
        const ny = (segment.b.x - a.x) / segment.edge.length;
        const width = widthNow * remaining;
        const alpha = opacity * remaining;
        const stroke = (context, offset, thickness, color, strength) => {
          context.strokeStyle = color;
          context.lineWidth = thickness;
          context.lineCap = 'round';
          context.globalAlpha = strength;
          context.beginPath();
          context.moveTo(a.x + nx * offset, a.y + ny * offset);
          context.lineTo(b.x + nx * offset, b.y + ny * offset);
          context.stroke();
        };
        // 裂痕附近的薄晶面承托暗槽与亮边，所有颜色最后裁入原图笔画范围。
        stroke(bedContext, 0, width + 13 * remaining, idleColor, alpha * .13);
        stroke(lipsContext, -width / 2 - .6, 1.2 * remaining, shadowColor, alpha * .75);
        stroke(lipsContext, width / 2 + .35, .8 * remaining, flowColor, alpha * (.55 + tension * .3));
        cuts.push({ a, b, width, alpha });
      }
    }
    for (const context of [bedContext, lipsContext]) {
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'destination-in';
      context.drawImage(core, 0, 0);
      context.globalCompositeOperation = 'source-over';
    }
    materialContext.drawImage(bed, 0, 0);
    for (const context of [materialContext, glowContext]) {
      context.save();
      context.globalCompositeOperation = 'destination-out';
      context.lineCap = 'round';
      for (const cut of cuts) {
        context.globalAlpha = cut.alpha;
        context.lineWidth = cut.width;
        context.beginPath();
        context.moveTo(cut.a.x, cut.a.y);
        context.lineTo(cut.b.x, cut.b.y);
        context.stroke();
      }
      context.restore();
    }
    materialContext.drawImage(lips, 0, 0);
    glowContext.save();
    glowContext.globalAlpha = .35 + tension * .3;
    glowContext.drawImage(lips, 0, 0);
    glowContext.restore();
    return { material, glow };
  }
  function reset() { extension = widthNow = tension = level = 0; opacity = 1; }
  return { assignChips, begin, update, refreshTheme, compose, reset };
}
