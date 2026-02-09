import json
import sys
from datetime import datetime

def process_leave_application(data):
    """Process leave application data"""
    try:
        if isinstance(data, str):
            data = json.loads(data)
        
        # Calculate leave balance
        vl_earned = float(data.get('vl_earned', 0) or 0)
        vl_less = float(data.get('vl_less', 0) or 0)
        sl_earned = float(data.get('sl_earned', 0) or 0)
        sl_less = float(data.get('sl_less', 0) or 0)
        
        vl_balance = vl_earned - vl_less
        sl_balance = sl_earned - sl_less
        
        # Generate summary
        summary = {
            'applicant_name': data.get('name', 'N/A'),
            'office': data.get('office', 'N/A'),
            'leave_type': data.get('leave_type', 'N/A'),
            'num_days': data.get('num_days', 0),
            'inclusive_dates': data.get('inclusive_dates', 'N/A'),
            'vl_balance': vl_balance,
            'sl_balance': sl_balance,
            'processed_at': datetime.now().isoformat(),
            'status': 'Processed'
        }
        
        print(f"Leave application processed for: {summary['applicant_name']}")
        print(f"Leave Type: {summary['leave_type']}")
        print(f"Days Requested: {summary['num_days']}")
        print(f"VL Balance: {vl_balance}")
        print(f"SL Balance: {sl_balance}")
        
        return summary
        
    except Exception as e:
        print(f"Error processing application: {str(e)}")
        return None

def generate_report(applications_file='data/applications.json'):
    """Generate a report of all leave applications"""
    try:
        with open(applications_file, 'r') as f:
            applications = json.load(f)
        
        report = {
            'total_applications': len(applications),
            'pending': len([a for a in applications if a.get('status') == 'Pending']),
            'approved': len([a for a in applications if a.get('status') == 'Approved']),
            'disapproved': len([a for a in applications if a.get('status') == 'Disapproved']),
            'generated_at': datetime.now().isoformat()
        }
        
        print("")
        print("=== Leave Applications Report ===")
        print(f"Total Applications: {report['total_applications']}")
        print(f"Pending: {report['pending']}")
        print(f"Approved: {report['approved']}")
        print(f"Disapproved: {report['disapproved']}")
        
        return report
        
    except FileNotFoundError:
        print("No applications file found.")
        return None
    except Exception as e:
        print(f"Error generating report: {str(e)}")
        return None

if __name__ == '__main__':
    if len(sys.argv) > 1:
        # Process incoming application data
        data = sys.argv[1]
        process_leave_application(data)
    else:
        # Generate report
        generate_report()
