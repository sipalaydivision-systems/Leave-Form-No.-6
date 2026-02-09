import openpyxl
from pathlib import Path
import json

def analyze_excel_file(filepath):
    """Analyze Excel file structure and formulas"""
    try:
        wb = openpyxl.load_workbook(filepath, data_only=False)
        ws = wb.active
        
        info = {
            'filename': Path(filepath).name,
            'sheet_name': ws.title,
            'dimensions': str(ws.dimensions),
            'cells_with_formulas': [],
            'cell_data': []
        }
        
        # Get all cells with formulas and values
        for row in ws.iter_rows(min_row=1, max_row=50):
            for cell in row:
                if cell.value is not None:
                    cell_info = {
                        'coordinate': cell.coordinate,
                        'value': str(cell.value) if not isinstance(cell.value, (int, float)) else cell.value,
                        'data_type': cell.data_type
                    }
                    
                    # Check if it's a formula
                    if cell.data_type == 'f':
                        cell_info['formula'] = cell.value
                        info['cells_with_formulas'].append(cell_info)
                    
                    info['cell_data'].append(cell_info)
        
        return info
    except Exception as e:
        return {'error': str(e), 'filename': Path(filepath).name}

# Analyze non-teaching sample
non_teaching_path = r'e:\Division Files\Leave Form No. 6\OneDrive_2026-02-05\LEAVE CARD-NON-TEACHING PERSONNEL\ACUHIDO, ELIZA B.xlsx'
teaching_path = r'e:\Division Files\Leave Form No. 6\OneDrive_2026-02-05_1\LEAVE CARD-TEACHING PERSONNEL\ABANILLA, FE.xlsx'

print("=" * 80)
print("NON-TEACHING PERSONNEL SAMPLE")
print("=" * 80)
result = analyze_excel_file(non_teaching_path)
print(f"File: {result.get('filename')}")
print(f"Sheet: {result.get('sheet_name')}")
print(f"Dimensions: {result.get('dimensions')}")
print(f"\nFormulas found: {len(result.get('cells_with_formulas', []))}")
for formula_cell in result.get('cells_with_formulas', [])[:10]:
    print(f"  {formula_cell['coordinate']}: {formula_cell.get('formula')}")

print("\n" + "=" * 80)
print("TEACHING PERSONNEL SAMPLE")
print("=" * 80)
result2 = analyze_excel_file(teaching_path)
print(f"File: {result2.get('filename')}")
print(f"Sheet: {result2.get('sheet_name')}")
print(f"Dimensions: {result2.get('dimensions')}")
print(f"\nFormulas found: {len(result2.get('cells_with_formulas', []))}")
for formula_cell in result2.get('cells_with_formulas', [])[:10]:
    print(f"  {formula_cell['coordinate']}: {formula_cell.get('formula')}")

print("\n" + "=" * 80)
print("SAMPLE CELL VALUES (First 30 cells)")
print("=" * 80)
for cell in result.get('cell_data', [])[:30]:
    print(f"{cell['coordinate']}: {cell['value']}")
