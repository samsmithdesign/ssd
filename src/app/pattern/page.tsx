"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/* ── Tunables (critique) ─────────────────────────────────────────── */
const PHRASE_FROM = "SISTERS";
const PHRASE_TO = "SISTER MANCHESTER";
const HOVER_RADIUS_PX = 90;
const HOVER_SCALE_MAX = 1.4;
const BASE_SCALE_MAX = 1.08;
const BASE_OPACITY_MIN = 0.22;
const BASE_OPACITY_MAX = 0.92;
const STEP_MS_MIN = 35;
const STEP_MS_MAX = 45;
const STEP_COUNT_MIN = 6;
const STEP_COUNT_MAX = 16;
const SAME_GLYPH_FLICKER_MIN = 2;
const SAME_GLYPH_FLICKER_MAX = 3;
const STAGGER_MS_PER_PX = 10 / 12; // ~10ms per 12px
const TARGET_CELL_PX = 16; // density dial — smaller = denser field
const PATTERN_SRC = "/pattern.jpg";
/* ─────────────────────────────────────────────────────────────────── */

const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

type CellModel = {
  fromGlyph: string;
  toGlyph: string;
  shown: string;
  baseOpacity: number;
  baseScale: number;
  cx: number;
  cy: number;
  col: number;
  row: number;
};

function randInt(min: number, max: number) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function randomAlpha() {
  return ALPHA[Math.floor(Math.random() * ALPHA.length)]!;
}

function randomAlnum() {
  return ALNUM[Math.floor(Math.random() * ALNUM.length)]!;
}

/**
 * Fixed column count that is not a divisor of either phrase length
 * (and not a multiple of either — avoids vertical stripes).
 */
function pickColumnCount(preferred: number, a: number, b: number) {
  const ok = (c: number) =>
    c >= 3 && a % c !== 0 && b % c !== 0 && c % a !== 0 && c % b !== 0;
  let cols = Math.max(3, preferred);
  for (let i = 0; i < 48; i++) {
    const delta = i === 0 ? 0 : i % 2 === 0 ? i / 2 : -Math.ceil(i / 2);
    const c = cols + delta;
    if (ok(c)) return c;
  }
  return cols + 1;
}

function mapPhrase(phrase: string, index: number) {
  return phrase[index % phrase.length] ?? " ";
}

function luminanceFallback(ny: number) {
  // Bright through the middle, dark toward the bottom (and slightly top).
  const mid = 1 - Math.min(1, Math.abs(ny - 0.42) / 0.55);
  const bottomDark = Math.max(0, (ny - 0.55) / 0.45);
  const t = Math.max(0, mid * (1 - bottomDark * 0.85));
  return BASE_OPACITY_MIN + t * (BASE_OPACITY_MAX - BASE_OPACITY_MIN);
}

function buildCells(
  cols: number,
  rows: number,
  cellW: number,
  cellH: number,
  sample: ((nx: number, ny: number) => number) | null,
): CellModel[] {
  const total = cols * rows;
  const cells: CellModel[] = new Array(total);
  for (let i = 0; i < total; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const nx = (col + 0.5) / cols;
    const ny = (row + 0.5) / rows;
    const fromGlyph = mapPhrase(PHRASE_FROM, i);
    const toGlyph = mapPhrase(PHRASE_TO, i);
    const baseOpacity = sample
      ? Math.min(
          BASE_OPACITY_MAX,
          Math.max(BASE_OPACITY_MIN, sample(nx, ny)),
        )
      : luminanceFallback(ny);
    const lift =
      ((baseOpacity - BASE_OPACITY_MIN) /
        (BASE_OPACITY_MAX - BASE_OPACITY_MIN)) *
      (BASE_SCALE_MAX - 1);
    cells[i] = {
      fromGlyph,
      toGlyph,
      shown: fromGlyph,
      baseOpacity,
      baseScale: 1 + lift,
      cx: (col + 0.5) * cellW,
      cy: (row + 0.5) * cellH,
      col,
      row,
    };
  }
  return cells;
}

