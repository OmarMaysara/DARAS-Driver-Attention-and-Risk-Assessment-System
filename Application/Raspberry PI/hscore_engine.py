"""
hscore_engine.py
────────────────
H-Score engine — Hailo YOLO26n edition.

Usage (hailo_inference_worker mode — recommended)
-------------------------------------------------
    from hscore_engine import HScoreEngine

    engine = HScoreEngine(
        calib_path   = "calibration.json",
        # model_path omitted — inference handled by hailo_inference_worker
        w_class      = 1/3,
        w_proximity  = 1/3,
        w_urgency    = 1/3,
    )

    # hailo_dets: list of (x1,y1,x2,y2,score,yolo_class_id) from hailo queue
    # yolo_class_id: 0=car  1=person  2=bike  (YOLO26n order)
    results = engine.process_frame_with_detections(frame, hailo_dets, dt=0.033)

Usage (standalone mode — testing only)
--------------------------------------
    engine = HScoreEngine(
        model_path   = "yolo26n.hef",
        calib_path   = "calibration.json",
    )
    results = engine.process_frame(frame, dt=0.033)   # opens its own VDevice

    ⚠ Do NOT run standalone + hailo_inference_worker simultaneously on the
      same chip — two VDevice handles on one physical device will conflict.

Each result dict:
    {
      "track_id"  : int,
      "cls_id"    : int,          # HScoreEngine index: 0=Person 1=Rider 2=Car
      "cls_name"  : str,
      "box"       : (x1,y1,x2,y2),
      "conf"      : float,
      "distance"  : float,        # metres
      "ttc"       : float|None,   # seconds; None = not approaching
      "proximity" : float,        # [0,1]
      "hscore"    : float,        # [0,1]
      "components": {
          "class_risk"  : float,
          "proximity"   : float,
          "urgency"     : float,   # normalised 1/TTC
          "w_class"     : float,
          "w_proximity" : float,
          "w_urgency"   : float,
      }
    }

Changes from ONNX version
--------------------------
  REMOVED  import onnxruntime as ort
  REMOVED  from matplotlib import scale    (was an accidental import / bug)
  REMOVED  _Detector class                 (ONNX-based)
  ADDED    from hailo_platform import ...
  ADDED    _HailoDetector class            (Hailo YOLO26n, standalone mode)
  ADDED    _YOLO_TO_ENGINE_CLS mapping     (car/person/bike → Person/Rider/Car)
  ADDED    HScoreEngine._process_tracks()  (shared pipeline, DRY refactor)
  ADDED    HScoreEngine.process_frame_with_detections()
  CHANGED  HScoreEngine.__init__           model_path now Optional (None = no detector)
  KEPT     All calibration, tracking, Kalman, TTC, proximity, H-Score logic
"""

from __future__ import annotations

import json
import math
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

from hailo_platform import (
    HEF, VDevice, HailoStreamInterface,
    InferVStreams, ConfigureParams,
    InputVStreamParams, OutputVStreamParams,
    FormatType,
)


# ═══════════════════════════════════════════════════════════════════════════════
# Constants
# ═══════════════════════════════════════════════════════════════════════════════

# HScoreEngine class registry (index used internally by tracker)
CLASS_NAMES: List[str] = ["Person", "Rider", "Car"]

_CLASS_RISK: Dict[str, float] = {
    "Person": 1.0,
    "Rider":  0.9,
    "Car":    0.7,
}

_DEFAULT_CLASS_RISK = 0.5

# YOLO26n output class order: ['car', 'person', 'bike']  (indices 0, 1, 2)
# HScoreEngine internal order: ['Person', 'Rider', 'Car'] (indices 0, 1, 2)
#
# Mapping: YOLO class_id → HScoreEngine cls_id
_YOLO_TO_ENGINE_CLS: Dict[int, int] = {
    0: 2,   # car    → Car    (engine index 2)
    1: 0,   # person → Person (engine index 0)
    2: 1,   # bike   → Rider  (engine index 1)
}

