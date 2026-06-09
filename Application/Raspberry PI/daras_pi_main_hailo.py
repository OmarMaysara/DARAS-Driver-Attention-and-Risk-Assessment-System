"""
daras_pi_main_hailo.py
======================
Dual-model driver-monitoring pipeline with Hailo-8 inference.

Inference method: single Hailo chip, time-sliced between two HEF models,
mirroring the activate → InferVStreams → deactivate pattern from multi.py.

HailoRT constraint: only ONE network group active at a time.
Solution: a dedicated hailo_inference_worker process owns the VDevice and
alternates between road (YOLO26n) and driver (ResNet-18) slots. Camera
workers communicate via mp.Queue — no direct chip access outside that process.

Changes in this revision
-------------------------
  [1] DScorePipeline (d_score_backend) used directly in driver_vision_worker —
      all local overrides of severity weights, EMA, DriverResult removed.
  [2] HScoreEngine   (hscore_engine)   used directly in road_vision_worker —
      all local overrides of proximity, urgency, build_road_results removed.
  [3] Risk score formula → 0.6 × D-Score  +  0.4 × H-Score.
  [4] Ego-lane coordinate handling unified: calibration.json absolute-pixel
      nodes now handled correctly in both the proximity scorer (hscore_engine
      fix) and all draw helpers, using the same auto-detection logic throughout.
  [5] draw_driver_overlay: Safe/Caution/Critical badges removed; replaced with
      GREEN "SAFE DRIVING" or RED "DISTRACTED" based on predicted class.
  [6] draw_road_overlay: SAFE / CAUTION / DANGER badge driven by
      ROAD_CAUTION_THRESHOLD and ROAD_DANGER_THRESHOLD (both = 1.0 initially).
"""

import multiprocessing as mp
import time
import requests
import cv2
import json
import base64
import os
import math
import numpy as np
import subprocess
from datetime import datetime, timezone

# ── Authoritative scoring engines (no local overrides) ─────────────────────
from d_score_backend import DScorePipeline
from hscore_engine   import HScoreEngine

# ── Hailo platform (replaces onnxruntime for both models) ──────────────────
from hailo_platform import (
    HEF, VDevice, HailoStreamInterface,
    InferVStreams, ConfigureParams,
    InputVStreamParams, OutputVStreamParams,
    FormatType,
)

# ==========================================
# CONFIGURATION
# ==========================================

API_BASE_URL = "https://unwistful-doleritic-elissa.ngrok-free.dev/api/v1"
API_KEY      = "bc95804a52915d85df7362d7de62871b"
HEADERS      = {"x-api-key": API_KEY}

ROAD_CAM_INDEX   = 2
DRIVER_CAM_INDEX = 0

ROAD_MODEL_HEF   = "yolo26n.hef"
DRIVER_MODEL_HEF = "resnet18_statefarm_v5_opset14_sim.hef"

RISK_THRESHOLD            = 0.75
BATCH_UPLOAD_INTERVAL_SEC = 600

# ==========================================
# ROAD RISK DISPLAY THRESHOLDS  (user-adjustable)
# ==========================================
# H-Score value at which the road overlay badge switches level.
# Both set to 1.0 now so badge always shows SAFE until you lower them.
ROAD_CAUTION_THRESHOLD = 1.0   # h_score ≥ this  → CAUTION
ROAD_DANGER_THRESHOLD  = 1.0   # h_score ≥ this  → DANGER  (must be ≥ CAUTION)

# ==========================================
# CAMERA INTRINSICS (fixed)
# ==========================================
FY = 884.0275284094906
CY = 315.80857457135204

READINGS_DIR = "readings"
if not os.path.exists(READINGS_DIR):
    os.makedirs(READINGS_DIR)
    print(f"[SYSTEM] Created {READINGS_DIR} directory for batch logs.")

# TOGGLE DISPLAY HERE
SHOW_WINDOWS  = True

# ── Recording ──────────────────────────────────────────────────────────────
RECORD_VIDEO  = True
RECORD_FPS    = 20.0
RECORD_FOURCC = "mp4v"

RECORDINGS_DIR = "recordings"
if not os.path.exists(RECORDINGS_DIR):
    os.makedirs(RECORDINGS_DIR)
    print(f"[SYSTEM] Created {RECORDINGS_DIR} directory for video recordings.")

# ==========================================
# HAILO INFERENCE CONSTANTS
# ==========================================
# ── Road / YOLO26n ─────────────────────────────────────────────────────────
YOLO_CLASSES     = ['car', 'person', 'rider']
YOLO_NUM_CLS     = len(YOLO_CLASSES)
YOLO_CONF_THRESH = 0.30
YOLO_NMS_THRESH  = 0.40
YOLO_INPUT_SIZE  = 640

# Output layer names → decoding stride
YOLO_OUTPUT_LAYERS = [
    ('yolo26n/conv61', 'yolo26n/conv64',  8),
    ('yolo26n/conv77', 'yolo26n/conv80', 16),
    ('yolo26n/conv91', 'yolo26n/conv94', 32),
]

# ── Driver / ResNet-18 ──────────────────────────────────────────────────────
DRIVER_INPUT_SIZE = 224

# ==========================================
# DISPLAY OVERLAY HELPERS
# ==========================================
_CLASS_DISPLAY = {
    "c0_safe":              "Safe driving",
    "c1_texting_right":     "Texting (R)",
    "c2_phone_right":       "Phone call (R)",
    "c3_texting_left":      "Texting (L)",
    "c4_phone_left":        "Phone call (L)",
    "c5_radio":             "Radio/controls",
    "c6_drinking":          "Drinking",
    "c7_reaching":          "Reaching behind",
    "c8_hair_makeup":       "Hair/makeup",
    "c9_talking_passenger": "Talking to pass.",
}

def _score_color(score: float) -> tuple:
    """Continuous 0→1 color: green → orange → red."""
    if score < 0.4: return (60, 210, 60)
    if score < 0.7: return (30, 165, 255)
    return (40, 40, 220)

def _draw_panel(frame, x, y, w, h, alpha=0.55):
    overlay = frame.copy()
    cv2.rectangle(overlay, (x, y), (x + w, y + h), (15, 15, 15), -1)
    cv2.addWeighted(overlay, alpha, frame, 1 - alpha, 0, frame)

def _bar(frame, x, y, value, bar_w=110, bar_h=9, color=(60, 210, 60)):
    cv2.rectangle(frame, (x, y), (x + bar_w, y + bar_h), (60, 60, 60), -1)
    filled = int(bar_w * max(0.0, min(1.0, value)))
    if filled > 0:
        cv2.rectangle(frame, (x, y), (x + filled, y + bar_h), color, -1)

def _text(frame, txt, x, y, color=(220, 220, 220), scale=0.48, thickness=1):
    cv2.putText(frame, txt, (x, y), cv2.FONT_HERSHEY_SIMPLEX, scale, color, thickness, cv2.LINE_AA)


