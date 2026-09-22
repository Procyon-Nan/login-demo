import { createSignetCracks } from './signet-cracks.js';

// 前四次只延伸主裂痕；较大的晶片留到第五次蓄力后释放。
const GRID = 6;
const TENSION_END = .18; // 第五次先用总时长的 18% 绷紧。
const TENSION_HOLD = .05; // 极限状态停留 5%（当前约 85ms），再快速释放。
// 透视焦距与晶片厚度，均使用画布像素；焦距越小，前后大小差异越明显。
const FOCAL_LENGTH = 980;
const THICKNESS = 1.8; // 薄晶片侧面厚度；保留空间感，避免形成宽实的暗边。
const SIDE_OPACITY = .28;
const REST_POSE = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0, opacity: 1 };
const smoothstep = (start, end, value) => {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
};
const noise = seed => {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};

// 以两颗种子的垂直平分线裁切凸多边形，得到无重叠的 Voronoi 晶片。
function clipCell(polygon, site, other) {
  const nx = other.x - site.x;
  const ny = other.y - site.y;
  const limit = (other.x ** 2 + other.y ** 2 - site.x ** 2 - site.y ** 2) / 2;
  const result = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const da = a.x * nx + a.y * ny - limit;
    const db = b.x * nx + b.y * ny - limit;
    if (da <= 0) result.push(a);
    if ((da <= 0) !== (db <= 0)) {
      const t = da / (da - db);
      result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return result;
}

function surface(width, height = width) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function solidMask(pixels, size) {
  const mask = surface(size);
  const context = mask.getContext('2d');
  const frame = context.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    frame.data[i * 4 + 3] = Math.min(1, pixels[i * 4 + 1] / 240) * pixels[i * 4 + 3];
  }
  context.putImageData(frame, 0, 0);
  return mask;
}

// 保留闭合轮廓的转折，删除误差不超过 0.15 个逻辑像素的冗余点。
// 精细采样仅用于初始化，避免漂浮时重复提交大量近乎共线的短线段。
function simplifyContour(points) {
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  const pending = [[0, points.length]];
  while (pending.length) {
    const [start, end] = pending.pop();
    const a = points[start], b = points[end % points.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    let farthest = -1, distance = .15 ** 2;
    for (let i = start + 1; i < end; i++) {
      const p = points[i];
      const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
      const error = (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
      if (error > distance) { distance = error; farthest = i; }
    }
    if (farthest < 0) continue;
    keep[farthest] = 1;
    pending.push([start, farthest], [farthest, end]);
  }
  return points.filter((_, i) => keep[i]);
}

// 在高分辨率覆盖率上提取闭合轮廓，坐标仍还原到原来的 640 单位空间。
function traceContours(mask, scale) {
  const { width, height } = mask;
  const pixels = mask.getContext('2d').getImageData(0, 0, width, height).data;
  const cases = [[], [[0, 3]], [[1, 0]], [[1, 3]], [[2, 1]], [[0, 3], [2, 1]], [[2, 0]], [[2, 3]],
    [[3, 2]], [[0, 2]], [[1, 0], [3, 2]], [[1, 2]], [[3, 1]], [[0, 1]], [[3, 0]], []];
  const edges = new Map();
  const alpha = (x, y) => pixels[(y * width + x) * 4 + 3] / 255;
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const corners = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
      const values = corners.map(([px, py]) => alpha(px, py));
      const code = values.reduce((result, value, i) => result | (value > .35 ? 1 << i : 0), 0);
      const edgePoint = edge => {
        const next = (edge + 1) % 4;
        const t = (.35 - values[edge]) / (values[next] - values[edge]);
        return {
          // 用采样网格边编号连接相邻单元，避免浮点坐标匹配造成断点。
          key: edge === 0 ? `h${x},${y}` : edge === 1 ? `v${x + 1},${y}`
            : edge === 2 ? `h${x},${y + 1}` : `v${x},${y}`,
          x: (corners[edge][0] + (corners[next][0] - corners[edge][0]) * t + .5) / scale,
          y: (corners[edge][1] + (corners[next][1] - corners[edge][1]) * t + .5) / scale,
        };
      };
      for (const [a, b] of cases[code]) {
        const start = edgePoint(a);
        edges.set(start.key, { start, end: edgePoint(b) });
      }
    }
  }
  const contours = [];
  while (edges.size) {
    const first = edges.values().next().value;
    const points = [];
    let edge = first;
    while (edge) {
      points.push(edge.start);
      edges.delete(edge.start.key);
      if (edge.end.key === first.start.key) break;
      edge = edges.get(edge.end.key);
    }
    if (!edge || points.length < 3) continue;
    // 轻微平滑采样噪声；大于 60° 的转折保留原位，避免磨圆断口和尖角。
    const smoothed = points.map((point, i) => {
      const before = points[(i + points.length - 1) % points.length];
      const after = points[(i + 1) % points.length];
      const ux = point.x - before.x, uy = point.y - before.y;
      const vx = after.x - point.x, vy = after.y - point.y;
      const cosine = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy));
      return cosine > .5
        ? { x: point.x * .8 + (before.x + after.x) * .1, y: point.y * .8 + (before.y + after.y) * .1 }
        : point;
    });
    const simplified = simplifyContour(smoothed);
    if (simplified.length >= 3) contours.push(simplified);
  }
  return contours;
}