# YOLO26n HEF — output layer names and stride for each detection scale
_YOLO_OUTPUT_LAYERS: List[Tuple[str, str, int]] = [
    ('yolo26n/conv61', 'yolo26n/conv64',  8),   # stride  8 — small objects
    ('yolo26n/conv77', 'yolo26n/conv80', 16),   # stride 16 — medium objects
    ('yolo26n/conv91', 'yolo26n/conv94', 32),   # stride 32 — large objects
]

_YOLO_NUM_CLS    = len(_YOLO_TO_ENGINE_CLS)   # 3
_YOLO_INPUT_SIZE = 640
_YOLO_CONF_DEF   = 0.30
_YOLO_NMS_DEF    = 0.45


# ═══════════════════════════════════════════════════════════════════════════════
# Calibration loader
# ═══════════════════════════════════════════════════════════════════════════════

def _load_calibration(path: str) -> dict:
    with open(path, "r") as fh:
        cal = json.load(fh)

    # Normalise key names
    if "camera_height_m" in cal and "camera_height" not in cal:
        cal["camera_height"] = cal["camera_height_m"]
    if "pitch_angle_rad" in cal and "pitch_angle" not in cal:
        cal["pitch_angle"] = cal["pitch_angle_rad"]

    required = ["camera_height", "pitch_angle", "fy", "cy"]
    missing  = [k for k in required if k not in cal]
    if missing:
        raise KeyError(f"calibration.json is missing keys: {missing}")

    return cal


# ═══════════════════════════════════════════════════════════════════════════════
# Ground-plane projector
# ═══════════════════════════════════════════════════════════════════════════════

class _GroundPlane:
    """D = H / tan(θ + arctan((y2 − cy) / fy))"""

    _D_MIN = 0.3
    _D_MAX = 120.0

    def __init__(self, cal: dict) -> None:
        self._H     = float(cal["camera_height"])
        self._theta = float(cal["pitch_angle"])
        self._fy    = float(cal["fy"])
        self._cy    = float(cal["cy"])

    def distance(self, y2: float) -> float:
        pixel_angle = math.atan((y2 - self._cy) / self._fy)
        total_angle = self._theta + pixel_angle
        if total_angle <= 0.0:
            return self._D_MAX
        d = self._H / math.tan(total_angle)
        return float(np.clip(d, self._D_MIN, self._D_MAX))


# ═══════════════════════════════════════════════════════════════════════════════
# Ego-lane proximity scorer
# ═══════════════════════════════════════════════════════════════════════════════

