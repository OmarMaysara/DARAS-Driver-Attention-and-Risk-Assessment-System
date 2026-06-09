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
  [7] Probability sharpening (k=2) applied after class remapping in
      driver_vision_worker — boosts high-confidence predictions and suppresses
      noise floor without changing predicted class (argmax-stable).
  [8] driver_distraction_distribution now binary: 1 for the most-detected
      class in the 1-second window, 0 for all others.
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
from zoneinfo import ZoneInfo

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

RISK_THRESHOLD            = 0.5 
BATCH_UPLOAD_INTERVAL_SEC = 600

EGYPT_TZ = ZoneInfo("Africa/Cairo")

# ==========================================
# ROAD RISK DISPLAY THRESHOLDS  (user-adjustable)
# ==========================================
ROAD_CAUTION_THRESHOLD = 0.35   # h_score >= this  → CAUTION
ROAD_DANGER_THRESHOLD  = 0.7   # h_score >= this  → DANGER  (must be >= CAUTION)

# ==========================================
# CAMERA INTRINSICS (fixed)
# ==========================================
FY = 491.2652094492
CY = 246.5059427592

# All paths anchored to the script directory so they resolve correctly
# regardless of which directory the process is launched from.
_SCRIPT_DIR    = os.path.dirname(os.path.abspath(__file__))
CALIB_PATH     = os.path.join(_SCRIPT_DIR, "calibration.json")
READINGS_DIR   = os.path.join(_SCRIPT_DIR, "readings")
RECORDINGS_DIR = os.path.join(_SCRIPT_DIR, "recordings")
os.makedirs(READINGS_DIR,   exist_ok=True)
os.makedirs(RECORDINGS_DIR, exist_ok=True)
print(f"[SYSTEM] Script dir : {_SCRIPT_DIR}")
print(f"[SYSTEM] Calib path : {CALIB_PATH}")

SHOW_WINDOWS  = True

# ── Recording ──────────────────────────────────────────────────────────────
RECORD_VIDEO  = True
RECORD_FPS    = 20.0
RECORD_FOURCC = "mp4v"

# ==========================================
# HAILO INFERENCE CONSTANTS
# ==========================================
YOLO_CLASSES     = ['car', 'person', 'rider']
YOLO_NUM_CLS     = len(YOLO_CLASSES)
YOLO_CONF_THRESH = 0.30
YOLO_NMS_THRESH  = 0.40
YOLO_INPUT_SIZE  = 640

