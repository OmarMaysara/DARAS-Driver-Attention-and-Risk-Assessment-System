"""
Business Logic Layer.
Handles authentication, metric calculations, hardware interactions, and dashboard generation.
"""
import math
import bcrypt
import jwt
from datetime import datetime, timedelta
from collections import defaultdict
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app import crud
from app.schemas import payloads
from app.models import entities

SECRET_KEY = "adas_super_secret_key_change_this_later"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7 

# ==========================================
# 1. INTERNAL HELPER FUNCTIONS
# ==========================================

def _calculate_rms_score(scores: list[float]) -> float:
    """Calculates the Root Mean Square for a list of scores."""
    if not scores: 
        return 0.0
    return math.sqrt(sum(s ** 2 for s in scores) / len(scores))

def _calculate_statistical_significance(base_chart: list[dict], baseline_threshold: float = 0.5) -> str:
    """
    Calculates the statistical significance of the risk trend against a baseline.
    Uses a Z-test to compute the confidence interval and determine if the 
    score deviation is mathematically significant.
    """
    n = len(base_chart)
    if n < 5: 
        return "Insufficient Data for Significance"
        
    scores = [point["score"] for point in base_chart]
    mean_score = sum(scores) / n
    
    variance = sum((x - mean_score) ** 2 for x in scores) / (n - 1)
    std_dev = math.sqrt(variance)
    
    if std_dev == 0:
        if mean_score > baseline_threshold:
            return "Significantly High Risk (p < 0.05)"
        elif mean_score < baseline_threshold:
            return "Significantly Safe (p < 0.05)"
        else:
            return "Insignificant Deviation (p > 0.05)"
            
    z_score = (mean_score - baseline_threshold) / (std_dev / math.sqrt(n))
    
    if z_score > 1.96:
        return "Significantly High Risk (p < 0.05)"
    elif z_score < -1.96:
        return "Significantly Safe (p < 0.05)"
    else:
        return "Insignificant Deviation (p > 0.05)"

def _get_default_target_date(timeframe: str) -> str:
    """Determines the default target date string based on the given timeframe."""
    now = datetime.now()
    if timeframe == "hour":
        return now.strftime("%Y-%m-%d %H")
    elif timeframe == "month":
        return now.strftime("%Y-%m")
    else:
        return now.strftime("%Y-%m-%d")

def _calculate_trend_chart(readings, timeframe: str) -> list[dict]:
    """Groups readings by timeframe and calculates the true RMS risk score (Used for Analytics)."""
    if not readings:
        return []

    groups = defaultdict(list)

    for r in readings:
        if timeframe == "hour":
            key = r.timestamp.strftime("%Y-%m-%d %H:%M:%S")
        elif timeframe == "day":
            key = r.timestamp.strftime("%Y-%m-%d %H:%M")
        elif timeframe == "month":
            key = r.timestamp.strftime("%Y-%m-%d %H:00")
        else:
            key = r.timestamp.strftime("%Y-%m-%d %H:00")
            
        groups[key].append(r.risk_score)

    chart = [
        {"timestamp": k, "score": round(_calculate_rms_score(v), 2)} 
        for k, v in groups.items()
    ]

    chart.sort(key=lambda x: x["timestamp"])
    return chart

def _generate_display_chart(readings, base_chart, timeframe: str) -> list[dict]:
    """Takes the base analytical chart and pads gaps with 0.0 for frontend rendering."""
    if not readings or not base_chart:
        return []

    if timeframe == "hour":
        fmt = "%Y-%m-%d %H:%M:%S"
        delta = timedelta(seconds=1)
    elif timeframe == "day":
        fmt = "%Y-%m-%d %H:%M"
        delta = timedelta(minutes=1)
    elif timeframe == "month":
        fmt = "%Y-%m-%d %H:00"
        delta = timedelta(hours=1)
    else:
        fmt = "%Y-%m-%d %H:00"
        delta = timedelta(minutes=1)

    min_time = min(r.timestamp for r in readings)
    max_time = max(r.timestamp for r in readings)

    if timeframe == "hour":
        curr_time = min_time.replace(microsecond=0)
        end_time = max_time.replace(microsecond=0)
    elif timeframe == "day":
        curr_time = min_time.replace(second=0, microsecond=0)
        end_time = max_time.replace(second=0, microsecond=0)
    elif timeframe == "month":
        curr_time = min_time.replace(minute=0, second=0, microsecond=0)
        end_time = max_time.replace(minute=0, second=0, microsecond=0)
    else:
        curr_time = min_time.replace(second=0, microsecond=0)
        end_time = max_time.replace(second=0, microsecond=0)

    base_lookup = {item["timestamp"]: item["score"] for item in base_chart}
    
    display_chart = []
    while curr_time <= end_time:
        key = curr_time.strftime(fmt)
        if key in base_lookup:
            display_chart.append({"timestamp": key, "score": base_lookup[key]})
        else:
            display_chart.append({"timestamp": key, "score": 0.0})
        curr_time += delta
    
    return display_chart