class _EgoLaneProximity:
    """
    Scores objects by proximity to the ego-lane polygon.

    Polygon nodes from calibration.json are normalised [0, 1] fractions.
    Score = 1.0 if foot-point (cx, y2) is inside; gradient 1→0 outside.
    """

    _GRADIENT_NORM = 0.20   # fraction of image width over which score falls 1→0

    def __init__(self, cal: dict) -> None:
        nodes = cal.get("ego_lane_nodes")
        self._nodes_frac: Optional[List[Tuple[float, float]]] = None
        if nodes and len(nodes) >= 3:
            self._nodes_frac = [(float(n["x"]), float(n["y"])) for n in nodes]

    @staticmethod
    def _default_trapezoid(img_w: int, img_h: int) -> List[Tuple[float, float]]:
        cx = img_w / 2.0
        return [
            (cx - 0.075 * img_w, 0.55 * img_h),
            (cx + 0.075 * img_w, 0.55 * img_h),
            (cx + 0.275 * img_w, 0.98 * img_h),
            (cx - 0.275 * img_w, 0.98 * img_h),
        ]

    def _pixel_polygon(self, img_w: int, img_h: int) -> List[Tuple[float, float]]:
        if self._nodes_frac is None:
            return self._default_trapezoid(img_w, img_h)
        unit_pts = {(0.0, 0.0), (0.0, 1.0), (1.0, 0.0), (1.0, 1.0)}
        node_pts = {(n[0], n[1]) for n in self._nodes_frac}
        if node_pts == unit_pts:
            return self._default_trapezoid(img_w, img_h)
        return [(n[0] * img_w, n[1] * img_h) for n in self._nodes_frac]

    @staticmethod
    def _point_in_polygon(px: float, py: float,
                          poly: List[Tuple[float, float]]) -> bool:
        n, inside = len(poly), False
        j = n - 1
        for i in range(n):
            xi, yi = poly[i]; xj, yj = poly[j]
            if ((yi > py) != (yj > py)) and \
               (px < (xj - xi) * (py - yi) / (yj - yi + 1e-9) + xi):
                inside = not inside
            j = i
        return inside

    @staticmethod
    def _dist_point_to_segment(px, py, ax, ay, bx, by) -> float:
        dx, dy = bx - ax, by - ay
        if dx == dy == 0:
            return math.hypot(px - ax, py - ay)
        t = max(0.0, min(1.0, ((px-ax)*dx + (py-ay)*dy) / (dx*dx + dy*dy)))
        return math.hypot(px - (ax + t*dx), py - (ay + t*dy))

    def _min_dist_to_polygon(self, px: float, py: float,
                              poly: List[Tuple[float, float]]) -> float:
        n = len(poly)
        return min(
            self._dist_point_to_segment(
                px, py, poly[i][0], poly[i][1], poly[(i+1)%n][0], poly[(i+1)%n][1])
            for i in range(n)
        )

    def score(self, cx_box: float, y2: float, img_w: int, img_h: int) -> float:
        poly = self._pixel_polygon(img_w, img_h)
        if self._point_in_polygon(cx_box, y2, poly):
            return 1.0
        dist   = self._min_dist_to_polygon(cx_box, y2, poly)
        norm_d = self._GRADIENT_NORM * img_w
        return float(np.clip(1.0 - dist / norm_d, 0.0, 1.0))

    def polygon_pixels(self, img_w: int, img_h: int) -> List[Tuple[int, int]]:
        return [(int(x), int(y)) for x, y in self._pixel_polygon(img_w, img_h)]


# ═══════════════════════════════════════════════════════════════════════════════
# Kalman filter — 1D constant-velocity model for distance smoothing / TTC
# ═══════════════════════════════════════════════════════════════════════════════

class _KalmanFilter:
    """State = [Z, V_rel]^T.  Observes Z only."""

    def __init__(self, z0: float) -> None:
        self._x = np.array([[z0], [0.0]])
        self._P = np.array([[5.0, 0.0], [0.0, 1.0]])
        self._F = np.array([[1.0, 0.1], [0.0, 1.0]])
        self._H = np.array([[1.0, 0.0]])
        self._Q = np.array([[0.5, 0.0], [0.0, 0.2]])
        self._R = np.array([[1.5]])

    def step(self, z_meas: float, dt: float) -> None:
        self._F[0, 1] = dt
        self._x = self._F @ self._x
        self._P = self._F @ self._P @ self._F.T + self._Q
        y       = np.array([[z_meas]]) - self._H @ self._x
        S       = self._H @ self._P @ self._H.T + self._R
        K       = self._P @ self._H.T @ np.linalg.inv(S)
        self._x = self._x + K @ y
        self._P = (np.eye(2) - K @ self._H) @ self._P

    @property
    def distance(self) -> float:
        return float(self._x[0, 0])

    @property
    def closing_speed(self) -> float:
        """Positive = object is getting closer."""
        return -float(self._x[1, 0])