YOLO_OUTPUT_LAYERS = [
    ('yolo26n/conv61', 'yolo26n/conv64',  8),
    ('yolo26n/conv77', 'yolo26n/conv80', 16),
    ('yolo26n/conv91', 'yolo26n/conv94', 32),
]

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
    PX, PY, PW, PH = 10, 10, 235, 190
    _draw_panel(frame, PX, PY, PW, PH)
    _text(frame, "DRIVER MONITOR", PX + 8, PY + 18, color=(180, 180, 180), scale=0.46)
    cv2.line(frame, (PX + 6, PY + 23), (PX + PW - 6, PY + 23), (60, 60, 60), 1)

    is_safe   = (result.predicted_class == "c0_safe")
    state_col = (60, 210, 60) if is_safe else (40, 40, 220)

    _text(frame, "D-Score", PX + 8,  PY + 42, color=(160, 160, 160), scale=0.42)
    _text(frame, f"{result.d_score_smoothed:.3f}", PX + 78, PY + 42,
          color=state_col, scale=0.55, thickness=1)
    _bar(frame, PX + 8, PY + 47, result.d_score_smoothed, bar_w=PW - 22, color=state_col)

    status_txt = "SAFE DRIVING" if is_safe else "DISTRACTED"
    _text(frame, status_txt, PX + 8, PY + 68, color=state_col, scale=0.46, thickness=1)

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

    if h_score >= ROAD_DANGER_THRESHOLD:
        road_status, status_col = "DANGER",  (40, 40, 220)
    elif h_score >= ROAD_CAUTION_THRESHOLD:
        road_status, status_col = "CAUTION", (30, 165, 255)
    else:
        road_status, status_col = "SAFE",    (60, 210, 60)

    PX, PY, PW, PH = 10, 10, 235, 218
    _draw_panel(frame, PX, PY, PW, PH)
    _text(frame, "ROAD MONITOR", PX + 8, PY + 18, color=(180, 180, 180), scale=0.46)
    cv2.line(frame, (PX + 6, PY + 23), (PX + PW - 6, PY + 23), (60, 60, 60), 1)

    _text(frame, "H-Score", PX + 8,  PY + 42, color=(160, 160, 160), scale=0.42)
    _text(frame, f"{h_score:.3f}",   PX + 78, PY + 42,
          color=status_col, scale=0.55, thickness=1)
    _bar(frame, PX + 8, PY + 47, h_score, bar_w=PW - 22, color=status_col)

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

    if prox >= 0.80:
        lane_txt, lane_col = "IN LANE",  (40, 40, 220)   # red — close and in lane
    elif prox >= 0.40:
        lane_txt, lane_col = "NEAR",     (30, 165, 255)  # orange — partial/edge
    else:
        lane_txt, lane_col = "OUT",      (60, 210, 60)   # green — outside lane
    cv2.line(frame, (PX + 6, PY + 122), (PX + PW - 6, PY + 122), (50, 50, 50), 1)
    _text(frame, f"Ego-Lane Prox: {prox:.2f}", PX + 8, PY + 136,
          color=(210, 210, 210), scale=0.43)
    bw_lane = len(lane_txt) * 8 + 8
    cv2.rectangle(frame,
                (PX + PW - bw_lane - 4, PY + 125),
                (PX + PW - 4,           PY + 139),
                lane_col, -1)
    _text(frame, lane_txt, PX + PW - bw_lane, PY + 137,
        color=(10, 10, 10), scale=0.38, thickness=1)

    cv2.line(frame, (PX + 6, PY + 154), (PX + PW - 6, PY + 154), (50, 50, 50), 1)
    urg_col = _score_color(urgency)
    ttc_str = "---" if ttc is None else (">99s" if ttc >= 99.0 else f"{ttc:.1f}s")
    _text(frame, f"Urgency: {urgency:.3f}   TTC: {ttc_str}", PX + 8, PY + 170,
          color=(210, 210, 210), scale=0.40)
    _bar(frame, PX + 8, PY + 175, urgency, bar_w=PW - 22, color=urg_col)


def draw_ego_lane(frame, calib: dict, img_w: int, img_h: int):
    nodes     = calib.get("ego_lane_nodes", [])
    pts       = None
    label_txt = "EGO LANE (default)"

    if nodes and len(nodes) >= 3:
        try:
            raw = [(float(n["x"]), float(n["y"])) for n in nodes]
            max_x = max(p[0] for p in raw)
            max_y = max(p[1] for p in raw)

            if max_x <= 1.0 and max_y <= 1.0:
                pixel_pts = [(int(x * img_w), int(y * img_h)) for x, y in raw]
            elif max_x <= img_w and max_y <= img_h:
                pixel_pts = [(int(x), int(y)) for x, y in raw]
            else:
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
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    return np.expand_dims(cv2.resize(rgb, (YOLO_INPUT_SIZE, YOLO_INPUT_SIZE)), 0)

def _sigmoid(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, -88, 88)
    return 1.0 / (1.0 + np.exp(-x))

def _decode_yolo_scale(reg: np.ndarray, cls_logits: np.ndarray, stride: int):
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
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    return np.expand_dims(cv2.resize(rgb, (DRIVER_INPUT_SIZE, DRIVER_INPUT_SIZE)), 0)

def postprocess_driver_hailo(raw_output: np.ndarray):
    logits = raw_output[0].astype(np.float32)
    e      = np.exp(logits - logits.max())
    probs  = e / e.sum()
    return int(np.argmax(probs)), probs


# Classes whose probability mass is merged into c0_safe before D-Score.
# Add indices here to remap additional classes.
_REMAP_TO_SAFE: set = {8}   # 8 = c8_hair_makeup → c0_safe

