"""
API Router configuration and endpoint definitions.
Binds HTTP routes to functions in the operations module.
"""
import jwt
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status, Header, Query
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app import crud
from app.database import SessionLocal
from app.schemas.payloads import (
    EmployerCreate, DriverCreate, ReadingCreate, 
    EmployerTokenResponse, DriverTokenResponse, 
    EmploymentRequestCreate, EmploymentRequestStatusUpdate,
    DeviceProvision, DeviceClaim, TripRequest, 
    SnapshotUpload, CalibrationSubmit
)
from app.services import operations

router = APIRouter()

# ==========================================
# 1. DEPENDENCIES & AUTH SETUP
# ==========================================

def get_db():
    """Generates a database session for requests and ensures it closes correctly."""
    db = SessionLocal()
    try: 
        yield db
    finally: 
        db.close()

oauth2_scheme_employer = OAuth2PasswordBearer(tokenUrl="/api/v1/employer/login", scheme_name="Employer Auth")
oauth2_scheme_driver = OAuth2PasswordBearer(tokenUrl="/api/v1/driver/login", scheme_name="Driver Auth")

def get_current_employer(token: str = Depends(oauth2_scheme_employer), db: Session = Depends(get_db)):
    """Dependency to validate the JWT token and return the current Employer entity."""
    try:
        payload = jwt.decode(token, operations.SECRET_KEY, algorithms=[operations.ALGORITHM])
        if payload.get("role") != "employer": 
            raise HTTPException(status_code=401, detail="Invalid token")
        employer = crud.get_employer(db, int(payload.get("sub")))
        if not employer: 
            raise HTTPException(status_code=401, detail="Employer not found")
        return employer
    except jwt.PyJWTError: 
        raise HTTPException(status_code=401, detail="Token invalid/expired")

def get_current_driver(token: str = Depends(oauth2_scheme_driver), db: Session = Depends(get_db)):
    """Dependency to validate the JWT token and return the current Driver entity."""
    try:
        payload = jwt.decode(token, operations.SECRET_KEY, algorithms=[operations.ALGORITHM])
        if payload.get("role") != "driver": 
            raise HTTPException(status_code=401, detail="Invalid token")
        driver = crud.get_driver(db, int(payload.get("sub")))
        if not driver: 
            raise HTTPException(status_code=401, detail="Driver not found")
        return driver
    except jwt.PyJWTError: 
        raise HTTPException(status_code=401, detail="Token invalid/expired")

# ==========================================
# 2. REGISTRATION
# ==========================================

@router.post("/employer/register", tags=["Registration"])
async def register_employer(employer: EmployerCreate, db: Session = Depends(get_db)):
    """Registers a new employer fleet account."""
    operations.handle_register_employer(db, employer)
    return {"status": "Success", "message": "Employer account created!"}

@router.post("/driver/register", tags=["Registration"])
async def register_driver(driver: DriverCreate, db: Session = Depends(get_db)):
    """Registers a new independent driver account."""
    new_driver = operations.handle_register_driver(db, driver)
    return {"status": "Success", "message": "Driver registered successfully", "driver_id": new_driver.driver_id}

# ==========================================
# 3. AUTHENTICATION
# ==========================================

