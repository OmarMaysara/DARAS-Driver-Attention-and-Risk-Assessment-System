"""
Data Access Layer.
Contains all direct database interactions (Create, Read, Update, Delete) using SQLAlchemy.
"""
from sqlalchemy.orm import Session
from sqlalchemy import desc
from sqlalchemy.dialects.postgresql import insert
import secrets
from datetime import datetime, timedelta
from app.models import entities
from app.schemas import payloads
from datetime import datetime
from sqlalchemy import cast, Date, func

# ==========================================
# 1. USERS (EMPLOYERS & DRIVERS)
# ==========================================

def create_employer(db: Session, employer: payloads.EmployerCreate, hashed_password: str) -> entities.Employer:
    """Creates a new employer account with a securely hashed password."""
    new_employer = entities.Employer(
        employer_name=employer.employer_name,
        phone_number=employer.phone_number,
        email=employer.email,
        country=employer.country,
        hashed_password=hashed_password
    )
    db.add(new_employer)
    db.commit()
    db.refresh(new_employer)
    return new_employer

def get_employer(db: Session, employer_id: int):
    """Fetches a specific employer by their database ID."""
    return db.query(entities.Employer).filter(entities.Employer.employer_id == employer_id).first()

def get_employer_by_email(db: Session, email: str):
    """Fetches an employer by their registered email address."""
    return db.query(entities.Employer).filter(entities.Employer.email == email).first()

def create_driver(db: Session, driver: payloads.DriverCreate, hashed_password: str) -> entities.Driver:
    """Registers a new independent driver account."""
    new_driver = entities.Driver(
        driver_name=driver.driver_name,
        phone_number=driver.phone_number,
        national_id=driver.national_id,
        license_expiration_date=driver.license_expiration_date,
        email=driver.email,
        hashed_password=hashed_password
    )
    db.add(new_driver)
    db.commit()
    db.refresh(new_driver)
    return new_driver

def get_driver(db: Session, driver_id: int):
    """Fetches a specific driver by their database ID."""
    return db.query(entities.Driver).filter(entities.Driver.driver_id == driver_id).first()

def get_driver_by_email(db: Session, email: str):
    """Fetches a driver by their registered email address."""
    return db.query(entities.Driver).filter(entities.Driver.email == email).first()

def get_driver_by_national_id(db: Session, national_id: str):
    """Fetches a driver to verify uniqueness of their national ID."""
    return db.query(entities.Driver).filter(entities.Driver.national_id == national_id).first()

def get_drivers_by_employer(db: Session, employer_id: int):
    """Fetches all drivers belonging to a specific employer via the many-to-many relationship."""
    return db.query(entities.Driver).filter(
        entities.Driver.employers.any(entities.Employer.employer_id == employer_id)
    ).all()

# ==========================================
# 2. EMPLOYMENT LINKS
# ==========================================

def create_employment_request(db: Session, employer_id: int, driver_email: str):
    """Creates a pending employment invitation for a driver."""
    req = entities.EmploymentRequest(employer_id=employer_id, driver_email=driver_email)
    db.add(req)
    db.commit()
    db.refresh(req)
    return req

def get_employment_request(db: Session, request_id: int):
    """Fetches a specific employment request by its ID."""
    return db.query(entities.EmploymentRequest).filter(entities.EmploymentRequest.request_id == request_id).first()

def get_pending_requests_for_driver(db: Session, email: str):
    """Retrieves all unresolved invitations for a specific driver."""
    return db.query(entities.EmploymentRequest).filter(
        entities.EmploymentRequest.driver_email == email,
        entities.EmploymentRequest.status == "Pending"
    ).all()

def link_driver_to_employer(db: Session, driver: entities.Driver, employer: entities.Employer):
    """Creates the many-to-many association between a driver and an employer."""
    if employer not in driver.employers:
        driver.employers.append(employer)
        db.commit()

def unlink_driver_from_employer(db: Session, driver: entities.Driver, employer: entities.Employer):
    """Severs the many-to-many association between a driver and an employer."""
    if employer in driver.employers:
        driver.employers.remove(employer)
        db.commit()