def _calculate_distractions_split(readings) -> list[dict]:
    """Calculates percentages and actual duration (in minutes) for driver states using one-hot encoded readings."""
    if not readings:
        return []

    state_counts = defaultdict(int)

    for r in readings:
        dist_dict = r.driver_distraction_distribution
        if isinstance(dist_dict, dict) and dist_dict:
            for state, val in dist_dict.items():
                if val == 1 or val == 1.0:
                    state_counts[state.replace("_", " ")] += 1
                    break
            
    total_valid_states = sum(state_counts.values())
            
    return [
        {
            "name": state.title(), 
            "value_percentage": round((count / total_valid_states) * 100, 1) if total_valid_states > 0 else 0.0,
            "duration_minutes": round(count / 60.0, 2)
        } 
        for state, count in state_counts.items()
    ]

def _get_driver_journeys(db: Session, driver_id: int, target_date: str = None) -> list[dict]:
    """Groups continuous split-second telemetry data into distinct physical trips (Journeys)."""
    readings = crud.get_analytical_scores_for_driver(db, driver_id, target_date=target_date, limit=10000)
    if not readings: 
        return []

    readings.sort(key=lambda x: x.timestamp)
    journeys = []
    
    current_journey = {
        "start_time": readings[0].timestamp,
        "end_time": readings[0].timestamp,
        "duration_minutes": 0
    }

    for i in range(1, len(readings)):
        prev, curr = readings[i-1], readings[i]
        
        if curr.timestamp - prev.timestamp > timedelta(minutes=5):
            duration = (current_journey["end_time"] - current_journey["start_time"]).total_seconds() / 60
            current_journey["duration_minutes"] = max(1, int(duration))
            journeys.append(current_journey)
            
            current_journey = {
                "start_time": curr.timestamp, "end_time": curr.timestamp,
                "duration_minutes": 0
            }
        else:
            current_journey["end_time"] = curr.timestamp

    duration = (current_journey["end_time"] - current_journey["start_time"]).total_seconds() / 60
    current_journey["duration_minutes"] = max(1, int(duration))
    journeys.append(current_journey)

    return journeys

# ==========================================
# 2. SECURITY & AUTHENTICATION
# ==========================================