@router.post("/employer/login", response_model=EmployerTokenResponse, tags=["Authentication"])
async def employer_login(credentials: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """Validates employer credentials and issues a JWT token."""
    return operations.authenticate_employer_email(db, credentials.username, credentials.password)

@router.post("/driver/login", response_model=DriverTokenResponse, tags=["Authentication"])
async def driver_login(credentials: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """Validates driver credentials and issues a JWT token."""
    return operations.authenticate_driver_email(db, credentials.username, credentials.password)

# ==========================================
# 4. DASHBOARD: EMPLOYER
# ==========================================

@router.get("/dashboard/employer/drivers", tags=["Dashboard - Employer"])
async def get_employee_rankings(db: Session = Depends(get_db), current_employer = Depends(get_current_employer)):
    """Retrieves all drivers in a fleet, sorted by their safety scores."""
    return {"ranked_employees": operations.get_dashboard_rankings(db, current_employer.employer_id)}

@router.get("/dashboard/employer/devices", tags=["Dashboard - Employer"])
async def get_employer_devices(db: Session = Depends(get_db), current_employer = Depends(get_current_employer)):
    """Retrieves specific hardware device details for the employer's fleet."""
    return {"devices": operations.get_employer_devices_formatted(db, current_employer.employer_id)}

@router.get("/dashboard/employer/fleet-analysis", tags=["Dashboard - Employer"])
async def get_fleet_analysis(
    timeframe: str = Query("week", description="Grouping timeframe: day, week, month"),
    threshold: float = Query(0.75, description="Risk score threshold to calculate event ratio"),
    db: Session = Depends(get_db), 
    current_employer = Depends(get_current_employer)
):
    """Returns top-level summary plus aggregated charts for the entire fleet."""
    return operations.get_fleet_wide_analysis(db, current_employer.employer_id, timeframe, threshold)

@router.get("/dashboard/employer/drivers/{driver_email}/details", tags=["Dashboard - Employer"])
async def get_driver_detailed_view(
    driver_email: str, 
    timeframe: str = Query("week", description="Grouping timeframe: day, week, month"),
    threshold: float = Query(0.75, description="Risk score threshold to calculate event ratio"),
    db: Session = Depends(get_db), 
    current_employer = Depends(get_current_employer)
):
    """Returns in-depth analytical charts and history for a specific driver."""
    details = operations.get_driver_detailed_dashboard(db, driver_email, current_employer.employer_id, timeframe, threshold)
    if not details: 
        raise HTTPException(status_code=404, detail="Driver not found in your fleet")
    return details

# ==========================================
# 5. DASHBOARD: DRIVER
# ==========================================

@router.get("/dashboard/driver/details", tags=["Dashboard - Driver"])
async def get_driver_dashboard(
    timeframe: str = Query("week", description="Grouping timeframe: day, week, month"),
    threshold: float = Query(0.75, description="Risk score threshold to calculate event ratio"),
    db: Session = Depends(get_db), 
    current_driver = Depends(get_current_driver)
):
    """BFF Endpoint: Returns profile info, quick stats, analytical charts, and pending requests in one call."""
    return operations.get_full_driver_dashboard(db, current_driver, timeframe, threshold)

@router.post("/dashboard/driver/start-trip", tags=["Dashboard - Driver"])
async def driver_start_trip(payload: TripRequest, db: Session = Depends(get_db), current_driver = Depends(get_current_driver)):
    """Assigns the driver to a specific car and starts a new journey."""
    return operations.handle_start_trip(db, payload.serial_number, current_driver)

@router.post("/dashboard/driver/end-trip", tags=["Dashboard - Driver"])
async def driver_end_trip(payload: TripRequest, db: Session = Depends(get_db), current_driver = Depends(get_current_driver)):
    """Unassigns the driver from the vehicle, formally ending the journey."""
    return operations.handle_end_trip(db, payload.serial_number, current_driver)

@router.post("/dashboard/driver/calibration/request-snapshot", tags=["Dashboard - Driver"])
async def request_calibration_snapshot(payload: TripRequest, db: Session = Depends(get_db), current_driver = Depends(get_current_driver)):
    """Driver clicks 'Capture Image' on web app to wake up the camera."""
    return operations.request_device_snapshot(db, payload.serial_number, current_driver)

@router.get("/dashboard/driver/calibration/snapshot/{serial_number}", tags=["Dashboard - Driver"])
async def get_calibration_snapshot(serial_number: str, db: Session = Depends(get_db), current_driver = Depends(get_current_driver)):
    """Fetches the latest camera frame for the frontend UI."""
    return operations.get_device_snapshot(db, serial_number, current_driver)

@router.post("/dashboard/driver/calibration/save", tags=["Dashboard - Driver"])
async def save_device_calibration(payload: CalibrationSubmit, db: Session = Depends(get_db), current_driver = Depends(get_current_driver)):
    """Saves the 4 lane nodes and physical attributes from the frontend UI."""
    return operations.handle_save_calibration(db, payload, current_driver)

# ==========================================
# 6. EMPLOYMENT
# ==========================================

@router.post("/employment/employer/request", tags=["Employment"])
async def request_driver_employment(payload: EmploymentRequestCreate, db: Session = Depends(get_db), current_employer = Depends(get_current_employer)):
    """Employer invites an independent driver to join their fleet via email."""
    req = operations.create_employment_request(db, current_employer.employer_id, payload.driver_email)
    return {"status": "Success", "message": "Request sent", "request_id": req.request_id}

@router.post("/employment/driver/requests/{request_id}/respond", tags=["Employment"])
async def respond_to_employment_request(request_id: int, payload: EmploymentRequestStatusUpdate, db: Session = Depends(get_db), current_driver = Depends(get_current_driver)):
    """Driver accepts or rejects an employment invitation."""
    operations.process_employment_response(db, request_id, current_driver, payload.status)
    return {"status": "Success", "message": f"Request {payload.status.lower()}"}

@router.delete("/employment/driver/sever/{employer_email}", tags=["Employment"])
async def sever_employment_driver(employer_email: str, db: Session = Depends(get_db), current_driver = Depends(get_current_driver)):
    """Allows a driver to resign or disconnect from a fleet using the employer's email."""
    operations.sever_driver_employment(db, employer_email, current_driver)
    return {"status": "Success", "message": "Employment severed by driver"}

@router.delete("/employment/employer/sever/{driver_email}", tags=["Employment"])
async def sever_employment_employer(driver_email: str, db: Session = Depends(get_db), current_employer = Depends(get_current_employer)):
    """Allows an employer to remove a driver from their fleet using the driver's email."""
    operations.sever_employer_employment(db, driver_email, current_employer)
    return {"status": "Success", "message": "Driver removed from fleet"}

# ==========================================
# 7. HARDWARE INTEGRATION AND MANAGEMENT
# ==========================================

@router.post("/internal/devices/provision", tags=["Hardware Management"])
async def provision_new_device(device: DeviceProvision, db: Session = Depends(get_db)):
    """(Admin) Registers a new device fresh off the assembly line."""
    new_device = operations.handle_provision_device(db, device)
    return {"status": "Success", "message": f"Device {new_device.serial_number} provisioned."}

@router.post("/dashboard/employer/devices/claim", tags=["Hardware Management"])
async def employer_claim_device(payload: DeviceClaim, db: Session = Depends(get_db), current_employer = Depends(get_current_employer)):
    """Employer claims a purchased device using the physical PIN."""
    return operations.handle_employer_claim_device(db, payload, current_employer.employer_id)

@router.post("/readings/batch", tags=["Hardware Integration"])
async def add_batch_readings(readings: List[ReadingCreate], x_api_key: str = Header(...), db: Session = Depends(get_db)):
    """Hardware uploads a batch file containing all recent telemetry."""
    operations.handle_add_batch_readings(db, readings, x_api_key)
    return {"status": "Success", "message": f"Successfully saved {len(readings)} readings."}

@router.get("/hardware/status", tags=["Hardware Integration"])
async def check_hardware_status(x_api_key: str = Header(...), db: Session = Depends(get_db)):
    """Hardware polls this endpoint waiting for commands or an active driver."""
    return operations.handle_hardware_status_poll(db, x_api_key)

@router.post("/hardware/calibration/snapshot", tags=["Hardware Integration"])
async def upload_camera_snapshot(payload: SnapshotUpload, x_api_key: str = Header(...), db: Session = Depends(get_db)):
    """Hardware uploads a single base64 image frame AND its AI bounding boxes."""
    return operations.handle_hardware_upload_snapshot(db, x_api_key, payload)

@router.get("/hardware/calibration", tags=["Hardware Integration"])
async def fetch_calibration_config(x_api_key: str = Header(...), db: Session = Depends(get_db)):
    """Hardware downloads the calibration JSON to save locally."""
    return operations.get_hardware_calibration(db, x_api_key)

# ==========================================
# DATA DELETION ENDPOINTS
# ==========================================

@router.delete("/readings/{device_id}/{driver_id}", tags=["Data Management"])
async def delete_readings(device_id: int, driver_id: int, db: Session = Depends(get_db)):
    """Deletes all readings for a given device and driver pair."""
    return operations.handle_delete_readings(db, device_id, driver_id)

@router.delete("/device/{device_id}", tags=["Data Management"])
async def delete_device(device_id: int, db: Session = Depends(get_db)):
    """Deletes a device by its ID."""
    return operations.handle_delete_device(db, device_id)

@router.delete("/employer/{employer_id}", tags=["Data Management"])
async def delete_employer(employer_id: int, db: Session = Depends(get_db)):
    """Deletes an employer by their ID."""
    return operations.handle_delete_employer(db, employer_id)

@router.delete("/driver/{driver_id}", tags=["Data Management"])
async def delete_driver(driver_id: int, db: Session = Depends(get_db)):
    """Deletes a driver by their ID."""
    return operations.handle_delete_driver(db, driver_id)

@router.delete("/requests/all", tags=["Data Management"])
async def delete_all_employment_requests(db: Session = Depends(get_db)):
    """Deletes all employment requests in the system."""
    return operations.handle_delete_all_employment_requests(db)