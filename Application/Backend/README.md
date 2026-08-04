# ADAS Fleet Intelligence API

Backend API for the Driver Attention and Reporting System (DARAS). Built with FastAPI, SQLAlchemy, and SQLite.[cite: 1]

## Tech Stack
* **Framework**: FastAPI.[cite: 2, 6]
* **Database**: PostgreSQL (Supabase) for production, SQLite for local development.[cite: 5]
* **ORM**: SQLAlchemy.[cite: 2, 5]
* **Data Validation**: Pydantic.[cite: 2, 9]
* **Authentication**: JWT (JSON Web Tokens) and bcrypt for password hashing.[cite: 2, 10]

## Backend Architecture
The codebase follows a modular architecture separating routing, business logic, data access, and database models:

* **`app/main.py`**: The entry point for the FastAPI application.[cite: 6] It sets up CORS middleware, initializes the database, and registers the API routers.[cite: 6]
* **`app/database.py`**: Handles database configuration and session management, including the toggle between production PostgreSQL and local SQLite.[cite: 5]
* **`app/api/endpoints.py`**: Contains the API router configuration and endpoint definitions.[cite: 7] It binds HTTP routes to the underlying business logic and handles JWT authentication dependencies.[cite: 7]
* **`app/models/entities.py`**: Defines the database schema and table relationships using SQLAlchemy ORM models (e.g., Employers, Drivers, Devices, Readings).[cite: 8]
* **`app/schemas/payloads.py`**: Contains Pydantic schemas used for request data validation, serialization, and Swagger API documentation.[cite: 9]
* **`app/services/operations.py`**: The Business Logic Layer.[cite: 10] It processes authentication, calculates hardware telemetry metrics, handles data aggregations for dashboards, and manages hardware status polling.[cite: 10]
* **`app/crud.py`**: The Data Access Layer.[cite: 4] It is responsible for all direct database interactions (Create, Read, Update, Delete) via SQLAlchemy.[cite: 4]

## Prerequisites
- **Python**: Version 3.10 or higher.[cite: 1]
- **Git**: To clone the repository (if applicable).[cite: 1]
- **ngrok**: For exposing the local development server to the internet.[cite: 1]

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
[cite: 1]

## Setup Instructions

**1. Open a terminal in the root directory of the project (`/adas-backend`).**[cite: 1]

**2. Create a Virtual Environment:**[cite: 1]
    python -m venv venv
[cite: 1]

**3. Activate the Virtual Environment:**[cite: 1]
* **Windows:**[cite: 1]
    venv\Scripts\activate
[cite: 1]
* **macOS / Linux:**[cite: 1]
    source venv/bin/activate
[cite: 1]

**4. Install Dependencies:**[cite: 1]
    pip install -r requirements.txt
[cite: 1]

**5. Install and Configure ngrok:**[cite: 1]
* Download and install [ngrok](https://ngrok.com/download).[cite: 1]
* Sign up for a free account to get an authentication token.[cite: 1]
* Authenticate your ngrok agent in the terminal:[cite: 1]
    ngrok config add-authtoken <YOUR_AUTHTOKEN>
[cite: 1]

**6. Run the Server:**[cite: 1]
You will need two separate terminal windows running simultaneously.[cite: 1]

* **Terminal 1 (Start the FastAPI Server):**[cite: 1]
    uvicorn app.main:app --reload --host 0.0.0.0
[cite: 1]

* **Terminal 2 (Start the ngrok Tunnel):**[cite: 1]
    ngrok http 8000
[cite: 1]

**7. Access the API:**[cite: 1]
* After running the ngrok command, look for the `Forwarding` URL in Terminal 2 (e.g., `https://unwistful-doleritic-elissa.ngrok-free.dev`).[cite: 1]
* Append `/docs` to that URL to access the Swagger UI:[cite: 1]
  **`https://unwistful-doleritic-elissa.ngrok-free.dev/docs`**[cite: 1]