def get_password_hash(password: str) -> str:
    """Hashes a plain-text password using bcrypt."""
    pwd_bytes = password.encode('utf-8')
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(pwd_bytes, salt).decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Checks if a plain-text password matches the stored database hash."""
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))

def create_access_token(data: dict) -> str:
    """Generates a secure JWT token encoding the user ID and role."""
    to_encode = data.copy()
    to_encode.update({"exp": datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def authenticate_employer_email(db: Session, email: str, password: str) -> dict:
    """Validates employer credentials and returns an access token."""
    employer = crud.get_employer_by_email(db, email)
    if not employer or not verify_password(password, employer.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    access_token = create_access_token(data={"sub": str(employer.employer_id), "role": "employer"})
    return {"access_token": access_token, "token_type": "bearer", "employer_id": employer.employer_id}

def authenticate_driver_email(db: Session, email: str, password: str) -> dict:
    """Validates driver credentials and returns an access token."""
    driver = crud.get_driver_by_email(db, email)
    if not driver or not verify_password(password, driver.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    access_token = create_access_token(data={"sub": str(driver.driver_id), "role": "driver"})
    return {"access_token": access_token, "token_type": "bearer", "driver_id": driver.driver_id}

# ==========================================
# 3. REGISTRATION
# ==========================================

def handle_register_employer(db: Session, payload: payloads.EmployerCreate) -> entities.Employer:
    """Handles business logic and validation for employer registration."""
    if crud.get_employer_by_email(db, payload.email):
        raise HTTPException(status_code=400, detail="Email already registered")
    hashed_pwd = get_password_hash(payload.password)
    return crud.create_employer(db=db, employer=payload, hashed_password=hashed_pwd)

def handle_register_driver(db: Session, payload: payloads.DriverCreate) -> entities.Driver:
    """Handles business logic and validation for driver registration."""
    if crud.get_driver_by_national_id(db, payload.national_id):
        raise HTTPException(status_code=400, detail="National ID already exists.")
    if crud.get_driver_by_email(db, payload.email):
        raise HTTPException(status_code=400, detail="Email already registered.")
    hashed_pwd = get_password_hash(payload.password)
    return crud.create_driver(db=db, driver=payload, hashed_password=hashed_pwd)

# ==========================================
# 4. DASHBOARD: EMPLOYER
# ==========================================

def get_dashboard_rankings(db: Session, employer_id: int) -> list[dict]:
    """Calculates and ranks the safety scores for every driver in an employer's fleet."""
    drivers = crud.get_drivers_by_employer(db, employer_id)
    if not drivers: 
        return []

    ranked_drivers = []
    for driver in drivers:
        readings = crud.get_analytical_scores_for_driver(db, driver.driver_id, limit=500)
        driver_rms_score = _calculate_rms_score([r.driver_score for r in readings])
        
        ranked_drivers.append({
            "employee": driver.driver_name,
            "email": driver.email,
            "national_id": driver.national_id,
            "role": "Driver",
            "safety_score": round(driver_rms_score, 2),
            "trips": len(_get_driver_journeys(db, driver.driver_id)),
            "licenseExpiration": driver.license_expiration_date
        })

    ranked_drivers.sort(key=lambda x: x["safety_score"], reverse=False)
    for index, data in enumerate(ranked_drivers): 
        data["rank"] = index + 1
        
    return ranked_drivers

def get_employer_devices_formatted(db: Session, employer_id: int) -> list[dict]:
    """Retrieves and formats device data for the employer dashboard."""
    devices = crud.get_devices_by_employer(db, employer_id)
    formatted_devices = []
    
    for device in devices:
        active_employee_email = None
        if device.active_driver_id:
            driver = crud.get_driver(db, device.active_driver_id)
            if driver:
                active_employee_email = driver.email
                
        formatted_devices.append({
            "serial_number": device.serial_number,
            "manufacturing_date": device.manufacturing_date,
            "active_employee_email": active_employee_email
        })
        
    return formatted_devices

