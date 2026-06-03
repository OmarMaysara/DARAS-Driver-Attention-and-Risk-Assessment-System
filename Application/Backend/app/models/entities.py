"""
SQLAlchemy ORM models defining the database schema and table relationships.
"""
from sqlalchemy import Column, Integer, String, Float, DateTime, Date, ForeignKey, Table, JSON, Boolean
from sqlalchemy.orm import relationship
from app.database import Base

# Many-to-Many link allowing a driver to work for multiple employers.
driver_employer_association = Table(
    "driver_employer",
    Base.metadata,
    Column("driver_id", Integer, ForeignKey("drivers.driver_id"), primary_key=True),
    Column("employer_id", Integer, ForeignKey("employers.employer_id"), primary_key=True)
)

class Employer(Base):
    """Company or Fleet owner account representing an organization."""
    __tablename__ = "employers"
    employer_id = Column(Integer, primary_key=True, index=True)
    employer_name = Column(String, nullable=False)
    phone_number = Column(String)
    country = Column(String) 
    email = Column(String, unique=True, index=True, nullable=False) 
    hashed_password = Column(String, nullable=False)
    
    drivers = relationship("Driver", secondary=driver_employer_association, back_populates="employers")
    devices = relationship("Device", back_populates="employer", cascade="all, delete-orphan")

class Driver(Base):
    """Independent driver account that can belong to multiple fleets."""
    __tablename__ = "drivers"
    driver_id = Column(Integer, primary_key=True, index=True)
    driver_name = Column(String, nullable=False)
    phone_number = Column(String)
    national_id = Column(String, unique=True, index=True, nullable=False)
    license_expiration_date = Column(Date)
    email = Column(String, unique=True, index=True, nullable=False) 
    hashed_password = Column(String, nullable=False) 
    
    employers = relationship("Employer", secondary=driver_employer_association, back_populates="drivers")
    readings = relationship("Reading", back_populates="driver", cascade="all, delete-orphan")

class Device(Base):
    """Represents a physical hardware unit installed in a vehicle."""
    __tablename__ = "devices"
    device_id = Column(Integer, primary_key=True, autoincrement=True, index=True)
    serial_number = Column(String, unique=True, index=True, nullable=False)
    manufacturing_date = Column(Date)
    activation_pin = Column(String, nullable=False) 
    device_api_key = Column(String, unique=True, index=True, nullable=True) 
    employer_id = Column(Integer, ForeignKey("employers.employer_id"), nullable=True) 
    active_driver_id = Column(Integer, ForeignKey("drivers.driver_id"), nullable=True)
    latest_snapshot = Column(String, nullable=True) 
    latest_detections = Column(JSON, nullable=True)
    calibration_data = Column(JSON, nullable=True)    
    calibration_synced = Column(Boolean, default=False) 
    snapshot_requested = Column(Boolean, default=False) 
    snapshot_ready = Column(Boolean, default=False)   
    
    employer = relationship("Employer", back_populates="devices")
    readings = relationship("Reading", back_populates="device", cascade="all, delete-orphan")

class Reading(Base):
    """High-frequency telemetry data sent from the hardware during a trip."""
    __tablename__ = "readings"
    device_id = Column(Integer, ForeignKey("devices.device_id"), primary_key=True, index=True) 
    driver_id = Column(Integer, ForeignKey("drivers.driver_id"), primary_key=True)
    timestamp = Column(DateTime, primary_key=True)
    driver_score = Column(Float)
    road_score = Column(Float)
    risk_score = Column(Float)
    driver_distraction_distribution = Column(JSON) 
    urgency = Column(Float) 
    proximity = Column(Float) 
    road_objects_classes = Column(String) 
    gps_coordinates = Column(String, nullable=True)
    
    driver = relationship("Driver", back_populates="readings")
    device = relationship("Device", back_populates="readings")

class EmploymentRequest(Base):
    """Tracks pending employment invitations sent from an employer to a driver."""
    __tablename__ = "employment_requests"
    request_id = Column(Integer, primary_key=True, index=True)
    employer_id = Column(Integer, ForeignKey("employers.employer_id"), nullable=False)
    driver_email = Column(String, index=True, nullable=False)
    status = Column(String, default="Pending") 
    
    employer = relationship("Employer")