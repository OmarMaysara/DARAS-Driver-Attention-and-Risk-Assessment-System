\# ADAS Fleet Intelligence API



Backend API for the Driver Attention and Reporting System (DARAS). Built with FastAPI, SQLAlchemy, and SQLite.



\## Prerequisites

\- \*\*Python\*\*: Version 3.10 or higher.

\- \*\*Git\*\*: To clone the repository (if applicable).

\- \*\*ngrok\*\*: For exposing the local development server to the internet.



\## Project Structure

Ensure your files are structured like this before starting:



```text

/adas-backend

├── requirements.txt

└── app/

&#x20;   ├── \_\_init\_\_.py

&#x20;   ├── main.py

&#x20;   ├── crud.py

&#x20;   ├── database.py

&#x20;   ├── api/

&#x20;   │   └── endpoints.py

&#x20;   ├── models/

&#x20;   │   └── entities.py

&#x20;   ├── schemas/

&#x20;   │   └── payloads.py

&#x20;   └── services/

&#x20;       └── operations.py

```



\## Setup Instructions



\*\*1. Open a terminal in the root directory of the project (`/adas-backend`).\*\*



\*\*2. Create a Virtual Environment:\*\*

```bash

python -m venv venv

```



\*\*3. Activate the Virtual Environment:\*\*

\* \*\*Windows:\*\*

```cmd

&#x20; venv\\Scripts\\activate

&#x20; ```

\* \*\*macOS / Linux:\*\*

```bash

&#x20; source venv/bin/activate

&#x20; ```



\*\*4. Install Dependencies:\*\*

```bash

pip install -r requirements.txt

```



\*\*5. Install and Configure ngrok:\*\*

\* Download and install \[ngrok](https://ngrok.com/download).

\* Sign up for a free account to get an authentication token.

\* Authenticate your ngrok agent in the terminal:

```bash

&#x20; ngrok config add-authtoken <YOUR\_AUTHTOKEN>

&#x20; ```



\*\*6. Run the Server:\*\*

You will need two separate terminal windows running simultaneously.



\* \*\*Terminal 1 (Start the FastAPI Server):\*\*

```bash

&#x20; uvicorn app.main:app --reload --host 0.0.0.0

&#x20; ```



\* \*\*Terminal 2 (Start the ngrok Tunnel):\*\*

```bash

&#x20; ngrok http 8000

&#x20; ```



\*\*7. Access the API:\*\*

\* After running the ngrok command, look for the `Forwarding` URL in Terminal 2 (e.g., `https://unwistful-doleritic-elissa.ngrok-free.dev`).

\* Append `/docs` to that URL to access the Swagger UI:

&#x20; \*\*`https://unwistful-doleritic-elissa.ngrok-free.dev/docs`\*\*

````</YOUR\_AUTHTOKEN>

