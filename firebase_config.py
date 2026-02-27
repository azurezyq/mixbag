import os
import firebase_admin
from firebase_admin import credentials, firestore, auth

# Path to service account key file from environment variable
cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")

if cred_path and os.path.exists(cred_path):
    cred = credentials.Certificate(cred_path)
    firebase_admin.initialize_app(cred)
else:
    # Fallback to default credentials (works on GCP/Firebase environments)
    try:
        firebase_admin.initialize_app()
    except Exception as e:
        print(f"Warning: Firebase Admin SDK not initialized: {e}")

# Optional: Specify a database ID if not using "(default)"
database_id = os.environ.get("FIREBASE_DATABASE_ID", "(default)")
db = firestore.client(database_id=database_id)
auth_client = auth