def draw_driver_overlay(frame, result):
    """
    Driver HUD — binary colour scheme:
      GREEN  →  c0_safe (safe driving)
      RED    →  any other class (distraction detected)

    Risk-level badges (Safe/Caution/Critical) have been removed.
    result is a DScoreResult from DScorePipeline.process_probs().
    """
    PX, PY, PW, PH = 10, 10, 235, 190
    _draw_panel(frame, PX, PY, PW, PH)
    _text(frame, "DRIVER MONITOR", PX + 8, PY + 18, color=(180, 180, 180), scale=0.46)
    cv2.line(frame, (PX + 6, PY + 23), (PX + PW - 6, PY + 23), (60, 60, 60), 1)

    # ── Binary safe / distracted colour ────────────────────────────────────
    is_safe   = (result.predicted_class == "c0_safe")
    state_col = (60, 210, 60) if is_safe else (40, 40, 220)   # green : red

    # D-Score value + bar
    _text(frame, "D-Score", PX + 8,  PY + 42, color=(160, 160, 160), scale=0.42)
    _text(frame, f"{result.d_score_smoothed:.3f}", PX + 78, PY + 42,
          color=state_col, scale=0.55, thickness=1)
    _bar(frame, PX + 8, PY + 47, result.d_score_smoothed, bar_w=PW - 22, color=state_col)

    # Status label — replaces Safe/Caution/Critical badge
    status_txt = "SAFE DRIVING" if is_safe else "DISTRACTED"
    _text(frame, status_txt, PX + 8, PY + 68, color=state_col, scale=0.46, thickness=1)

    # Predicted class in matching colour
    label = _CLASS_DISPLAY.get(result.predicted_class, result.predicted_class)
    _text(frame, f"Class: {label}", PX + 8, PY + 87, color=state_col, scale=0.42)

    cv2.line(frame, (PX + 6, PY + 95), (PX + PW - 6, PY + 95), (50, 50, 50), 1)
    _text(frame, "Top Distractions", PX + 8, PY + 107, color=(130, 130, 130), scale=0.38)

    top3 = sorted(
        ((k, v) for k, v in result.class_scores.items() if k != "c0_safe"),
        key=lambda x: x[1], reverse=True
    )[:3]
    max_val = max((v for _, v in top3), default=1e-6)

    for i, (cls_key, wval) in enumerate(top3):
        row_y = PY + 122 + i * 24
        lbl   = _CLASS_DISPLAY.get(cls_key, cls_key)[:17]
        norm  = wval / max_val if max_val > 0 else 0.0
        _text(frame, lbl, PX + 8, row_y, color=(190, 190, 190), scale=0.38)
        _bar(frame, PX + 8, row_y + 4, norm, bar_w=PW - 22, bar_h=8,
             color=_score_color(norm))


def draw_road_overlay(frame, display_pkg: dict):
    """
    Road HUD — threshold-based SAFE / CAUTION / DANGER badge driven by
    ROAD_CAUTION_THRESHOLD and ROAD_DANGER_THRESHOLD module constants.

    Both thresholds default to 1.0 so everything shows SAFE until the user
    lowers them to meaningful values.

    results in display_pkg come from HScoreEngine.process_frame_with_detections().
    """
    results       = display_pkg.get("results", [])
    ego_lane_poly = display_pkg.get("ego_lane_poly", [])

    if ego_lane_poly and len(ego_lane_poly) >= 3:
        pts = np.array(ego_lane_poly, dtype=np.int32).reshape((-1, 1, 2))
        overlay = frame.copy()
        cv2.fillPoly(overlay, [pts], (255, 230, 0))
        cv2.addWeighted(overlay, 0.12, frame, 0.88, 0, frame)
        cv2.polylines(frame, [pts], isClosed=True, color=(0, 220, 255), thickness=2)

    if results:
        worst_id = max(results, key=lambda r: r["hscore"])["track_id"]
        for r in results:
            x1, y1, x2, y2 = r["box"]
            is_worst  = r["track_id"] == worst_id
            box_col   = (0, 0, 220) if is_worst else (60, 180, 60)
            thickness = 3           if is_worst else 1
            cv2.rectangle(frame, (x1, y1), (x2, y2), box_col, thickness)
            lbl_y = max(y1 - 4, 12)
            _text(frame, f"{r['cls_name']} {r['hscore']:.2f}", x1 + 2, lbl_y,
                  color=box_col, scale=0.40, thickness=1)

    if results:
        rd       = max(results, key=lambda r: r["hscore"])
        h_score  = rd["hscore"]
        dist_m   = rd["distance"]
        prox     = rd["proximity"]
        urgency  = rd["components"]["urgency"]
        obj_type = rd["cls_name"]
        ttc      = rd["ttc"]
    else:
        h_score = dist_m = prox = urgency = 0.0
        obj_type = "none"
        ttc = None

    # ── Threshold-based road status ─────────────────────────────────────────
    if h_score >= ROAD_DANGER_THRESHOLD:
        road_status, status_col = "DANGER",  (40, 40, 220)    # red
    elif h_score >= ROAD_CAUTION_THRESHOLD:
        road_status, status_col = "CAUTION", (30, 165, 255)   # orange
    else:
        road_status, status_col = "SAFE",    (60, 210, 60)    # green

    PX, PY, PW, PH = 10, 10, 235, 218
    _draw_panel(frame, PX, PY, PW, PH)
    _text(frame, "ROAD MONITOR", PX + 8, PY + 18, color=(180, 180, 180), scale=0.46)
    cv2.line(frame, (PX + 6, PY + 23), (PX + PW - 6, PY + 23), (60, 60, 60), 1)

    _text(frame, "H-Score", PX + 8,  PY + 42, color=(160, 160, 160), scale=0.42)
    _text(frame, f"{h_score:.3f}",   PX + 78, PY + 42,
          color=status_col, scale=0.55, thickness=1)
    _bar(frame, PX + 8, PY + 47, h_score, bar_w=PW - 22, color=status_col)

    # SAFE / CAUTION / DANGER badge
    bw_badge = len(road_status) * 9 + 10
    cv2.rectangle(frame,
                  (PX + 8,           PY + 57),
                  (PX + 8 + bw_badge, PY + 73),
                  status_col, -1)
    _text(frame, road_status, PX + 13, PY + 69,
          color=(10, 10, 10), scale=0.44, thickness=1)

    cv2.line(frame, (PX + 6, PY + 79), (PX + PW - 6, PY + 79), (50, 50, 50), 1)

    obj_lbl = obj_type if obj_type != "none" else "\u2014"
    _text(frame, f"Object:   {obj_lbl}", PX + 8, PY + 95, color=(210, 210, 210), scale=0.43)

    if dist_m > 0:
        dist_col = (60, 210, 60) if dist_m > 5 else (30, 165, 255) if dist_m > 2 else (40, 40, 220)
        dist_str = f"{dist_m:.1f} m"
    else:
        dist_col, dist_str = (110, 110, 110), "\u2014"
    _text(frame, f"Distance: {dist_str}", PX + 8, PY + 112, color=dist_col, scale=0.43)

    in_lane  = prox >= 1.0
    lane_col = (40, 40, 220) if in_lane else (60, 210, 60)
    cv2.line(frame, (PX + 6, PY + 122), (PX + PW - 6, PY + 122), (50, 50, 50), 1)
    _text(frame, f"Ego-Lane Prox: {prox:.2f}", PX + 8, PY + 136,
          color=(210, 210, 210), scale=0.43)
    badge_txt = "IN LANE" if in_lane else "OUT"
    bw_lane = len(badge_txt) * 8 + 8
    cv2.rectangle(frame,
                  (PX + PW - bw_lane - 4, PY + 125),
                  (PX + PW - 4,           PY + 139),
                  lane_col, -1)
    _text(frame, badge_txt, PX + PW - bw_lane, PY + 137,
          color=(10, 10, 10), scale=0.38, thickness=1)

    cv2.line(frame, (PX + 6, PY + 154), (PX + PW - 6, PY + 154), (50, 50, 50), 1)
    urg_col = _score_color(urgency)
    ttc_str = "---" if ttc is None else (">99s" if ttc >= 99.0 else f"{ttc:.1f}s")
    _text(frame, f"Urgency: {urgency:.3f}   TTC: {ttc_str}", PX + 8, PY + 170,
          color=(210, 210, 210), scale=0.40)
    _bar(frame, PX + 8, PY + 175, urgency, bar_w=PW - 22, color=urg_col)