# Power-sharpening: P_i' = P_i^k / Σ P_j^k
# k=2 amplifies the dominant class and suppresses the noise floor.
# Argmax-stable — predicted class never changes. Set k=1 to disable.
_SHARPEN_K: float = 1.0


def _apply_class_remapping(probs: np.ndarray) -> np.ndarray:
    """Fold remapped class probabilities into c0_safe (index 0). Output sums to 1."""
    out = probs.copy()
    for idx in _REMAP_TO_SAFE:
        out[0]   += out[idx]
        out[idx]  = 0.0
    return out


def _sharpen_probs(probs: np.ndarray, k: float = _SHARPEN_K) -> np.ndarray:
    """P_i' = P_i^k / Σ P_j^k — sharpens dominant class, suppresses noise floor. Argmax-stable."""
    powered = np.power(probs.astype(np.float64), k)
    total   = powered.sum()
    if total < 1e-12:
        # Degenerate input (all zeros after remapping) — return uniform
        out = np.ones(len(probs), dtype=np.float32) / len(probs)
        return out
    return (powered / total).astype(np.float32)


# ==========================================
# CALIBRATION HELPER
# ==========================================
def _load_calibration() -> dict:
    try:
        with open(CALIB_PATH) as f:
            return json.load(f)
    except Exception:
        return {
            "fy": FY, "cy": CY,
            "camera_height_m": 1.2,
            "pitch_angle_rad": 0.0,
            "ego_lane_nodes":  [],
        }


# ==========================================
# PROCESS 1: MASTER CONTROLLER
# ==========================================
def _flush_telemetry_to_api(batch, readings_dir):
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
    _recover_unsent_batches()
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
                        if not os.path.exists(CALIB_PATH):
                            print("[MASTER] ⚠ Trip blocked — calibration.json not found.")
                        else:
                            shared_context['device_id']      = status_data.get("device_id")
                            shared_context['driver_id']      = status_data.get("driver_id")
                            shared_context['trip_rec_start'] = time.time()
                            status_event.set()
                            print(f"[MASTER] Trip started! Driver {shared_context['driver_id']}")

                elif state == "waiting":
                    if status_event.is_set():
                        status_event.clear()
                        shared_context['trip_rec_start'] = None
                        print("[MASTER] Trip ended. Shutting down models.")

                elif state == "capture_snapshot":
                    print("[MASTER] Capturing calibration snapshot...")
                    _handle_calibration_snapshot()

                elif state == "fetch_calibration":
                    print("[MASTER] Downloading calibration JSON...")
                    cal_resp = requests.get(
                        f"{API_BASE_URL}/hardware/calibration",
                        headers=HEADERS, timeout=10,
                    )
                    if cal_resp.status_code == 200:
                        success = _compute_and_save_calibration(cal_resp.json())
                        if success:
                            print("[MASTER] ✓ calibration.json written successfully.")
                        else:
                            print("[MASTER] ✗ Calibration write failed — see [CALIB] logs above.")
                    else:
                        print(f"[MASTER] ✗ Could not fetch calibration data: "
                              f"{cal_resp.status_code} {cal_resp.text[:120]}")

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
        except Exception as e:
            import traceback
            print(f"[MASTER] ✗ Unexpected error in master loop: {e}")
            print(traceback.format_exc())
            # Do NOT re-raise — keep the master loop alive

        time.sleep(3)


# ── Calibration helpers ────────────────────────────────────────────────────

# Snapshot resolution sent to the app — fixed so ego-lane nodes returned
# by the app are always in a known coordinate space.
_SNAPSHOT_W = 640
_SNAPSHOT_H = 480

def _calibrate_pitch_angle(known_distance_m, v, camera_height_m, fy, cy):
    alpha = math.atan((v - cy) / fy)
    return math.atan(camera_height_m / known_distance_m) - alpha