class _TTCManager:
    _TTC_MAX         = 99.9
    _MIN_SPEED       = 0.05     # m/s
    _MAX_LOST_FRAMES = 60

    def __init__(self) -> None:
        self._filters: Dict[int, _KalmanFilter] = {}
        self._lost:    Dict[int, int]            = {}

    def update(self, track_id: int, dist: float, dt: float) -> Optional[float]:
        if track_id not in self._filters:
            self._filters[track_id] = _KalmanFilter(dist)
            self._lost[track_id]    = 0
            return None
        kf = self._filters[track_id]
        kf.step(dist, dt)
        self._lost[track_id] = 0
        v = kf.closing_speed
        z = kf.distance
        if z <= 0 or v < self._MIN_SPEED:
            return None
        return float(min(z / v, self._TTC_MAX))

    def mark_lost(self, track_id: int) -> None:
        if track_id in self._lost:
            self._lost[track_id] += 1

    def purge_stale(self) -> None:
        stale = [tid for tid, cnt in self._lost.items()
                 if cnt > self._MAX_LOST_FRAMES]
        for tid in stale:
            self._filters.pop(tid, None)
            self._lost.pop(tid, None)


# ═══════════════════════════════════════════════════════════════════════════════
# IoU + Tracker
# ═══════════════════════════════════════════════════════════════════════════════

def _iou(a: tuple, b: tuple) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
    if inter == 0:
        return 0.0
    return inter / ((ax2-ax1)*(ay2-ay1) + (bx2-bx1)*(by2-by1) - inter)


class _Track:
    _counter = 0

    def __init__(self, det: Dict) -> None:
        _Track._counter += 1
        self.track_id = _Track._counter
        self.box      = det["box"]
        self.cls_id   = det["cls_id"]
        self.conf     = det["conf"]
        self.lost     = 0

    def update(self, det: Dict) -> None:
        self.box    = det["box"]
        self.cls_id = det["cls_id"]
        self.conf   = det["conf"]
        self.lost   = 0


class _Tracker:
    def __init__(self, iou_hi: float = 0.45, iou_lo: float = 0.20,
                 conf_cut: float = 0.50, max_lost: int = 30) -> None:
        self._iou_hi   = iou_hi
        self._iou_lo   = iou_lo
        self._conf_cut = conf_cut
        self._max_lost = max_lost
        self._tracks: List[_Track] = []

    def _match(self, tracks: List[_Track], dets: List[Dict],
               thresh: float) -> Tuple[List[Tuple[int,int]], List[int], List[int]]:
        if not tracks or not dets:
            return [], list(range(len(tracks))), list(range(len(dets)))
        mat = np.array([[_iou(t.box, d["box"]) for d in dets] for t in tracks])
        ut, ud = set(range(len(tracks))), set(range(len(dets)))
        matched: List[Tuple[int, int]] = []
        for idx in np.argsort(-mat.ravel()):
            ti, di = divmod(int(idx), len(dets))
            if mat[ti, di] < thresh:
                break
            if ti in ut and di in ud:
                matched.append((ti, di))
                ut.discard(ti); ud.discard(di)
        return matched, list(ut), list(ud)

    def update(self, detections: List[Dict]) -> List[Dict]:
        hi  = [d for d in detections if d["conf"] >= self._conf_cut]
        lo  = [d for d in detections if d["conf"] <  self._conf_cut]
        act = [t for t in self._tracks if t.lost == 0]
        lst = [t for t in self._tracks if t.lost  > 0]

        m1, ua, uh = self._match(act, hi, self._iou_hi)
        for ti, di in m1: act[ti].update(hi[di])
        m2, _,  _  = self._match(lst, lo, self._iou_lo)
        for ti, di in m2: lst[ti].update(lo[di])
        for ti in ua:     act[ti].lost += 1
        for di in uh:     self._tracks.append(_Track(hi[di]))
        self._tracks = [t for t in self._tracks if t.lost <= self._max_lost]

        return [
            {"track_id": t.track_id, "box": t.box,
             "cls_id": t.cls_id, "conf": t.conf}
            for t in self._tracks if t.lost == 0
        ]


# ═══════════════════════════════════════════════════════════════════════════════
# Hailo YOLO26n detector — standalone mode only
# ═══════════════════════════════════════════════════════════════════════════════

