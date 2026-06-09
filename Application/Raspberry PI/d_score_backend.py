"""
d_score_backend.py
==================
Driver Distraction Severity Score (D-Score) — Hailo Production Implementation
Model: resnet18_statefarm_v5_opset14_sim.hef  (ResNet-18, 10-class State Farm)

Architecture confirmed via model inspection:
  Input  : uint8  NHWC [1, 224, 224, 3]  (quantized — no float normalisation)
  Output : float32       [1, 10]          (raw logits, softmax applied here)
  Classes: State Farm Distracted Driver Dataset (c0–c9)

Severity weights derived from empirical crash Odds Ratios:
  Dingus et al. (2016), PNAS  — SHRP2 Naturalistic Driving Study
  Klauer et al. (2014), NEJM  — 100-Car Naturalistic Driving Study

Formula:
  w(ci) = (OR_i − 1) / (OR_max − 1),  OR_max = 12.2
  D_w   = Σ P(ci) · w(ci)
  D_t   = γ · D_{t−1} + (1−γ) · D_t      (temporal smoothing)

Integration modes
-----------------
  A) hailo_inference_worker mode (main architecture):
       pipeline = DScorePipeline(driver_id="drv1", fps=30)
       result   = pipeline.process_probs(probs)   # probs from hailo queue
       ← NO VDevice opened in driver process; chip owned by hailo_inference_worker

  B) Standalone / testing mode:
       ModelRegistry.load("resnet18_statefarm_v5_opset14_sim.hef")  # once
       pipeline = DScorePipeline(driver_id="drv1", fps=30)
       result   = pipeline.process_frame(bgr_frame)   # opens VDevice internally
       ← Do NOT run simultaneously with road model or hailo_inference_worker.

Changes from ONNX version
--------------------------
  CHANGED  Import   : onnxruntime → hailo_platform
  CHANGED  Preproc  : ViT float32 NCHW + ImageNet norm → ResNet-18 uint8 NHWC
  CHANGED  ModelRegistry : ONNX InferenceSession → Hailo VDevice + network_group
  ADDED    DScorePipeline.process_probs() : accepts external probs (mode A)
  KEPT     All scoring math, smoothing, DScoreResult, DriverRegistry unchanged
"""

from __future__ import annotations

import logging
import math
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

import cv2
import numpy as np