def _compute_and_save_calibration(backend_data):
    """
    Compute pitch angle and ego-lane nodes from app calibration data,
    then write calibration.json.

    Returns True on success, False on any error (never raises — master_controller
    must not be killed by a bad API payload or transient camera failure).
    """
    try:
        # ── Always log the full payload so key mismatches are visible ──────
        print(f"[CALIB] Raw payload keys: {list(backend_data.keys())}")
        print(f"[CALIB] Raw payload: {backend_data}")

        # ── Camera height — try both spellings ────────────────────────────
        cam_h = (
            backend_data.get("mounting_height") or
            backend_data.get("camera_height_m") or
            backend_data.get("camera_height") or
            1.2
        )
        cam_h = float(cam_h)

        # ── Known distance — API key is "focal_distance" ────────────────────
        if "focal_distance" not in backend_data or backend_data["focal_distance"] is None:
            print(f"[CALIB] ✗ API payload missing 'focal_distance'. "
                  f"Available keys: {list(backend_data.keys())}")
            return False
        known_distance = float(backend_data["focal_distance"])
        print(f"[CALIB] focal_distance = {known_distance}m")

        bbox = backend_data.get("selected_bbox")

        # ── Validate required fields ──────────────────────────────────────
        if bbox is None:
            print("[CALIB] ✗ API payload missing 'selected_bbox' — calibration aborted.")
            return False
        if "y2" not in bbox:
            print(f"[CALIB] ✗ 'selected_bbox' missing 'y2' key — got: {bbox}")
            return False
        if known_distance <= 0:
            print(f"[CALIB] ✗ distance is {known_distance} — must be > 0.")
            return False
        if cam_h <= 0:
            print(f"[CALIB] ✗ mounting_height is {cam_h} — must be > 0.")
            return False

        print(f"[CALIB] Payload OK — cam_h={cam_h}m  dist={known_distance}m  "
              f"bbox_y2={bbox['y2']}")

        # ── Read native camera resolution ─────────────────────────────────
        native_h, native_w = _SNAPSHOT_H, _SNAPSHOT_W
        try:
            _cap = cv2.VideoCapture(ROAD_CAM_INDEX)
            _ret, _frm = _cap.read()
            _cap.release()
            if _ret and _frm is not None:
                native_h, native_w = _frm.shape[:2]
                print(f"[CALIB] Native camera resolution: {native_w}×{native_h}")
            else:
                print("[CALIB] ⚠ Could not read road camera — using snapshot dims as fallback.")
        except Exception as cam_err:
            print(f"[CALIB] ⚠ Camera open error ({cam_err}) — using snapshot dims as fallback.")

        scale_x = native_w / _SNAPSHOT_W
        scale_y = native_h / _SNAPSHOT_H
        print(f"[CALIB] Scale factors: x={scale_x:.3f}  y={scale_y:.3f}")

        # ── Compute pitch angle ───────────────────────────────────────────
        y2_native = float(bbox["y2"]) * scale_y
        pitch_angle_rad = _calibrate_pitch_angle(
            known_distance, y2_native, cam_h, FY, CY
        )
        pitch_deg = math.degrees(pitch_angle_rad)
        print(f"[CALIB] Computed pitch: {pitch_deg:.3f}°  "
              f"(y2_native={y2_native:.1f}px)")

        if not (-30 < pitch_deg < 60):
            print(f"[CALIB] ⚠ Pitch {pitch_deg:.1f}° is outside expected range "
                  f"(-30° to 60°) — check mounting_height and bbox selection.")

        # ── Scale ego-lane nodes to native resolution ─────────────────────
        ego_nodes_raw    = backend_data.get("ego_lane_nodes", [])
        ego_nodes_native = [
            {"x": round(n["x"] * scale_x, 2),
             "y": round(n["y"] * scale_y, 2)}
            for n in ego_nodes_raw
        ]
        print(f"[CALIB] Ego-lane nodes: {len(ego_nodes_native)} "
              f"(native {native_w}×{native_h})")

        # ── Write calibration.json ────────────────────────────────────────
        local_calib = {
            "fy":              FY,
            "cy":              CY,
            "camera_height_m": cam_h,
            "pitch_angle_rad": pitch_angle_rad,
            "ego_lane_nodes":  ego_nodes_native,
        }
        # Delete the old file first so a stale copy can never persist.
        if os.path.exists(CALIB_PATH):
            os.remove(CALIB_PATH)
            print(f"[CALIB] Removed old file at {CALIB_PATH}")

        with open(CALIB_PATH, "w") as f:
            json.dump(local_calib, f, indent=2)

        # Verify the file was actually written and is valid JSON
        with open(CALIB_PATH, "r") as f:
            verify = json.load(f)
        assert abs(verify["pitch_angle_rad"] - pitch_angle_rad) < 1e-9

        print(
            f"[CALIB] ✓ Written and verified: {CALIB_PATH}\n"
            f"[CALIB]   pitch={pitch_deg:.2f}°  fy={FY}  cy={CY}  "
            f"[CALIB]   cam_h={cam_h}m  dist={known_distance}m"
        )
        return True

    except Exception as e:
        import traceback
        print(f"[CALIB] ✗ EXCEPTION in _compute_and_save_calibration: {e}")
        print(traceback.format_exc())
        return False

