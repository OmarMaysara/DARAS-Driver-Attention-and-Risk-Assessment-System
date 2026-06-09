"""
hscore_engine.py  —  H-Score engine, Hailo YOLO26n edition.

H-Score formula
───────────────
H = class_risk × (w_proximity × proximity + w_urgency × urgency)

  class_risk : Car = 0.8 · Rider = 0.9 · Person = 1.0
  w_proximity = 0.4  (default)
  w_urgency   = 0.6  (default)

Proximity (distance-aware)
──────────────────────────
  Inside ego-lane polygon  → 1.0 at ≤0 m, decays to 0.20 at 40 m
  Outside ego-lane polygon → gradient 1→0 over 20% of frame width from edge

Urgency (TTC-primary)
─────────────────────
  Kalman confirmed approach  →  clip(1 − TTC / 6s, 0, 1)
  First frame (no velocity)  →  clip(1 − d / 5m, 0, 1) × 0.30  (max 0.30)
  Confirmed static           →  0.0

Result dict per track:
  track_id, cls_id, cls_name, box, conf, distance (m), ttc (s|None),
  proximity [0-1], hscore [0-1],
  components: {class_risk, proximity, urgency, ttc_urgency,
               fallback_urgency, w_proximity, w_urgency}

Usage:
  engine = HScoreEngine(calib_path="calibration.json")
  results = engine.process_frame_with_detections(frame, hailo_dets, dt=0.033)

  ⚠ Standalone (testing only):
  engine = HScoreEngine(model_path="yolo26n.hef", calib_path="calibration.json")
  results = engine.process_frame(frame, dt=0.033)
  Do NOT run standalone while hailo_inference_worker owns the chip.
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

CLASS_NAMES: List[str] = ["Person", "Rider", "Car"]

# Crash-severity multiplier — gates the entire H-Score
_CLASS_RISK: Dict[str, float] = {
    "Person": 1.0,
    "Rider":  0.9,
    "Car":    0.8,
}
_DEFAULT_CLASS_RISK = 0.7   # unknown class fallback

# YOLO26n class order: car=0  person=1  bike=2
# Engine internal order: Person=0  Rider=1  Car=2
_YOLO_TO_ENGINE_CLS: Dict[int, int] = {0: 2, 1: 0, 2: 1}

_YOLO_OUTPUT_LAYERS: List[Tuple[str, str, int]] = [
    ('yolo26n/conv61', 'yolo26n/conv64',  8),
    ('yolo26n/conv77', 'yolo26n/conv80', 16),
    ('yolo26n/conv91', 'yolo26n/conv94', 32),
]

_YOLO_NUM_CLS    = 3
_YOLO_INPUT_SIZE = 640
_YOLO_CONF_DEF   = 0.30
_YOLO_NMS_DEF    = 0.45

# Urgency thresholds
_URGENCY_TTC_MAX_S        = 6.0    # TTC ≥ this → urgency 0
_URGENCY_FALLBACK_DIST_M  = 8.0    # beyond this → zero first-frame fallback
_URGENCY_FALLBACK_WEIGHT  = 0.5   # caps first-frame fallback at 0.30

# Proximity — in-lane distance decay
# Objects inside the ego-lane polygon score 1.0 at close range and decay
# to _PROX_IN_LANE_FLOOR at _PROX_DIST_MAX_M, so a far-away car touching
# the lane edge no longer outscores a nearby car that is half-in.
_PROX_DIST_MAX_M    = 40.0   # distance at which in-lane score reaches the floor
_PROX_IN_LANE_FLOOR = 0.20   # minimum score for any confirmed in-lane object


# ═══════════════════════════════════════════════════════════════════════════════
# Calibration loader
# ═══════════════════════════════════════════════════════════════════════════════

def _load_calibration(path: str) -> dict:
    with open(path, "r") as fh:
        cal = json.load(fh)
    if "camera_height_m" in cal and "camera_height" not in cal:
        cal["camera_height"] = cal["camera_height_m"]
    if "pitch_angle_rad" in cal and "pitch_angle" not in cal:
        cal["pitch_angle"] = cal["pitch_angle_rad"]
    missing = [k for k in ("camera_height", "pitch_angle", "fy", "cy") if k not in cal]
    if missing:
        raise KeyError(f"calibration.json missing keys: {missing}")
    return cal


# ═══════════════════════════════════════════════════════════════════════════════
# Ground-plane projector
# ═══════════════════════════════════════════════════════════════════════════════

class _GroundPlane:
    """D = H / tan(pitch + arctan((y2 − cy) / fy))"""

    _D_MIN = 1.5
    _D_MAX = 120.0

    def __init__(self, cal: dict) -> None:
        self._H     = float(cal["camera_height"])
        self._theta = float(cal["pitch_angle"])
        self._fy    = float(cal["fy"])
        self._cy    = float(cal["cy"])

    def distance(self, y2: float) -> float:
        total_angle = self._theta + math.atan((y2 - self._cy) / self._fy)
        if total_angle <= 0.0:
            return self._D_MAX
        return float(np.clip(self._H / math.tan(total_angle), self._D_MIN, self._D_MAX))


# ═══════════════════════════════════════════════════════════════════════════════
# Ego-lane proximity scorer
# ═══════════════════════════════════════════════════════════════════════════════

class _EgoLaneProximity:
    """
    Score = 1.0 if foot-point (cx, y2) is inside the ego-lane polygon.
    Outside: gradient 1 → 0 over _GRADIENT_NORM × image_width from the edge.

    Node coordinate auto-detection:
      max ≤ 1.0          → normalised fractions → × frame size
      max ≤ img_w/img_h  → absolute px, same resolution
      otherwise          → absolute px, different resolution — scaled
    """

    _GRADIENT_NORM = 0.20

    def __init__(self, cal: dict) -> None:
        nodes = cal.get("ego_lane_nodes")
        self._nodes_raw: Optional[List[Tuple[float, float]]] = None
        if nodes and len(nodes) >= 3:
            self._nodes_raw = [(float(n["x"]), float(n["y"])) for n in nodes]

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
        if self._nodes_raw is None:
            return self._default_trapezoid(img_w, img_h)
        unit_pts = {(0.0, 0.0), (0.0, 1.0), (1.0, 0.0), (1.0, 1.0)}
        if {(n[0], n[1]) for n in self._nodes_raw} == unit_pts:
            return self._default_trapezoid(img_w, img_h)
        max_x = max(p[0] for p in self._nodes_raw)
        max_y = max(p[1] for p in self._nodes_raw)
        if max_x <= 1.0 and max_y <= 1.0:
            return [(n[0] * img_w, n[1] * img_h) for n in self._nodes_raw]
        elif max_x <= img_w and max_y <= img_h:
            return [(n[0], n[1]) for n in self._nodes_raw]
        else:
            return [(n[0] / max_x * img_w, n[1] / max_y * img_h) for n in self._nodes_raw]

    @staticmethod
    def _point_in_polygon(px: float, py: float, poly: List[Tuple[float, float]]) -> bool:
        n, inside, j = len(poly), False, len(poly) - 1
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

    def _min_dist_to_polygon(self, px: float, py: float, poly: List[Tuple[float, float]]) -> float:
        n = len(poly)
        return min(
            self._dist_point_to_segment(px, py,
                poly[i][0], poly[i][1], poly[(i+1)%n][0], poly[(i+1)%n][1])
            for i in range(n)
        )

    def score(self, cx_box: float, y2: float, img_w: int, img_h: int,
              distance: float = 0.0) -> float:
        """
        Inside polygon  → 1.0 at d=0, decays to _PROX_IN_LANE_FLOOR at _PROX_DIST_MAX_M.
        Outside polygon → gradient 1→0 over _GRADIENT_NORM × image_width from the edge.
        """
        poly = self._pixel_polygon(img_w, img_h)
        if self._point_in_polygon(cx_box, y2, poly):
            # Decay score with depth so close in-lane objects always beat far ones
            t = float(np.clip(distance / _PROX_DIST_MAX_M, 0.0, 1.0))
            return _PROX_IN_LANE_FLOOR + (1.0 - _PROX_IN_LANE_FLOOR) * (1.0 - t)
        dist = self._min_dist_to_polygon(cx_box, y2, poly)
        return float(np.clip(1.0 - dist / (self._GRADIENT_NORM * img_w), 0.0, 1.0))

    def polygon_pixels(self, img_w: int, img_h: int) -> List[Tuple[int, int]]:
        return [(int(x), int(y)) for x, y in self._pixel_polygon(img_w, img_h)]


# ═══════════════════════════════════════════════════════════════════════════════
# Kalman filter — 1D constant-velocity for distance + TTC
# ═══════════════════════════════════════════════════════════════════════════════

class _KalmanFilter:
    """State = [distance, relative_velocity]."""

    def __init__(self, z0: float) -> None:
        self._x = np.array([[z0], [0.0]])
        self._P = np.array([[5.0, 0.0], [0.0, 4.0]])
        self._F = np.array([[1.0, 0.1], [0.0, 1.0]])
        self._H = np.array([[1.0, 0.0]])
        self._Q = np.array([[0.5, 0.0], [0.0, 0.5]])
        self._R = np.array([[1.5]])

    def step(self, z_meas: float, dt: float) -> None:
        self._F[0, 1] = dt
        self._x = self._F @ self._x
        self._P = self._F @ self._P @ self._F.T + self._Q
        y = np.array([[z_meas]]) - self._H @ self._x
        S = self._H @ self._P @ self._H.T + self._R
        K = self._P @ self._H.T @ np.linalg.inv(S)
        self._x = self._x + K @ y
        self._P = (np.eye(2) - K @ self._H) @ self._P

    @property
    def distance(self) -> float:
        return float(self._x[0, 0])

    @property
    def closing_speed(self) -> float:
        return -float(self._x[1, 0])   # positive = object approaching


class _TTCManager:
    _TTC_MAX         = 99.9
    _MIN_SPEED       = 0.01   # lowered: 0.05 was suppressing slow-approach TTC
    _MAX_LOST_FRAMES = 60

    def __init__(self) -> None:
        self._filters: Dict[int, _KalmanFilter] = {}
        self._lost:    Dict[int, int]            = {}
        self._stepped: set                       = set()
        self._closing: Dict[int, bool]           = {}  # True = Kalman confirmed approach

    def update(self, track_id: int, dist: float, dt: float) -> Optional[float]:
        if track_id not in self._filters:
            self._filters[track_id] = _KalmanFilter(dist)
            self._lost[track_id]    = 0
            self._closing[track_id] = False
            return None
        kf = self._filters[track_id]
        kf.step(dist, dt)
        self._stepped.add(track_id)
        self._lost[track_id] = 0
        v, z = kf.closing_speed, kf.distance
        if z <= 0 or v < self._MIN_SPEED:
            # Object confirmed static or receding — mark as not closing
            self._closing[track_id] = False
            return None
        self._closing[track_id] = True
        return float(min(z / v, self._TTC_MAX))

    def is_closing(self, track_id: int) -> bool:
        """True once Kalman has confirmed the object is approaching."""
        return self._closing.get(track_id, False)

    def mark_lost(self, track_id: int) -> None:
        if track_id in self._lost:
            self._lost[track_id] += 1

    def has_velocity(self, track_id: int) -> bool:
        return track_id in self._stepped

    def purge_stale(self) -> None:
        stale = [tid for tid, cnt in self._lost.items() if cnt > self._MAX_LOST_FRAMES]
        for tid in stale:
            self._filters.pop(tid, None)
            self._lost.pop(tid, None)
            self._stepped.discard(tid)
            self._closing.pop(tid, None)


# ═══════════════════════════════════════════════════════════════════════════════
# IoU tracker
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
        self.box = det["box"]; self.cls_id = det["cls_id"]
        self.conf = det["conf"]; self.lost = 0


class _Tracker:
    def __init__(self, iou_hi=0.45, iou_lo=0.20, conf_cut=0.50, max_lost=30) -> None:
        self._iou_hi = iou_hi; self._iou_lo = iou_lo
        self._conf_cut = conf_cut; self._max_lost = max_lost
        self._tracks: List[_Track] = []

    def _match(self, tracks, dets, thresh):
        if not tracks or not dets:
            return [], list(range(len(tracks))), list(range(len(dets)))
        mat = np.array([[_iou(t.box, d["box"]) for d in dets] for t in tracks])
        ut, ud = set(range(len(tracks))), set(range(len(dets)))
        matched = []
        for idx in np.argsort(-mat.ravel()):
            ti, di = divmod(int(idx), len(dets))
            if mat[ti, di] < thresh: break
            if ti in ut and di in ud:
                matched.append((ti, di)); ut.discard(ti); ud.discard(di)
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
        for ti in ua: act[ti].lost += 1
        for di in uh: self._tracks.append(_Track(hi[di]))
        self._tracks = [t for t in self._tracks if t.lost <= self._max_lost]
        return [{"track_id": t.track_id, "box": t.box,
                 "cls_id": t.cls_id, "conf": t.conf}
                for t in self._tracks if t.lost == 0]


# ═══════════════════════════════════════════════════════════════════════════════
# Hailo YOLO26n detector — standalone / testing mode only
# ═══════════════════════════════════════════════════════════════════════════════

class _HailoDetector:
    """Opens its own VDevice — do not use while hailo_inference_worker is running."""

    def __init__(self, hef_path: str, conf_thresh=_YOLO_CONF_DEF, iou_thresh=_YOLO_NMS_DEF):
        self._conf = conf_thresh; self._iou = iou_thresh
        hef = HEF(hef_path)
        self._target = VDevice()
        self._ng = self._target.configure(
            hef, ConfigureParams.create_from_hef(hef, interface=HailoStreamInterface.PCIe))[0]
        self._in_p  = InputVStreamParams.make_from_network_group(
            self._ng, format_type=FormatType.UINT8,   quantized=True)
        self._out_p = OutputVStreamParams.make_from_network_group(
            self._ng, format_type=FormatType.FLOAT32, quantized=False)
        self._inp_name = hef.get_input_vstream_infos()[0].name

    def _preprocess(self, frame: np.ndarray) -> np.ndarray:
        return np.expand_dims(
            cv2.resize(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB),
                       (_YOLO_INPUT_SIZE, _YOLO_INPUT_SIZE)), 0)

    @staticmethod
    def _sigmoid(x): return 1.0 / (1.0 + np.exp(-np.clip(x, -88, 88)))

    def _decode_scale(self, reg, cls_logits, stride):
        H, W   = reg.shape[:2]
        gx, gy = np.meshgrid(np.arange(W), np.arange(H))
        grid   = np.stack((gx, gy), axis=-1).reshape(-1, 2) + 0.5
        rf     = reg.reshape(-1, 4)
        cf     = self._sigmoid(cls_logits.reshape(-1, _YOLO_NUM_CLS))
        sc     = cf.max(axis=-1)
        mask   = sc > self._conf
        if not mask.any(): return [], [], []
        g, r, s, ci = grid[mask], rf[mask], sc[mask], cf[mask].argmax(axis=-1)
        xmin = (g[:,0] - r[:,0]) * stride
        ymin = (g[:,1] - r[:,1]) * stride
        w    = (g[:,0] + r[:,2]) * stride - xmin
        h    = (g[:,1] + r[:,3]) * stride - ymin
        return np.stack((xmin, ymin, w, h), axis=-1).tolist(), s.tolist(), ci.tolist()

    def detect(self, frame: np.ndarray) -> List[Dict]:
        orig_h, orig_w = frame.shape[:2]
        with self._ng.activate(self._ng.create_params()):
            with InferVStreams(self._ng, self._in_p, self._out_p) as pipe:
                raw = pipe.infer({self._inp_name: self._preprocess(frame)})
        all_b, all_s, all_i = [], [], []
        for reg_key, cls_key, stride in _YOLO_OUTPUT_LAYERS:
            b, s, i = self._decode_scale(raw[reg_key][0], raw[cls_key][0], stride)
            all_b += b; all_s += s; all_i += i
        if not all_b: return []
        idxs = cv2.dnn.NMSBoxes(all_b, all_s, self._conf, self._iou)
        if len(idxs) == 0: return []
        sx, sy = orig_w / _YOLO_INPUT_SIZE, orig_h / _YOLO_INPUT_SIZE
        return [{"box":  (int(all_b[i][0]*sx), int(all_b[i][1]*sy),
                          int((all_b[i][0]+all_b[i][2])*sx), int((all_b[i][1]+all_b[i][3])*sy)),
                 "conf":  float(all_s[i]),
                 "cls_id": _YOLO_TO_ENGINE_CLS.get(int(all_i[i]), int(all_i[i]))}
                for i in idxs.flatten()]


# ═══════════════════════════════════════════════════════════════════════════════
# Public API
# ═══════════════════════════════════════════════════════════════════════════════

class HScoreEngine:
    """
    H = class_risk × (w_proximity × proximity + w_urgency × urgency)

    class_risk: Car=0.8  Rider=0.9  Person=1.0
    Default weights: w_proximity=0.4  w_urgency=0.6
    Max H per class: Car→0.80  Rider→0.90  Person→1.00
    """

    TTC_MIN = 0.5   # kept for API compatibility

    def __init__(
        self,
        calib_path:  str,
        model_path:  Optional[str] = None,
        *,
        w_proximity: float = 0.4,
        w_urgency:   float = 0.6,
        conf_thresh: float = 0.40,
        iou_thresh:  float = 0.45,
    ) -> None:
        cal = _load_calibration(calib_path)
        self._projector  = _GroundPlane(cal)
        self._proximity  = _EgoLaneProximity(cal)
        self._ttc_mgr    = _TTCManager()
        self._tracker    = _Tracker()
        self.w_proximity = w_proximity
        self.w_urgency   = w_urgency
        self._detector: Optional[_HailoDetector] = None
        if model_path is not None:
            self._detector = _HailoDetector(model_path, conf_thresh, iou_thresh)

    def _compute_hscore(
        self,
        cls_name:    str,
        proximity:   float,
        ttc:         Optional[float],
        distance:    float = 0.0,
        has_velocity: bool = False,
        is_closing:   bool = False,
    ) -> Tuple[float, Dict]:
        """
        H = class_risk × (w_proximity × proximity + w_urgency × urgency)

        Urgency branches:
          TTC available (approaching, TTC computable)
                                 → clip(1 − TTC / 6s, 0, 1)
          Approaching but TTC=None (speed below threshold / distance edge case)
                                 → fallback: clip(1 − d / 5m, 0, 1) × 0.30
          First Kalman frame     → fallback: clip(1 − d / 5m, 0, 1) × 0.30
          Confirmed static       → 0.0
        """
        class_risk = _CLASS_RISK.get(cls_name, _DEFAULT_CLASS_RISK)

        if ttc is not None and ttc > 0:
            # Best case: Kalman confirmed approach with valid TTC
            ttc_urgency      = float(np.clip(1.0 - ttc / _URGENCY_TTC_MAX_S, 0.0, 1.0))
            fallback_urgency = 0.0
            urgency          = ttc_urgency
        elif not has_velocity or is_closing:
            # No velocity estimate yet (first/second frame) OR approaching but
            # TTC couldn't be computed (e.g. speed just crossed _MIN_SPEED).
            # Use distance-based fallback, capped at 0.30.
            ttc_urgency      = 0.0
            fallback_urgency = float(np.clip(
                1.0 - distance / _URGENCY_FALLBACK_DIST_M, 0.0, 1.0
            )) * _URGENCY_FALLBACK_WEIGHT
            urgency          = fallback_urgency
        else:
            # has_velocity=True and is_closing=False → confirmed static/receding
            ttc_urgency = fallback_urgency = urgency = 0.0

        h = float(np.clip(
            class_risk * (self.w_proximity * proximity + self.w_urgency * urgency),
            0.0, 1.0
        ))
        return h, {
            "class_risk":       class_risk,
            "proximity":        proximity,
            "urgency":          urgency,
            "ttc_urgency":      ttc_urgency,
            "fallback_urgency": fallback_urgency,
            "w_proximity":      self.w_proximity,
            "w_urgency":        self.w_urgency,
        }

    def _process_tracks(self, frame: np.ndarray, detections: List[Dict], dt: float) -> List[Dict]:
        img_h, img_w = frame.shape[:2]
        tracks       = self._tracker.update(detections)
        results:     List[Dict] = []
        active_ids:  List[int]  = []

        for trk in tracks:
            x1, y1, x2, y2 = trk["box"]
            cls_id   = trk["cls_id"]
            track_id = trk["track_id"]
            cls_name = CLASS_NAMES[cls_id] if cls_id < len(CLASS_NAMES) else "Unknown"
            active_ids.append(track_id)

            distance     = self._projector.distance(float(y2))
            ttc          = self._ttc_mgr.update(track_id, distance, dt)
            has_velocity = self._ttc_mgr.has_velocity(track_id)
            is_closing   = self._ttc_mgr.is_closing(track_id)
            proximity    = self._proximity.score((x1+x2)/2.0, float(y2), img_w, img_h, distance)
            hscore, components = self._compute_hscore(
                cls_name, proximity, ttc, distance, has_velocity, is_closing)

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

    def process_frame_with_detections(self, frame: np.ndarray, hailo_dets: list,
                                       dt: float = 0.033) -> List[Dict]:
        """Main-architecture path — no chip access. hailo_dets from inference worker."""
        dets = [{"box":    (int(x1), int(y1), int(x2), int(y2)),
                 "conf":   float(score),
                 "cls_id": _YOLO_TO_ENGINE_CLS.get(int(yolo_cls), int(yolo_cls))}
                for (x1, y1, x2, y2, score, yolo_cls) in hailo_dets]
        return self._process_tracks(frame, dets, dt)

    def process_frame(self, frame: np.ndarray, dt: float = 0.1) -> List[Dict]:
        """Standalone path — requires model_path in __init__. Not for use with hailo_inference_worker."""
        if self._detector is None:
            raise RuntimeError("process_frame() requires model_path. "
                               "Use process_frame_with_detections() with hailo_inference_worker.")
        return self._process_tracks(frame, self._detector.detect(frame), dt)

    def ego_lane_polygon(self, img_w: int, img_h: int) -> List[Tuple[int, int]]:
        return self._proximity.polygon_pixels(img_w, img_h)