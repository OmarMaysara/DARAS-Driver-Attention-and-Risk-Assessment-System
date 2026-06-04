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

All original functions are preserved.
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

# ── kept for backward-compatibility (calibration snapshot still uses YOLO .pt)
from d_score_backend import ModelRegistry, DScorePipeline  # noqa: F401  (inference now Hailo)
from hscore_engine   import HScoreEngine                   # noqa: F401  (scoring now inline)

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

ROAD_MODEL_HEF   = "yolo26n.hef"                           # was yolo26s_best.onnx
DRIVER_MODEL_HEF = "resnet18_statefarm_v5_opset14_sim.hef" # was vit_small_opset14_sim.onnx

RISK_THRESHOLD            = 0.75
BATCH_UPLOAD_INTERVAL_SEC = 600

W_CLASS     = 1 / 3
W_PROXIMITY = 1 / 3
W_URGENCY   = 1 / 3

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
RECORD_VIDEO  = True      # Save annotated output video for each trip
RECORD_FPS    = 20.0      # Should match your camera's actual frame rate
RECORD_FOURCC = "mp4v"    # "mp4v" → .mp4  |  "XVID" → .avi

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

# Output layer names → decoding stride  (yolo26n HEF; update if model differs)
YOLO_OUTPUT_LAYERS = [
    ('yolo26n/conv61', 'yolo26n/conv64',  8),
    ('yolo26n/conv77', 'yolo26n/conv80', 16),
    ('yolo26n/conv91', 'yolo26n/conv94', 32),
]

# Per-class risk weight used in H-Score (car, person, bike)
_CLASS_RISK_MAP = {0: 0.70, 1: 0.90, 2: 0.80}

# ── Driver / ResNet-18 ──────────────────────────────────────────────────────
DRIVER_INPUT_SIZE = 224

DRIVER_CLASS_KEYS = [
    "c0_safe", "c1_texting_right", "c2_phone_right", "c3_texting_left",
    "c4_phone_left", "c5_radio", "c6_drinking", "c7_reaching",
    "c8_hair_makeup", "c9_talking_passenger",
]

# Distraction severity per class for raw D-Score (c0_safe = 0.0)
_DRIVER_SEVERITY = [0.0, 1.0, 1.0, 1.0, 1.0, 0.5, 0.8, 0.8, 0.6, 0.5]

# EMA smoothing factor for D-Score (matches DScorePipeline default)
EMA_ALPHA = 0.20

# ==========================================
# DISPLAY OVERLAY HELPERS  (unchanged)
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

def _risk_color(risk_level: str) -> tuple:
    return {"Safe": (60, 210, 60), "Caution": (30, 165, 255), "Critical": (40, 40, 220)}.get(
        risk_level, (200, 200, 200)
    )

def _score_color(score: float) -> tuple:
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
    PX, PY, PW, PH = 10, 10, 235, 212
    _draw_panel(frame, PX, PY, PW, PH)
    _text(frame, "DRIVER MONITOR", PX + 8, PY + 18, color=(180, 180, 180), scale=0.46)
    cv2.line(frame, (PX + 6, PY + 23), (PX + PW - 6, PY + 23), (60, 60, 60), 1)

    risk_col = _risk_color(result.risk_level)
    _text(frame, "D-Score", PX + 8, PY + 42, color=(160, 160, 160), scale=0.42)
    _text(frame, f"{result.d_score_smoothed:.3f}", PX + 78, PY + 42, color=risk_col, scale=0.55, thickness=1)
    _bar(frame, PX + 8, PY + 47, result.d_score_smoothed, bar_w=PW - 22, color=risk_col)

    badge = result.risk_level.upper()
    bw = len(badge) * 9 + 10
    cv2.rectangle(frame, (PX + 8, PY + 62), (PX + 8 + bw, PY + 78), risk_col, -1)
    _text(frame, badge, PX + 13, PY + 74, color=(10, 10, 10), scale=0.44, thickness=1)

    label = _CLASS_DISPLAY.get(result.predicted_class, result.predicted_class)
    prob  = float(result.probabilities[result.predicted_index])  # int-keyed
    _text(frame, f"Class: {label}", PX + 8, PY + 97, color=(210, 210, 210), scale=0.42)

    cv2.line(frame, (PX + 6, PY + 105), (PX + PW - 6, PY + 105), (50, 50, 50), 1)
    _text(frame, "Top Distractions", PX + 8, PY + 117, color=(130, 130, 130), scale=0.38)

    top3 = sorted(
        ((k, v) for k, v in result.class_scores.items() if k != "c0_safe"),
        key=lambda x: x[1], reverse=True
    )[:3]
    max_val = max((v for _, v in top3), default=1e-6)

    for i, (cls_key, wval) in enumerate(top3):
        row_y = PY + 133 + i * 25
        lbl   = _CLASS_DISPLAY.get(cls_key, cls_key)[:17]
        norm  = wval / max_val if max_val > 0 else 0.0
        _text(frame, lbl, PX + 8, row_y, color=(190, 190, 190), scale=0.38)
        _bar(frame, PX + 8, row_y + 4, norm, bar_w=PW - 22, bar_h=8, color=_score_color(norm))