def get_fleet_wide_analysis(db: Session, employer_id: int, timeframe: str, target_date: str, threshold: float) -> dict:
    """Returns top-level summary plus aggregated charts for the entire fleet."""
    if not target_date:
        target_date = _get_default_target_date(timeframe)
        
    drivers = crud.get_drivers_by_employer(db, employer_id)
    if not drivers:
        return {"summary_report": {}, "trend_chart": [], "distractions_split": []}

    driver_ids = [d.driver_id for d in drivers]
    readings = crud.get_analytical_scores_for_fleet(db, driver_ids, target_date=target_date, limit=20000)
    
    total_trips = 0
    driver_stats = []

    for driver in drivers:
        d_readings = crud.get_analytical_scores_for_driver(db, driver.driver_id, target_date=target_date, limit=500)
        d_rms_score = _calculate_rms_score([r.driver_score for r in d_readings])
        
        driver_journeys = _get_driver_journeys(db, driver.driver_id, target_date)
        total_trips += len(driver_journeys)
        driver_stats.append({"name": driver.driver_name, "score": round(d_rms_score, 2)})

    driver_stats.sort(key=lambda x: x["score"], reverse=False)

    if not readings:
        return {
            "summary_report": {
                "total_employees": len(drivers), "top_driver": driver_stats[0]["name"] if driver_stats else None,
                "needs_attention": driver_stats[-1]["name"] if driver_stats else None,
                "total_trips": total_trips, "total_drive_time_mins": 0.0, "total_risky_drive_time_mins": 0.0, 
                "alerts": 0, "avg_driver_score": 0.0, "avg_road_score": 0.0, "avg_risk_score": 0.0, 
                "percentile_95th": 0.0, "event_ratio": 0.0, "significance": "No Data"
            },
            "trend_chart": [], 
            "distractions_split": []
        }

    base_chart = _calculate_trend_chart(readings, timeframe)
    display_chart = _generate_display_chart(readings, base_chart, timeframe)
    distractions_split = _calculate_distractions_split(readings)
    
    alerts = sum(1 for r in readings if r.risk_score > threshold)
    event_ratio = alerts / len(readings) if readings else 0.0
    
    total_drive_time_mins = round(sum(d["duration_minutes"] for d in distractions_split), 2)
    safe_time = sum(d["duration_minutes"] for d in distractions_split if d["name"] == "Safe Driving")
    total_risky_drive_time_mins = round(total_drive_time_mins - safe_time, 2)

    driver_scores = [r.driver_score for r in readings]
    road_scores = [r.road_score for r in readings]
    risk_scores = [r.risk_score for r in readings]
    
    rms_fleet_score = _calculate_rms_score(driver_scores)
    rms_road_score = _calculate_rms_score(road_scores)
    rms_risk_score = _calculate_rms_score(risk_scores)
    
    sorted_risks = sorted(risk_scores)
    p95_index = max(0, int(math.ceil(0.95 * len(sorted_risks))) - 1)
    p95_risk = sorted_risks[p95_index] if sorted_risks else 0.0

    summary_report = {
        "total_employees": len(drivers),
        "top_driver": driver_stats[0]["name"] if driver_stats else None,
        "needs_attention": driver_stats[-1]["name"] if driver_stats else None,
        "total_trips": total_trips,
        "total_drive_time_mins": total_drive_time_mins,
        "total_risky_drive_time_mins": total_risky_drive_time_mins,
        "alerts": alerts,
        "avg_driver_score": round(rms_fleet_score, 2),
        "avg_road_score": round(rms_road_score, 2),
        "avg_risk_score": round(rms_risk_score, 2),
        "percentile_95th": round(p95_risk, 2),
        "event_ratio": round(event_ratio, 2),
        "significance": _calculate_statistical_significance(base_chart, baseline_threshold=0.5)
    }

    return {
        "summary_report": summary_report,
        "trend_chart": display_chart, 
        "distractions_split": distractions_split
    }

def get_driver_detailed_dashboard(db: Session, driver_email: str, employer_id: int, timeframe: str, target_date: str, threshold: float) -> dict:
    """Returns in-depth analytical charts and history for a specific driver."""
    if not target_date:
        target_date = _get_default_target_date(timeframe)
        
    driver = crud.get_driver_by_email(db, driver_email)
    if not driver or not any(emp.employer_id == employer_id for emp in driver.employers):
        return None

    readings = crud.get_analytical_scores_for_driver(db, driver.driver_id, target_date=target_date, limit=10000)
    journeys = _get_driver_journeys(db, driver.driver_id, target_date)
    
    if not readings:
        return {
            "driver_info": {"name": driver.driver_name, "national_id": driver.national_id, "status": "NO DATA"},
            "summary_report": {
                "total_trips": len(journeys), "total_drive_time_mins": 0.0,
                "total_risky_drive_time_mins": 0.0, "alerts": 0, "avg_driver_score": 0.0,
                "avg_road_score": 0.0, "avg_risk_score": 0.0, "percentile_95th": 0.0,
                "event_ratio": 0.0, "significance": "No Data"
            },
            "analysis": {"trend_chart": [], "distractions_split": []}
        }

    base_chart = _calculate_trend_chart(readings, timeframe)
    display_chart = _generate_display_chart(readings, base_chart, timeframe)
    distractions_split = _calculate_distractions_split(readings)
    
    alerts = sum(1 for r in readings if r.risk_score > threshold)
    event_ratio = alerts / len(readings) if readings else 0.0
    
    total_drive_time_mins = round(sum(d["duration_minutes"] for d in distractions_split), 2)
    safe_time = sum(d["duration_minutes"] for d in distractions_split if d["name"] == "Safe Driving")
    total_risky_drive_time_mins = round(total_drive_time_mins - safe_time, 2)

    driver_scores = [r.driver_score for r in readings]
    road_scores = [r.road_score for r in readings]
    risk_scores = [r.risk_score for r in readings]
    
    rms_driver_score = _calculate_rms_score(driver_scores)
    rms_road_score = _calculate_rms_score(road_scores)
    rms_risk_score = _calculate_rms_score(risk_scores)
    
    sorted_risks = sorted(risk_scores)
    p95_index = max(0, int(math.ceil(0.95 * len(sorted_risks))) - 1)
    p95_risk = sorted_risks[p95_index] if sorted_risks else 0.0

    summary_report = {
        "total_trips": len(journeys),
        "total_drive_time_mins": total_drive_time_mins,
        "total_risky_drive_time_mins": total_risky_drive_time_mins,
        "alerts": alerts,
        "avg_driver_score": round(rms_driver_score, 2),
        "avg_road_score": round(rms_road_score, 2),
        "avg_risk_score": round(rms_risk_score, 2),
        "percentile_95th": round(p95_risk, 2),
        "event_ratio": round(event_ratio, 2),
        "significance": _calculate_statistical_significance(base_chart, baseline_threshold=0.5)
    }

    return {
        "driver_info": {"name": driver.driver_name, "national_id": driver.national_id, "status": "RESTRICTED" if rms_risk_score > 0.5 else "ACTIVE"},
        "summary_report": summary_report,
        "analysis": {
            "trend_chart": display_chart, 
            "distractions_split": distractions_split
        }
    }

