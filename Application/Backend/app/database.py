"""
Core database configuration and session management for the ADAS backend.
Initializes the SQLAlchemy engine and base models.
"""
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# 1. Look for the Supabase integration variable first, then fallback to local SQLite
SQLALCHEMY_DATABASE_URL = os.getenv("POSTGRES_URL") or os.getenv("DATABASE_URL") or "sqlite:///./adas.db"

# 2. Fix the protocol naming quirk (SQLAlchemy 1.4+ requires 'postgresql://' instead of 'postgres://')
if SQLALCHEMY_DATABASE_URL.startswith("postgres://"):
    SQLALCHEMY_DATABASE_URL = SQLALCHEMY_DATABASE_URL.replace("postgres://", "postgresql://", 1)

# 3. Configure connection arguments dynamically
# 'connect_args' is required for SQLite multi-threading but throws an error if passed to PostgreSQL
if SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    engine = create_engine(
        SQLALCHEMY_DATABASE_URL, 
        connect_args={"check_same_thread": False}
    )
else:
    engine = create_engine(SQLALCHEMY_DATABASE_URL)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()