def draw_ego_lane(frame, calib: dict, img_w: int, img_h: int):
    """
    Draw the ego-lane polygon from calibration.json onto frame.

    Coordinate auto-detection (same logic used in HScoreEngine._EgoLaneProximity):
      • All x ≤ 1.0 AND all y ≤ 1.0  →  normalised [0-1] fractions
      • Values fit within frame size   →  absolute pixels, same resolution
      • Values exceed frame size       →  absolute pixels, scaled to fit
    Falls back to a default centre trapezoid when no valid nodes are present.
    """
    nodes     = calib.get("ego_lane_nodes", [])
    pts       = None
    label_txt = "EGO LANE (default)"

    if nodes and len(nodes) >= 3:
        try:
            raw = [(float(n["x"]), float(n["y"])) for n in nodes]

            max_x = max(p[0] for p in raw)
            max_y = max(p[1] for p in raw)

            if max_x <= 1.0 and max_y <= 1.0:
                # Normalised [0-1] fractions
                pixel_pts = [(int(x * img_w), int(y * img_h)) for x, y in raw]
            elif max_x <= img_w and max_y <= img_h:
                # Absolute pixels from same camera resolution
                pixel_pts = [(int(x), int(y)) for x, y in raw]
            else:
                # Absolute pixels from a different resolution — scale to fit
                pixel_pts = [(int(x / max_x * img_w), int(y / max_y * img_h))
                             for x, y in raw]

            pts       = np.array(pixel_pts, dtype=np.int32)
            label_txt = "EGO LANE"
        except Exception as e:
            print(f"[EGO LANE] Could not parse nodes ({e}), falling back to default.")
            pts = None

    if pts is None:
        print("[EGO LANE] No valid nodes in calibration — drawing default trapezoid.")
        cx  = img_w / 2.0
        pts = np.array([
            (int(cx - 0.075 * img_w), int(0.55 * img_h)),
            (int(cx + 0.075 * img_w), int(0.55 * img_h)),
            (int(cx + 0.275 * img_w), int(0.98 * img_h)),
            (int(cx - 0.275 * img_w), int(0.98 * img_h)),
        ], dtype=np.int32)

    poly = pts.reshape((-1, 1, 2))
    overlay = frame.copy()
    cv2.fillPoly(overlay, [poly], (0, 200, 80))
    cv2.addWeighted(overlay, 0.20, frame, 0.80, 0, frame)
    cv2.polylines(frame, [poly], isClosed=True, color=(0, 220, 255), thickness=2)

    top_y  = max(int(pts[:, 1].min()) - 6, 14)
    left_x = int(pts[:, 0].min()) + 4
    cv2.putText(frame, label_txt, (left_x, top_y),
                cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 220, 255), 1, cv2.LINE_AA)


# ==========================================
# VIDEO RECORDING HELPER
# ==========================================
def _make_writer(label: str, frame_w: int, frame_h: int) -> cv2.VideoWriter:
    ts  = datetime.now().strftime("%Y%m%d_%H%M%S")
    ext = "mp4" if RECORD_FOURCC == "mp4v" else "avi"
    path   = os.path.join(RECORDINGS_DIR, f"{label}_{ts}.{ext}")
    fourcc = cv2.VideoWriter_fourcc(*RECORD_FOURCC)
    writer = cv2.VideoWriter(path, fourcc, RECORD_FPS, (frame_w, frame_h))
    print(f"[RECORD] {label} → {path}  ({frame_w}×{frame_h} @ {RECORD_FPS} fps)")
    return writer


# ==========================================
# HAILO YOLO INFERENCE HELPERS
# ==========================================
def preprocess_yolo_hailo(frame: np.ndarray) -> np.ndarray:
    """Resize + BGR→RGB, return (1, 640, 640, 3) uint8 batch tensor."""
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    return np.expand_dims(cv2.resize(rgb, (YOLO_INPUT_SIZE, YOLO_INPUT_SIZE)), 0)

def _sigmoid(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, -88, 88)
    return 1.0 / (1.0 + np.exp(-x))

def _decode_yolo_scale(reg: np.ndarray, cls_logits: np.ndarray, stride: int):
    """Decode one scale of DFL-free YOLO26n output."""
    H, W = reg.shape[:2]
    gx, gy = np.meshgrid(np.arange(W), np.arange(H))
    grid     = np.stack((gx, gy), axis=-1).reshape(-1, 2) + 0.5
    reg_flat = reg.reshape(-1, 4)
    cls_flat = _sigmoid(cls_logits.reshape(-1, YOLO_NUM_CLS))
    scores   = cls_flat.max(axis=-1)
    mask     = scores > YOLO_CONF_THRESH
    if not mask.any():
        return [], [], []
    g, r, s, ci = grid[mask], reg_flat[mask], scores[mask], cls_flat[mask].argmax(axis=-1)
    xmin = (g[:, 0] - r[:, 0]) * stride
    ymin = (g[:, 1] - r[:, 1]) * stride
    w    = (g[:, 0] + r[:, 2]) * stride - xmin
    h    = (g[:, 1] + r[:, 3]) * stride - ymin
    return np.stack((xmin, ymin, w, h), axis=-1).tolist(), s.tolist(), ci.tolist()

def postprocess_yolo_hailo(raw: dict, orig_h: int, orig_w: int) -> list:
    """
    Decode multi-scale YOLO26n Hailo outputs → list of
    (x1, y1, x2, y2, score, class_id) in original image pixel coords.
    """
    all_b, all_s, all_i = [], [], []
    for reg_key, cls_key, stride in YOLO_OUTPUT_LAYERS:
        b, s, i = _decode_yolo_scale(raw[reg_key][0], raw[cls_key][0], stride)
        all_b += b;  all_s += s;  all_i += i
    if not all_b:
        return []
    idxs = cv2.dnn.NMSBoxes(all_b, all_s, YOLO_CONF_THRESH, YOLO_NMS_THRESH)
    if len(idxs) == 0:
        return []
    sx, sy = orig_w / YOLO_INPUT_SIZE, orig_h / YOLO_INPUT_SIZE
    out = []
    for idx in idxs.flatten():
        bx, by, bw, bh = all_b[idx]
        out.append((int(bx * sx), int(by * sy),
                    int((bx + bw) * sx), int((by + bh) * sy),
                    float(all_s[idx]), int(all_i[idx])))
    return out


# ==========================================
# HAILO DRIVER INFERENCE HELPERS
# ==========================================
def preprocess_driver_hailo(frame: np.ndarray) -> np.ndarray:
    """Resize + BGR→RGB, return (1, 224, 224, 3) uint8 batch tensor."""
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    return np.expand_dims(cv2.resize(rgb, (DRIVER_INPUT_SIZE, DRIVER_INPUT_SIZE)), 0)