# ==========================================
# 5. DASHBOARD: DRIVER
# ==========================================

def get_full_driver_dashboard(db: Session, current_driver: entities.Driver, timeframe: str, target_date: str, threshold: float) -> dict:
    """Returns profile info, quick stats, analytical charts, and pending requests."""
    if not target_date:
        target_date = _get_default_target_date(timeframe)
        
    journeys = _get_driver_journeys(db, current_driver.driver_id, target_date)
    readings = crud.get_analytical_scores_for_driver(db, current_driver.driver_id, target_date=target_date, limit=10000)
    requests = crud.get_pending_requests_for_driver(db, current_driver.email)
    formatted_requests = [{"request_id": r.request_id, "employer_name": r.employer.employer_name} for r in requests]

    if not readings:
        return {
            "profile": {"driver_name": current_driver.driver_name, "email": current_driver.email, "active_employers": [emp.employer_name for emp in current_driver.employers]},
            "summary_report": {
                "total_trips": len(journeys), "total_drive_time_mins": 0.0,
                "total_risky_drive_time_mins": 0.0, "alerts": 0, "avg_driver_score": 0.0,
                "avg_road_score": 0.0, "avg_risk_score": 0.0, "percentile_95th": 0.0,
                "event_ratio": 0.0, "significance": "No Data"
            },
            "analysis": {"trend_chart": [], "distractions_split": []},
            "pending_requests": formatted_requests
        }

    base_chart = _calculate_trend_chart(readings, timeframe)
    display_chart = _generate_display_chart(readings, base_chart, timeframe)
    distractions_split = _calculate_distractions_split(readings)
    
    alerts = sum(1 for r in readings if r.risk_score > threshold)
    event_ratio = alerts / len(readings) if readings else 0.0
    
    total_drive_time_mins = round(sum(d["duration_minutes"] for d in distractions_split), 2)
    safe_time = sum(d["duration_minutes"] for d in distractions_split if d["name"] == "Safe Driving")
    total_risky_drive_time_mins = round(total_drive_time_mins - safe_time, 2)

    driver_scores = [r.driver_score for r in readings]
    road_scores = [r.road_score for r in readings]
    risk_scores = [r.risk_score for r in readings]
    
    rms_driver_score = _calculate_rms_score(driver_scores)
    rms_road_score = _calculate_rms_score(road_scores)
    rms_risk_score = _calculate_rms_score(risk_scores)
    
    sorted_risks = sorted(risk_scores)
    p95_index = max(0, int(math.ceil(0.95 * len(sorted_risks))) - 1)
    p95_risk = sorted_risks[p95_index] if sorted_risks else 0.0

    summary_report = {
        "total_trips": len(journeys),
        "total_drive_time_mins": total_drive_time_mins,
        "total_risky_drive_time_mins": total_risky_drive_time_mins,
        "alerts": alerts,
        "avg_driver_score": round(rms_driver_score, 2),
        "avg_road_score": round(rms_road_score, 2),
        "avg_risk_score": round(rms_risk_score, 2),
        "percentile_95th": round(p95_risk, 2),
        "event_ratio": round(event_ratio, 2),
        "significance": _calculate_statistical_significance(base_chart, baseline_threshold=0.5)
    }

    return {
        "profile": {"driver_name": current_driver.driver_name, "email": current_driver.email, "active_employers": [emp.employer_name for emp in current_driver.employers]},
        "summary_report": summary_report,
        "analysis": {
            "trend_chart": display_chart, 
            "distractions_split": distractions_split
        },
        "pending_requests": formatted_requests
    }

