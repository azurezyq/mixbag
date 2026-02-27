import json
import os
from firebase_config import db

def seed():
    with open('mock_data.json', 'r') as f:
        data = json.load(f)
    
    # Clear existing checklists
    print("Clearing existing checklists...")
    docs = db.collection('checklists').list_documents()
    for doc in docs:
        doc.delete()

    batch = db.batch()
    checklists_ref = db.collection('checklists')
    
    for item in data:
        # Generate a stable ID from name
        doc_id = item['name'].replace(' ', '_').lower()
        doc_ref = checklists_ref.document(doc_id)
        batch.set(doc_ref, item)
    
    batch.commit()
    print(f"Successfully seeded {len(data)} checklists into Firestore.")

if __name__ == "__main__":
    seed()