def postprocess_driver_hailo(raw_output: np.ndarray):
    """
    Softmax ResNet-18 logits from Hailo.
    raw_output shape: (1, 10) — first dim is batch.
    Returns (class_id: int, probs: np.ndarray shape (10,)).
    """
    logits = raw_output[0].astype(np.float32)      # (10,)
    e      = np.exp(logits - logits.max())
    probs  = e / e.sum()
    return int(np.argmax(probs)), probs


# ==========================================
# DRIVER CLASS REMAPPING
# Classes listed here have their probability mass merged into c0_safe (index 0)
# before the D-Score pipeline sees the output.  This means they contribute zero
# severity to the D-Score, are displayed as "Safe driving", and do not trigger
# any distraction alert — exactly as if the model had predicted c0_safe.
#
# Current remaps
# ──────────────
#   8  c8_hair_makeup  →  c0_safe
#       The model frequently confuses hair/makeup with safe driving, and
#       hair/makeup is considered low-risk enough to treat as safe.
#
# To remap additional classes, add their index to the set below.
# ==========================================
_REMAP_TO_SAFE: set = {8}   # class indices to treat as c0_safe

def _apply_class_remapping(probs: np.ndarray) -> np.ndarray:
    """
    Merge probability mass from remapped classes into c0_safe (index 0).

    The resulting array is still a valid probability distribution (sums to 1).
    Remapped classes will have probability 0, so they never appear as the
    predicted class and contribute nothing to the severity-weighted D-Score.

    Args:
        probs: float32 ndarray shape (10,) from postprocess_driver_hailo.

    Returns:
        Remapped float32 ndarray shape (10,).
    """
    out = probs.copy()
    for idx in _REMAP_TO_SAFE:
        out[0]   += out[idx]   # fold into c0_safe
        out[idx]  = 0.0
    return out


# ==========================================
# CALIBRATION HELPER  (for draw_ego_lane in road_vision_worker)
# ==========================================
def _load_calibration() -> dict:
    """Load calibration.json; return safe defaults if file is missing."""
    try:
        with open("calibration.json") as f:
            return json.load(f)
    except Exception:
        return {
            "fy": FY, "cy": CY,
            "camera_height_m": 1.2,
            "pitch_angle_rad": 0.0,
            "ego_lane_nodes":  [],
        }


# ==========================================
# PROCESS 1: MASTER CONTROLLER  (unchanged)
# ==========================================
def _flush_telemetry_to_api(batch, readings_dir):
    """Save batch to disk then POST it. Delete file only on success."""
    if not batch:
        return False
    timestamp      = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    batch_filepath = os.path.join(readings_dir, f"batch_{timestamp}.json")
    with open(batch_filepath, "w") as f:
        json.dump(batch, f, indent=2)
    try:
        resp = requests.post(
            f"{API_BASE_URL}/readings/batch",
            headers=HEADERS, json=batch, timeout=15,
        )
        if resp.status_code == 200:
            os.remove(batch_filepath)
            print(f"[MASTER] Batch uploaded ({len(batch)} readings). File removed.")
            return True
        else:
            print(f"[MASTER] Upload failed: {resp.status_code} — file kept as backup.")
            return False
    except Exception as e:
        print(f"[MASTER] Upload error: {e} — file kept as backup.")
        return False


def _recover_unsent_batches():
    """On startup, re-upload any batch files left from a previous run."""
    import glob
    pending = sorted(glob.glob(os.path.join(READINGS_DIR, "batch_*.json")))
    if not pending:
        return
    print(f"[MASTER] Found {len(pending)} unsent batch file(s) from previous run. Re-uploading...")
    for fp in pending:
        try:
            with open(fp) as f:
                data = json.load(f)
            resp = requests.post(
                f"{API_BASE_URL}/readings/batch",
                headers=HEADERS, json=data, timeout=15,
            )
            if resp.status_code == 200:
                os.remove(fp)
                print(f"[MASTER] ✓ Recovered: {fp}")
            else:
                print(f"[MASTER] ✗ Failed to recover {fp}: {resp.status_code}")
        except Exception as e:
            print(f"[MASTER] ✗ Error recovering {fp}: {e}")

def master_controller(status_event, telemetry_queue, shared_context):
    print("[MASTER] Started. Polling API...")
    last_upload_time = time.time()
    telemetry_batch  = []
    last_batch_file  = None
    trip_active      = False

    while True:
        try:
            state = None
            resp = requests.get(f"{API_BASE_URL}/hardware/status", headers=HEADERS, timeout=5)
            if resp.status_code == 200:
                status_data = resp.json()
                state = status_data.get("status")

                if state == "active":
                    if not status_event.is_set():
                        if not os.path.exists("calibration.json"):
                            print("[MASTER] ⚠ Trip blocked — calibration.json not found. "
                                  "Complete calibration before starting a trip.")
                        else:
                            shared_context['device_id']      = status_data.get("device_id")
                            shared_context['driver_id']      = status_data.get("driver_id")
                            # Stamp the reference clock BEFORE firing the event so
                            # both vision workers read the exact same rec_start.
                            shared_context['trip_rec_start'] = time.time()
                            status_event.set()
                            print(f"[MASTER] Trip started! Driver {shared_context['driver_id']}")

                elif state == "waiting":
                    if status_event.is_set():
                        status_event.clear()
                        shared_context['trip_rec_start'] = None   # reset for next trip
                        print("[MASTER] Trip ended. Shutting down models.")

                elif state == "capture_snapshot":
                    print("[MASTER] Capturing calibration snapshot...")
                    _handle_calibration_snapshot()

                elif state == "fetch_calibration":
                    print("[MASTER] Downloading calibration JSON...")
                    cal_resp = requests.get(f"{API_BASE_URL}/hardware/calibration", headers=HEADERS)
                    if cal_resp.status_code == 200:
                        _compute_and_save_calibration(cal_resp.json())
                        print("[MASTER] Calibration saved.")

            while not telemetry_queue.empty():
                telemetry_batch.append(telemetry_queue.get())

            if state == "active":
                trip_active = True

            trip_just_ended = (trip_active and state == "waiting")
            if trip_just_ended:
                trip_active = False

            should_upload = (
                (trip_just_ended and len(telemetry_batch) > 0)
                or
                (time.time() - last_upload_time > BATCH_UPLOAD_INTERVAL_SEC
                 and len(telemetry_batch) > 0)
            )

            if should_upload:
                timestamp      = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
                batch_filepath = os.path.join(READINGS_DIR, f"batch_{timestamp}.json")
                with open(batch_filepath, "w") as f:
                    json.dump(telemetry_batch, f, indent=2)

                upload_resp = requests.post(
                    f"{API_BASE_URL}/readings/batch",
                    headers=HEADERS, json=telemetry_batch, timeout=15,
                )
                if upload_resp.status_code == 200:
                    if last_batch_file and os.path.exists(last_batch_file):
                        os.remove(last_batch_file)
                    last_batch_file = batch_filepath
                    telemetry_batch.clear()
                    last_upload_time = time.time()
                    print("[MASTER] Batch upload successful.")

        except requests.exceptions.RequestException as e:
            print(f"[MASTER] Network error: {e}")

        time.sleep(3)