def _handle_calibration_snapshot():
    try:
        from ultralytics import YOLO
        model = YOLO("/home/daras/hailo-apps-infra/App_Main_folder/yolo26s_ncnn_model")
    except Exception as e:
        print(f"[SNAPSHOT] ✗ Could not load YOLO model: {e}")
        return

    cap = cv2.VideoCapture(ROAD_CAM_INDEX)
    for _ in range(50):
        cap.read()

    ret, frame = cap.read()
    cap.release()

    if not ret:
        print("[SNAPSHOT] ✗ Failed to read frame from road camera.")
        return

    orig_h, orig_w = frame.shape[:2]

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
# ==========================================
def hailo_inference_worker(status_event,
                            hailo_road_frame_q,   hailo_road_result_q,
                            hailo_driver_frame_q, hailo_driver_result_q):
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

            # ── ROAD SLOT ─────────────────────────────────────────────────
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

            # ── DRIVER SLOT ───────────────────────────────────────────────
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
# PROCESS 2: ROAD VISION
# ==========================================
def road_vision_worker(status_event, results_queue, shared_context,
                        hailo_road_frame_q, hailo_road_result_q):
    print("[ROAD] Initialized. Waiting for trip...")

    while True:
        status_event.wait()

        try:
            engine = HScoreEngine(
                calib_path  = CALIB_PATH,
                w_proximity = 0.4,
                w_urgency   = 0.6,
            )
            print("[ROAD] HScoreEngine loaded — H = class_risk × (0.4·prox + 0.6·urg).")
        except Exception as e:
            print(f"[ROAD] HScoreEngine init failed: {e}. Road scoring disabled.")
            engine = None

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

        rec_start = None
        for _ in range(100):
            rec_start = shared_context.get('trip_rec_start')
            if rec_start is not None:
                break
            time.sleep(0.002)
        rec_start = rec_start or time.time()

        last_slot  = -1
        last_disp  = None

        print(f"[ROAD] Engine active. rec_start anchor: {rec_start:.3f}")

        while status_event.is_set():
            ret, frame = cap.read()
            if not ret:
                time.sleep(0.005)
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

            try:
                hailo_road_frame_q.put_nowait((frame, img_h, img_w))
            except Exception:
                pass

            while True:
                try:
                    last_detections = hailo_road_result_q.get_nowait()
                except Exception:
                    break

            if engine is not None:
                results = engine.process_frame_with_detections(
                    frame, last_detections, real_dt
                )
            else:
                results = []

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

            disp = frame.copy()
            draw_ego_lane(disp, calib, img_w, img_h)
            draw_road_overlay(disp, {"results": results, "ego_lane_poly": []})

            if RECORD_VIDEO:
                target_slot = int((current_time - rec_start) * RECORD_FPS)
                if target_slot > last_slot:
                    if road_writer is None:
                        road_writer = _make_writer("road", img_w, img_h)
                    fill_frame = last_disp if last_disp is not None else disp
                    for _ in range(target_slot - last_slot - 1):
                        road_writer.write(fill_frame)
                    road_writer.write(disp)
                    last_slot = target_slot
            last_disp = disp

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
# PROCESS 3: DRIVER VISION
# ==========================================
def driver_vision_worker(status_event, results_queue, shared_context,
                          hailo_driver_frame_q, hailo_driver_result_q):
    print("[DRIVER] Initialized. Waiting for trip...")

    pipeline = DScorePipeline(driver_id="driver_main", fps=RECORD_FPS)

    while True:
        status_event.wait()
        pipeline.reset()

        cap = cv2.VideoCapture(DRIVER_CAM_INDEX)
        if SHOW_WINDOWS:
            try: cv2.namedWindow("Driver Cam", cv2.WINDOW_NORMAL)
            except Exception: pass

        last_probs        = np.ones(10, dtype=np.float32) / 10.0
        driver_writer     = None
        driver_raw_writer = None

        rec_start = None
        for _ in range(100):
            rec_start = shared_context.get('trip_rec_start')
            if rec_start is not None:
                break
            time.sleep(0.002)
        rec_start = rec_start or time.time()

        last_slot  = -1
        last_disp  = None
        last_raw   = None

        print(f"[DRIVER] Engine active. rec_start anchor: {rec_start:.3f}")

        while status_event.is_set():
            ret, frame = cap.read()
            if not ret:
                time.sleep(0.005)  # <--- FIX: Prevents infinite CPU spin loop that freezes the window
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

            try:
                hailo_driver_frame_q.put_nowait(frame)
            except Exception:
                pass

            while True:
                try:
                    _cid, last_probs = hailo_driver_result_q.get_nowait()
                except Exception:
                    break

            # ── Pre-processing pipeline ───────────────────────────────────
            # Step 1: remap hair/makeup (and any other configured classes) → safe
            remapped = _apply_class_remapping(last_probs)

            # Step 2: power-sharpen (k=2) — amplify dominant class, suppress
            #         noise floor from flat softmax output.
            #         Formula: P_i' = P_i^k / Σ P_j^k
            sharpened = _sharpen_probs(remapped)

            # Step 3: compute D-Score on the sharpened distribution
            result = pipeline.process_probs(sharpened)

            results_queue.put({
                "source":    "driver",
                "timestamp": current_time,
                "data":      result.to_dict(),
            })

            img_h, img_w = frame.shape[:2]
            disp = frame.copy()
            draw_driver_overlay(disp, result)

            if RECORD_VIDEO:
                target_slot = int((current_time - rec_start) * RECORD_FPS)
                if target_slot > last_slot:
                    if driver_writer is None:
                        driver_writer     = _make_writer("driver",     img_w, img_h)
                        driver_raw_writer = _make_writer("driver_raw", img_w, img_h)
                    fill_disp = last_disp if last_disp is not None else disp
                    fill_raw  = last_raw  if last_raw  is not None else frame
                    for _ in range(target_slot - last_slot - 1):
                        driver_writer.write(fill_disp)
                        driver_raw_writer.write(fill_raw)
                    driver_writer.write(disp)
                    driver_raw_writer.write(frame)
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

    mean_risk = round(0.6 * mean_d + 0.4 * mean_h, 4)

    mode_obj_classes = ""
    if road_data:
        classes_list = [d["object_type"] for d in road_data if d["object_type"] != "none"]
        if classes_list:
            mode_obj_classes = max(set(classes_list), key=classes_list.count)

    # ── Driver distraction distribution — binary format ───────────────────
    # 1 for whichever class was predicted most often in the 1-second window,
    # 0 for all others. predicted_class is the argmax of the sharpened
    # distribution, already computed in driver_vision_worker.
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
    avg_dist = {v: 0 for v in key_map.values()}
    if driver_data:
        predicted_classes = [d["predicted_class"] for d in driver_data]
        mode_class = max(set(predicted_classes), key=predicted_classes.count)
        if mode_class in key_map:
            avg_dist[key_map[mode_class]] = 1

    return {
        "device_id": shared_context.get("device_id", 0),
        "driver_id": shared_context.get("driver_id", 0),
        "timestamp": datetime.now(EGYPT_TZ).isoformat(),        
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