from hailo_platform import (
    HEF, VDevice, HailoStreamInterface,
    InferVStreams, ConfigureParams,
    InputVStreamParams, OutputVStreamParams,
    FormatType,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Class registry — State Farm 10-class label set
# ---------------------------------------------------------------------------
CLASS_REGISTRY: Dict[str, dict] = {
    "c0_safe":              {"index": 0, "odds_ratio": 1.00, "description": "Safe / normal driving"},
    "c1_texting_right":     {"index": 1, "odds_ratio": 6.10, "description": "Texting — right hand"},
    "c2_phone_right":       {"index": 2, "odds_ratio": 12.20,"description": "Phone call — right hand"},
    "c3_texting_left":      {"index": 3, "odds_ratio": 6.10, "description": "Texting — left hand"},
    "c4_phone_left":        {"index": 4, "odds_ratio": 12.20,"description": "Phone call — left hand"},
    "c5_radio":             {"index": 5, "odds_ratio": 2.30, "description": "Operating radio / controls"},
    "c6_drinking":          {"index": 6, "odds_ratio": 2.99, "description": "Drinking"},
    "c7_reaching":          {"index": 7, "odds_ratio": 9.10, "description": "Reaching behind seat"},
    "c8_hair_makeup":       {"index": 8, "odds_ratio": 4.50, "description": "Hair / makeup grooming"},
    "c9_talking_passenger": {"index": 9, "odds_ratio": 1.40, "description": "Talking to passenger"},
}

_OR_MAX = max(v["odds_ratio"] for v in CLASS_REGISTRY.values())   # 12.2

SEVERITY_WEIGHTS: np.ndarray = np.array(
    [(v["odds_ratio"] - 1.0) / (_OR_MAX - 1.0) for v in CLASS_REGISTRY.values()],
    dtype=np.float32,
)

CLASS_LABELS: List[str] = list(CLASS_REGISTRY.keys())

# Input dimensions expected by the Hailo ResNet-18 HEF
_INPUT_H = 224
_INPUT_W = 224


# ---------------------------------------------------------------------------
# Preprocessing — Hailo ResNet-18 (quantized uint8 input)
# ---------------------------------------------------------------------------
def preprocess_frame_hailo(frame: np.ndarray) -> np.ndarray:
    """
    Preprocess a single BGR frame for Hailo ResNet-18 inference.

    The HEF model is fully quantized — float normalisation is baked in.
    Pipeline:
      1. Input validation
      2. Resize to 224×224  (bilinear, aspect ratio NOT preserved — matches training)
      3. BGR → RGB
      4. Add batch dimension → uint8 NHWC [1, 224, 224, 3]

    Args:
        frame: uint8 HxWx3 numpy array, BGR colour order (OpenCV default).

    Returns:
        uint8 tensor [1, 224, 224, 3] ready for Hailo UINT8 input vstream.

    Raises:
        ValueError: frame is None, wrong shape, or too small.
    """
    if frame is None:
        raise ValueError("frame must not be None.")
    if not isinstance(frame, np.ndarray):
        raise ValueError(f"frame must be a numpy array, got {type(frame).__name__}.")
    if frame.ndim != 3 or frame.shape[2] != 3:
        raise ValueError(f"Expected uint8 HxWx3 BGR image, got shape {frame.shape}.")
    if frame.shape[0] < _INPUT_H or frame.shape[1] < _INPUT_W:
        raise ValueError(
            f"Image too small {frame.shape[:2]} — "
            f"both dimensions must be >= {_INPUT_H}px."
        )
    if frame.dtype != np.uint8:
        frame = np.clip(frame, 0, 255).astype(np.uint8)

    resized = cv2.resize(frame, (_INPUT_W, _INPUT_H), interpolation=cv2.INTER_LINEAR)
    rgb     = resized[:, :, ::-1]                      # BGR → RGB
    return np.expand_dims(rgb, 0)                      # [1, 224, 224, 3] uint8


# ---------------------------------------------------------------------------
# JSON-serialisable result
# ---------------------------------------------------------------------------
@dataclass
class DScoreResult:
    """
    Full result returned per frame.
    Call .to_dict() to get a JSON-safe dict for API responses.
    """
    driver_id:        str
    d_score_raw:      float
    d_score_smoothed: float
    probabilities:    np.ndarray        # shape (10,) — internal use / display
    predicted_class:  str
    predicted_index:  int
    risk_level:       str
    class_scores:     Dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict:
        """Return a plain-Python dict safe for json.dumps()."""
        return {
            "driver_id":        self.driver_id,
            "d_score_raw":      round(float(self.d_score_raw),      4),
            "d_score_smoothed": round(float(self.d_score_smoothed), 4),
            "predicted_class":  self.predicted_class,
            "predicted_index":  int(self.predicted_index),
            "risk_level":       self.risk_level,
            "probabilities":    [round(float(p), 4) for p in self.probabilities],
            "class_scores":     {k: round(float(v), 4) for k, v in self.class_scores.items()},
        }

    def __str__(self) -> str:
        lines = [
            f"Driver          : {self.driver_id}",
            f"D_score (smooth): {self.d_score_smoothed:.4f}  [{self.risk_level}]",
            f"D_score (raw)   : {self.d_score_raw:.4f}",
            f"Predicted class : {self.predicted_class}"
            f"  (p={self.probabilities[self.predicted_index]:.3f})",
            "Top contributions:",
        ]
        for label, score in sorted(
            self.class_scores.items(), key=lambda x: x[1], reverse=True
        )[:3]:
            lines.append(f"  {label:<26}  weighted={score:.4f}")
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# ModelRegistry — Hailo singleton for standalone / testing use
#
# NOT needed when hailo_inference_worker owns the VDevice (main architecture).
# In that mode, skip ModelRegistry entirely and call pipeline.process_probs().
# ---------------------------------------------------------------------------
class ModelRegistry:
    """
    Singleton that holds ONE Hailo VDevice + network_group for the HEF model.

    Load once at standalone startup; share across all DScorePipeline instances.
    Thread-safe inference via per-call activate/deactivate.

    ⚠ Conflict warning: Do NOT call ModelRegistry.load() in a process that
       shares a Hailo chip with hailo_inference_worker — both would try to
       own the same VDevice.  Use DScorePipeline.process_probs() instead.
    """
    _hef:         Optional[HEF]     = None
    _target:      Optional[VDevice] = None   # kept alive for process lifetime
    _ng                             = None   # ConfiguredNetwork
    _in_p                           = None   # InputVStreamParams
    _out_p                          = None   # OutputVStreamParams
    _input_name:  Optional[str]     = None
    _output_name: Optional[str]     = None
    _lock:        threading.Lock    = threading.Lock()
    _infer_lock:  threading.Lock    = threading.Lock()  # serialises chip access

    @classmethod
    def load(cls, model_path: str | Path) -> None:
        """
        Load HEF and open VDevice.  Call exactly once at standalone startup.

        Args:
            model_path: path to .hef file (ResNet-18 StateFarm).
        """
        model_path = Path(model_path)
        if not model_path.exists():
            raise FileNotFoundError(f"HEF model not found: {model_path}")
        with cls._lock:
            if cls._ng is not None:
                logger.warning("ModelRegistry: already loaded — skipping.")
                return
            cls._hef    = HEF(str(model_path))
            cls._target = VDevice()
            cls._ng     = cls._target.configure(
                cls._hef,
                ConfigureParams.create_from_hef(
                    cls._hef, interface=HailoStreamInterface.PCIe
                ),
            )[0]
            cls._in_p  = InputVStreamParams.make_from_network_group(
                cls._ng, format_type=FormatType.UINT8,   quantized=True)
            cls._out_p = OutputVStreamParams.make_from_network_group(
                cls._ng, format_type=FormatType.FLOAT32, quantized=False)
            cls._input_name  = cls._hef.get_input_vstream_infos()[0].name
            cls._output_name = cls._hef.get_output_vstream_infos()[0].name
        logger.info(
            "ModelRegistry: loaded %s (Hailo ResNet-18)  "
            "input=%s  output=%s",
            model_path.name, cls._input_name, cls._output_name,
        )

    @classmethod
    def infer(cls, tensor: np.ndarray) -> np.ndarray:
        """
        Thread-safe Hailo inference.  Returns softmax probabilities (10,).

        Args:
            tensor: uint8 [1, 224, 224, 3] from preprocess_frame_hailo().

        Raises:
            RuntimeError: load() was not called first.
        """
        if cls._ng is None:
            raise RuntimeError(
                "ModelRegistry.load() must be called at startup "
                "before running any inference."
            )
        with cls._infer_lock:
            with cls._ng.activate(cls._ng.create_params()):
                with InferVStreams(cls._ng, cls._in_p, cls._out_p) as pipe:
                    raw = pipe.infer({cls._input_name: tensor})

        logits  = raw[cls._output_name][0].astype(np.float32)   # (10,)
        shifted = logits - logits.max()
        exp     = np.exp(shifted)
        return (exp / exp.sum()).astype(np.float32)

    @classmethod
    def is_loaded(cls) -> bool:
        return cls._ng is not None


# ---------------------------------------------------------------------------
# Core scoring functions — model-independent, unchanged from ONNX version
# ---------------------------------------------------------------------------

def compute_d_score(
    probabilities: np.ndarray,
) -> tuple[float, Dict[str, float]]:
    """
    Compute severity-weighted distraction score.

    Formula (Dingus et al. 2016 / Klauer et al. 2014):
        w(ci) = (OR_i − 1) / (OR_max − 1)
        D_w   = Σ P(ci) · w(ci)

    Returns:
        d_score:      float in [0, 1].
        class_scores: per-class contribution {label: P_i * w_i}.
    """
    if probabilities.shape != (10,):
        raise ValueError(
            f"Expected probabilities shape (10,), got {probabilities.shape}."
        )
    weighted     = probabilities * SEVERITY_WEIGHTS
    d_score      = float(weighted.sum())
    class_scores = {label: float(weighted[i]) for i, label in enumerate(CLASS_LABELS)}
    return d_score, class_scores


def smooth_d_score(
    d_current:  float,
    d_previous: Optional[float],
    gamma:      float,
) -> float:
    """
    Exponential moving average: D_t = γ · D_{t−1} + (1−γ) · D_current

    Args:
        d_current:  Raw D score for this frame.
        d_previous: Smoothed D score from previous frame (None on cold start).
        gamma:      Use gamma_from_fps() — do not hardcode.
    """
    if not (0.0 <= gamma <= 1.0):
        raise ValueError(f"gamma must be in [0, 1], got {gamma}.")
    if d_previous is None:
        return d_current
    return gamma * d_previous + (1.0 - gamma) * d_current


def gamma_from_fps(fps: float, window_seconds: float = 0.5) -> float:
    """
    Compute gamma so the smoothing window is correct for any fps.

    Args:
        fps:            Camera / stream frame rate.
        window_seconds: Desired smoothing window (default 0.5 s).

    Examples:
        gamma_from_fps(25, 0.5)  →  0.9231
        gamma_from_fps(10, 0.5)  →  0.8187
        gamma_from_fps(30, 0.5)  →  0.9355
    """
    if fps <= 0:
        raise ValueError(f"fps must be > 0, got {fps}.")
    return float(math.exp(-1.0 / (window_seconds * fps)))


def _classify_risk(d_smooth: float) -> str:
    """Map smoothed D score to three-level risk category."""
    if d_smooth < 0.25:
        return "Safe"
    if d_smooth < 0.55:
        return "Caution"
    return "Critical"


# ---------------------------------------------------------------------------
# Thread-safe per-driver pipeline
# ---------------------------------------------------------------------------
class DScorePipeline:
    """
    Stateful per-driver pipeline: preprocess → infer → D score → smooth.

    Two usage modes
    ---------------
    A) hailo_inference_worker (main architecture) — call process_probs():
         pipeline = DScorePipeline("drv1", fps=30)
         result   = pipeline.process_probs(probs_from_queue)

    B) Standalone / testing — call process_frame():
         ModelRegistry.load("resnet18_statefarm_v5_opset14_sim.hef")
         pipeline = DScorePipeline("drv1", fps=25)
         result   = pipeline.process_frame(bgr_frame)
    """

    def __init__(
        self,
        driver_id:      str,
        fps:            float = 25.0,
        window_seconds: float = 0.5,
    ) -> None:
        self.driver_id       = driver_id
        self.gamma           = gamma_from_fps(fps, window_seconds)
        self._d_smooth_prev: Optional[float] = None
        self._lock           = threading.Lock()
        logger.info(
            "DScorePipeline: driver=%s  fps=%.1f  gamma=%.4f",
            driver_id, fps, self.gamma,
        )

    # ── Mode A: external probs from hailo_inference_worker ────────────────────

    def process_probs(self, probs: np.ndarray) -> DScoreResult:
        """
        Main-architecture path: compute D-Score from pre-computed Hailo probs.

        Runs scoring + EMA smoothing.  No chip access.

        Args:
            probs: float32 (10,) softmax probabilities from hailo_inference_worker.

        Returns:
            DScoreResult — call .to_dict() for JSON / queue serialisation.
        """
        if probs.shape != (10,):
            raise ValueError(f"Expected probs shape (10,), got {probs.shape}.")

        d_raw, class_scores = compute_d_score(probs)

        with self._lock:
            d_smooth            = smooth_d_score(d_raw, self._d_smooth_prev, self.gamma)
            self._d_smooth_prev = d_smooth

        pred_idx = int(probs.argmax())
        return DScoreResult(
            driver_id        = self.driver_id,
            d_score_raw      = d_raw,
            d_score_smoothed = d_smooth,
            probabilities    = probs,
            predicted_class  = CLASS_LABELS[pred_idx],
            predicted_index  = pred_idx,
            risk_level       = _classify_risk(d_smooth),
            class_scores     = class_scores,
        )

    # ── Mode B: standalone Hailo inference ────────────────────────────────────

    def process_frame(self, frame: np.ndarray) -> DScoreResult:
        """
        Standalone path: full pipeline including Hailo inference.

        Requires ModelRegistry.load() to have been called at startup.

        ⚠ Do NOT call in a process that shares the chip with
          hailo_inference_worker.  Use process_probs() instead.

        Args:
            frame: uint8 HxWx3 BGR image from OpenCV / dashcam.

        Returns:
            DScoreResult.

        Raises:
            ValueError:   bad frame input.
            RuntimeError: ModelRegistry not initialised.
        """
        try:
            tensor = preprocess_frame_hailo(frame)
        except ValueError as exc:
            logger.error("driver=%s preprocess error: %s", self.driver_id, exc)
            raise

        try:
            probs = ModelRegistry.infer(tensor)
        except Exception as exc:
            logger.error("driver=%s Hailo inference error: %s", self.driver_id, exc)
            raise

        return self.process_probs(probs)

    def reset(self) -> None:
        """Clear smoothing history.  Call at start of each new driving trip."""
        with self._lock:
            self._d_smooth_prev = None
        logger.info("DScorePipeline: driver=%s state reset.", self.driver_id)


# ---------------------------------------------------------------------------
# Per-driver registry for multi-driver backends
# ---------------------------------------------------------------------------
class DriverRegistry:
    """
    Manages one DScorePipeline per driver_id.

    Useful for backends monitoring multiple cameras simultaneously.

    Standalone usage:
        ModelRegistry.load("resnet18_statefarm_v5_opset14_sim.hef")
        registry = DriverRegistry(fps=25)
        result   = registry.process_frame("driver_42", bgr_frame)
        registry.reset_driver("driver_42")
        registry.remove_driver("driver_42")

    For hailo_inference_worker architecture, call registry.get_pipeline()
    and use process_probs() directly.
    """

    def __init__(self, fps: float = 25.0, window_seconds: float = 0.5):
        self._fps            = fps
        self._window_seconds = window_seconds
        self._pipelines: Dict[str, DScorePipeline] = {}
        self._lock = threading.Lock()

    def _get_or_create(self, driver_id: str) -> DScorePipeline:
        with self._lock:
            if driver_id not in self._pipelines:
                self._pipelines[driver_id] = DScorePipeline(
                    driver_id      = driver_id,
                    fps            = self._fps,
                    window_seconds = self._window_seconds,
                )
        return self._pipelines[driver_id]

    def process_frame(self, driver_id: str, frame: np.ndarray) -> DScoreResult:
        """Standalone: route frame to correct driver pipeline (creates if needed)."""
        return self._get_or_create(driver_id).process_frame(frame)

    def process_probs(self, driver_id: str, probs: np.ndarray) -> DScoreResult:
        """hailo_inference_worker mode: route probs to correct driver pipeline."""
        return self._get_or_create(driver_id).process_probs(probs)

    def reset_driver(self, driver_id: str) -> None:
        """Reset smoothing state for one driver (new trip)."""
        with self._lock:
            if driver_id in self._pipelines:
                self._pipelines[driver_id].reset()

    def remove_driver(self, driver_id: str) -> None:
        """Remove driver pipeline when session ends."""
        with self._lock:
            self._pipelines.pop(driver_id, None)
        logger.info("DriverRegistry: removed driver=%s", driver_id)

    def active_drivers(self) -> List[str]:
        with self._lock:
            return list(self._pipelines.keys())


# ---------------------------------------------------------------------------
# Backend integration examples (updated for Hailo)
# ---------------------------------------------------------------------------

FASTAPI_EXAMPLE = '''
# ── FastAPI integration (Hailo, hailo_inference_worker mode) ────────────────
from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, HTTPException
import cv2, numpy as np
from d_score_backend import DriverRegistry

registry = DriverRegistry(fps=25)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # ModelRegistry.load() NOT called — hailo_inference_worker owns the chip.
    yield

app = FastAPI(lifespan=lifespan)

@app.post("/score/{driver_id}")
async def score_frame(driver_id: str, probs: list[float]):
    """Receive pre-computed probs from hailo_inference_worker queue."""
    probs_arr = np.array(probs, dtype=np.float32)
    result    = registry.process_probs(driver_id, probs_arr)
    return result.to_dict()
'''

STANDALONE_EXAMPLE = '''
# ── Standalone / testing (Hailo, single process) ───────────────────────────
from d_score_backend import ModelRegistry, DScorePipeline

ModelRegistry.load("resnet18_statefarm_v5_opset14_sim.hef")   # once at startup
pipeline = DScorePipeline("driver_01", fps=25)

import cv2
cap = cv2.VideoCapture(0)
while cap.isOpened():
    ret, frame = cap.read()
    if not ret: break
    result = pipeline.process_frame(frame)          # Hailo inference inside
    print(result.d_score_smoothed, result.risk_level, result.predicted_class)
cap.release()
'''


# ---------------------------------------------------------------------------
# Self-test  (python d_score_backend.py)
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import json, sys, time
    from pathlib import Path

    MODEL_PATH = Path("resnet18_statefarm_v5_opset14_sim.hef")
    if not MODEL_PATH.exists():
        print("ERROR: place resnet18_statefarm_v5_opset14_sim.hef in this folder.")
        sys.exit(1)

    # Startup — load Hailo model once
    ModelRegistry.load(MODEL_PATH)

    print("=" * 60)
    print("GAMMA BY FPS  (0.5 s smoothing window)")
    print("=" * 60)
    for fps in [1, 5, 10, 15, 25, 30]:
        print(f"  {fps:3d} fps  ->  gamma = {gamma_from_fps(fps, 0.5):.4f}")

    # Single driver, 10 frames
    print("\n" + "=" * 60)
    print("SINGLE DRIVER — 10-frame sequence (Hailo inference)")
    print("=" * 60)
    pipeline   = DScorePipeline(driver_id="driver_01", fps=25)
    fake_frame = (np.random.rand(480, 640, 3) * 255).astype(np.uint8)

    for i in range(10):
        result = pipeline.process_frame(fake_frame)
        print(
            f"Frame {i+1:02d} | "
            f"D_raw={result.d_score_raw:.4f}  "
            f"D_smooth={result.d_score_smoothed:.4f}  "
            f"[{result.risk_level:<8}]  "
            f"pred={result.predicted_class}"
        )

    print("\nFull result (last frame):")
    print(result)
    print("\nJSON output:")
    print(json.dumps(result.to_dict(), indent=2))

    # process_probs() path (hailo_inference_worker mode)
    print("\n" + "=" * 60)
    print("process_probs() PATH  (hailo_inference_worker mode)")
    print("=" * 60)
    pipeline2 = DScorePipeline(driver_id="driver_02", fps=30)
    fake_probs = np.array([0.7, 0.1, 0.05, 0.05, 0.02, 0.02, 0.02, 0.01, 0.01, 0.02],
                          dtype=np.float32)
    fake_probs /= fake_probs.sum()
    r2 = pipeline2.process_probs(fake_probs)
    print(f"  D_smooth={r2.d_score_smoothed:.4f}  [{r2.risk_level}]  pred={r2.predicted_class}")

    # Multi-driver
    print("\n" + "=" * 60)
    print("MULTI-DRIVER registry")
    print("=" * 60)
    registry = DriverRegistry(fps=25)
    for driver in ["driver_A", "driver_B", "driver_C"]:
        r = registry.process_frame(driver, fake_frame)
        print(f"  {driver}  D={r.d_score_smoothed:.4f}  [{r.risk_level}]")
    print(f"  Active: {registry.active_drivers()}")

    # Latency
    print("\n" + "=" * 60)
    print("LATENCY BENCHMARK  (20 frames, Hailo)")
    print("=" * 60)
    times = []
    for _ in range(20):
        t0 = time.perf_counter()
        pipeline.process_frame(fake_frame)
        times.append((time.perf_counter() - t0) * 1000)
    print(f"  Mean : {np.mean(times):.1f} ms")
    print(f"  P95  : {np.percentile(times, 95):.1f} ms")
    print(f"  Max  : {np.max(times):.1f} ms")
    print(f"  Max throughput: ~{1000/np.mean(times):.0f} fps")