def handle_start_trip(db: Session, serial_number: str, current_driver: entities.Driver) -> dict:
    """Assigns the active driver to a vehicle if calibration is synced."""
    device = crud.get_device_by_serial(db, serial_number)
    if not device: 
        raise HTTPException(status_code=404, detail="Car not found")
        
    if device.employer_id not in [emp.employer_id for emp in current_driver.employers]:
        raise HTTPException(status_code=403, detail="Not authorized to drive this fleet's car.")
    
    if not device.calibration_data or not device.calibration_synced:
        raise HTTPException(status_code=400, detail="Calibration incomplete. Waiting for hardware to sync.")
        
    device.active_driver_id = current_driver.driver_id
    db.commit()
    return {"status": "Trip Started", "device_id": device.device_id, "driver_id": current_driver.driver_id}

def handle_end_trip(db: Session, serial_number: str, current_driver: entities.Driver) -> dict:
    """Removes the driver assignment from a vehicle, ending the trip."""
    device = crud.get_device_by_serial(db, serial_number)
    if device and device.active_driver_id == current_driver.driver_id:
        device.active_driver_id = None
        db.commit()
    return {"status": "Trip Ended"}

# ==========================================
# 6. EMPLOYMENT
# ==========================================

def create_employment_request(db: Session, employer_id: int, driver_email: str) -> entities.EmploymentRequest:
    """Processes an employer's request to invite a driver to their fleet."""
    target_driver = crud.get_driver_by_email(db, driver_email)
    if not target_driver: 
        raise HTTPException(status_code=404, detail="No driver registered with this email")
        
    if employer_id in [emp.employer_id for emp in target_driver.employers]:
        raise HTTPException(status_code=400, detail="Driver is already employed by you")
    return crud.create_employment_request(db, employer_id, driver_email)

def process_employment_response(db: Session, request_id: int, current_driver: entities.Driver, response_status: str):
    """Processes a driver's response (Accept/Reject) to a fleet invitation."""
    req = crud.get_employment_request(db, request_id)
    if not req or req.driver_email != current_driver.email or req.status != "Pending":
        raise HTTPException(status_code=404, detail="Valid pending request not found")

    if response_status == "Accepted":
        employer = crud.get_employer(db, req.employer_id)
        if not employer: 
            raise HTTPException(status_code=404, detail="Employer no longer exists")
        crud.link_driver_to_employer(db, current_driver, employer)
        req.status = "Accepted"
    else: 
        req.status = "Rejected"
    db.commit()

def sever_driver_employment(db: Session, employer_email: str, current_driver: entities.Driver):
    """Allows a driver to sever ties with an employer using the employer's email."""
    employer = crud.get_employer_by_email(db, employer_email)
    if not employer: 
        raise HTTPException(status_code=404, detail="Employer not found")
    crud.unlink_driver_from_employer(db, current_driver, employer)

def sever_employer_employment(db: Session, driver_email: str, current_employer: entities.Employer):
    """Allows an employer to fire a driver from their fleet using the driver's email."""
    driver = crud.get_driver_by_email(db, driver_email)
    if not driver: 
        raise HTTPException(status_code=404, detail="Driver not found")
    crud.unlink_driver_from_employer(db, driver, current_employer)

# ==========================================
# 7. HARDWARE & CALIBRATION
# ==========================================

def handle_provision_device(db: Session, payload: payloads.DeviceProvision) -> entities.Device:
    """Admin endpoint logic to provision a fresh hardware unit."""
    if crud.get_device_by_serial(db, payload.serial_number):
        raise HTTPException(status_code=400, detail="Serial number already exists.")
    return crud.provision_device(db, payload)