class _HailoDetector:
    """
    Wraps Hailo YOLO26n inference for standalone / testing use.

    Opens its own VDevice — do NOT instantiate in a process that already
    has hailo_inference_worker running on the same chip.
    """

    def __init__(
        self,
        hef_path:   str,
        conf_thresh: float = _YOLO_CONF_DEF,
        iou_thresh:  float = _YOLO_NMS_DEF,
    ) -> None:
        self._conf = conf_thresh
        self._iou  = iou_thresh

        hef           = HEF(hef_path)
        self._target  = VDevice()                           # kept alive permanently
        self._ng      = self._target.configure(
            hef,
            ConfigureParams.create_from_hef(hef, interface=HailoStreamInterface.PCIe),
        )[0]
        self._in_p    = InputVStreamParams.make_from_network_group(
            self._ng, format_type=FormatType.UINT8,   quantized=True)
        self._out_p   = OutputVStreamParams.make_from_network_group(
            self._ng, format_type=FormatType.FLOAT32, quantized=False)
        self._inp_name = hef.get_input_vstream_infos()[0].name

    # ── Preprocessing ─────────────────────────────────────────────────────────

    def _preprocess(self, frame: np.ndarray) -> np.ndarray:
        """BGR → RGB → resize 640×640 → uint8 NHWC [1,640,640,3]."""
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        return np.expand_dims(
            cv2.resize(rgb, (_YOLO_INPUT_SIZE, _YOLO_INPUT_SIZE)), 0
        )

    # ── YOLO26n output decoding ───────────────────────────────────────────────

    @staticmethod
    def _sigmoid(x: np.ndarray) -> np.ndarray:
        x = np.clip(x, -88, 88)
        return 1.0 / (1.0 + np.exp(-x))

    def _decode_scale(
        self,
        reg: np.ndarray,
        cls_logits: np.ndarray,
        stride: int,
    ) -> Tuple[list, list, list]:
        """Decode one detection scale from raw HEF outputs."""
        H, W     = reg.shape[:2]
        gx, gy   = np.meshgrid(np.arange(W), np.arange(H))
        grid     = np.stack((gx, gy), axis=-1).reshape(-1, 2) + 0.5
        reg_flat = reg.reshape(-1, 4)
        cls_flat = self._sigmoid(cls_logits.reshape(-1, _YOLO_NUM_CLS))
        scores   = cls_flat.max(axis=-1)
        mask     = scores > self._conf
        if not mask.any():
            return [], [], []
        g, r, s, ci = grid[mask], reg_flat[mask], scores[mask], cls_flat[mask].argmax(axis=-1)
        xmin = (g[:, 0] - r[:, 0]) * stride
        ymin = (g[:, 1] - r[:, 1]) * stride
        w    = (g[:, 0] + r[:, 2]) * stride - xmin
        h    = (g[:, 1] + r[:, 3]) * stride - ymin
        return np.stack((xmin, ymin, w, h), axis=-1).tolist(), s.tolist(), ci.tolist()

    # ── Public detect API ─────────────────────────────────────────────────────

    def detect(self, frame: np.ndarray) -> List[Dict]:
        """
        Run YOLO26n inference on one BGR frame.

        Returns:
            List of dicts with "box", "conf", "cls_id" (HScoreEngine index).
        """
        orig_h, orig_w = frame.shape[:2]
        tensor         = self._preprocess(frame)

        with self._ng.activate(self._ng.create_params()):
            with InferVStreams(self._ng, self._in_p, self._out_p) as pipe:
                raw = pipe.infer({self._inp_name: tensor})

        all_b, all_s, all_i = [], [], []
        for reg_key, cls_key, stride in _YOLO_OUTPUT_LAYERS:
            b, s, i = self._decode_scale(raw[reg_key][0], raw[cls_key][0], stride)
            all_b += b;  all_s += s;  all_i += i

        if not all_b:
            return []
        idxs = cv2.dnn.NMSBoxes(all_b, all_s, self._conf, self._iou)
        if len(idxs) == 0:
            return []

        sx, sy = orig_w / _YOLO_INPUT_SIZE, orig_h / _YOLO_INPUT_SIZE
        dets   = []
        for idx in idxs.flatten():
            bx, by, bw, bh = all_b[idx]
            x1, y1 = int(bx * sx),         int(by * sy)
            x2, y2 = int((bx + bw) * sx),  int((by + bh) * sy)
            yolo_cls = int(all_i[idx])
            dets.append({
                "box":    (x1, y1, x2, y2),
                "conf":   float(all_s[idx]),
                "cls_id": _YOLO_TO_ENGINE_CLS.get(yolo_cls, yolo_cls),
            })
        return dets


