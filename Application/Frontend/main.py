from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import os
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="DARAS Backend Intelligence")

# Configure CORS for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, replace with your frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/v1/dashboard/employer/reports")
async def get_employer_reports(employer_id: int = None):
    # Mock data for demonstration
    return {
        "total_employees": 12,
        "total_trips": 1250,
        "top_driver": "Ahmed Al-Rashid",
        "needs_attention": "Khaled Hassan"
    }

@app.get("/api/v1/dashboard/employer/rankings")
async def get_employer_rankings(employer_id: int = None):
    # Expanded Mock data to show the design fully
    return {
        "ranked_employees": [
            {"driver_id": 1, "driver_name": "Ahmed Al-Rashid", "safety_score": 98, "trips": 450, "incidents": 0, "role": "Senior Fleet Captain", "last_active": "2024-05-07T10:30:00Z"},
            {"driver_id": 2, "driver_name": "Sarah Mansour", "safety_score": 92, "trips": 320, "incidents": 1, "role": "Logistics Specialist", "last_active": "2024-05-07T11:45:00Z"},
            {"driver_id": 3, "driver_name": "Omar Farouk", "safety_score": 88, "trips": 210, "incidents": 0, "role": "Driver", "last_active": "2024-05-07T09:15:00Z"},
            {"driver_id": 4, "driver_name": "Laila Hassan", "safety_score": 84, "trips": 195, "incidents": 2, "role": "Urban Courier", "last_active": "2024-05-06T14:20:00Z"},
            {"driver_id": 5, "driver_name": "Yassin Zaid", "safety_score": 79, "trips": 140, "incidents": 1, "role": "Driver", "last_active": "2024-05-06T18:30:00Z"},
            {"driver_id": 6, "driver_name": "Hoda Ezzat", "safety_score": 72, "trips": 95, "incidents": 3, "role": "Junior Driver", "last_active": "2024-05-05T12:10:00Z"},
            {"driver_id": 7, "driver_name": "Mostafa Gad", "safety_score": 65, "trips": 110, "incidents": 4, "role": "Driver", "last_active": "2024-05-05T08:45:00Z"},
            {"driver_id": 8, "driver_name": "Nour Selim", "safety_score": 58, "trips": 75, "incidents": 2, "role": "Junior Driver", "last_active": "2024-05-04T16:20:00Z"},
            {"driver_id": 9, "driver_name": "Khaled Hassan", "safety_score": 42, "trips": 185, "incidents": 8, "role": "Probationary", "last_active": "2024-05-06T16:20:00Z"},
            {"driver_id": 10, "driver_name": "Mona Amin", "safety_score": 35, "trips": 50, "incidents": 6, "role": "Trainee", "last_active": "2024-05-03T11:00:00Z"}
        ]
    }

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