# ── Calibration helpers  (unchanged) ──────────────────────────────────────
def _calibrate_pitch_angle(known_distance_m, v, camera_height_m, fy, cy):
    alpha = math.atan((v - cy) / fy)
    return math.atan(camera_height_m / known_distance_m) - alpha

def _compute_and_save_calibration(backend_data):
    """
    Convert calibration data received from the backend into a calibration.json
    that is consistent with the native road-camera resolution.

    Why the scaling is needed
    ─────────────────────────
    The calibration snapshot was sent to the backend at _SNAPSHOT_W × _SNAPSHOT_H
    (640 × 480).  The app therefore returns bbox coordinates and ego-lane nodes
    in that 640 × 480 coordinate space.

    However:
      • FY and CY (the camera intrinsics used at runtime) are expressed in
        *native* camera pixels (e.g. 884 / 315 for a 1280 × 720 sensor).
      • _calibrate_pitch_angle uses (y2 - CY) / FY to compute the pixel angle,
        so y2 must be in the same space as CY and FY.
      • ego_lane_nodes are compared against live frames at native resolution,
        so they must also be in native pixel coordinates.

    Mixing snapshot-space y2 with native-space FY/CY produces a wrong pitch
    angle: the camera appears more steeply tilted than it really is, every
    computed distance comes out shorter than reality, and urgency is
    permanently inflated.

    Fix: read one frame from the road camera to learn the native resolution,
    then scale all snapshot-space coordinates up to native space before use.
    """
    cam_h          = backend_data.get("mounting_height", 1.2)
    known_distance = backend_data.get("known_distance_m", 3.25)
    bbox           = backend_data.get("selected_bbox", {"y1": 540, "y2": 540})

    # ── Determine native camera resolution ────────────────────────────────
    # We open the road camera briefly (called only during the "waiting" / non-trip
    # state, so the road_vision_worker is not holding the camera).
    native_h, native_w = _SNAPSHOT_H, _SNAPSHOT_W   # safe fallback = no scaling
    try:
        _cap = cv2.VideoCapture(ROAD_CAM_INDEX)
        _ret, _frm = _cap.read()
        _cap.release()
        if _ret and _frm is not None:
            native_h, native_w = _frm.shape[:2]
            print(f"[CALIB] Native camera resolution: {native_w}×{native_h}")
        else:
            print("[CALIB] ⚠ Could not read road camera — using snapshot dims as fallback.")
    except Exception as e:
        print(f"[CALIB] ⚠ Camera open error ({e}) — using snapshot dims as fallback.")

    # Scale factors: snapshot → native
    scale_x = native_w / _SNAPSHOT_W
    scale_y = native_h / _SNAPSHOT_H

    # ── Scale bbox y2 to native space for pitch calculation ───────────────
    # _calibrate_pitch_angle needs y2 expressed in the same pixels as FY / CY.
    y2_native = float(bbox["y2"]) * scale_y

    pitch_angle_rad = _calibrate_pitch_angle(
        known_distance, y2_native, cam_h, FY, CY
    )

    # ── Scale ego-lane nodes to native space ──────────────────────────────
    # Stored nodes are used at runtime against live frames at native resolution;
    # draw_ego_lane and _EgoLaneProximity._pixel_polygon both need coordinates
    # expressed in that same space.
    ego_nodes_raw    = backend_data.get("ego_lane_nodes", [])
    ego_nodes_native = [
        {"x": round(n["x"] * scale_x, 2),
         "y": round(n["y"] * scale_y, 2)}
        for n in ego_nodes_raw
    ]

    local_calib = {
        "fy":              FY,
        "cy":              CY,
        "camera_height_m": cam_h,
        "pitch_angle_rad": pitch_angle_rad,
        "ego_lane_nodes":  ego_nodes_native,
    }
    with open("calibration.json", "w") as f:
        json.dump(local_calib, f, indent=2)

    print(
        f"[CALIB] Saved — pitch={math.degrees(pitch_angle_rad):.2f}°  "
        f"cam_h={cam_h}m  dist={known_distance}m  "
        f"scale=({scale_x:.3f}×{scale_y:.3f})  "
        f"{len(ego_nodes_native)} ego-lane nodes (native {native_w}×{native_h})"
    )

_SNAPSHOT_W = 640   # calibration snapshot fixed resolution
_SNAPSHOT_H = 480   # ego-lane nodes from the app will be in this coordinate space

def _handle_calibration_snapshot():
    """
    Capture one road-camera frame, run YOLO on it, resize everything to
    _SNAPSHOT_W × _SNAPSHOT_H (640 × 480) and POST to the backend.

    Why 640 × 480?
    The app draws the ego-lane polygon on top of the snapshot it receives.
    Sending a fixed resolution means the node coordinates it returns are
    always in 640 × 480 space, which is what draw_ego_lane and
    _EgoLaneProximity._pixel_polygon expect when they see values up to ~640/480.
    This removes the resolution mismatch that caused the ego-lane overlay
    to shift when drawn on the road camera window.
    """
    try:
        from ultralytics import YOLO
        model = YOLO("/home/daras/hailo-apps-infra/App_Main_folder/yolo26s_ncnn_model")
    except Exception as e:
        print(f"[SNAPSHOT] ✗ Could not load YOLO model: {e}")
        return

    cap = cv2.VideoCapture(ROAD_CAM_INDEX)
    for _ in range(50):           # warm-up: let exposure settle
        cap.read()

    ret, frame = cap.read()
    cap.release()

    if not ret:
        print("[SNAPSHOT] ✗ Failed to read frame from road camera.")
        return

    orig_h, orig_w = frame.shape[:2]

    # Run YOLO on the full-resolution frame for best detection quality
    try:
        results    = model(frame, verbose=False)
        detections_orig = [
            {"x1": int(b.xyxy[0][0]), "y1": int(b.xyxy[0][1]),
             "x2": int(b.xyxy[0][2]), "y2": int(b.xyxy[0][3])}
            for r in results for b in r.boxes
        ]
    except Exception as e:
        print(f"[SNAPSHOT] ✗ YOLO inference failed: {e}")
        return

    # Scale frame and detection boxes to snapshot resolution
    frame_snap = cv2.resize(frame, (_SNAPSHOT_W, _SNAPSHOT_H))
    scale_x    = _SNAPSHOT_W / orig_w
    scale_y    = _SNAPSHOT_H / orig_h
    detections_snap = [
        {
            "x1": int(d["x1"] * scale_x),
            "y1": int(d["y1"] * scale_y),
            "x2": int(d["x2"] * scale_x),
            "y2": int(d["y2"] * scale_y),
        }
        for d in detections_orig
    ]

    try:
        _, buffer = cv2.imencode('.jpg', frame_snap)
        resp = requests.post(
            f"{API_BASE_URL}/hardware/calibration/snapshot",
            headers=HEADERS,
            json={
                "snapshot_base64": base64.b64encode(buffer).decode('utf-8'),
                "detections":      detections_snap,
            },
            timeout=10,
        )
        if resp.status_code == 200:
            print(f"[SNAPSHOT] ✓ Sent {_SNAPSHOT_W}×{_SNAPSHOT_H} — "
                  f"{len(detections_snap)} detections.")
        else:
            print(f"[SNAPSHOT] ✗ Server rejected snapshot: {resp.status_code} {resp.text[:120]}")
    except Exception as e:
        print(f"[SNAPSHOT] ✗ POST failed: {e}")