def draw_road_overlay(frame, display_pkg: dict):
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
        rd      = max(results, key=lambda r: r["hscore"])
        h_score = rd["hscore"]
        dist_m  = rd["distance"]
        prox    = rd["proximity"]
        urgency = rd["components"]["urgency"]
        obj_type = rd["cls_name"]
        ttc     = rd["ttc"]
    else:
        h_score = dist_m = prox = urgency = 0.0
        obj_type = "none"
        ttc = None

    PX, PY, PW, PH = 10, 10, 235, 198
    _draw_panel(frame, PX, PY, PW, PH)
    score_col = _score_color(h_score)
    _text(frame, "ROAD MONITOR", PX + 8, PY + 18, color=(180, 180, 180), scale=0.46)
    cv2.line(frame, (PX + 6, PY + 23), (PX + PW - 6, PY + 23), (60, 60, 60), 1)

    _text(frame, "H-Score", PX + 8, PY + 42, color=(160, 160, 160), scale=0.42)
    _text(frame, f"{h_score:.3f}", PX + 78, PY + 42, color=score_col, scale=0.55, thickness=1)
    _bar(frame, PX + 8, PY + 47, h_score, bar_w=PW - 22, color=score_col)

    cv2.line(frame, (PX + 6, PY + 60), (PX + PW - 6, PY + 60), (50, 50, 50), 1)
    obj_lbl = obj_type if obj_type != "none" else "\u2014"
    _text(frame, f"Object:   {obj_lbl}", PX + 8, PY + 76, color=(210, 210, 210), scale=0.43)

    if dist_m > 0:
        dist_col = (60, 210, 60) if dist_m > 5 else (30, 165, 255) if dist_m > 2 else (40, 40, 220)
        dist_str = f"{dist_m:.1f} m"
    else:
        dist_col, dist_str = (110, 110, 110), "\u2014"
    _text(frame, f"Distance: {dist_str}", PX + 8, PY + 93, color=dist_col, scale=0.43)

    in_lane  = prox >= 1.0
    lane_col = (40, 40, 220) if in_lane else (60, 210, 60)
    cv2.line(frame, (PX + 6, PY + 103), (PX + PW - 6, PY + 103), (50, 50, 50), 1)
    _text(frame, f"Ego-Lane Prox: {prox:.2f}", PX + 8, PY + 117, color=(210, 210, 210), scale=0.43)
    badge_txt = "IN LANE" if in_lane else "OUT"
    bw = len(badge_txt) * 8 + 8
    cv2.rectangle(frame, (PX + PW - bw - 4, PY + 106), (PX + PW - 4, PY + 120), lane_col, -1)
    _text(frame, badge_txt, PX + PW - bw, PY + 118, color=(10, 10, 10), scale=0.38, thickness=1)

    cv2.line(frame, (PX + 6, PY + 135), (PX + PW - 6, PY + 135), (50, 50, 50), 1)
    urg_col = _score_color(urgency)
    ttc_str = "---" if ttc is None else (">99s" if ttc >= 99.0 else f"{ttc:.1f}s")
    _text(frame, f"Urgency: {urgency:.3f}   TTC: {ttc_str}", PX + 8, PY + 151,
          color=(210, 210, 210), scale=0.40)
    _bar(frame, PX + 8, PY + 156, urgency, bar_w=PW - 22, color=urg_col)