def handle_employer_claim_device(db: Session, payload: payloads.DeviceClaim, employer_id: int) -> dict:
    """Assigns an unowned hardware device to an employer's fleet using a physical PIN."""
    device = crud.get_device_by_serial(db, payload.serial_number)
    if not device: 
        raise HTTPException(status_code=404, detail="Invalid Serial Number")
    if device.employer_id is not None: 
        raise HTTPException(status_code=400, detail="Device is already claimed")
    if device.activation_pin != payload.activation_pin: 
        raise HTTPException(status_code=401, detail="Incorrect PIN")
        
    crud.claim_device(db, device, employer_id)
    return {"status": "Success", "message": "Device added to your fleet."}

def handle_add_batch_readings(db: Session, readings: list[payloads.ReadingCreate], api_key: str):
    """Verifies hardware and safely processes a batch file of telemetry readings."""
    device = crud.get_device_by_api_key(db, api_key)
    if not device: 
        raise HTTPException(status_code=401, detail="Unauthorized Hardware.")
    if any(r.device_id != device.device_id for r in readings):
        raise HTTPException(status_code=400, detail="Device ID mismatch in batch payload.")
    crud.create_readings_batch(db=db, readings=readings)

def handle_hardware_status_poll(db: Session, api_key: str) -> dict:
    """Answers the polling check from the hardware to coordinate states."""
    device = crud.get_device_by_api_key(db, api_key)
    if not device: 
        raise HTTPException(status_code=401, detail="Unauthorized Hardware")
    
    if device.snapshot_requested:
        device.snapshot_requested = False 
        db.commit()
        return {"status": "capture_snapshot"}

    if device.calibration_data and not device.calibration_synced:
        return {"status": "fetch_calibration"}

    if device.active_driver_id:
        return {"status": "active", "driver_id": device.active_driver_id, "device_id": device.device_id}
        
    return {"status": "waiting"}

def request_device_snapshot(db: Session, serial_number: str, current_driver: entities.Driver) -> dict:
    """Sets a flag telling the hardware to take a camera photo on its next poll and resets calibration."""
    device = crud.get_device_by_serial(db, serial_number)
    if not device or device.employer_id not in [emp.employer_id for emp in current_driver.employers]:
        raise HTTPException(status_code=404, detail="Car not found or unauthorized.")
        
    device.snapshot_requested = True
    device.snapshot_ready = False 
    
    device.calibration_data = None
    device.calibration_synced = False
    
    db.commit()
    return {"status": "Snapshot requested. Old calibration cleared. Hardware will upload shortly."}

def handle_hardware_upload_snapshot(db: Session, api_key: str, payload: payloads.SnapshotUpload) -> dict:
    """Hardware uploads the requested Base64 image frame AND its AI detections."""
    device = crud.get_device_by_api_key(db, api_key)
    if not device: 
        raise HTTPException(status_code=401, detail="Unauthorized Hardware")
    
    device.latest_snapshot = payload.snapshot_base64
    device.latest_detections = [d.dict() for d in payload.detections]
    device.snapshot_ready = True 
    db.commit()
    return {"status": "Snapshot and detections saved"}

def get_device_snapshot(db: Session, serial_number: str, current_driver: entities.Driver) -> dict:
    """Web app fetches the latest uploaded frame AND bounding boxes for the UI."""
    device = crud.get_device_by_serial(db, serial_number)
    if not device or device.employer_id not in [emp.employer_id for emp in current_driver.employers]:
        raise HTTPException(status_code=404, detail="Car not found or unauthorized.")
    
    if not device.snapshot_ready:
        raise HTTPException(status_code=425, detail="Snapshot is not ready yet. Keep polling.")
    
    if not device.latest_snapshot:
        raise HTTPException(status_code=404, detail="No snapshot available.")
        
    device.snapshot_ready = False
    db.commit()
        
    return {
        "snapshot_base64": device.latest_snapshot,
        "detections": device.latest_detections or []
    }

def handle_save_calibration(db: Session, payload: payloads.CalibrationSubmit, current_driver: entities.Driver) -> dict:
    """Web app submits the geometry, attributes, and the single clicked bounding box."""
    device = crud.get_device_by_serial(db, payload.serial_number)
    if not device or device.employer_id not in [emp.employer_id for emp in current_driver.employers]:
        raise HTTPException(status_code=404, detail="Car not found or unauthorized.")
    
    if len(payload.calibration.ego_lane_nodes) != 4:
        raise HTTPException(status_code=400, detail="Exactly 4 nodes are required for ego lane geometry.")
        
    bbox = payload.calibration.selected_bbox
    if bbox.x1 >= bbox.x2 or bbox.y1 >= bbox.y2:
        raise HTTPException(status_code=400, detail="Invalid bounding box coordinates selected.")
        
    device.calibration_data = payload.calibration.dict()
    device.calibration_synced = False 
    db.commit()
    return {"status": "Calibration saved successfully. Waiting for hardware sync."}

