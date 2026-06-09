"""
Entry point for the FastAPI application.
Handles middleware setup, database initialization, and router registration.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.endpoints import router
from app.database import engine, Base
from app.models import entities 

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="ADAS Fleet Intelligence API",
    description="Backend API for the Driver Attention and Reporting System (DARAS)",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True, 
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api/v1")