def draw_ego_lane(frame, calib: dict, img_w: int, img_h: int):
    """
    Draw the ego-lane polygon from calibration.json onto frame.

    Coordinate auto-detection:
      • If all x values ≤ 1.0 AND all y values ≤ 1.0  →  normalised (0-1 fractions)
      • Otherwise                                        →  absolute pixel coordinates
    Falls back to a default centre trapezoid when no valid nodes are present.

    Renders:
      • Semi-transparent green fill  (alpha 0.20)
      • Solid cyan outline           (2 px)
      • "EGO LANE" or "EGO LANE (default)" label
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
                # Normalised (0–1) coordinates — multiply by frame size
                pixel_pts = [(int(x * img_w), int(y * img_h)) for x, y in raw]

            elif max_x <= img_w and max_y <= img_h:
                # Absolute pixels from same camera — use directly, they already fit
                pixel_pts = [(int(x), int(y)) for x, y in raw]

            else:
                # Absolute pixels from a different camera/resolution — scale to fit
                pixel_pts = [(int(x / max_x * img_w), int(y / max_y * img_h))
                             for x, y in raw]

            pts       = np.array(pixel_pts, dtype=np.int32)
            label_txt = "EGO LANE"
        except Exception as e:
            print(f"[EGO LANE] Could not parse nodes ({e}), falling back to default.")
            pts = None

    if pts is None:
        # Default centre trapezoid — same geometry as _EgoLaneProximity._default_trapezoid()
        print("[EGO LANE] No valid nodes in calibration — drawing default trapezoid.")
        cx  = img_w / 2.0
        pts = np.array([
            (int(cx - 0.075 * img_w), int(0.55 * img_h)),  # top-left
            (int(cx + 0.075 * img_w), int(0.55 * img_h)),  # top-right
            (int(cx + 0.275 * img_w), int(0.98 * img_h)),  # bottom-right
            (int(cx - 0.275 * img_w), int(0.98 * img_h)),  # bottom-left
        ], dtype=np.int32)

    poly = pts.reshape((-1, 1, 2))

    # Semi-transparent green fill
    overlay = frame.copy()
    cv2.fillPoly(overlay, [poly], (0, 200, 80))
    cv2.addWeighted(overlay, 0.20, frame, 0.80, 0, frame)

    # Solid cyan outline
    cv2.polylines(frame, [poly], isClosed=True, color=(0, 220, 255), thickness=2)

    # Label just above the topmost vertex
    top_y  = max(int(pts[:, 1].min()) - 6, 14)
    left_x = int(pts[:, 0].min()) + 4
    cv2.putText(frame, label_txt, (left_x, top_y),
                cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 220, 255), 1, cv2.LINE_AA)


# ==========================================
# VIDEO RECORDING HELPER
# ==========================================
def _make_writer(label: str, frame_w: int, frame_h: int) -> cv2.VideoWriter:
    """
    Open a timestamped VideoWriter for one camera channel.
    Files saved as:  recordings/road_YYYYMMDD_HHMMSS.mp4
                     recordings/driver_YYYYMMDD_HHMMSS.mp4
    Writer is opened on the first real frame so the resolution is always correct.
    """
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
    """Decode one scale of DFL-free YOLO26n output into (boxes_xywh, scores, class_ids)."""
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
# ROAD SCORING HELPERS  (replaces HScoreEngine internal model)
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

def _estimate_distance_m(y2: int, calib: dict) -> float:
    """
    Ground-plane distance from bounding-box bottom pixel using
    the pinhole-camera + pitch-angle model stored in calibration.json.
    """
    fy_c  = calib.get("fy", FY)
    cy_c  = calib.get("cy", CY)
    cam_h = calib.get("camera_height_m", 1.2)
    pitch = calib.get("pitch_angle_rad",  0.0)
    pixel_angle = math.atan((y2 - cy_c) / fy_c)
    total_angle = pixel_angle + pitch
    if total_angle <= 1e-6:
        return 50.0                     # object above horizon → far away
    return round(cam_h / math.tan(total_angle), 2)

def _estimate_proximity(box: tuple, ego_lane_nodes: list,
                         frame_w: int, frame_h: int) -> float:
    """
    1.0 if box centre is inside the ego-lane polygon (nodes normalised 0–1),
    0.5 if no calibration polygon is available, 0.0 otherwise.
    """
    if not ego_lane_nodes or len(ego_lane_nodes) < 3:
        return 0.5
    pts = np.array(
        [[int(n["x"] * frame_w), int(n["y"] * frame_h)] for n in ego_lane_nodes],
        dtype=np.int32,
    )
    cx     = int((box[0] + box[2]) / 2)
    cy_box = int((box[1] + box[3]) / 2)
    return 1.0 if cv2.pointPolygonTest(pts, (cx, cy_box), False) >= 0 else 0.0

def _estimate_urgency(dist_m: float, ttc) -> float:
    """Urgency ∈ [0, 1]: closer distance and/or lower TTC → higher urgency."""
    u_dist = max(0.0, min(1.0, 1.0 - (dist_m - 1.0) / 25.0))
    if ttc is not None:
        u_ttc = max(0.0, min(1.0, 1.0 - ttc / 6.0))
        return max(u_dist, u_ttc)
    return u_dist

def _build_road_results(detections: list, calib: dict,
                         frame_h: int, frame_w: int,
                         prev_dist_map: dict, dt: float) -> list:
    """
    Convert raw YOLO detections to road-result dicts compatible with
    draw_road_overlay() and the aggregator.

    detections : list of (x1, y1, x2, y2, score, class_id)
    prev_dist_map : {track_id: prev_dist_m}  — updated in place for TTC
    """
    results = []
    for tid, (x1, y1, x2, y2, score, cid) in enumerate(detections):
        dist_m = _estimate_distance_m(y2, calib)
        prox   = _estimate_proximity(
            (x1, y1, x2, y2), calib.get("ego_lane_nodes", []), frame_w, frame_h
        )

        # TTC from consecutive distance measurements
        ttc = None
        if tid in prev_dist_map and dt > 0:
            delta = prev_dist_map[tid] - dist_m     # positive → approaching
            if delta > 0:
                ttc = round(dist_m / (delta / dt), 1)
        prev_dist_map[tid] = dist_m

        class_risk = _CLASS_RISK_MAP.get(cid, 0.70)
        urgency    = _estimate_urgency(dist_m, ttc)
        hscore     = round(
            W_CLASS * class_risk + W_PROXIMITY * prox + W_URGENCY * urgency, 4
        )

        results.append({
            "box":      (x1, y1, x2, y2),
            "track_id": tid,
            "cls_name": YOLO_CLASSES[cid] if cid < len(YOLO_CLASSES) else "unknown",
            "score":    round(score, 3),
            "hscore":   hscore,
            "distance": dist_m,
            "proximity": prox,
            "ttc":      ttc,
            "components": {
                "class_risk": class_risk,
                "proximity":  prox,
                "urgency":    urgency,
            },
        })
    return results


# ==========================================
# DRIVER SCORING HELPERS  (replaces DScorePipeline internal model)
# ==========================================
class DriverResult:
    """
    Lightweight drop-in for DScorePipeline's result object.
    Satisfies draw_driver_overlay (attribute access) and
    aggregator (to_dict → class_scores with string keys).
    """
    def __init__(self, class_id: int, probs: np.ndarray, d_score_smoothed: float):
        self.predicted_index  = class_id
        self.predicted_class  = DRIVER_CLASS_KEYS[class_id]
        # int-keyed so draw_driver_overlay can do result.probabilities[result.predicted_index]
        self.probabilities    = {i: float(probs[i]) for i in range(len(probs))}
        # string-keyed for aggregator's key_map iteration
        self.class_scores     = {
            DRIVER_CLASS_KEYS[i]: float(probs[i] * _DRIVER_SEVERITY[i])
            for i in range(len(probs))
        }
        self.d_score_smoothed = round(float(d_score_smoothed), 4)
        if d_score_smoothed < 0.35:
            self.risk_level = "Safe"
        elif d_score_smoothed < 0.70:
            self.risk_level = "Caution"
        else:
            self.risk_level = "Critical"

    def to_dict(self) -> dict:
        return {
            "d_score_smoothed": self.d_score_smoothed,
            "risk_level":       self.risk_level,
            "predicted_class":  self.predicted_class,
            "predicted_index":  self.predicted_index,
            "probabilities":    self.probabilities,
            "class_scores":     self.class_scores,
        }

def _compute_d_score(probs: np.ndarray) -> float:
    """Raw D-Score: dot product of class probabilities × severity weights."""
    return float(np.dot(probs, _DRIVER_SEVERITY))


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
            os.remove(batch_filepath)   # ✅ delete AFTER confirmed upload
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
    trip_active      = False  # Added to track trip state for uploads

    while True:
        try:
            state = None  # Prevent UnboundLocalError if request fails
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
                            shared_context['device_id'] = status_data.get("device_id")
                            shared_context['driver_id'] = status_data.get("driver_id")
                            status_event.set()
                            print(f"[MASTER] Trip started! Driver {shared_context['driver_id']}")

                elif state == "waiting":
                    if status_event.is_set():
                        status_event.clear()
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

            # ── Drain telemetry queue ──────────────────────────────────
            while not telemetry_queue.empty():
                telemetry_batch.append(telemetry_queue.get())

            # ── Detect trip end ────────────────────────────────────────
            if state == "active":
                trip_active = True

            trip_just_ended = (trip_active and state == "waiting")
            if trip_just_ended:
                trip_active = False

            # ── Upload logic ───────────────────────────────────────────
            # Send immediately on trip end, OR every 10 min during a long trip
            should_upload = (
                (trip_just_ended and len(telemetry_batch) > 0)           # trip ended — flush all
                or
                (time.time() - last_upload_time > BATCH_UPLOAD_INTERVAL_SEC   # 10-min interval
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
    cam_h          = backend_data.get("mounting_height", 1.2)
    known_distance = backend_data.get("known_distance_m", 3.25)
    bbox           = backend_data.get("selected_bbox", {"y1": 540, "y2": 540})
    pitch_angle_rad = _calibrate_pitch_angle(
        known_distance, float(bbox["y2"]), cam_h, FY, CY
    )
    local_calib = {
        "fy": FY, "cy": CY, "camera_height_m": cam_h,
        "pitch_angle_rad":  pitch_angle_rad,
        "ego_lane_nodes":   backend_data.get("ego_lane_nodes", []),
    }
    with open("calibration.json", "w") as f:
        json.dump(local_calib, f, indent=2)

def _handle_calibration_snapshot():
    # Load YOLO model
    try:
        from ultralytics import YOLO
        model = YOLO("/home/daras/hailo-apps-infra/App_Main_folder/yolo26s_ncnn_model")
    except Exception as e:
        print(f"[SNAPSHOT] ✗ Could not load YOLO model: {e}")
        return

    # Capture frame with warm-up
    cap = cv2.VideoCapture(ROAD_CAM_INDEX)

    # ✅ Warm up: discard first N frames so exposure settles
    for _ in range(50):
        cap.read()

    ret, frame = cap.read()
    cap.release()

    if not ret:
        print("[SNAPSHOT] ✗ Failed to read frame from road camera.")
        return

    # Run detection
    try:
        results    = model(frame, verbose=False)
        detections = [
            {"x1": int(b.xyxy[0][0]), "y1": int(b.xyxy[0][1]),
             "x2": int(b.xyxy[0][2]), "y2": int(b.xyxy[0][3])}
            for r in results for b in r.boxes
        ]
    except Exception as e:
        print(f"[SNAPSHOT] ✗ YOLO inference failed: {e}")
        return

    # Encode and POST
    try:
        _, buffer = cv2.imencode('.jpg', frame)
        resp = requests.post(
            f"{API_BASE_URL}/hardware/calibration/snapshot",
            headers=HEADERS,
            json={
                "snapshot_base64": base64.b64encode(buffer).decode('utf-8'),
                "detections":      detections,
            },
            timeout=10,
        )
        if resp.status_code == 200:
            print(f"[SNAPSHOT] ✓ Sent — {len(detections)} detections.")
        else:
            print(f"[SNAPSHOT] ✗ Server rejected snapshot: {resp.status_code} {resp.text[:120]}")
    except Exception as e:
        print(f"[SNAPSHOT] ✗ POST failed: {e}")


# ==========================================
# PROCESS: HAILO INFERENCE WORKER
# Owns the single Hailo chip — time-slices YOLO26n and ResNet-18.
# Mirrors the activate → InferVStreams → deactivate pattern of multi.py.
# ==========================================
def hailo_inference_worker(status_event,
                            hailo_road_frame_q,   hailo_road_result_q,
                            hailo_driver_frame_q, hailo_driver_result_q):
    """
    Dedicated process that exclusively owns the Hailo VDevice.

    HailoRT constraint: only ONE network group may be active at a time.
    Solution: alternate between road slot (YOLO26n) and driver slot
    (ResNet-18) — each slot activates its network group, runs one frame
    of inference, then deactivates before the other slot begins.
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
        # Configure both models once — kept for the lifetime of the process
        road_ng = target.configure(
            road_hef,
            ConfigureParams.create_from_hef(road_hef, interface=HailoStreamInterface.PCIe),
        )[0]
        driver_ng = target.configure(
            driver_hef,
            ConfigureParams.create_from_hef(driver_hef, interface=HailoStreamInterface.PCIe),
        )[0]

        # Build VStream params once — reused every slot, zero rebuild overhead
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
            # Pause cleanly between trips — no chip activity when idle
            status_event.wait()

            # ── ROAD SLOT ──────────────────────────────────────────────────
            # Grab newest road frame; skip slot if camera worker has nothing
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
                # Deliver result; drop stale entry if worker hasn't consumed it
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
                    probs = np.ones(len(DRIVER_CLASS_KEYS), dtype=np.float32) / len(DRIVER_CLASS_KEYS)
                if hailo_driver_result_q.full():
                    try: hailo_driver_result_q.get_nowait()
                    except Exception: pass
                hailo_driver_result_q.put((cid, probs))