def get_hardware_calibration(db: Session, api_key: str) -> dict:
    """Fetches the mathematical configuration for the hardware and marks it as synced."""
    device = crud.get_device_by_api_key(db, api_key)
    if not device: 
        raise HTTPException(status_code=401, detail="Unauthorized Hardware")
    
    if not device.calibration_data:
        raise HTTPException(status_code=404, detail="Not calibrated yet")
        
    device.calibration_synced = True 
    db.commit()
    return device.calibration_data

# ==========================================
# 8. DATA MANAGEMENT
# ==========================================

def handle_get_all_readings(db: Session, device_id: int, driver_id: int) -> list[dict]:
    """Fetches and formats all raw readings for a specific device and driver."""
    readings = crud.get_all_readings_for_device_and_driver(db, device_id, driver_id)
    if not readings:
        return []
    return [
        {
            "device_id": r.device_id,
            "driver_id": r.driver_id,
            "timestamp": r.timestamp.isoformat(),
            "driver_score": r.driver_score,
            "road_score": r.road_score,
            "risk_score": r.risk_score,
            "driver_distraction_distribution": r.driver_distraction_distribution,
            "urgency": r.urgency,
            "proximity": r.proximity,
            "road_objects_classes": r.road_objects_classes,
            "gps_coordinates": r.gps_coordinates
        }
        for r in readings
    ]

def handle_get_readings_by_time_range(db: Session, device_id: int, driver_id: int, start_time: datetime, end_time: datetime) -> list[dict]:
    """Fetches and formats readings for a specific device and driver within a time range."""
    readings = crud.get_readings_by_time_range(db, device_id, driver_id, start_time, end_time)
    
    if not readings:
        return []
        
    return [
        {
            "device_id": r.device_id,
            "driver_id": r.driver_id,
            "timestamp": r.timestamp.isoformat(),
            "driver_score": r.driver_score,
            "road_score": r.road_score,
            "risk_score": r.risk_score,
            "driver_distraction_distribution": r.driver_distraction_distribution,
            "urgency": r.urgency,
            "proximity": r.proximity,
            "road_objects_classes": r.road_objects_classes,
            "gps_coordinates": r.gps_coordinates
        }
        for r in readings
    ]

def handle_delete_readings(db: Session, device_id: int, driver_id: int) -> dict:
    """Processes the deletion of readings for a specific device and driver."""
    crud.delete_readings(db, device_id, driver_id)
    return {"status": "Success", "message": "Readings deleted successfully."}

def handle_delete_device(db: Session, device_id: int) -> dict:
    """Processes the deletion of a specific device."""
    device = crud.delete_device(db, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found.")
    return {"status": "Success", "message": "Device deleted successfully."}

def handle_delete_employer(db: Session, employer_id: int) -> dict:
    """Processes the deletion of an employer."""
    employer = crud.delete_employer(db, employer_id)
    if not employer:
        raise HTTPException(status_code=404, detail="Employer not found.")
    return {"status": "Success", "message": "Employer deleted successfully."}

def handle_delete_driver(db: Session, driver_id: int) -> dict:
    """Processes the deletion of a driver."""
    driver = crud.delete_driver(db, driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found.")
    return {"status": "Success", "message": "Driver deleted successfully."}

def handle_delete_all_employment_requests(db: Session) -> dict:
    """Processes the deletion of all employment requests."""
    count = crud.delete_all_employment_requests(db)
    return {"status": "Success", "message": f"Successfully deleted {count} employment requests."}

def handle_delete_readings_by_time_range(db: Session, device_id: int, driver_id: int, start_time: datetime, end_time: datetime) -> dict:
    """Processes the deletion of readings within a specific time range."""
    count = crud.delete_readings_by_time_range(db, device_id, driver_id, start_time, end_time)
    return {"status": "Success", "message": f"Successfully deleted {count} readings in the specified range."}