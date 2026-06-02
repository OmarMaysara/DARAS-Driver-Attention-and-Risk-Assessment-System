"use client";

import { useEffect, useRef } from "react";

type NetNode = { x: number; y: number; layer: number; idx: number; pulse: number };
type NetEdge = {
  from: NetNode;
  to: NetNode;
  progress: number;
  speed: number;
  active: boolean;
  color: number;
  opacity: number;
};

export function NeuralNetCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cv = canvas as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;
    let animId: number;
    let W = 0,
      H = 0;

    // Neural net layers: [inputs, hidden1, hidden2, outputs]
    const LAYER_SIZES = [5, 7, 7, 4];
    let nodes: NetNode[] = [];
    let edges: NetEdge[] = [];

    function resize() {
      W = cv.offsetWidth;
      H = cv.offsetHeight;
      cv.width = W;
      cv.height = H;
      buildNet();
    }

    function buildNet() {
      nodes = [];
      edges = [];
      const numLayers = LAYER_SIZES.length;
      const xPad = W * 0.12;
      const layerGap = (W - xPad * 2) / (numLayers - 1);

      LAYER_SIZES.forEach((count, l) => {
        const x = xPad + l * layerGap;
        const yPad = H * 0.15;
        const yGap = (H - yPad * 2) / (count - 1 || 1);
        for (let i = 0; i < count; i++) {
          const y = count === 1 ? H / 2 : yPad + i * yGap;
          nodes.push({ x, y, layer: l, idx: i, pulse: Math.random() * Math.PI * 2 });
        }
      });

      // Connect every node in layer l to every node in layer l+1
      for (let l = 0; l < numLayers - 1; l++) {
        const fromNodes = nodes.filter((n) => n.layer === l);
        const toNodes = nodes.filter((n) => n.layer === l + 1);
        for (const f of fromNodes) {
          for (const t of toNodes) {
            const hue = 210 + Math.random() * 50; // blue-purple range
            edges.push({
              from: f,
              to: t,
              progress: Math.random(),
              speed: 0.0015 + Math.random() * 0.0025,
              active: Math.random() > 0.35,
              color: hue,
              opacity: 0.08 + Math.random() * 0.15,
            });
          }
        }
      }
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      // Draw edges (synaptic connections)
      for (const e of edges) {
        if (!e.active) continue;
        const dx = e.to.x - e.from.x,
          dy = e.to.y - e.from.y;

        // Static wire
        ctx.beginPath();
        ctx.moveTo(e.from.x, e.from.y);
        ctx.lineTo(e.to.x, e.to.y);
        ctx.strokeStyle = `hsla(${e.color},40%,75%,${e.opacity})`;
        ctx.lineWidth = 0.9;
        ctx.stroke();

        // Animated signal pulse travelling along the edge
        const px = e.from.x + dx * e.progress;
        const py = e.from.y + dy * e.progress;
        const grad = ctx.createRadialGradient(px, py, 0, px, py, 6);
        grad.addColorStop(0, `hsla(${e.color},45%,80%,0.7)`);
        grad.addColorStop(1, `hsla(${e.color},45%,80%,0)`);
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        // Advance
        e.progress += e.speed;
        if (e.progress > 1) {
          e.progress = 0;
          // Randomly deactivate/activate to keep it lively
          e.active = Math.random() > 0.25;
        }
      }

      // Draw nodes
      for (const n of nodes) {
        n.pulse += 0.014;
        const glow = 0.55 + 0.45 * Math.sin(n.pulse);
        const r = 5 + 2 * glow;
        const isInput = n.layer === 0;
        const isOutput = n.layer === LAYER_SIZES.length - 1;

        // Outer glow ring
        const ringGrad = ctx.createRadialGradient(n.x, n.y, r * 0.4, n.x, n.y, r * 2.8);
        const hue = isInput ? 200 : isOutput ? 260 : 220;
        ringGrad.addColorStop(0, `hsla(${hue},45%,75%,${0.18 * glow})`);
        ringGrad.addColorStop(1, `hsla(${hue},45%,75%,0)`);
        ctx.beginPath();
        ctx.arc(n.x, n.y, r * 2.8, 0, Math.PI * 2);
        ctx.fillStyle = ringGrad;
        ctx.fill();

        // Core dot
        const dotGrad = ctx.createRadialGradient(n.x - r * 0.3, n.y - r * 0.3, 0, n.x, n.y, r);
        dotGrad.addColorStop(0, `hsla(${hue},35%,92%,0.9)`);
        dotGrad.addColorStop(1, `hsla(${hue},35%,65%,0.8)`);
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = dotGrad;
        ctx.fill();

        // Border
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = `hsla(${hue},35%,80%,0.5)`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    function loop() {
      draw();
      animId = requestAnimationFrame(loop);
    }
    const ro = new ResizeObserver(() => {
      resize();
    });
    ro.observe(cv);
    resize();
    loop();
    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 0,
      }}
    />
  );
}
