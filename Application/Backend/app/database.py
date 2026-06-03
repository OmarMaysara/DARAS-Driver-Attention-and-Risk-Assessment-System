"""
Core database configuration and session management for the ADAS backend.
Initializes the SQLAlchemy engine and base models.
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# Local SQLite database for development purposes.
SQLALCHEMY_DATABASE_URL = "sqlite:///./adas.db"

# Core SQLAlchemy Engine. check_same_thread=False allows FastAPI async workers to use SQLite safely.
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, 
    connect_args={"check_same_thread": False}
)

# Core session factory used by the get_db() dependency to create database sessions.
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base class for all SQLAlchemy ORM models to inherit from.
Base = declarative_base()