// 三轴旋转后的局部坐标基，按晶片中心深度作透视缩放。
function project(piece, pose, center) {
  const cx = Math.cos(pose.pitch), sx = Math.sin(pose.pitch);
  const cy = Math.cos(pose.yaw), sy = Math.sin(pose.yaw);
  const cz = Math.cos(pose.roll), sz = Math.sin(pose.roll);
  const u = { x: cy * cz, y: cy * sz, z: -sy };
  const v = { x: sx * sy * cz - cx * sz, y: sx * sy * sz + cx * cz, z: sx * cy };
  const normal = { x: cx * sy * cz + sx * sz, y: cx * sy * sz - sx * cz, z: cx * cy };
  const scale = FOCAL_LENGTH / (FOCAL_LENGTH - pose.z);
  const x = center.x + (piece.x + pose.x - center.x) * scale;
  const y = center.y + (piece.y + pose.y - center.y) * scale;
  const a = u.x * scale, b = u.y * scale, c = v.x * scale, d = v.y * scale;
  return { u, v, normal, scale, a, b, c, d, e: x - a * piece.x - c * piece.y, f: y - b * piece.x - d * piece.y };
}

export function createSignetFracture({ pixels, contour, size, arrivalAt, detailPixels, detailScale }) {
  const patternSeed = Math.random() * 10000;
  let minX = size, minY = size, maxX = 0, maxY = 0;
  for (let i = 0; i < contour.length; i++) {
    if (contour[i] < .04) continue;
    minX = Math.min(minX, i % size);
    maxX = Math.max(maxX, i % size);
    minY = Math.min(minY, Math.floor(i / size));
    maxY = Math.max(maxY, Math.floor(i / size));
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const center = { x: minX + width * .52, y: minY + height * .48 };
  const sites = Array.from({ length: GRID * GRID }, (_, id) => ({
    id,
    x: minX + (id % GRID + .18 + noise(id + 1) * .64) / GRID * width,
    y: minY + (Math.floor(id / GRID) + .18 + noise(id + 101) * .64) / GRID * height,
    mass: 0, arrival: 0,
  }));

  // 只保留真正含有刻印轮廓的晶片，并用该片轮廓的加权到达时间驱动修复。
  for (let i = 0; i < contour.length; i++) {
    if (!contour[i]) continue;
    const x = i % size;
    const y = Math.floor(i / size);
    let nearest = sites[0];
    let distance = Infinity;
    for (const site of sites) {
      const d = (x - site.x) ** 2 + (y - site.y) ** 2;
      if (d < distance) { distance = d; nearest = site; }
    }
    nearest.mass += contour[i];
    nearest.arrival += contour[i] * arrivalAt(x, y);
  }

  const core = solidMask(pixels, size);
  const detailCore = solidMask(detailPixels, size * detailScale);

  for (const site of sites) {
    let polygon = [{ x: 0, y: 0 }, { x: size, y: 0 }, { x: size, y: size }, { x: 0, y: size }];
    for (const other of sites) if (other !== site) polygon = clipCell(polygon, site, other);
    site.polygon = polygon;
  }
  const cracks = createSignetCracks({ cells: sites, core, bounds: { minX, minY, width, height }, arrivalAt, seed: patternSeed });
  const pieces = sites.filter(site => site.mass > 0).map(site => {
    const polygon = site.polygon;
    const path = new Path2D();
    polygon.forEach((point, i) => i ? path.lineTo(point.x, point.y) : path.moveTo(point.x, point.y));
    path.closePath();
    const left = Math.max(0, Math.floor(Math.min(...polygon.map(point => point.x))) - 2);
    const top = Math.max(0, Math.floor(Math.min(...polygon.map(point => point.y))) - 2);
    const right = Math.min(size, Math.ceil(Math.max(...polygon.map(point => point.x))) + 2);
    const bottom = Math.min(size, Math.ceil(Math.max(...polygon.map(point => point.y))) + 2);
    const edge = surface((right - left) * detailScale, (bottom - top) * detailScale);
    const edgeContext = edge.getContext('2d');
    edgeContext.scale(detailScale, detailScale);
    edgeContext.translate(-left, -top);
    edgeContext.strokeStyle = '#fff';
    edgeContext.lineWidth = 1.2;
    edgeContext.stroke(path);
    edgeContext.globalCompositeOperation = 'destination-in';
    edgeContext.drawImage(detailCore, 0, 0, size, size);
    edgeContext.setTransform(1, 0, 0, 1, 0, 0);
    edgeContext.globalCompositeOperation = 'source-over';
    const face = surface(edge.width, edge.height);
    const faceContext = face.getContext('2d');
    faceContext.save();
    faceContext.scale(detailScale, detailScale);
    faceContext.translate(-left, -top);
    faceContext.clip(path);
    faceContext.drawImage(detailCore, 0, 0, size, size);
    faceContext.restore();
    return {
      ...site, path, edge, face, sides: traceContours(face, detailScale), left, top, width: right - left, height: bottom - top,
      arrival: site.arrival / site.mass,
      pose: { ...REST_POSE }, flash: 0, chipStage: Infinity,
    };
  });
  cracks.assignChips(pieces);
  let level = 0;
  let release = 0;
  let sideColor;

  function begin(nextLevel) {
    level = nextLevel;
    release = 0;
    cracks.begin(level);
    for (const piece of pieces) {
      piece.start = { ...piece.pose };
      piece.startFlash = piece.flash;
      const age = Math.max(0, level - piece.chipStage);
      const broken = level === 5 || level >= piece.chipStage;
      const random = noise(piece.id + 201);
      const tilt = noise(piece.id + 301) - .5;
      const direction = Math.atan2(piece.y - center.y, piece.x - center.x) + (random - .5) * .65;
      // 无统一上浮或下坠方向：每片拥有不同的前后深度与角动量，散开后仍然保留。
      const distance = !broken ? 0 : level === 5 ? 14 + random * 12
        : 9 + random * 4 + age * 2;
      piece.target = {
        x: Math.cos(direction) * distance,
        y: Math.sin(direction) * distance,
        z: broken ? tilt * (level === 5 ? 70 : 22 + age * 12) : 0,
        pitch: broken ? tilt * (level === 5 ? 1.25 : .35 + age * .14) : 0,
        yaw: broken ? (random - .5) * (level === 5 ? 1.5 : .45 + age * .18) : 0,
        roll: broken ? (noise(piece.id + 501) - .5) * (level === 5 ? .55 : .12 + age * .06) : 0,
        opacity: broken && piece.chipStage < 5 ? .85 : 1,
      };
      piece.tensed = {
        ...piece.start,
        x: piece.start.x * .88 + (center.x - piece.x) * .012,
        y: piece.start.y * .88 + (center.y - piece.y) * .012,
        z: piece.start.z * .9 - 2.5,
        pitch: piece.start.pitch * .9, yaw: piece.start.yaw * .9, roll: piece.start.roll * .9,
      };
      piece.delay = piece.chipStage === level ? .55 + noise(piece.id + 401) * .08 : .05;
    }
  }

  function update(time) {
    const pull = smoothstep(0, TENSION_END, time);
    const releaseStart = TENSION_END + TENSION_HOLD;
    const releasedTime = Math.max(0, (time - releaseStart) / (1 - releaseStart));
    // 释放瞬间具有高初速度，约 0.2 秒完成大部分位移，再缓慢滑入失重漂浮。
    release = level === 5 ? (1 - Math.exp(-releasedTime * 8)) / (1 - Math.exp(-8)) : 0;
    const spin = (1 - Math.exp(-releasedTime * 4.2)) / (1 - Math.exp(-4.2));
    cracks.update(time, level === 5 ? pull * (1 - release) : 0, release);
    for (const piece of pieces) {
      if (level === 5) {
        for (const key of Object.keys(REST_POSE)) {
          const t = ['pitch', 'yaw', 'roll'].includes(key) ? spin : release;
          piece.pose[key] = time <= releaseStart
            ? piece.start[key] + (piece.tensed[key] - piece.start[key]) * pull
            : piece.tensed[key] + (piece.target[key] - piece.tensed[key]) * t;
        }
        piece.flash = piece.startFlash * (1 - pull) + Math.sin(Math.PI * smoothstep(0, .24, releasedTime)) * .85;
      } else {
        const t = smoothstep(piece.delay, 1, time);
        for (const key of Object.keys(REST_POSE)) piece.pose[key] = piece.start[key] + (piece.target[key] - piece.start[key]) * t;
        piece.flash = piece.chipStage <= level
          ? piece.startFlash * (1 - t) + Math.sin(Math.PI * t) * .5 : 0;
      }
    }
  }

  function drift(milliseconds) {
    const strength = smoothstep(0, 1400, milliseconds) * (level === 5 ? 1 : .45);
    for (const piece of pieces) {
      if (level < 5 && piece.chipStage > level) continue;
      const phase = noise(piece.id + 601) * Math.PI * 2;
      const time = milliseconds / (11000 + noise(piece.id + 701) * 6000) * Math.PI * 2;
      const wave = Math.sin(time + phase) - Math.sin(phase);
      const cross = Math.cos(time * .83 + phase) - Math.cos(phase);
      piece.pose = {
        ...piece.target,
        x: piece.target.x + wave * 2.5 * strength,
        y: piece.target.y + cross * 3 * strength,
        z: piece.target.z + wave * 5 * strength,
        pitch: piece.target.pitch + cross * .055 * strength,
        yaw: piece.target.yaw + wave * .065 * strength,
        roll: piece.target.roll + cross * .035 * strength,
      };
    }
  }

  function refreshTheme(flowColor, idleColor) {
    // 断面取主题粉紫色的浅透混合色，不再用压暗的轮廓色制造厚重阴影。
    sideColor = idleColor.map((value, i) => value * .35 + flowColor[i] * .65);
    cracks.refreshTheme(flowColor, idleColor);
    for (const piece of pieces) {
      for (const [surface, color] of [[piece.edge, flowColor], [piece.face, idleColor]]) {
        const context = surface.getContext('2d');
        context.globalCompositeOperation = 'source-in';
        context.fillStyle = `rgb(${color.join(',')})`;
        context.fillRect(0, 0, surface.width, surface.height);
        context.globalCompositeOperation = 'source-over';
      }
    }
  }

  function drawSides(context, piece, matrix, strength) {
    const thickness = THICKNESS * strength * matrix.scale;
    const backX = -matrix.normal.x * thickness;
    const backY = -matrix.normal.y * thickness;
    const point = p => ({
      x: matrix.a * (p.x + piece.left) + matrix.c * (p.y + piece.top) + matrix.e,
      y: matrix.b * (p.x + piece.left) + matrix.d * (p.y + piece.top) + matrix.f,
    });
    const shade = .92 + Math.max(0, -.5 * matrix.normal.x - .6 * matrix.normal.y + .2) * .08;
    context.fillStyle = `rgb(${sideColor.map(value => Math.min(255, Math.round(value * shade))).join(',')})`;
    // 每段连续可见边缘只画一个完整侧面，消除短四边形之间的栅格接缝。
    context.beginPath();
    for (const contour of piece.sides) {
      const visible = contour.map((a, i) => {
        const b = contour[(i + 1) % contour.length];
        return matrix.u.z * (b.y - a.y) - matrix.v.z * (b.x - a.x) > 0;
      });
      const start = visible.indexOf(false);
      let strip = [];
      for (let step = 1; step <= contour.length; step++) {
        const i = (start + step) % contour.length;
        if (visible[i]) {
          if (!strip.length) strip.push(point(contour[i]));
          strip.push(point(contour[(i + 1) % contour.length]));
        } else if (strip.length) {
          context.moveTo(strip[0].x, strip[0].y);
          for (let j = 1; j < strip.length; j++) context.lineTo(strip[j].x, strip[j].y);
          for (let j = strip.length - 1; j >= 0; j--) context.lineTo(strip[j].x + backX, strip[j].y + backY);
          context.closePath();
          strip = [];
        }
      }
    }
    context.fill();
  }

  function draw(source, glowSource, context, glowContext, progress, materialSource, nativeGlowSource) {
    const fractured = level > 0 && progress < 1;
    const cracked = fractured ? cracks.compose(materialSource, glowSource, progress) : { material: source, glow: glowSource };
    const artwork = cracked.material;
    for (const [target, image] of [[context, artwork], [glowContext, cracked.glow]]) {
      target.clearRect(0, 0, size, size);
      target.drawImage(image, 0, 0);
    }
    if (!fractured) return;
    const moving = [];
    for (const piece of pieces) {
      if (level < 5 && piece.chipStage > level) continue;
      const healed = smoothstep(piece.arrival - .025, piece.arrival + .10, progress);
      const remaining = 1 - healed;
      const pose = {};
      for (const key of Object.keys(REST_POSE)) pose[key] = REST_POSE[key] + (piece.pose[key] - REST_POSE[key]) * remaining;
      // 接近原位时连续交回原始画面，避免裁切抗锯齿留下永久接缝。
      const transfer = smoothstep(0, 1.2, Math.hypot(pose.x, pose.y, pose.z) + Math.abs(pose.roll) * 30);
      if (!transfer) continue;
      moving.push({ piece, pose, remaining, transfer, flash: piece.flash * remaining + healed * remaining * 2 });
    }
    // 先同时移走所有受损区域，再绘制晶片，避免相邻晶片互相擦除。
    for (const target of [context, glowContext]) {
      if (moving.length === pieces.length && moving.every(state => state.transfer === 1)) {
        target.clearRect(0, 0, size, size);
        continue;
      }
      target.save();
      target.globalCompositeOperation = 'destination-out';
      for (const { piece, transfer } of moving) {
        target.globalAlpha = transfer;
        target.fill(piece.path);
      }
      target.restore();
    }
    moving.sort((a, b) => a.pose.z - b.pose.z);
    for (const state of moving) {
      const { piece, pose, remaining, transfer, flash } = state;
      const matrix = project(piece, pose, center);
      const light = Math.max(0, -.4 * matrix.normal.x - .5 * matrix.normal.y + .75 * matrix.normal.z);
      const volume = level === 5 && piece.chipStage === Infinity ? release : 1;
      context.save();
      context.globalAlpha = pose.opacity * transfer * remaining * volume * SIDE_OPACITY;
      drawSides(context, piece, matrix, remaining * volume);
      context.restore();
      for (const [target, image] of [[context, artwork], [glowContext, cracked.glow]]) {
        target.save();
        target.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
        if (target === context) {
          // 晶面只留低覆盖率的色泽与朝向反光，让背景透过碎片。
          target.globalAlpha = pose.opacity * transfer * remaining * volume * (.02 + light * .04);
          target.drawImage(piece.face, piece.left, piece.top, piece.width, piece.height);
        }
        target.globalAlpha = pose.opacity * transfer;
        target.save();
        target.clip(piece.path);
        target.drawImage(image, piece.left, piece.top, piece.width, piece.height,
          piece.left, piece.top, piece.width, piece.height);
        target.restore();
        const rim = flash + remaining * volume * (.10 + Math.pow(light, 6) * .32);
        if (rim > .001) {
          target.globalAlpha = pose.opacity * transfer * Math.min(1, rim);
          target.drawImage(piece.edge, piece.left, piece.top, piece.width, piece.height);
        }
        target.restore();
      }
    }
    context.save();
    context.globalCompositeOperation = 'destination-over';
    context.drawImage(nativeGlowSource, 0, 0);
    context.restore();
  }

  function reset() {
    level = 0;
    release = 0;
    cracks.reset();
    for (const piece of pieces) {
      piece.pose = { ...REST_POSE };
      piece.flash = 0;
    }
  }
  const hasFloatingPieces = () => level === 5 || pieces.some(piece => piece.chipStage <= level);
  return { begin, update, drift, draw, refreshTheme, reset, hasFloatingPieces };
}
