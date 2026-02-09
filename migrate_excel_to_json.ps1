# Migrate Excel data to employees.json using PowerShell
$excelFile = "F:\Division Files\Leave Form No. 6\SDO-SIPALAY-MASTER-FILE-as-of-January-2026.xlsx"
$jsonFile = "F:\Division Files\Leave Form No. 6\employees.json"

try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    
    $workbook = $excel.Workbooks.Open($excelFile, $null, $true)
    $worksheet = $workbook.Sheets(1)
    
    $usedRange = $worksheet.UsedRange
    $rows = $usedRange.Rows.Count
    
    Write-Host "Reading from Excel: $($worksheet.Name)"
    Write-Host "Total rows: $rows"
    
    $employees = @()
    $employeeId = 1
    
    # Skip header row (row 1) and read from row 2
    for ($i = 2; $i -le $rows; $i++) {
        try {
            $employeeNumber = $worksheet.Cells($i, 1).Value2
            $lastName = $worksheet.Cells($i, 2).Value2
            $firstName = $worksheet.Cells($i, 3).Value2
            $middleName = $worksheet.Cells($i, 4).Value2
            $position = $worksheet.Cells($i, 7).Value2
            $sg = $worksheet.Cells($i, 8).Value2
            $step = $worksheet.Cells($i, 9).Value2
            $salary = $worksheet.Cells($i, 10).Value2
            $schoolId = $worksheet.Cells($i, 11).Value2
            $schoolName = $worksheet.Cells($i, 12).Value2
            
            # Skip if critical data missing
            if (!$lastName -or !$firstName -or !$position) {
                continue
            }
            
            # Clean data
            $lastName = [string]$lastName -replace '\s+$'
            $firstName = [string]$firstName -replace '\s+$'
            if ($middleName) { $middleName = [string]$middleName -replace '\s+$' } else { $middleName = "" }
            $position = [string]$position -replace '\s+$'
            $schoolName = [string]$schoolName -replace '\s+$'
            
            # Convert numeric values
            [int]$sg = [int]$sg
            [int]$step = if ($step) { [int]$step } else { 1 }
            [int]$salary = if ($salary) { [int]$salary } else { 0 }
            
            $fullName = "$firstName $middleName $lastName".Trim() -replace '\s+', ' '
            $office = if ($schoolName) { $schoolName } else { "SDO" }
            
            # Create email
            $email = "$($firstName.ToLower()).$($lastName.ToLower())@deped.gov.ph" -replace '\s+', '.'
            
            $employee = @{
                "id" = $employeeId
                "officeCode" = [string]$schoolId
                "office" = $office
                "district" = "Sipalay"
                "lastName" = $lastName
                "firstName" = $firstName
                "middleName" = $middleName
                "fullName" = $fullName
                "position" = $position
                "salaryGrade" = $sg
                "step" = $step
                "salary" = $salary
                "email" = $email
                "createdAt" = (Get-Date -Format 'o')
                "leaveCredits" = 10
                "lastLeaveUpdate" = (Get-Date -Format 'o')
            }
            
            $employees += $employee
            $employeeId++
            
            if ($employeeId % 100 -eq 0) {
                Write-Host "  Processed $($employeeId - 1) employees..."
            }
        } catch {
            Write-Host "  Error on row $i`: $_"
        }
    }
    
    Write-Host ""
    Write-Host "Total employees: $($employees.Count)"
    
    # Convert to JSON and save
    $jsonContent = $employees | ConvertTo-Json -Depth 5
    $jsonContent | Out-File -FilePath $jsonFile -Encoding UTF8
    
    Write-Host "Saved to employees.json"
    
    # Print samples
    Write-Host ""
    Write-Host "Sample records:"
    $employees[0..4] | ForEach-Object {
        Write-Host "  $($_.fullName) - $($_.position) (SG $($_.salaryGrade) Step $($_.step) - ₱$($_.salary))"
    }
    
    # Salary grid summary
    Write-Host ""
    Write-Host "Salary Grade Summary:"
    $salaryGrades = @{}
    $employees | ForEach-Object {
        $sgKey = $_.salaryGrade
        $stepKey = "Step $($_.step)"
        if (!$salaryGrades[$sgKey]) {
            $salaryGrades[$sgKey] = @{}
        }
        if (!$salaryGrades[$sgKey][$stepKey]) {
            $salaryGrades[$sgKey][$stepKey] = $_.salary
        }
    }
    
    $salaryGrades.Keys | Sort-Object | ForEach-Object {
        Write-Host "  SG $_`: $(($salaryGrades[$_] | ConvertTo-Json -Compress))"
    }
    
    $workbook.Close($false)
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) > $null
    $excel.Quit()
    
} catch {
    Write-Host "Error: $_"
}