# ==========================================
# 3. HARDWARE & DEVICES
# ==========================================

def provision_device(db: Session, device: payloads.DeviceProvision) -> entities.Device:
    """Adds a newly manufactured device and generates the permanent API key."""
    api_key = secrets.token_hex(16) 
    new_device = entities.Device(
        serial_number=device.serial_number,
        manufacturing_date=device.manufacturing_date,
        activation_pin=device.activation_pin,
        device_api_key=api_key 
    )
    db.add(new_device)
    db.commit()
    db.refresh(new_device)
    return new_device

def claim_device(db: Session, device: entities.Device, employer_id: int):
    """Assigns an unowned device to a specific employer."""
    device.employer_id = employer_id
    db.commit()
    db.refresh(device)
    return device

def get_device(db: Session, device_id: int):
    """Fetches a specific hardware device by its database ID."""
    return db.query(entities.Device).filter(entities.Device.device_id == device_id).first()

def get_device_by_serial(db: Session, serial_number: str):
    """Fetches a specific hardware device by its printed serial number."""
    return db.query(entities.Device).filter(entities.Device.serial_number == serial_number).first()

def get_device_by_api_key(db: Session, api_key: str):
    """Fetches a device using its secure API key for hardware authentication."""
    return db.query(entities.Device).filter(entities.Device.device_api_key == api_key).first()

def get_devices_by_employer(db: Session, employer_id: int):
    """Fetches all devices owned by a specific fleet."""
    return db.query(entities.Device).filter(entities.Device.employer_id == employer_id).all()

# ==========================================
# 4. TELEMETRY & READINGS
# ==========================================

def get_readings_for_driver(db: Session, driver_id: int, limit: int = 100):
    """Fetches the most recent FULL telemetry readings (useful for single point checks)."""
    return db.query(entities.Reading).filter(
        entities.Reading.driver_id == driver_id
    ).order_by(desc(entities.Reading.timestamp)).limit(limit).all()

def _parse_date_range(target_date: str):
    """Returns (start, end) datetime tuple for both YYYY-MM and YYYY-MM-DD formats."""
    date_part = target_date.split(" ")[0]
    if len(date_part) == 7:  # YYYY-MM  — month scope
        start = datetime.strptime(date_part, "%Y-%m")
        # First moment of the next month = exclusive upper bound
        end = (start.replace(month=start.month + 1) if start.month < 12
               else start.replace(year=start.year + 1, month=1))
    else:                    # YYYY-MM-DD — day scope
        start = datetime.strptime(date_part, "%Y-%m-%d")
        end = start + timedelta(days=1)
    return start, end

def get_analytical_scores_for_driver(db: Session, driver_id: int, target_date: str = None, limit: int = 10000):
    query = db.query(entities.Reading).filter(entities.Reading.driver_id == driver_id)
    if start_date:
        start_dt = datetime.strptime(start_date, "%Y-%m-%d")
        end_dt = (datetime.strptime(end_date, "%Y-%m-%d") if end_date else start_dt) + timedelta(days=1)
        query = query.filter(entities.Reading.timestamp >= start_dt, entities.Reading.timestamp < end_dt)
    elif target_date:
        date_part = target_date.split(" ")[0]
        start_dt = datetime.strptime(date_part, "%Y-%m-%d")
        end_dt = start_dt + timedelta(days=1)
        query = query.filter(entities.Reading.timestamp >= start_dt, entities.Reading.timestamp < end_dt)
    return query.order_by(entities.Reading.timestamp.desc()).limit(limit).all()

def get_analytical_scores_for_fleet(db: Session, driver_ids: list[int], target_date: str = None, limit: int = 20000):
    query = db.query(entities.Reading).filter(entities.Reading.driver_id.in_(driver_ids))
    if start_date:
        start_dt = datetime.strptime(start_date, "%Y-%m-%d")
        end_dt = (datetime.strptime(end_date, "%Y-%m-%d") if end_date else start_dt) + timedelta(days=1)
        query = query.filter(entities.Reading.timestamp >= start_dt, entities.Reading.timestamp < end_dt)
    elif target_date:
        date_part = target_date.split(" ")[0]
        start_dt = datetime.strptime(date_part, "%Y-%m-%d")
        end_dt = start_dt + timedelta(days=1)
        query = query.filter(entities.Reading.timestamp >= start_dt, entities.Reading.timestamp < end_dt)

    return query.order_by(entities.Reading.timestamp.desc()).limit(limit).all()