# ==========================================
# PROCESS: HAILO INFERENCE WORKER
# Owns the single Hailo chip — time-slices YOLO26n and ResNet-18.
# ==========================================
def hailo_inference_worker(status_event,
                            hailo_road_frame_q,   hailo_road_result_q,
                            hailo_driver_frame_q, hailo_driver_result_q):
    """
    Dedicated process that exclusively owns the Hailo VDevice.
    Alternates between road (YOLO26n) and driver (ResNet-18) slots each cycle.
    """
    print("[HAILO] Worker started. Loading HEF models...")
    _dir = os.path.dirname(os.path.abspath(__file__))

    def _abs(name):
        return name if os.path.isabs(name) else os.path.join(_dir, name)

    road_hef   = HEF(_abs(ROAD_MODEL_HEF))
    driver_hef = HEF(_abs(DRIVER_MODEL_HEF))

    road_input_name    = road_hef.get_input_vstream_infos()[0].name
    driver_input_name  = driver_hef.get_input_vstream_infos()[0].name
    driver_output_name = driver_hef.get_output_vstream_infos()[0].name

    print(f"[HAILO]   Road   input : {road_input_name}")
    print(f"[HAILO]   Driver input : {driver_input_name}  output : {driver_output_name}")

    with VDevice() as target:
        road_ng = target.configure(
            road_hef,
            ConfigureParams.create_from_hef(road_hef, interface=HailoStreamInterface.PCIe),
        )[0]
        driver_ng = target.configure(
            driver_hef,
            ConfigureParams.create_from_hef(driver_hef, interface=HailoStreamInterface.PCIe),
        )[0]

        road_in_p    = InputVStreamParams.make_from_network_group(
            road_ng,   format_type=FormatType.UINT8,   quantized=True)
        road_out_p   = OutputVStreamParams.make_from_network_group(
            road_ng,   format_type=FormatType.FLOAT32, quantized=False)
        driver_in_p  = InputVStreamParams.make_from_network_group(
            driver_ng, format_type=FormatType.UINT8,   quantized=True)
        driver_out_p = OutputVStreamParams.make_from_network_group(
            driver_ng, format_type=FormatType.FLOAT32, quantized=False)

        print("[HAILO] Both models configured. Inference loop running.\n")

        while True:
            status_event.wait()

            # ── ROAD SLOT ──────────────────────────────────────────────────
            try:
                road_frame, orig_h, orig_w = hailo_road_frame_q.get(timeout=0.05)
            except Exception:
                road_frame = None

            if road_frame is not None:
                tensor = preprocess_yolo_hailo(road_frame)
                try:
                    with road_ng.activate(road_ng.create_params()):
                        with InferVStreams(road_ng, road_in_p, road_out_p) as pipe:
                            raw = pipe.infer({road_input_name: tensor})
                    dets = postprocess_yolo_hailo(raw, orig_h, orig_w)
                except Exception as e:
                    print(f"[HAILO/ROAD] Inference error: {e}")
                    dets = []
                if hailo_road_result_q.full():
                    try: hailo_road_result_q.get_nowait()
                    except Exception: pass
                hailo_road_result_q.put(dets)

            # ── DRIVER SLOT ────────────────────────────────────────────────
            try:
                driver_frame = hailo_driver_frame_q.get(timeout=0.05)
            except Exception:
                driver_frame = None

            if driver_frame is not None:
                tensor = preprocess_driver_hailo(driver_frame)
                try:
                    with driver_ng.activate(driver_ng.create_params()):
                        with InferVStreams(driver_ng, driver_in_p, driver_out_p) as pipe:
                            raw = pipe.infer({driver_input_name: tensor})
                    cid, probs = postprocess_driver_hailo(raw[driver_output_name])
                except Exception as e:
                    print(f"[HAILO/DRIVER] Inference error: {e}")
                    cid   = 0
                    probs = np.ones(10, dtype=np.float32) / 10.0
                if hailo_driver_result_q.full():
                    try: hailo_driver_result_q.get_nowait()
                    except Exception: pass
                hailo_driver_result_q.put((cid, probs))


# ==========================================
# PROCESS 2: ROAD VISION  (Hailo YOLO + HScoreEngine)
# ==========================================
def road_vision_worker(status_event, results_queue, shared_context,
                        hailo_road_frame_q, hailo_road_result_q):
    """
    Captures road frames → sends to hailo_inference_worker for YOLO26n detection
    → computes H-Scores via HScoreEngine (Kalman TTC, IoU tracker, proximity)
    → pushes telemetry to results_queue.

    HScoreEngine is re-created at the start of each trip so it picks up any
    calibration.json updates made between trips.
    """
    print("[ROAD] Initialized. Waiting for trip...")

    while True:
        status_event.wait()

        # ── Fresh HScoreEngine per trip (loads current calibration.json) ──
        try:
            engine = HScoreEngine(calib_path="calibration.json")
            print("[ROAD] HScoreEngine loaded.")
        except Exception as e:
            print(f"[ROAD] HScoreEngine init failed: {e}. Road scoring disabled.")
            engine = None

        # Load calibration dict separately for draw_ego_lane overlay
        calib = _load_calibration()

        _nodes = calib.get("ego_lane_nodes", [])
        if _nodes and len(_nodes) >= 3:
            _mx = max(float(n["x"]) for n in _nodes)
            _my = max(float(n["y"]) for n in _nodes)
            if _mx <= 1.0 and _my <= 1.0:
                print(f"[EGO LANE] Calibration nodes (normalised) — {len(_nodes)} points")
            else:
                print(f"[EGO LANE] Calibration nodes (absolute px "
                      f"{_mx:.0f}×{_my:.0f}) — {len(_nodes)} points")
        else:
            print("[EGO LANE] No valid nodes — drawing default trapezoid.")

        cap = cv2.VideoCapture(ROAD_CAM_INDEX)
        if SHOW_WINDOWS:
            try: cv2.namedWindow("Road Cam", cv2.WINDOW_NORMAL)
            except Exception: pass

        last_time       = time.time()
        last_detections = []
        road_writer     = None

        # ── Timestamp-based recording ───────────────────────────────────────
        # rec_start: the shared wall-clock anchor stamped by master_controller
        # into shared_context['trip_rec_start'] just before status_event.set().
        # Polling briefly here covers the tiny race between master writing the
        # value and this worker waking up.
        rec_start = None
        for _ in range(100):
            rec_start = shared_context.get('trip_rec_start')
            if rec_start is not None:
                break
            time.sleep(0.002)
        rec_start = rec_start or time.time()   # fallback (should never trigger)

        last_slot  = -1     # last VideoWriter frame-slot written
        last_disp  = None   # most-recent annotated frame (for gap-filling)

        print(f"[ROAD] Engine active (Hailo YOLO26n + HScoreEngine). "
              f"rec_start anchor: {rec_start:.3f}")

        while status_event.is_set():
            ret, frame = cap.read()
            if not ret:
                time.sleep(0.005)
                # ── Gap-fill even when the camera stalls ──────────────────
                if RECORD_VIDEO and road_writer is not None and last_disp is not None:
                    _now = time.time()
                    _ts  = int((_now - rec_start) * RECORD_FPS)
                    if _ts > last_slot:
                        for _ in range(_ts - last_slot):
                            road_writer.write(last_disp)
                        last_slot = _ts
                continue

            current_time = time.time()
            real_dt = current_time - last_time
            if real_dt <= 0: real_dt = 0.033
            last_time = current_time

            img_h, img_w = frame.shape[:2]

            # 1. Submit frame to Hailo inference worker
            try:
                hailo_road_frame_q.put_nowait((frame, img_h, img_w))
            except Exception:
                pass

            # 2. Drain result queue — always use the freshest detections
            while True:
                try:
                    last_detections = hailo_road_result_q.get_nowait()
                except Exception:
                    break

            # 3. H-Score via HScoreEngine (tracker + Kalman TTC + proximity)
            if engine is not None:
                results = engine.process_frame_with_detections(
                    frame, last_detections, real_dt
                )
            else:
                results = []

            # 4. Queue telemetry
            if results:
                worst = max(results, key=lambda x: x["hscore"])
                reading_data = {
                    "h_score":            worst["hscore"],
                    "distance_m":         worst["distance"],
                    "ego_lane_proximity": worst["proximity"],
                    "urgency":            worst["components"]["urgency"],
                    "object_type":        worst["cls_name"],
                    "class_risk":         worst["components"]["class_risk"],
                }
            else:
                reading_data = {
                    "h_score": 0.0, "distance_m": 0.0, "ego_lane_proximity": 0.0,
                    "urgency": 0.0, "object_type": "none", "class_risk": 0.0,
                }
            results_queue.put({"source": "road", "timestamp": current_time,
                               "data": reading_data})

            # 5. Annotate frame
            disp = frame.copy()
            draw_ego_lane(disp, calib, img_w, img_h)
            draw_road_overlay(disp, {"results": results, "ego_lane_poly": []})

            # 6. Slot-based recording — guarantees same frame count as driver
            #
            #   target_slot  = which frame-slot wall-clock says we should be at
            #   last_slot    = last slot already written
            #
            #   If road is SLOW  (hailo bottleneck, < RECORD_FPS):
            #       target_slot jumps by >1 → gap-fill with last frame, then write new
            #   If road is FAST  (> RECORD_FPS):
            #       target_slot == last_slot → skip write (don't double-write a slot)
            #
            if RECORD_VIDEO:
                target_slot = int((current_time - rec_start) * RECORD_FPS)
                if target_slot > last_slot:
                    if road_writer is None:
                        road_writer = _make_writer("road", img_w, img_h)
                    fill_frame = last_disp if last_disp is not None else disp
                    for _ in range(target_slot - last_slot - 1):   # fill gaps
                        road_writer.write(fill_frame)
                    road_writer.write(disp)                        # write current
                    last_slot = target_slot
            last_disp = disp   # always update — used for gap-filling next iteration

            if SHOW_WINDOWS:
                try:
                    cv2.imshow("Road Cam", disp)
                    if cv2.waitKey(1) & 0xFF == ord('q'):
                        status_event.clear()
                        break
                except Exception:
                    pass

        cap.release()
        if road_writer is not None:
            road_writer.release()
            road_writer = None
            print("[RECORD] Road recording saved.")
        if SHOW_WINDOWS:
            try: cv2.destroyWindow("Road Cam")
            except Exception: pass


