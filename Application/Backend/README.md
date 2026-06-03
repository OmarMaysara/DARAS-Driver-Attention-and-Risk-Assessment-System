# ADAS Fleet Intelligence API

Backend API for the Driver Attention and Reporting System (DARAS). Built with FastAPI, SQLAlchemy, and SQLite.

## Prerequisites
- **Python**: Version 3.10 or higher.
- **Git**: To clone the repository (if applicable).
- **ngrok**: For exposing the local development server to the internet.

## Project Structure
Ensure your files are structured like this before starting:

    /adas-backend
    ├── requirements.txt
    └── app/
        ├── __init__.py
        ├── main.py
        ├── crud.py
        ├── database.py
        ├── api/
        │   └── endpoints.py
        ├── models/
        │   └── entities.py
        ├── schemas/
        │   └── payloads.py
        └── services/
            └── operations.py

## Setup Instructions

**1. Open a terminal in the root directory of the project (`/adas-backend`).**

**2. Create a Virtual Environment:**
    python -m venv venv

**3. Activate the Virtual Environment:**
* **Windows:**
    venv\Scripts\activate
* **macOS / Linux:**
    source venv/bin/activate

**4. Install Dependencies:**
    pip install -r requirements.txt

**5. Install and Configure ngrok:**
* Download and install [ngrok](https://ngrok.com/download).
* Sign up for a free account to get an authentication token.
* Authenticate your ngrok agent in the terminal:
    ngrok config add-authtoken <YOUR_AUTHTOKEN>

**6. Run the Server:**
You will need two separate terminal windows running simultaneously.

* **Terminal 1 (Start the FastAPI Server):**
    uvicorn app.main:app --reload --host 0.0.0.0

* **Terminal 2 (Start the ngrok Tunnel):**
    ngrok http 8000

**7. Access the API:**
* After running the ngrok command, look for the `Forwarding` URL in Terminal 2 (e.g., `https://unwistful-doleritic-elissa.ngrok-free.dev`).
* Append `/docs` to that URL to access the Swagger UI:
  **`https://unwistful-doleritic-elissa.ngrok-free.dev/docs`**