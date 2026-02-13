"""
Upload migrated data to the live Railway system via the seed endpoint.
Run this after the deployment is live.
"""
import json
import urllib.request
import os
import time

BASE_URL = "https://leave-management.up.railway.app"
SEED_KEY = "sipalay-sdo-2026-seed"
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')

def upload_data(data_type, filepath):
    """Upload a data file to the live system."""
    print(f"\nUploading {data_type}...")
    
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    print(f"  Records: {len(data) if isinstance(data, list) else 'N/A'}")
    
    payload = json.dumps({
        'secretKey': SEED_KEY,
        'dataType': data_type,
        'data': data
    }).encode('utf-8')
    
    print(f"  Payload size: {len(payload) / 1024 / 1024:.2f} MB")
    
    req = urllib.request.Request(
        f"{BASE_URL}/api/data/seed",
        data=payload,
        headers={'Content-Type': 'application/json'},
        method='POST'
    )
    
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            result = json.loads(resp.read())
            print(f"  ✓ {result.get('message', 'OK')}")
            return True
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"  ✗ HTTP {e.code}: {body}")
        return False
    except Exception as e:
        print(f"  ✗ Error: {e}")
        return False

def check_status():
    """Check system status."""
    try:
        req = urllib.request.Request(f"{BASE_URL}/api/system-status")
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
            print(f"\nSystem Status:")
            print(f"  Volume: {'✓' if result.get('volumeMounted') else '✗'}")
            fc = result.get('fileCounts', {})
            for k, v in fc.items():
                print(f"  {k}: {v}")
            return result
    except Exception as e:
        print(f"Cannot reach server: {e}")
        return None

def main():
    print("=" * 60)
    print("DATA UPLOAD TO LIVE SYSTEM")
    print("=" * 60)
    
    # Check if server is up
    print("\nChecking server status...")
    status = check_status()
    if not status:
        print("Server not reachable. Wait for deployment to complete.")
        return
    
    # Upload data files in order
    files_to_upload = [
        ('users', os.path.join(DATA_DIR, 'users.json')),
        ('leavecards', os.path.join(DATA_DIR, 'leavecards.json')),
        ('cto-records', os.path.join(DATA_DIR, 'cto-records.json')),
    ]
    
    for data_type, filepath in files_to_upload:
        if os.path.exists(filepath):
            success = upload_data(data_type, filepath)
            if not success:
                print(f"Failed to upload {data_type}. Stopping.")
                return
            time.sleep(2)  # Small delay between uploads
        else:
            print(f"  Skipping {data_type}: file not found")
    
    # Verify
    print("\n" + "=" * 60)
    print("VERIFICATION")
    print("=" * 60)
    check_status()
    
    print("\n✓ Data upload complete!")

if __name__ == '__main__':
    main()
