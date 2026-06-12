"""
Core database configuration and session management for the ADAS backend.
Initializes the SQLAlchemy engine and base models.
"""
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# 1. Fall back to local SQLite if POSTGRES_URL isn't found (like on your local machine)
SQLALCHEMY_DATABASE_URL = os.getenv("POSTGRES_URL", "sqlite:///./adas.db")

# 2. Fix the driver prefix for SQLAlchemy if using PostgreSQL
if SQLALCHEMY_DATABASE_URL.startswith("postgres://"):
    SQLALCHEMY_DATABASE_URL = SQLALCHEMY_DATABASE_URL.replace("postgres://", "postgresql://", 1)

# 3. Configure connect_args only if we are using SQLite
connect_args = {}
if SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, 
    connect_args=connect_args
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()