# ═══════════════════════════════════════════════════════════════════════════════
# Public API
# ═══════════════════════════════════════════════════════════════════════════════

class HScoreEngine:
    """
    Single public class — instantiate once, call process_frame_with_detections()
    or process_frame() per frame.

    H-Score formula
    ───────────────
    numerator   = w_class · class_risk(cls)
                + w_proximity · proximity
                + w_urgency   · (TTC_MIN / TTC)   ← clamped [0,1]
    denominator = w_class + w_proximity + w_urgency
    H-Score     = clamp(numerator / denominator, 0, 1)
    """

    TTC_MIN = 0.5   # seconds — 1/TTC capped at 1/TTC_MIN = 2.0 then rescaled

    def __init__(
        self,
        calib_path:  str,
        model_path:  Optional[str] = None,   # required only for standalone mode
        *,
        w_class:     float = 1.0,
        w_proximity: float = 1.0,
        w_urgency:   float = 1.0,
        conf_thresh: float = 0.40,
        iou_thresh:  float = 0.45,
        k_urgency:   float = 3.0,
    ) -> None:
        cal = _load_calibration(calib_path)

        self._projector  = _GroundPlane(cal)
        self._proximity  = _EgoLaneProximity(cal)
        self._ttc_mgr    = _TTCManager()
        self._tracker    = _Tracker()

        self.w_class     = w_class
        self.w_proximity = w_proximity
        self.w_urgency   = w_urgency
        self._k          = k_urgency

        # Standalone mode: create _HailoDetector if model_path supplied
        self._detector: Optional[_HailoDetector] = None
        if model_path is not None:
            self._detector = _HailoDetector(model_path, conf_thresh, iou_thresh)

    # ── H-Score computation ───────────────────────────────────────────────────

    def _compute_hscore(
        self,
        cls_name:  str,
        proximity: float,
        ttc:       Optional[float],
    ) -> Tuple[float, Dict]:
        class_risk = _CLASS_RISK.get(cls_name, _DEFAULT_CLASS_RISK)

        if ttc is None or ttc <= 0:
            inv_ttc = 0.0
        else:
            inv_ttc = float(np.clip(self.TTC_MIN / ttc, 0.0, 1.0))

        denom = self.w_class + self.w_proximity + self.w_urgency or 1.0
        numerator = (
            self.w_class     * class_risk +
            self.w_proximity * proximity  +
            self.w_urgency   * inv_ttc
        )
        h = float(np.clip(numerator / denom, 0.0, 1.0))

        components = {
            "class_risk":  class_risk,
            "proximity":   proximity,
            "urgency":     inv_ttc,
            "w_class":     self.w_class,
            "w_proximity": self.w_proximity,
            "w_urgency":   self.w_urgency,
        }
        return h, components

    # ── Shared tracking + scoring pipeline ───────────────────────────────────

    def _process_tracks(
        self,
        frame:      np.ndarray,
        detections: List[Dict],    # [{box, conf, cls_id}, ...]
        dt:         float,
    ) -> List[Dict]:
        """
        Run tracker → TTC → proximity → H-Score on pre-built detection dicts.
        Used by both process_frame() and process_frame_with_detections().
        """
        img_h, img_w = frame.shape[:2]
        tracks       = self._tracker.update(detections)
        results:     List[Dict] = []
        active_ids:  List[int] = []

        for trk in tracks:
            x1, y1, x2, y2 = trk["box"]
            cls_id   = trk["cls_id"]
            track_id = trk["track_id"]
            cls_name = CLASS_NAMES[cls_id] if cls_id < len(CLASS_NAMES) else "Unknown"
            active_ids.append(track_id)

            distance  = self._projector.distance(float(y2))
            ttc       = self._ttc_mgr.update(track_id, distance, dt)
            cx_box    = (x1 + x2) / 2.0
            proximity = self._proximity.score(cx_box, float(y2), img_w, img_h)
            hscore, components = self._compute_hscore(cls_name, proximity, ttc)

            results.append({
                "track_id":   track_id,
                "cls_id":     cls_id,
                "cls_name":   cls_name,
                "box":        (x1, y1, x2, y2),
                "conf":       trk["conf"],
                "distance":   distance,
                "ttc":        ttc,
                "proximity":  proximity,
                "hscore":     hscore,
                "components": components,
            })

        for track in self._tracker._tracks:
            if track.track_id not in active_ids:
                self._ttc_mgr.mark_lost(track.track_id)
        self._ttc_mgr.purge_stale()

        return results

    # ── Mode A: external detections from hailo_inference_worker ──────────────

    def process_frame_with_detections(
        self,
        frame:      np.ndarray,
        hailo_dets: list,
        dt:         float = 0.033,
    ) -> List[Dict]:
        """
        hailo_inference_worker mode — takes pre-computed YOLO26n detections
        and runs tracking + TTC Kalman + proximity + H-Score.

        No chip access.  This is the recommended call in the main architecture.

        Args:
            frame:      BGR numpy array (H,W,3) — used only for image dimensions.
            hailo_dets: list of (x1, y1, x2, y2, score, yolo_class_id) tuples
                        where yolo_class_id: 0=car  1=person  2=bike
            dt:         elapsed time since last frame in seconds.

        Returns:
            List of result dicts (see module docstring).
        """
        # Convert (x1,y1,x2,y2,score,yolo_cls) → tracker-compatible dicts
        # and remap YOLO class IDs to HScoreEngine class IDs
        dets = [
            {
                "box":    (int(x1), int(y1), int(x2), int(y2)),
                "conf":   float(score),
                "cls_id": _YOLO_TO_ENGINE_CLS.get(int(yolo_cls), int(yolo_cls)),
            }
            for (x1, y1, x2, y2, score, yolo_cls) in hailo_dets
        ]
        return self._process_tracks(frame, dets, dt)

    # ── Mode B: standalone Hailo inference ────────────────────────────────────

    def process_frame(self, frame: np.ndarray, dt: float = 0.1) -> List[Dict]:
        """
        Standalone mode — runs full pipeline including Hailo YOLO26n inference.

        Requires model_path to have been passed to __init__().

        ⚠ Do NOT call in a process sharing the chip with hailo_inference_worker.
          Use process_frame_with_detections() instead.

        Args:
            frame: BGR numpy array (H,W,3), dtype uint8.
            dt:    elapsed time since last frame in seconds.

        Returns:
            List of result dicts.

        Raises:
            RuntimeError: model_path was not provided to __init__().
        """
        if self._detector is None:
            raise RuntimeError(
                "process_frame() requires model_path in HScoreEngine.__init__(). "
                "Use process_frame_with_detections() when using hailo_inference_worker."
            )
        detections = self._detector.detect(frame)
        return self._process_tracks(frame, detections, dt)

    # ── Utility ───────────────────────────────────────────────────────────────

    def ego_lane_polygon(self, img_w: int, img_h: int) -> List[Tuple[int, int]]:
        """
        Ego-lane polygon as (x, y) pixel tuples for the current frame size.
        Pass to draw_road_overlay() for visualisation.
        """
        return self._proximity.polygon_pixels(img_w, img_h)