# ==========================================
# PROCESS 3: DRIVER VISION  (Hailo ResNet-18 + DScorePipeline)
# ==========================================
def driver_vision_worker(status_event, results_queue, shared_context,
                          hailo_driver_frame_q, hailo_driver_result_q):
    """
    Captures driver frames → sends to hailo_inference_worker for ResNet-18
    classification → computes D-Score via DScorePipeline (full severity-weighted
    formula with fps-correct EMA smoothing) → pushes telemetry to results_queue.

    DScorePipeline is created once and reset at the start of each trip so the
    EMA smoothing history doesn't bleed across trips.
    """
    print("[DRIVER] Initialized. Waiting for trip...")

    # Create once; reset EMA state at the start of each trip
    pipeline = DScorePipeline(driver_id="driver_main", fps=RECORD_FPS)

    while True:
        status_event.wait()
        pipeline.reset()   # clear EMA history for new trip

        cap = cv2.VideoCapture(DRIVER_CAM_INDEX)
        if SHOW_WINDOWS:
            try: cv2.namedWindow("Driver Cam", cv2.WINDOW_NORMAL)
            except Exception: pass

        # Fallback probs: uniform across all 10 classes
        last_probs        = np.ones(10, dtype=np.float32) / 10.0
        driver_writer     = None   # annotated (with overlay)
        driver_raw_writer = None   # clean feed  (no overlay)

        # ── Timestamp-based recording — same anchor as road_vision_worker ──
        rec_start = None
        for _ in range(100):
            rec_start = shared_context.get('trip_rec_start')
            if rec_start is not None:
                break
            time.sleep(0.002)
        rec_start = rec_start or time.time()

        last_slot  = -1     # last VideoWriter frame-slot written
        last_disp  = None   # most-recent annotated frame (for gap-filling)
        last_raw   = None   # most-recent raw frame      (for gap-filling)

        print(f"[DRIVER] Engine active (Hailo ResNet-18 + DScorePipeline). "
              f"rec_start anchor: {rec_start:.3f}")

        while status_event.is_set():
            ret, frame = cap.read()
            if not ret:
                # ── Gap-fill even when the camera stalls ──────────────────
                if RECORD_VIDEO and driver_writer is not None and last_disp is not None:
                    _now = time.time()
                    _ts  = int((_now - rec_start) * RECORD_FPS)
                    if _ts > last_slot:
                        for _ in range(_ts - last_slot):
                            driver_writer.write(last_disp)
                            driver_raw_writer.write(last_raw)
                        last_slot = _ts
                continue

            current_time = time.time()

            # 1. Submit frame to Hailo inference worker
            try:
                hailo_driver_frame_q.put_nowait(frame)
            except Exception:
                pass

            # 2. Drain result queue — always use the freshest classification
            while True:
                try:
                    _cid, last_probs = hailo_driver_result_q.get_nowait()
                except Exception:
                    break

            # 3. Remap hair/makeup (and any other configured classes) → safe,
            #    then compute D-Score via DScorePipeline.
            result = pipeline.process_probs(_apply_class_remapping(last_probs))

            # 4. Queue telemetry (DScoreResult.to_dict() is JSON-safe)
            results_queue.put({
                "source":    "driver",
                "timestamp": current_time,
                "data":      result.to_dict(),
            })

            # 5. Build annotated frame; keep raw frame untouched
            img_h, img_w = frame.shape[:2]
            disp = frame.copy()
            draw_driver_overlay(disp, result)

            # 6. Slot-based recording — same logic as road_vision_worker
            #
            #   If driver is FAST  (camera > RECORD_FPS):
            #       target_slot == last_slot → skip (drop the extra frame)
            #   If driver is SLOW  (< RECORD_FPS, unlikely):
            #       gap-fill with last known frame
            #
            if RECORD_VIDEO:
                target_slot = int((current_time - rec_start) * RECORD_FPS)
                if target_slot > last_slot:
                    if driver_writer is None:
                        driver_writer     = _make_writer("driver",     img_w, img_h)
                        driver_raw_writer = _make_writer("driver_raw", img_w, img_h)
                    fill_disp = last_disp if last_disp is not None else disp
                    fill_raw  = last_raw  if last_raw  is not None else frame
                    for _ in range(target_slot - last_slot - 1):   # fill gaps
                        driver_writer.write(fill_disp)
                        driver_raw_writer.write(fill_raw)
                    driver_writer.write(disp)                      # annotated
                    driver_raw_writer.write(frame)                 # clean raw
                    last_slot = target_slot
            last_disp = disp
            last_raw  = frame

            if SHOW_WINDOWS:
                try:
                    cv2.imshow("Driver Cam", disp)
                    if cv2.waitKey(1) & 0xFF == ord('q'):
                        status_event.clear()
                        break
                except Exception:
                    pass

        cap.release()
        if driver_writer is not None:
            driver_writer.release()
            driver_writer = None
            print("[RECORD] Driver (annotated) recording saved.")
        if driver_raw_writer is not None:
            driver_raw_writer.release()
            driver_raw_writer = None
            print("[RECORD] Driver (raw) recording saved.")
        if SHOW_WINDOWS:
            try: cv2.destroyWindow("Driver Cam")
            except Exception: pass


