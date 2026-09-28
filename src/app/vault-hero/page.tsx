"use client";

import { useEffect, useRef } from "react";

/* ── Tunables ────────────────────────────────────────────────────── */
/** Letter set cycled in each cell (Sister spelling; digits→letters map). */
const GLYPHS = ["S", "i", "s", "t", "e", "r"] as const;
/** Target cell pitch in CSS pixels (smaller = denser). */
const CELL_PX = 16;
/** Font size as a fraction of cell size. */
const FONT_SCALE = 0.72;
/** Soft spotlight radius around the pointer (CSS px). */
const HOVER_RADIUS_PX = 140;
/** Base glyph alpha at rest (very faint, vault-like). */
const REST_ALPHA = 0.07;
/** Peak glyph alpha at cursor center. */
const HOVER_ALPHA = 0.72;
/** Overall canvas opacity (matches vault `.vault-ascii-backdrop`). */
const CANVAS_OPACITY = 0.8;
/** Glyph fill (near-black on white). */
const GLYPH_RGB = "0, 0, 0";
/** Page background. */
const BG = "#ffffff";
/** Scramble cadence while a cell is inside the spotlight (ms). */
const SCRAMBLE_MS = 45;
/** Font stack — monospace feel like the vault backdrop. */
const FONT_FAMILY =
  'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';
/* ─────────────────────────────────────────────────────────────────── */

type Cell = {
  x: number;
  y: number;
  glyph: string;
  nextScrambleAt: number;
};

function randomGlyph() {
  return GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!;
}

function buildGrid(width: number, height: number): {
  cells: Cell[];
  cols: number;
  rows: number;
  cell: number;
} {
  const cols = Math.max(1, Math.floor(width / CELL_PX));
  const rows = Math.max(1, Math.floor(height / CELL_PX));
  const cellW = width / cols;
  const cellH = height / rows;
  const cell = Math.min(cellW, cellH);
  const cells: Cell[] = new Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      cells[i] = {
        x: (col + 0.5) * cellW,
        y: (row + 0.5) * cellH,
        glyph: randomGlyph(),
        nextScrambleAt: 0,
      };
    }
  }
  return { cells, cols, rows, cell };
}

export default function VaultHeroPage() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const pointer = { x: -9999, y: -9999, inside: false };
    let cells: Cell[] = [];
    let cellSize = CELL_PX;
    let raf = 0;
    let reducedMotion = false;

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => {
      reducedMotion = mq.matches;
    };
    syncMotion();
    mq.addEventListener("change", syncMotion);

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = wrap.clientWidth || window.innerWidth;
      const h = wrap.clientHeight || window.innerHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const built = buildGrid(w, h);
      cells = built.cells;
      cellSize = built.cell;
    };

    const onMove = (e: PointerEvent) => {
      const rect = wrap.getBoundingClientRect();
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
      pointer.inside = true;
    };
    const onLeave = () => {
      pointer.inside = false;
    };

    const paint = (now: number) => {
      const w = wrap.clientWidth || window.innerWidth;
      const h = wrap.clientHeight || window.innerHeight;
      ctx.clearRect(0, 0, w, h);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `${Math.max(8, cellSize * FONT_SCALE)}px ${FONT_FAMILY}`;

      const r = HOVER_RADIUS_PX;
      const r2 = r * r;

      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i]!;
        let alpha = REST_ALPHA;

        if (pointer.inside) {
          const dx = cell.x - pointer.x;
          const dy = cell.y - pointer.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < r2) {
            const t = 1 - Math.sqrt(d2) / r;
            // Smoothstep falloff — soft spotlight, not a hard disk.
            const ease = t * t * (3 - 2 * t);
            alpha = REST_ALPHA + (HOVER_ALPHA - REST_ALPHA) * ease;

            if (!reducedMotion && now >= cell.nextScrambleAt) {
              cell.glyph = randomGlyph();
              // Faster scramble nearer the cursor.
              const pace = SCRAMBLE_MS + (1 - ease) * SCRAMBLE_MS;
              cell.nextScrambleAt = now + pace;
            }
          }
        }

        ctx.fillStyle = `rgba(${GLYPH_RGB}, ${alpha})`;
        ctx.fillText(cell.glyph, cell.x, cell.y);
      }

      raf = requestAnimationFrame(paint);
    };

    resize();
    wrap.addEventListener("pointermove", onMove);
    wrap.addEventListener("pointerleave", onLeave);
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(paint);

    return () => {
      cancelAnimationFrame(raf);
      wrap.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("resize", resize);
      mq.removeEventListener("change", syncMotion);
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        background: BG,
        cursor: "crosshair",
        userSelect: "none",
      }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden
        data-vault-hero-canvas
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          opacity: CANVAS_OPACITY,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
