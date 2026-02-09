# Read Excel file using COM object
$excelFile = "F:\Division Files\Leave Form No. 6\SDO-SIPALAY-MASTER-FILE-as-of-January-2026.xlsx"

try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    
    $workbook = $excel.Workbooks.Open($excelFile, $null, $true)
    $worksheet = $workbook.Sheets(1)
    
    $usedRange = $worksheet.UsedRange
    $rows = $usedRange.Rows.Count
    $cols = $usedRange.Columns.Count
    
    Write-Host "Sheet: $($worksheet.Name)"
    Write-Host "Rows: $rows, Columns: $cols"
    Write-Host ""
    
    # Read first 50 rows
    for ($i = 1; $i -le [Math]::Min(50, $rows); $i++) {
        $rowData = @()
        for ($j = 1; $j -le $cols; $j++) {
            try {
                $cellValue = $worksheet.Cells($i, $j).Value2
                if ($cellValue -eq $null) { 
                    $cellValue = ""
                }
                $rowData += [string]$cellValue
            } catch {
                $rowData += ""
            }
        }
        Write-Host "Row $i`: $($rowData -join ' | ')"
    }
    
    $workbook.Close($false)
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) > $null
    $excel.Quit()
} catch {
    Write-Host "Error: $_"
}
