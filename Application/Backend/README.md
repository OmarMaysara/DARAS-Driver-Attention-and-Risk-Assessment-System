# ADAS Fleet Intelligence API

Backend API for the Driver Attention and Reporting System (DARAS). Built with FastAPI, SQLAlchemy, and SQLite.

## Tech Stack
* **Framework**: FastAPI.
* **Database**: PostgreSQL (Supabase) for production, SQLite for local development.
* **ORM**: SQLAlchemy.
* **Data Validation**: Pydantic.
* **Authentication**: JWT (JSON Web Tokens) and bcrypt for password hashing.

## Backend Architecture
The codebase follows a modular architecture separating routing, business logic, data access, and database models:

* **`app/main.py`**: The entry point for the FastAPI application. It sets up CORS middleware, initializes the database, and registers the API routers.
* **`app/database.py`**: Handles database configuration and session management, including the toggle between production PostgreSQL and local SQLite.
* **`app/api/endpoints.py`**: Contains the API router configuration and endpoint definitions. It binds HTTP routes to the underlying business logic and handles JWT authentication dependencies.
* **`app/models/entities.py`**: Defines the database schema and table relationships using SQLAlchemy ORM models (e.g., Employers, Drivers, Devices, Readings).
* **`app/schemas/payloads.py`**: Contains Pydantic schemas used for request data validation, serialization, and Swagger API documentation.
* **`app/services/operations.py`**: The Business Logic Layer. It processes authentication, calculates hardware telemetry metrics, handles data aggregations for dashboards, and manages hardware status polling.
* **`app/crud.py`**: The Data Access Layer. It is responsible for all direct database interactions (Create, Read, Update, Delete) via SQLAlchemy.

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