export default function PatternPage() {
  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const cellElsRef = useRef<(HTMLSpanElement | null)[]>([]);
  const cellsRef = useRef<CellModel[]>([]);
  const pointerRef = useRef<{ x: number; y: number; inside: boolean }>({
    x: -9999,
    y: -9999,
    inside: false,
  });
  const hoveredIndexRef = useRef<number | null>(null);
  const tickClearRef = useRef<number | null>(null);
  const revealGenRef = useRef(0);
  const timersRef = useRef<number[]>([]);
  const showingToRef = useRef(false);
  const reducedMotionRef = useRef(false);
  const rafRef = useRef<number>(0);
  const colsRef = useRef(0);

  const [layout, setLayout] = useState<{
    cols: number;
    rows: number;
    cellW: number;
    cellH: number;
    cells: CellModel[];
  } | null>(null);
  const [bgReady, setBgReady] = useState(false);
  const [bgFailed, setBgFailed] = useState(false);
  const [captionPhrase, setCaptionPhrase] = useState(PHRASE_TO);
  const [gridKey, setGridKey] = useState(0);

  const clearRevealTimers = useCallback(() => {
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current = [];
    revealGenRef.current += 1;
  }, []);

  const paintCell = useCallback(
    (index: number, opacity: number, scale: number, shown?: string) => {
      const el = cellElsRef.current[index];
      if (!el) return;
      el.style.opacity = String(opacity);
      el.style.transform = `scale(${scale})`;
      if (shown !== undefined) {
        el.textContent = shown === " " ? "\u00a0" : shown;
        const cell = cellsRef.current[index];
        if (cell) cell.shown = shown;
      }
    },
    [],
  );

  const sampleLuminance = useCallback(
    (img: HTMLImageElement, w: number, h: number) => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(w / 4));
      canvas.height = Math.max(1, Math.floor(h / 4));
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      let data: ImageData;
      try {
        data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      } catch {
        return null;
      }
      const { data: px, width, height } = data;
      return (nx: number, ny: number) => {
        const x = Math.min(width - 1, Math.max(0, Math.floor(nx * width)));
        const y = Math.min(height - 1, Math.max(0, Math.floor(ny * height)));
        const i = (y * width + x) * 4;
        const r = px[i] ?? 0;
        const g = px[i + 1] ?? 0;
        const b = px[i + 2] ?? 0;
        const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        return (
          BASE_OPACITY_MIN + lum * (BASE_OPACITY_MAX - BASE_OPACITY_MIN)
        );
      };
    },
    [],
  );

  const rebuild = useCallback(
    (sample: ((nx: number, ny: number) => number) | null) => {
      const root = rootRef.current;
      if (!root) return;
      const w = root.clientWidth || window.innerWidth;
      const h = root.clientHeight || window.innerHeight;
      const preferred = Math.max(3, Math.round(w / TARGET_CELL_PX));
      const cols = pickColumnCount(
        preferred,
        PHRASE_FROM.length,
        PHRASE_TO.length,
      );
      const cellW = w / cols;
      const rows = Math.max(1, Math.ceil(h / cellW));
      const cellH = h / rows;
      const cells = buildCells(cols, rows, cellW, cellH, sample);
      cellsRef.current = cells;
      cellElsRef.current = new Array(cells.length).fill(null);
      colsRef.current = cols;
      clearRevealTimers();
      showingToRef.current = false;
      setCaptionPhrase(PHRASE_TO);
      setLayout({ cols, rows, cellW, cellH, cells });
      setGridKey((k) => k + 1);
    },
    [clearRevealTimers],
  );

  // Initial grid with fallback luminance; upgrade when image samples land.
  useEffect(() => {
    rebuild(null);
  }, [rebuild]);

  // Load background image for luminance + display; fall back if missing.
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      if (cancelled) return;
      setBgReady(true);
      setBgFailed(false);
      const sample = sampleLuminance(
        img,
        img.naturalWidth,
        img.naturalHeight,
      );
      rebuild(sample);
    };
    img.onerror = () => {
      if (cancelled) return;
      setBgReady(false);
      setBgFailed(true);
      // Keep current fallback grid — comment marks where image would swap in.
      rebuild(null);
    };
    img.src = PATTERN_SRC;
    return () => {
      cancelled = true;
    };
  }, [rebuild, sampleLuminance]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      reducedMotionRef.current = mq.matches;
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useLayoutEffect(() => {
    const onResize = () => {
      // Re-sample from cached image if available via bg element.
      if (bgFailed || !bgReady) {
        rebuild(null);
        return;
      }
      const img = new Image();
      img.onload = () => {
        const sample = sampleLuminance(
          img,
          img.naturalWidth,
          img.naturalHeight,
        );
        rebuild(sample);
      };
      img.onerror = () => rebuild(null);
      img.src = PATTERN_SRC;
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [bgFailed, bgReady, rebuild, sampleLuminance]);

  // Hover rAF — styles only, never React state.
  useEffect(() => {
    const tick = () => {
      const cells = cellsRef.current;
      const ptr = pointerRef.current;
      let nearest: number | null = null;
      let nearestDist = Infinity;

      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i]!;
        let opacity = cell.baseOpacity;
        let scale = cell.baseScale;

        if (ptr.inside) {
          const dx = cell.cx - ptr.x;
          const dy = cell.cy - ptr.y;
          const dist = Math.hypot(dx, dy);
          if (dist < nearestDist) {
            nearestDist = dist;
            nearest = i;
          }
          if (dist < HOVER_RADIUS_PX) {
            const t = 1 - dist / HOVER_RADIUS_PX;
            const ease = t * t * (3 - 2 * t);
            opacity = opacity + (1 - opacity) * ease;
            scale = scale + (HOVER_SCALE_MAX - scale) * ease;
          }
        }

        paintCell(i, opacity, scale);
      }

      // One-frame A–Z tick when pointer first enters a cell.
      if (ptr.inside && nearest !== null && nearest !== hoveredIndexRef.current) {
        hoveredIndexRef.current = nearest;
        const cell = cells[nearest]!;
        if (cell.fromGlyph !== " " || cell.toGlyph !== " ") {
          const idx = nearest;
          const settle = cell.shown;
          paintCell(idx, cell.baseOpacity, cell.baseScale, randomAlpha());
          if (tickClearRef.current) cancelAnimationFrame(tickClearRef.current);
          tickClearRef.current = requestAnimationFrame(() => {
            paintCell(idx, cell.baseOpacity, cell.baseScale, settle);
            tickClearRef.current = null;
          });
        }
      } else if (!ptr.inside) {
        hoveredIndexRef.current = null;
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafRef.current);
      if (tickClearRef.current) cancelAnimationFrame(tickClearRef.current);
    };
  }, [paintCell, gridKey]);

  const runReveal = useCallback(
    (originX: number, originY: number) => {
      const cells = cellsRef.current;
      if (!cells.length) return;

      clearRevealTimers();
      const gen = revealGenRef.current;
      const toTarget = !showingToRef.current;
      showingToRef.current = toTarget;
      setCaptionPhrase(toTarget ? PHRASE_FROM : PHRASE_TO);

      const targetKey = toTarget ? "toGlyph" : "fromGlyph";

      if (reducedMotionRef.current) {
        for (let i = 0; i < cells.length; i++) {
          const cell = cells[i]!;
          paintCell(i, cell.baseOpacity, cell.baseScale, cell[targetKey]);
        }
        return;
      }

      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i]!;
        const dist = Math.hypot(cell.cx - originX, cell.cy - originY);
        const delay = dist * STAGGER_MS_PER_PX;
        const target = cell[targetKey];
        const same = cell.fromGlyph === cell.toGlyph;
        const steps = same
          ? randInt(SAME_GLYPH_FLICKER_MIN, SAME_GLYPH_FLICKER_MAX)
          : randInt(STEP_COUNT_MIN, STEP_COUNT_MAX);
        const stepMs = randInt(STEP_MS_MIN, STEP_MS_MAX);

        const startId = window.setTimeout(() => {
          if (revealGenRef.current !== gen) return;
          let step = 0;
          const stepOnce = () => {
            if (revealGenRef.current !== gen) return;
            step += 1;
            if (step >= steps) {
              paintCell(i, cell.baseOpacity, cell.baseScale, target);
              return;
            }
            // Discrete scramble — never interpolate letterforms.
            paintCell(i, cell.baseOpacity, cell.baseScale, randomAlnum());
            const next = window.setTimeout(stepOnce, stepMs);
            timersRef.current.push(next);
          };
          stepOnce();
        }, delay);
        timersRef.current.push(startId);
      }
    },
    [clearRevealTimers, paintCell],
  );

  const onPointerMove = (e: React.PointerEvent) => {
    const grid = gridRef.current;
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    pointerRef.current.x = e.clientX - rect.left;
    pointerRef.current.y = e.clientY - rect.top;
    pointerRef.current.inside = true;
  };

  const onPointerLeave = () => {
    pointerRef.current.inside = false;
    hoveredIndexRef.current = null;
  };

  const onClick = (e: React.MouseEvent) => {
    const grid = gridRef.current;
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    runReveal(e.clientX - rect.left, e.clientY - rect.top);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      const grid = gridRef.current;
      if (!grid) return;
      const rect = grid.getBoundingClientRect();
      runReveal(rect.width / 2, rect.height / 2);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runReveal]);

  useEffect(() => () => clearRevealTimers(), [clearRevealTimers]);

  const cells = layout?.cells ?? [];

  return (
    <div
      ref={rootRef}
      style={{
        // Font via CSS variable — do not download or invent a font file.
        ["--face" as string]: '"Sister Mono", ui-monospace, monospace',
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        background: "#000",
        color: "#fff",
        fontFamily: "var(--face)",
        userSelect: "none",
        cursor: "crosshair",
      }}
    >
      {/* Background: image when present; else dark red→black radial fallback. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          // Swap: pattern.jpg when loaded; radial fallback when missing.
          backgroundImage: bgFailed
            ? "radial-gradient(ellipse at 50% 40%, #5a1010 0%, #1a0505 45%, #000 100%)"
            : `url(${PATTERN_SRC})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          backgroundColor: "#000",
        }}
      />

      <div
        ref={gridRef}
        role="presentation"
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onClick={onClick}
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          gridTemplateColumns: layout
            ? `repeat(${layout.cols}, 1fr)`
            : undefined,
          gridTemplateRows: layout
            ? `repeat(${layout.rows}, 1fr)`
            : undefined,
          zIndex: 1,
        }}
      >
        {cells.map((cell, i) => (
          <span
            key={`${gridKey}-${i}`}
            ref={(el) => {
              cellElsRef.current[i] = el;
            }}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontFamily: "var(--face)",
              fontSize: layout
                ? `min(${layout.cellW * 0.78}px, ${layout.cellH * 0.78}px)`
                : undefined,
              lineHeight: 1,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              opacity: cell.baseOpacity,
              transform: `scale(${cell.baseScale})`,
              transformOrigin: "center center",
              willChange: "transform, opacity",
              pointerEvents: "none",
            }}
          >
            {cell.shown === " " ? "\u00a0" : cell.shown}
          </span>
        ))}
      </div>

      <p
        style={{
          position: "fixed",
          left: 12,
          bottom: 10,
          margin: 0,
          zIndex: 2,
          fontFamily: "var(--face)",
          fontSize: 11,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.72)",
          lineHeight: 1.3,
          pointerEvents: "none",
        }}
      >
        {captionPhrase}
        <br />
        click to reveal
      </p>
    </div>
  );
}