# ==========================================
# PROCESS 2: ROAD VISION  (Hailo YOLO + H-Score)
# ==========================================
def road_vision_worker(status_event, results_queue, shared_context,
                        hailo_road_frame_q, hailo_road_result_q):
    """
    Captures road camera frames, forwards them to hailo_inference_worker
    for YOLO26n detection, then computes H-Scores using calibration data
    and pushes telemetry to results_queue.

    Replaces: HScoreEngine(model_path=ROAD_MODEL_HEF).process_frame()
    Inference now runs on Hailo chip via hailo_inference_worker.
    """
    print("[ROAD] Initialized. Waiting for trip...")

    while True:
        status_event.wait()

        # Reload calibration at the start of each trip so live updates apply
        calib = _load_calibration()
        # Log ego lane mode once per trip
        _nodes = calib.get("ego_lane_nodes", [])
        if _nodes and len(_nodes) >= 3:
            _mx = max(float(n["x"]) for n in _nodes)
            _my = max(float(n["y"]) for n in _nodes)
            if _mx <= 1.0 and _my <= 1.0:
                print(f"[EGO LANE] Calibration nodes (normalised) — {len(_nodes)} points")
            elif _mx <= 640 and _my <= 480:  # replace 640/480 with your actual frame size
                print(f"[EGO LANE] Calibration nodes (absolute px, same camera) — {len(_nodes)} points")
            else:
                print(f"[EGO LANE] Calibration nodes (absolute px, scaled from {_mx:.0f}×{_my:.0f}) — {len(_nodes)} points")
        else:
            print("[EGO LANE] No valid nodes — drawing default trapezoid.")
        prev_dist_map: dict = {}    # {track_id: prev_dist_m} for TTC

        cap = cv2.VideoCapture(ROAD_CAM_INDEX)
        if SHOW_WINDOWS:
            try: cv2.namedWindow("Road Cam", cv2.WINDOW_NORMAL)
            except Exception: pass

        last_time = time.time()
        last_detections: list = []      # keep last result for display continuity
        road_writer = None             # opened on first frame (real resolution)
        print("[ROAD] Engine active (Hailo YOLO26n).")

        while status_event.is_set():
            ret, frame = cap.read()
            if not ret:
                time.sleep(0.005)
                continue

            # 1. Calculate dynamic dt
            current_time = time.time()
            real_dt = current_time - last_time
            if real_dt <= 0: real_dt = 0.033
            last_time = current_time

            img_h, img_w = frame.shape[:2]

            # 2. Submit frame to Hailo inference worker (non-blocking)
            try:
                hailo_road_frame_q.put_nowait((frame, img_h, img_w))
            except Exception:
                pass    # queue full — hailo worker is busy; try next frame

            # 3. Drain result queue — always use the freshest available result
            while True:
                try:
                    last_detections = hailo_road_result_q.get_nowait()
                except Exception:
                    break

            # 4. Build H-Score results from Hailo detections + calibration
            results = _build_road_results(
                last_detections, calib, img_h, img_w, prev_dist_map, real_dt
            )

            # 5. Queue Telemetry
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
            results_queue.put({"source": "road", "timestamp": current_time, "data": reading_data})

            # 6. Build annotated frame (always — recording works even without display)
            disp  = frame.copy()
            nodes = calib.get("ego_lane_nodes", [])
            ego_poly = [(int(n["x"] * img_w), int(n["y"] * img_h)) for n in nodes]
            draw_ego_lane(disp, calib, img_w, img_h)                          # ego-lane polygon
            draw_road_overlay(disp, {"results": results, "ego_lane_poly": []}) # detections + HUD

            if RECORD_VIDEO:
                if road_writer is None:
                    road_writer = _make_writer("road", img_w, img_h)
                road_writer.write(disp)

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
# PROCESS 3: DRIVER VISION  (Hailo ResNet-18 + D-Score)
# ==========================================
def driver_vision_worker(status_event, results_queue, shared_context,
                          hailo_driver_frame_q, hailo_driver_result_q):
    """
    Captures driver camera frames, forwards them to hailo_inference_worker
    for ResNet-18 classification, then computes EMA-smoothed D-Scores and
    pushes telemetry to results_queue.

    Replaces: ModelRegistry.load() + DScorePipeline.process_frame()
    Inference now runs on Hailo chip via hailo_inference_worker.
    """
    print("[DRIVER] Initialized. Waiting for trip...")

    while True:
        status_event.wait()

        cap = cv2.VideoCapture(DRIVER_CAM_INDEX)
        if SHOW_WINDOWS:
            try: cv2.namedWindow("Driver Cam", cv2.WINDOW_NORMAL)
            except Exception: pass

        ema_d_score = 0.0
        last_probs  = np.ones(len(DRIVER_CLASS_KEYS), dtype=np.float32) / len(DRIVER_CLASS_KEYS)
        last_cid    = 0
        driver_writer = None            # opened on first frame (real resolution)
        print("[DRIVER] Engine active (Hailo ResNet-18).")

        while status_event.is_set():
            ret, frame = cap.read()
            if not ret: continue

            # 1. Submit frame to Hailo inference worker (non-blocking)
            try:
                hailo_driver_frame_q.put_nowait(frame)
            except Exception:
                pass    # queue full — use last known result below

            # 2. Drain result queue — always use the freshest classification
            while True:
                try:
                    last_cid, last_probs = hailo_driver_result_q.get_nowait()
                except Exception:
                    break

            # 3. EMA-smoothed D-Score
            raw_d       = _compute_d_score(last_probs)
            ema_d_score = EMA_ALPHA * raw_d + (1.0 - EMA_ALPHA) * ema_d_score
            result      = DriverResult(last_cid, last_probs, ema_d_score)

            # 4. Queue Telemetry
            results_queue.put({
                "source":    "driver",
                "timestamp": time.time(),
                "data":      result.to_dict(),
            })

            # 5. Build annotated frame (always — recording works even without display)
            img_h, img_w = frame.shape[:2]
            disp = frame.copy()
            draw_driver_overlay(disp, result)

            if RECORD_VIDEO:
                if driver_writer is None:
                    driver_writer = _make_writer("driver", img_w, img_h)
                driver_writer.write(disp)

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
            print("[RECORD] Driver recording saved.")
        if SHOW_WINDOWS:
            try: cv2.destroyWindow("Driver Cam")
            except Exception: pass


