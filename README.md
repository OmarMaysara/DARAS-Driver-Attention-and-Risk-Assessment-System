# DARAS: Driver Attention \& Risk Assessment System

!\[Version](https://img.shields.io/badge/version-1.0-blue.svg)
!\[Build](https://img.shields.io/badge/build-passing-brightgreen.svg)
!\[License](https://img.shields.io/badge/license-MIT-green.svg)

## 📖 Abstract

**DARAS** is an edge-native Advanced Driver Assistance System (ADAS) that monitors the driver and road environment simultaneously to produce a unified, real-time risk score. It supports both individual drivers and fleet operators by providing proactive in-cabin alerts and longitudinal historical safety profiling.

By executing multi-model deep learning inference entirely at the edge, DARAS eliminates the latency and continuous connectivity requirements of cloud computing, while strictly preserving driver privacy (in-cabin video is processed locally and never transmitted; only telemetry leaves the device).

## 🚀 Key Features

* **Dual-Stream Processing:** Merges Driver Attention (Inattention Detection Model) and Road Hazard (Environmental Risk Model) streams into a single unified risk score (`R = 0.6D + 0.4H`).
* **Edge-Native Autonomy:** Powered by a Raspberry Pi 5 coupled with a Hailo-8L Neural Processing Unit via M.2 PCIe bridge, ensuring up to 20 FPS per stream processing under an 80°C thermal ceiling.
* **Advanced Telemetry Pipeline:** Continuous telemetry ingestion and aggregation with intermittent network fault tolerance.
* **Dual Dashboard Portals:**

  * **Driver Portal:** Personal safety score, distraction class breakdowns, and device calibration management.
  * **Employer Portal:** Fleet overviews, driver rankings, live alert feeds, and risk trend analysis.
* **Five-Tier Risk Matrix:** Graduated response scale avoiding binary safe/unsafe categorization (Excellent, Verified, Fair, At Risk, Critical).

## 🏗️ System Architecture

DARAS is composed of five interconnected subsystems:

1. **Hardware Edge Unit:**

   * **Host Comput:** Raspberry Pi 5 (Broadcom BCM2712 SoC, 16GB LPDDR4X-4267).
   * **AI Co-processor:** Hailo-8L NPU (13 TOPS) via M.2 HAT+.
   * **Power/Thermal:** Regulated DC-DC step-down buck converter (12/24V to 5V/5A); active cooling stack within a 3D-printed high-temp ABS+ chassis.
   * **Sensors:** Dual Rapoo USB 3.0 Web Cameras (Driver-facing \& Road-facing).
2. **Driver AI Model (ResNet-18):**

   * Classifies driver behavioral cues into ten discrete categories (c0-c9) utilizing a Quantized INT8 compiled Hailo Executable Format (HEF) model.
3. **Road AI Model (YOLO26n):**

   * Lightweight detection of person, rider, and car classes trained on BDD100K.
   * Integrates IoU tracking, monocular ground-plane distance estimation, Kalman filter stabilization, and Time-To-Collision (TTC) calculation.
4. **Backend (FastAPI):**

   * RESTful API built with Python, FastAPI, and SQLAlchemy.
   * PostgreSQL database for robust relational storage.
   * Decoupled authentication: JWT for human portals, pre-shared API keys for edge devices.
5. **Frontend (Next.js 19):**

   * React 19 architecture with Tailwind CSS v4.
   * Split-panel layouts rendering driver/road outputs concurrently.

## 🛠️ Technology Stack

|Layer|Technology|
|-|-|
|**Edge Compute**|Raspberry Pi 5, Hailo-8L, Broadcom BCM2712|
|**Deep Learning**|ResNet-18, YOLO26n, HailoRT, GStreamer|
|**Backend API**|FastAPI, Python, SQLAlchemy, PostgreSQL|
|**Frontend App**|Next.js 19, React 19, TypeScript 5, Tailwind CSS v4, Lucide React|
|**Auth \& Security**|JWT (JSON Web Tokens), OAuth2PasswordBearer, REST/HTTPS|

## ⚙️ Hardware Installation \& Setup

1. **Physical Mounting:**

   * Secure the ABS+ chassis near the rearview mirror assembly.
   * Mount the road-facing sensor behind the rearview mirror.
   * Mount the driver-facing sensor on the central dashboard or A-pillar.
2. **Power Configuration:**

   * Wire the unit into the vehicle's 12V/24V accessory line. The internal DC-DC converter will safely regulate this to 5V/5A.
3. **Device Calibration:**

   * Log into the Driver Portal and trigger the calibration snapshot workflow.
   * Verify the internal driver bounding boxes and establish the ego-lane trapezoidal nodes for the road camera.

## 👥 Project Team

**Arab Academy for Science, Technology and Maritime Transport**  
*College of Engineering and Technology - Computer Engineering (2026)*

* **Hossam Koshok** (Hardware \& Physical Integration)
* **Malak Hesham** (Frontend Architecture)
* **Nadin Ahmed** (AI/Computer Vision - Driver)
* **Omar Maysara** (AI/Computer Vision - Road)
* **Yamen Ehab** (Backend \& API Engineering)
* **Supervised By:** Dr. Sherine Nagi

