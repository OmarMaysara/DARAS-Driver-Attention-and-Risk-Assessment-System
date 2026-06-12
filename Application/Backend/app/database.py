"""
Core database configuration and session management for the DARAS backend.
Handles switching between production PostgreSQL (Supabase) and local SQLite.
"""
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# 1. Fetch connection string (defaults to local SQLite if empty)
db_url = os.getenv("POSTGRES_URL", "sqlite:///./adas.db")

# 2. If it's a production Postgres URL, sanitize and clean it up
if db_url.startswith("postgres://") or db_url.startswith("postgresql://"):
    # SQLAlchemy requires 'postgresql://' instead of 'postgres://'
    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql://", 1)
    
    # Strip out any trailing query parameters causing the "supa" error
    if "?" in db_url:
        # Splits URL at '?' and takes only the base connection string
        db_url = db_url.split("?")[0]

# 3. Configure connect_args based on database type
connect_args = {}
if db_url.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

# Initialize engine
engine = create_engine(db_url, connect_args=connect_args)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()