def create_readings_batch(db: Session, readings: list[payloads.ReadingCreate]):
    """Inserts telemetry readings. Safely ignores exact duplicates if hardware retries an upload."""
    if not readings: 
        return

    values = [
        {
            "device_id": r.device_id,
            "driver_id": r.driver_id,
            "timestamp": r.timestamp,
            "driver_score": r.driver_score,
            "road_score": r.road_score,
            "risk_score": r.risk_score,
            "driver_distraction_distribution": r.driver_distraction_distribution.dict(),
            "urgency": r.urgency,
            "proximity": r.proximity,
            "road_objects_classes": r.road_objects_classes,
            "gps_coordinates": r.gps_coordinates
        }
        for r in readings
    ]

    stmt = insert(entities.Reading).values(values)
    stmt = stmt.on_conflict_do_nothing(index_elements=['device_id', 'driver_id', 'timestamp'])
    
    db.execute(stmt)
    db.commit()

def get_all_readings_for_device_and_driver(db: Session, device_id: int, driver_id: int):
    """Retrieves every single telemetry reading for a specific device and driver."""
    return db.query(entities.Reading).filter(
        entities.Reading.device_id == device_id,
        entities.Reading.driver_id == driver_id
    ).order_by(entities.Reading.timestamp.asc()).all()

def get_readings_by_time_range(db: Session, device_id: int, driver_id: int, start_time: datetime, end_time: datetime):
    """Retrieves telemetry readings for a specific device and driver within a timestamp range."""
    return db.query(entities.Reading).filter(
        entities.Reading.device_id == device_id,
        entities.Reading.driver_id == driver_id,
        entities.Reading.timestamp >= start_time,
        entities.Reading.timestamp <= end_time
    ).order_by(entities.Reading.timestamp.asc()).all()

# ==========================================
# 5. DATA MANAGEMENT & DELETION
# ==========================================

def delete_readings(db: Session, device_id: int, driver_id: int):
    """Deletes all readings associated with a specific device and driver."""
    db.query(entities.Reading).filter(
        entities.Reading.device_id == device_id,
        entities.Reading.driver_id == driver_id
    ).delete(synchronize_session=False)
    db.commit()

def delete_device(db: Session, device_id: int):
    """Deletes a device by its ID."""
    device = db.query(entities.Device).filter(entities.Device.device_id == device_id).first()
    if device:
        db.delete(device)
        db.commit()
    return device

def delete_employer(db: Session, employer_id: int):
    """Deletes an employer and cascades to their devices."""
    employer = db.query(entities.Employer).filter(entities.Employer.employer_id == employer_id).first()
    if employer:
        db.delete(employer)
        db.commit()
    return employer

def delete_driver(db: Session, driver_id: int):
    """Deletes a driver."""
    driver = db.query(entities.Driver).filter(entities.Driver.driver_id == driver_id).first()
    if driver:
        db.delete(driver)
        db.commit()
    return driver

def delete_all_employment_requests(db: Session):
    """Deletes all records from the employment_requests table."""
    deleted_count = db.query(entities.EmploymentRequest).delete(synchronize_session=False)
    db.commit()
    return deleted_count

def delete_readings_by_time_range(db: Session, device_id: int, driver_id: int, start_time: datetime, end_time: datetime):
    """Deletes readings for a specific device and driver within a timestamp range."""
    deleted_count = db.query(entities.Reading).filter(
        entities.Reading.device_id == device_id,
        entities.Reading.driver_id == driver_id,
        entities.Reading.timestamp >= start_time,
        entities.Reading.timestamp <= end_time
    ).delete(synchronize_session=False)
    db.commit()
    return deleted_count