# ==========================================
# PROCESS 4: AGGREGATOR & ALERTS  (unchanged)
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
    road_scores   = [d["data"]["h_score"]        for d in window if d["source"] == "road"]
    driver_scores = [d["data"]["d_score_smoothed"] for d in window if d["source"] == "driver"]
    return ((road_scores[-1] if road_scores else 0.0) +
            (driver_scores[-1] if driver_scores else 0.0)) / 2.0

def _trigger_hardware_alert():
    print("[ALERT] DANGER THRESHOLD CROSSED - BEEP BEEP!")
    
    # It is highly recommended to use the absolute path so it works 
    # no matter where you launch your script from!
    audio_file = "/home/daras/Final_app_work_env/App_Main_folder/soundtools-tts-am_adam-1780436867881.wav"
    
    try:
        # This executes the exact terminal command that worked for you.
        # It will block the code (pause) until the wav file is completely finished.
        subprocess.run(["pw-play", audio_file], check=True)
    except Exception as e:
        print(f"[ERROR] Failed to play audio: {e}")

def _format_telemetry(window, shared_context):
    road_data   = [d["data"] for d in window if d["source"] == "road"]
    driver_data = [d["data"] for d in window if d["source"] == "driver"]

    if not road_data and not driver_data: return None

    mean_h    = sum(d["h_score"]        for d in road_data)   / len(road_data)   if road_data   else 0.0
    mean_u    = sum(d["urgency"]        for d in road_data)   / len(road_data)   if road_data   else 0.0
    mean_p    = sum(d["ego_lane_proximity"] for d in road_data) / len(road_data) if road_data   else 0.0
    mean_d    = sum(d["d_score_smoothed"] for d in driver_data) / len(driver_data) if driver_data else 0.0
    mean_risk = (mean_h + mean_d) / 2.0

    mode_obj_classes = ""
    if road_data:
        classes_list = [d["object_type"] for d in road_data if d["object_type"] != "none"]
        if classes_list: mode_obj_classes = max(set(classes_list), key=classes_list.count)

    avg_dist = {
        "safe_driving": 0.0, "texting_right": 0.0, "texting_left": 0.0,
        "talking_to_passenger": 0.0, "drinking": 0.0, "calling_right": 0.0,
        "calling_left": 0.0, "operating_radio": 0.0, "hair_and_makeup": 0.0,
        "reaching_behind": 0.0,
    }
    if driver_data:
        key_map = {
            "c0_safe": "safe_driving",       "c1_texting_right": "texting_right",
            "c2_phone_right": "calling_right", "c3_texting_left": "texting_left",
            "c4_phone_left": "calling_left",  "c5_radio": "operating_radio",
            "c6_drinking": "drinking",        "c7_reaching": "reaching_behind",
            "c8_hair_makeup": "hair_and_makeup", "c9_talking_passenger": "talking_to_passenger",
        }
        for d in driver_data:
            for original_key, val in d["class_scores"].items():
                if original_key in key_map: avg_dist[key_map[original_key]] += val
        for key in avg_dist: avg_dist[key] /= len(driver_data)

    return {
        "device_id": shared_context.get("device_id", 0),
        "driver_id": shared_context.get("driver_id", 0),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "driver_score": round(mean_d, 4),
        "road_score":   round(mean_h, 4),
        "risk_score":   round(mean_risk, 4),
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

    # ── Inter-process queues for Hailo inference ───────────────────────────
    # maxsize=2 keeps memory bounded and ensures workers always see fresh frames
    hailo_road_frame_q    = mp.Queue(maxsize=2)   # road_vision  → hailo_worker
    hailo_road_result_q   = mp.Queue(maxsize=2)   # hailo_worker → road_vision
    hailo_driver_frame_q  = mp.Queue(maxsize=2)   # driver_vision → hailo_worker
    hailo_driver_result_q = mp.Queue(maxsize=2)   # hailo_worker → driver_vision

    # ── Processes ──────────────────────────────────────────────────────────
    p_master = mp.Process(
        target=master_controller,
        args=(status_event, telemetry_queue, shared_context),
    )
    # Hailo worker — single owner of the chip
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