# ==========================================
# PROCESS 4: AGGREGATOR & ALERTS
# ==========================================
def aggregator_worker(status_event, results_queue, telemetry_queue, shared_context):
    print("[AGGREGATOR] Initialized. Waiting for trip...")
    buffer        = []
    last_1s_flush = time.time()

    while True:
        status_event.wait()
        while status_event.is_set():
            if not results_queue.empty():
                item = results_queue.get()
                buffer.append(item)
                current_time = time.time()

                fast_window = [d for d in buffer if current_time - d["timestamp"] <= 0.25]
                if len(fast_window) > 0:
                    r_score = _calculate_immediate_risk(fast_window)
                    if r_score > RISK_THRESHOLD:
                        _trigger_hardware_alert()

                if current_time - last_1s_flush >= 1.0:
                    slow_window = [d for d in buffer if current_time - d["timestamp"] <= 1.0]
                    if len(slow_window) > 0:
                        reading = _format_telemetry(slow_window, shared_context)
                        if reading: telemetry_queue.put(reading)

                    buffer        = [d for d in buffer if current_time - d["timestamp"] > 1.0]
                    last_1s_flush = current_time
            else:
                time.sleep(0.01)


def _calculate_immediate_risk(window):
    """
    Immediate risk for alert triggering.
    Formula: 0.6 × D-Score + 0.4 × H-Score
    """
    road_scores   = [d["data"]["h_score"]          for d in window if d["source"] == "road"]
    driver_scores = [d["data"]["d_score_smoothed"] for d in window if d["source"] == "driver"]
    h = road_scores[-1]   if road_scores   else 0.0
    d = driver_scores[-1] if driver_scores else 0.0
    return 0.6 * d + 0.4 * h


def _trigger_hardware_alert():
    print("[ALERT] DANGER THRESHOLD CROSSED - BEEP BEEP!")
    audio_file = "/home/daras/Final_app_work_env/App_Main_folder/soundtools-tts-am_adam-1780436867881.wav"
    try:
        subprocess.run(["pw-play", audio_file], check=True)
    except Exception as e:
        print(f"[ERROR] Failed to play audio: {e}")


def _format_telemetry(window, shared_context):
    road_data   = [d["data"] for d in window if d["source"] == "road"]
    driver_data = [d["data"] for d in window if d["source"] == "driver"]

    if not road_data and not driver_data:
        return None

    mean_h    = sum(d["h_score"]            for d in road_data)   / len(road_data)   if road_data   else 0.0
    mean_u    = sum(d["urgency"]            for d in road_data)   / len(road_data)   if road_data   else 0.0
    mean_p    = sum(d["ego_lane_proximity"] for d in road_data)   / len(road_data)   if road_data   else 0.0
    mean_d    = sum(d["d_score_smoothed"]   for d in driver_data) / len(driver_data) if driver_data else 0.0

    # Risk = 0.6 × D-Score  +  0.4 × H-Score
    mean_risk = round(0.6 * mean_d + 0.4 * mean_h, 4)

    mode_obj_classes = ""
    if road_data:
        classes_list = [d["object_type"] for d in road_data if d["object_type"] != "none"]
        if classes_list:
            mode_obj_classes = max(set(classes_list), key=classes_list.count)

    avg_dist = {
        "safe_driving": 0.0, "texting_right": 0.0, "texting_left": 0.0,
        "talking_to_passenger": 0.0, "drinking": 0.0, "calling_right": 0.0,
        "calling_left": 0.0, "operating_radio": 0.0, "hair_and_makeup": 0.0,
        "reaching_behind": 0.0,
    }
    if driver_data:
        # class_scores keys from DScoreResult: "c0_safe", "c1_texting_right", …
        key_map = {
            "c0_safe":              "safe_driving",
            "c1_texting_right":     "texting_right",
            "c2_phone_right":       "calling_right",
            "c3_texting_left":      "texting_left",
            "c4_phone_left":        "calling_left",
            "c5_radio":             "operating_radio",
            "c6_drinking":          "drinking",
            "c7_reaching":          "reaching_behind",
            "c8_hair_makeup":       "hair_and_makeup",
            "c9_talking_passenger": "talking_to_passenger",
        }
        for d in driver_data:
            for original_key, val in d["class_scores"].items():
                if original_key in key_map:
                    avg_dist[key_map[original_key]] += val
        for key in avg_dist:
            avg_dist[key] /= len(driver_data)

    return {
        "device_id": shared_context.get("device_id", 0),
        "driver_id": shared_context.get("driver_id", 0),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "driver_score": round(mean_d, 4),
        "road_score":   round(mean_h, 4),
        "risk_score":   mean_risk,
        "driver_distraction_distribution": avg_dist,
        "urgency":   round(mean_u, 4),
        "proximity": round(mean_p, 4),
        "road_objects_classes": mode_obj_classes,
        "gps_coordinates": "31.2001, 29.9187",
    }


# ==========================================
# ENTRY POINT
# ==========================================
if __name__ == '__main__':
    manager        = mp.Manager()
    shared_context = manager.dict()
    status_event   = mp.Event()

    unified_results_queue = mp.Queue()
    telemetry_queue       = mp.Queue()

    hailo_road_frame_q    = mp.Queue(maxsize=2)
    hailo_road_result_q   = mp.Queue(maxsize=2)
    hailo_driver_frame_q  = mp.Queue(maxsize=2)
    hailo_driver_result_q = mp.Queue(maxsize=2)

    p_master = mp.Process(
        target=master_controller,
        args=(status_event, telemetry_queue, shared_context),
    )
    p_hailo  = mp.Process(
        target=hailo_inference_worker,
        args=(status_event,
              hailo_road_frame_q,   hailo_road_result_q,
              hailo_driver_frame_q, hailo_driver_result_q),
    )
    p_road   = mp.Process(
        target=road_vision_worker,
        args=(status_event, unified_results_queue, shared_context,
              hailo_road_frame_q, hailo_road_result_q),
    )
    p_driver = mp.Process(
        target=driver_vision_worker,
        args=(status_event, unified_results_queue, shared_context,
              hailo_driver_frame_q, hailo_driver_result_q),
    )
    p_agg    = mp.Process(
        target=aggregator_worker,
        args=(status_event, unified_results_queue, telemetry_queue, shared_context),
    )

    processes = [p_master, p_hailo, p_road, p_driver, p_agg]
    for p in processes: p.start()

    try:
        for p in processes: p.join()
    except KeyboardInterrupt:
        print("\n[SYSTEM] Shutting down...")
        for p in processes: p.terminate()